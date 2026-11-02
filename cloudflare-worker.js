    import { WorkerEntrypoint } from "cloudflare:workers";

    /**
     * HindiAnime Stream Worker (Worker-native source resolver)
     *
     * Routes:
     *   GET /stream?id=&season=&ep=  — Legacy stream resolver retained for fallback.
     *   GET /sources?id=&season=&ep= — Resolves HLS, MyStream, Google Drive and PlayZen
     *                                   directly from their source providers.
     *   GET /hls-proxy?url=<encoded>&referer=<encoded>&origin=<encoded>
     *                                — Proxies HLS/M3U8 streams with the required Referer/Origin
     *                                   headers so browsers can play them cross-origin (incl. localhost).
     *   GET /?url=<encoded>          — General CORS proxy for media streams
     *
     * Deploy at: dash.cloudflare.com → Workers & Pages → wispy-cherry-6934
     */

    const BROWSER_UA =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    const PROXY_SECRET_BINDING = "HINDIANIME_PROXY_SECRET";
    const PROXY_SECRET_HEADER = "x-hindianime-proxy-secret";
    const PUBLIC_STREAM_API_BINDING = "PUBLIC_STREAM_API_ENABLED";
    const PUBLIC_SOURCE_RESOLVER_BINDING = "PUBLIC_SOURCE_RESOLVER_ENABLED";
    const ANIMESALT_HOMEPAGE_URL = "https://animesalt.cx/";
    const HOMEPAGE_CACHE_CONTROL = "public, max-age=300, stale-if-error=86400";
    const HOMEPAGE_KV_BINDING = "ANIMESALT_HOMEPAGE_KV";
    const HOMEPAGE_KV_KEY = "animesalt-homepage:last-good:v1";
    const HOMEPAGE_COOLDOWN_KEY = "animesalt-homepage:upstream-cooldown:v1";
    const HOMEPAGE_MAX_STALE_MS = 24 * 60 * 60 * 1000;
    const HOMEPAGE_FRESH_MS = 5 * 60 * 1000;
    const HOMEPAGE_CHALLENGE_COOLDOWN_MS = 5 * 60 * 1000;
    const HOMEPAGE_PROBE_LEASE_MS = 30 * 1000;
    const HOMEPAGE_TIMEOUT_MS = 10000;
    const HOMEPAGE_MAX_BYTES = 2 * 1024 * 1024;
    const CATALOG_FRESH_MS = 5 * 60 * 1000;
    const CATALOG_TIMEOUT_MS = 8000;
    const CATALOG_FEED_MAX_BYTES = 2 * 1024 * 1024;
    const CATALOG_SITEMAP_INDEX_MAX_BYTES = 512 * 1024;
    const CATALOG_SITEMAP_MAX_BYTES = 4 * 1024 * 1024;
    const CATALOG_MAX_SITEMAPS = 6;
    const GENERAL_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;
    const ANIMESALT_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
    const DATA_SNAPSHOT_PREFIX = "animesalt:data:v1:";
    const DATA_SNAPSHOT_FRESH_MS = 15 * 60 * 1000;
    const DETAIL_SNAPSHOT_FRESH_MS = 6 * 60 * 60 * 1000;
    const DATA_SNAPSHOT_MAX_STALE_MS = 24 * 60 * 60 * 1000;
    const STREAM_LOOKUP_CACHE_TTL_MS = 90 * 1000;
    const streamLookupCache = new Map();
    const streamLookupInflight = new Map();
    const ravokHlsCache = new Map();

    // KV coordinates cooldowns between warm Worker isolates. These local values
    // additionally suppress concurrent/repeated work within the current isolate.
    let homepageLocalCooldownUntil = 0;
    let homepageLocalProbeUntil = 0;
    let homepageLocalProbeInProgress = false;

    const ALLOWED_ORIGINS = [
      "https://hindi-anime.com",
      "https://hindianime-seven.vercel.app",
      "http://localhost:3000",
      "https://localhost:3000",
      "http://localhost:3001",
      "https://localhost:3001",
    ];

    const ALLOWED_GENERAL_HOSTS = new Set([
      "animesalt.cx",
      "www.animesalt.cx",
      "img.animesalt.cx",
      "as-cdn.top",
      "as-cdn23.top",
      "as-cdn24.top",
      "as-cdn25.top",
      "as-cdn26.top",
      "ravok.buzz",
      "animeflash.live",
      "www.animeflash.live",
      "archive.animeinfinity.me",
    ]);

    const ALLOWED_CDN_HOSTS = new Set([
      "as-cdn.top",
      "as-cdn23.top",
      "as-cdn24.top",
      "as-cdn25.top",
      "as-cdn26.top",
    ]);

    function isAllowedRavokTarget(url) {
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        url.hash ||
        url.search !== ""
      ) return false;
      // MyStream embed pattern: /embed/<id>, /e/<id>, or /video/<id> with alphanumeric/dash token (3 to 80 chars)
      return /^\/(?:embed|e|video)\/[a-zA-Z0-9_-]{3,80}$/.test(url.pathname);
    }

    function isAllowedAnimeFlashTarget(url) {
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        url.hash
      ) return false;
      return /^\/(?:episode|movie|anime)\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?\/?$/.test(url.pathname);
    }

    function isPositiveInteger(value, maxDigits = 12) {
      return typeof value === "string" &&
        value.length <= maxDigits &&
        /^[1-9]\d*$/.test(value) &&
        Number.isSafeInteger(Number(value));
    }

    function isSafeAnimeSaltSlug(value) {
      try {
        const decoded = decodeURIComponent(value);
        return /^[\p{L}\p{N}._-]+$/u.test(decoded);
      } catch {
        return false;
      }
    }

    function hasOnlyQueryKeys(url, allowedKeys) {
      return Array.from(url.searchParams.keys()).every((key) => allowedKeys.has(key));
    }

    function isAllowedAnimeSaltTarget(url) {
      const rawPath = url.pathname;
      const path = rawPath.endsWith("/") ? rawPath : `${rawPath}/`;
      const parts = rawPath.split("/").filter(Boolean);

      // Root homepage or search
      if (rawPath === "/" || rawPath === "") {
        return true;
      }

      // Pagination: /page/1/, /page/2/, etc.
      if (/^\/page\/[1-9]\d*\/$/.test(path)) {
        return true;
      }

      // Series and Movies
      if (parts[0] === "series" || parts[0] === "movies") {
        if (parts.length === 1) return true;
        if (parts.length === 2) return isSafeAnimeSaltSlug(parts[1]);
        if (parts.length === 3 && parts[1] === "page" && isPositiveInteger(parts[2])) return true;
        if (parts.length === 2 && (parts[1] === "feed" || parts[1].includes("sitemap"))) return true;
        return true;
      }

      // Episode: /episode/<slug>/
      if (parts[0] === "episode") {
        return parts.length >= 2 && isSafeAnimeSaltSlug(parts[1]);
      }

      // Anime details: /anime/<slug>/
      if (parts[0] === "anime") {
        return parts.length >= 2 && isSafeAnimeSaltSlug(parts[1]);
      }

      // Category (genre, language, type, etc.)
      if (parts[0] === "category") {
        return true;
      }

      // Sitemaps & Feeds
      if (rawPath.endsWith(".xml") || rawPath.includes("feed") || rawPath.includes("sitemap")) {
        return true;
      }

      // WordPress Assets & Uploads
      if (parts[0] === "wp-content" || parts[0] === "wp-includes") {
        return true;
      }

      // WordPress AJAX
      if (rawPath === "/wp-admin/admin-ajax.php") {
        return true;
      }

      return false;
    }

    function isAllowedTokoStreamTarget(url) {
      if (url.pathname !== "/api/v3/toko/stream" || url.hash) return false;
      const allowedKeys = new Set(["titles[]", "season", "episode", "stream"]);
      if (!hasOnlyQueryKeys(url, allowedKeys)) return false;

      const titles = url.searchParams.getAll("titles[]");
      const seasons = url.searchParams.getAll("season");
      const episodes = url.searchParams.getAll("episode");
      const streams = url.searchParams.getAll("stream");
      return titles.length >= 1 && titles.length <= 4 &&
        titles.every((title) => title.trim().length > 0 && title.length <= 160 && !/[\u0000-\u001f]/.test(title)) &&
        seasons.length === 1 && isPositiveInteger(seasons[0], 4) &&
        episodes.length === 1 && isPositiveInteger(episodes[0], 5) &&
        streams.length <= 1 && (streams.length === 0 || streams[0] === "0");
    }

    function isAllowedCatalogTarget(url, kind) {
      if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
        !["animesalt.cx", "www.animesalt.cx"].includes(url.hostname.toLowerCase())) return false;
      if (new RegExp(`^/${kind}/page/[1-9]\\d*/$`).test(url.pathname)) {
        return !url.search;
      }
      if (url.pathname === `/${kind}/feed/`) {
        const pages = url.searchParams.getAll("paged");
        return Array.from(url.searchParams.keys()).every((key) => key === "paged") &&
          (pages.length === 0 || (pages.length === 1 && isPositiveInteger(pages[0])));
      }
      return !url.search && (url.pathname === "/sitemap_index.xml" ||
        new RegExp(`^/${kind}-sitemap[1-9]\\d*\\.xml$`).test(url.pathname));
    }

    function decodeDataEntities(value) {
      return value
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#0*39;|&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#(x[\da-f]+|\d+);/gi, (entity, code) => {
          const point = code[0].toLowerCase() === "x"
            ? Number.parseInt(code.slice(1), 16)
            : Number.parseInt(code, 10);
          return Number.isSafeInteger(point) && point > 0 && point <= 0x10ffff
            ? String.fromCodePoint(point)
            : entity;
        })
        .replace(/\s+/g, " ")
        .trim();
    }

    function dataImage(markup) {
      const value = markup.match(/(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i)?.[1] || "";
      if (!value || value.startsWith("data:")) return null;
      try {
        const url = new URL(value, ANIMESALT_HOMEPAGE_URL);
        return url.protocol === "https:" ? url.toString() : null;
      } catch {
        return null;
      }
    }

    function dataSlug(href) {
      try {
        const url = new URL(href, ANIMESALT_HOMEPAGE_URL);
        const parts = url.pathname.split("/").filter(Boolean);
        return ["series", "movies"].includes(parts[0]) && parts[1] ? parts[1] : "";
      } catch {
        return "";
      }
    }

    function parseSnapshotCatalog(html, kind, page, headers) {
      const results = [];
      const articles = html.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/gi);
      for (const [, attributes, content] of articles) {
        if (!/(?:^|\s)post(?:\s|$)/i.test(catalogAttribute(attributes, "class"))) continue;
        const anchor = [...content.matchAll(/<a\b([^>]*)>/gi)].find(([, attrs]) =>
          /(?:^|\s)lnk-blk(?:\s|$)/i.test(catalogAttribute(attrs, "class"))
        );
        const href = (anchor ? catalogAttribute(anchor[1], "href") : "").replace(/&amp;/gi, "&");
        const slug = dataSlug(href);
        if (!slug || !href.includes(`/${kind}/`)) continue;
        const titleMarkup = content.match(/<h2\b[^>]*\bclass=["'][^"']*\bentry-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1]
          || (anchor ? catalogAttribute(anchor[1], "title") : "");
        const title = decodeDataEntities(titleMarkup);
        if (!title) continue;
        const image = dataImage(content);
        const animeUrl = new URL(href, ANIMESALT_HOMEPAGE_URL).toString();
        results.push({ title, anime_id: animeUrl, poster: image });
      }
      const totalPagesHeader = Number(headers?.get("x-catalog-total-pages"));
      const totalPages = Number.isSafeInteger(totalPagesHeader) && totalPagesHeader > 0
        ? totalPagesHeader
        : page + (results.length > 0 ? 1 : 0);
      return results.length ? { results, totalPages, currentPage: page } : null;
    }

    function parseSnapshotHomepage(html) {
      const parseArticles = (sectionName, freshDrop = false) => {
        const index = html.indexOf(sectionName);
        if (index < 0) return [];
        const partial = html.slice(index, index + 40000);
        const boundary = partial.indexOf('class="section-title', 50);
        const chunk = boundary > 0 ? partial.slice(0, boundary) : partial;
        const items = [];
        for (const [, markup] of chunk.matchAll(/<article\b[^>]*class=["'][^"']*\bpost\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi)) {
          const href = markup.match(/href=["']([^"']+)["']/i)?.[1] || "";
          const poster = dataImage(markup);
          const slug = dataSlug(href);
          const titleMarkup = markup.match(/<h2\b[^>]*class=["'][^"']*\bentry-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1] || "";
          const title = decodeDataEntities(titleMarkup) || slug.replace(/-/g, " ");
          if (!slug || !poster || !title) continue;
          const item = { title, anime_id: new URL(href, ANIMESALT_HOMEPAGE_URL).toString(), poster };
          if (freshDrop) {
            item.season = markup.match(/class=["'][^"']*\bpost-ql\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]?.match(/\d+/)?.[0] || "1";
            const yearText = markup.match(/class=["'][^"']*\byear\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "";
            item.episode = yearText.match(/EP:\s*(\d+(?:-\d+)?)/i)?.[1] || yearText.match(/\d+/)?.[0] || "1";
          }
          items.push(item);
        }
        return items;
      };

      const parseCharts = (sectionName) => {
        const index = html.indexOf(sectionName);
        if (index < 0) return [];
        const partial = html.slice(index, index + 40000);
        const boundary = partial.indexOf('class="section-title', 50);
        const chunk = boundary > 0 ? partial.slice(0, boundary) : partial;
        const items = [];
        for (const [, markup] of chunk.matchAll(/<div\b[^>]*class=["'][^"']*\bchart-item\b[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*\bchart-item\b|$)/gi)) {
          const href = markup.match(/href=["']([^"']+)["']/i)?.[1] || "";
          const titleMarkup = markup.match(/class=["']chart-title["'][^>]*>([\s\S]*?)<\//i)?.[1] || "";
          const title = decodeDataEntities(titleMarkup);
          const poster = dataImage(markup);
          const slug = dataSlug(href);
          if (!slug || !title || !poster) continue;
          items.push({
            title,
            anime_id: new URL(href, ANIMESALT_HOMEPAGE_URL).toString(),
            poster,
            rank: markup.match(/class=["']chart-number["'][^>]*>(\d+)</i)?.[1] || String(items.length + 1),
          });
        }
        return items;
      };

      const results = {
        mostWatched_Series: parseCharts("Most-Watched Series"),
        mostWatched_Films: parseCharts("Most-Watched Films"),
        fresh_drops: parseArticles("Fresh Drops", true),
        on_air_series: parseArticles("On-Air Series"),
        latest_animeMovies: parseArticles("Latest Anime Movies"),
      };
      if (!results.mostWatched_Series.length && !results.mostWatched_Films.length && !results.fresh_drops.length) return null;
      return { success: true, data: { success: true, results } };
    }

    function parseSnapshotEpisodes(html) {
      const episodes = [];
      const articles = html.matchAll(/<article\b[^>]*class=["'][^"']*\bepisodes\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi);
      for (const [, markup] of articles) {
        const image = dataImage(markup) || "";
        const number = markup.match(/<span\b[^>]*class=["'][^"']*\bnum-epi\b[^"']*["'][^>]*>([^<]+)<\/span>/i)?.[1]?.trim() || "";
        const titleMarkup = markup.match(/<h2\b[^>]*class=["'][^"']*\bentry-title\b[^"']*["'][^>]*>([^<]+)<\/h2>/i)?.[1] || "";
        const title = decodeDataEntities(titleMarkup) || (number ? `Episode ${number}` : `Episode ${episodes.length + 1}`);
        const link = markup.match(/href=["'](https:\/\/animesalt\.cx\/episode\/[^"']+)["']/i)?.[1] || "";
        const linkEpisode = link.match(/-(\d+)x(\d+)\/?/);
        const parsedNumber = Number(number) || Number(linkEpisode?.[2]) || episodes.length + 1;
        episodes.push({ title, season: String(parsedNumber), image });
      }
      return episodes;
    }

    function parseSnapshotAnimeDetail(html, slug, isMovie) {
      const visible = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
      if (!/<html\b/i.test(html) || /<title>\s*just a moment/i.test(html) || /(?:page you are looking for does not exist|error 404|nothing found)/i.test(visible)) return null;

      const rawTitle = html.match(/<h1\b[^>]*class=["'][^"']*\bentry-title\b[^"']*["'][^>]*>([^<]+)<\/h1>/i)?.[1]
        || html.match(/<title>([^<]+)<\/title>/i)?.[1] || "";
      const title = decodeDataEntities(rawTitle).replace(/\s*-\s*Anime\s*Salt.*$/i, "").replace(/^[【\[\s]+|[】\]\s]+$/g, "").trim();
      if (!title || /(?:404|not found)/i.test(title)) return null;

      const overviewBlock = html.match(/id=["']overview-text["'][^>]*>([\s\S]*?)<\/div>/i)
        || html.match(/<div[^>]*class=["'][^"']*(?:description|entry-content|synopsis)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
      const paragraph = overviewBlock?.[1]?.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || overviewBlock?.[1] || "";
      let synopsis = decodeDataEntities(paragraph);
      if (!synopsis || synopsis.length < 16 || /^language:/i.test(synopsis)) {
        const description = html.match(/<meta\s+(?:property=["']og:description["']\s+content=["']([^"']+)["']|content=["']([^"']+)["']\s+property=["']og:description["'])/i);
        synopsis = decodeDataEntities(description?.[1] || description?.[2] || "");
      }

      const imageVariable = html.match(/(?:let|var)\s+image\s*=["']((?:https:)?\/\/[^"']+)["']/i)?.[1];
      const heroImage = html.match(/<img[^>]+style=["'][^"']*14rem[^"']*["'][^>]+data-src=["']((?:https:)?\/\/[^"']+)["']/i)?.[1]
        || html.match(/<img[^>]+data-src=["']((?:https:)?\/\/[^"']+)["'][^>]+style=["'][^"']*14rem[^"']*["']/i)?.[1];
      const themeImage = html.match(/<img[^>]+class=["'][^"']*\bTPostImg\b[^"']*["'][^>]+(?:data-src|src)=["']([^"']+)["']/i)?.[1];
      const ogImage = html.match(/<meta\s+(?:property=["']og:image["']\s+content=["']([^"']+)["']|content=["']([^"']+)["']\s+property=["']og:image["'])/i);
      const wideImage = html.match(/<img[^>]+class=["'][^"']*\bTPostBg\b[^"']*["'][^>]+data-src=["']([^"']+)["']/i)?.[1]
        || html.match(/<img[^>]+data-src=["']([^"']+)["'][^>]+class=["'][^"']*\bTPostBg\b[^"']*["']/i)?.[1];
      const normalizeImage = (value) => {
        if (!value || /logo|icon|favicon|cropped-/i.test(value)) return "";
        try {
          const url = new URL(value, ANIMESALT_HOMEPAGE_URL);
          return url.protocol === "https:" ? url.toString().replace(/\/w(?:185|200|300|342)\//, "/w500/") : "";
        } catch { return ""; }
      };
      const poster = normalizeImage(imageVariable || heroImage || themeImage || ogImage?.[1] || ogImage?.[2] || wideImage);
      const backdrop = normalizeImage(wideImage) || poster;
      const seasonButtons = [...html.matchAll(/<a\b[^>]*>/gi)]
        .map(([tag]) => tag)
        .filter((tag) => /class=["'][^"']*\bseason-btn\b[^"']*["']/i.test(tag));
      const seasons = [...new Set(seasonButtons
        .map((tag) => Number(tag.match(/data-season=["'](\d+)["']/i)?.[1]))
        .filter(Number.isSafeInteger))].sort((a, b) => a - b);
      const postId = seasonButtons.map((tag) => tag.match(/data-post=["'](\d+)["']/i)?.[1]).find(Boolean)
        || html.match(/id=["']post-(\d+)["']/i)?.[1] || "";
      const genres = [...new Set([...html.matchAll(/\/category\/genre\/([a-zA-Z0-9_-]+)/gi)].map((match) => match[1].toLowerCase()))]
        .filter((genre) => !["animation", "adult-cast", "award-winning", "subbed", "dubbed", "hindi", "english"].includes(genre));
      const episodes = isMovie ? [{ title: "Full Movie", season: "1", image: poster }] : parseSnapshotEpisodes(html);
      return {
        postId,
        seasons: isMovie ? [1] : (seasons.length ? seasons : [1]),
        s1Episodes: episodes,
        synopsis: synopsis || undefined,
        title,
        poster: poster || undefined,
        backdrop: backdrop || poster || undefined,
        isMovie,
        genres,
        slug,
      };
    }

    async function fetchAnimeSaltHtml(url, timeoutMs = 8000) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const request = new Request(url, {
          method: "GET",
          headers: {
            "User-Agent": BROWSER_UA,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            Referer: "https://animesalt.cx/",
          },
          redirect: "manual",
        });
        const result = await fetchWithAllowedRedirects(request, isAllowedGeneralTarget, { signal: controller.signal }, 3);
        if (!result.response?.ok || !(result.response.headers.get("content-type") || "").toLowerCase().includes("text/html")) return null;
        return await readResponseTextWithLimit(result.response, ANIMESALT_RESPONSE_MAX_BYTES);
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    }

    async function readDataSnapshot(env, key) {
      const kv = env?.[HOMEPAGE_KV_BINDING];
      if (!kv) return null;
      try {
        const raw = await kv.get(`${DATA_SNAPSHOT_PREFIX}${key}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed?.version !== 1 || typeof parsed.storedAt !== "number" || !parsed.data) return null;
        const ageMs = Date.now() - parsed.storedAt;
        return ageMs >= 0 && ageMs <= DATA_SNAPSHOT_MAX_STALE_MS ? { data: parsed.data, ageMs } : null;
      } catch {
        return null;
      }
    }

    async function writeDataSnapshot(env, key, data) {
      const kv = env?.[HOMEPAGE_KV_BINDING];
      if (!kv) return false;
      try {
        await kv.put(`${DATA_SNAPSHOT_PREFIX}${key}`, JSON.stringify({ version: 1, storedAt: Date.now(), data }), {
          expirationTtl: Math.ceil(DATA_SNAPSHOT_MAX_STALE_MS / 1000),
        });
        return true;
      } catch (error) {
        console.warn("[data-snapshot]", JSON.stringify({ event: "write-error", key, errorName: error instanceof Error ? error.name : "UnknownError" }));
        return false;
      }
    }

    function snapshotJson(data, request, state, ageSeconds = 0, freshSeconds = 900) {
      const maxAge = state === "fresh" || state === "refreshed" ? freshSeconds : 30;
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=900`,
          "Cloudflare-CDN-Cache-Control": `public, max-age=${maxAge}, stale-while-revalidate=900`,
          "X-Data-Snapshot": state,
          "X-Data-Age": String(Math.max(0, Math.floor(ageSeconds))),
          ...corsHeaders(request),
          "Access-Control-Expose-Headers": `${corsHeaders(request)["Access-Control-Expose-Headers"]}, X-Data-Snapshot, X-Data-Age`,
        },
      });
    }

    async function getHomepageHtml(request, env, ctx) {
      const homepageRequestUrl = new URL(`/?url=${encodeURIComponent(ANIMESALT_HOMEPAGE_URL)}`, request.url);
      const homepageRequest = new Request(homepageRequestUrl, { method: "GET", headers: request.headers });
      const homepageHandler = (ctx && ctx.exports && ctx.exports.AnimeSaltHomepageCache) ||
        (env && env.AnimeSaltHomepageCache) || new AnimeSaltHomepageCache(ctx, env);
      const response = await homepageHandler.fetch(homepageRequest);
      if (!response.ok || !(response.headers.get("content-type") || "").includes("text/html")) return null;
      return {
        html: await response.text(),
        stale: response.headers.get("x-animesalt-cache") === "stale",
      };
    }

    async function refreshDataSnapshot(key, request, env, ctx) {
      let data = null;
      let stale = false;
      if (key === "homepage") {
        const homepage = await getHomepageHtml(request, env, ctx);
        if (homepage) {
          data = parseSnapshotHomepage(homepage.html);
          stale = homepage.stale;
        }
      } else if (/^catalog:(?:series|movies):[1-9]\d*$/.test(key)) {
        const [, kind, pageText] = key.split(":");
        const page = Number(pageText);
        const routeUrl = new URL(`/catalog?kind=${kind}&page=${page}`, request.url);
        const response = await handleCatalog(routeUrl, request);
        if (response.ok && (response.headers.get("content-type") || "").includes("text/html")) {
          const html = await response.text();
          data = parseSnapshotCatalog(html, kind, page, response.headers);
          stale = response.headers.get("x-catalog-cache") === "stale";
        }
      } else if (key.startsWith("anime:")) {
        const slug = key.slice("anime:".length);
        const seriesUrl = `https://animesalt.cx/series/${encodeURIComponent(slug)}/`;
        const movieUrl = `https://animesalt.cx/movies/${encodeURIComponent(slug)}/`;
        const [seriesHtml, movieHtml] = await Promise.all([
          fetchAnimeSaltHtml(seriesUrl),
          fetchAnimeSaltHtml(movieUrl),
        ]);
        data = (seriesHtml && parseSnapshotAnimeDetail(seriesHtml, slug, false))
          || (movieHtml && parseSnapshotAnimeDetail(movieHtml, slug, true));
      } else if (key.startsWith("episodes:")) {
        const [, slug, seasonText] = key.split(":");
        const season = Number(seasonText);
        if (!Number.isSafeInteger(season) || season < 1 || season > 100) return null;
        const animeSnapshot = await readDataSnapshot(env, `anime:${slug}`);
        const animeResult = animeSnapshot?.data
          ? { data: animeSnapshot.data }
          : await refreshDataSnapshot(`anime:${slug}`, request, env, ctx);
        const animeData = animeResult?.data;
        if (!animeData) return null;
        if (season === 1) {
          data = animeData.s1Episodes;
        } else if (animeData.isMovie) {
          data = [];
        } else if (animeData.postId) {
          const ajaxUrl = `https://animesalt.cx/wp-admin/admin-ajax.php?action=action_select_season&season=${season}&post=${encodeURIComponent(animeData.postId)}`;
          const ajaxController = new AbortController();
          const ajaxTimeout = setTimeout(() => ajaxController.abort(), 8000);
          try {
            const ajaxRequest = new Request(ajaxUrl, {
              method: "GET",
              headers: {
                "User-Agent": BROWSER_UA,
                Accept: "text/html,*/*;q=0.8",
                "Referer": `https://animesalt.cx/series/${encodeURIComponent(slug)}/`,
                "X-Requested-With": "XMLHttpRequest",
              },
              redirect: "manual",
            });
            const ajaxResponse = await fetchWithAllowedRedirects(ajaxRequest, isAllowedGeneralTarget, { signal: ajaxController.signal }, 2);
            if (ajaxResponse.response?.ok) {
              const body = await readResponseTextWithLimit(ajaxResponse.response, ANIMESALT_RESPONSE_MAX_BYTES);
              data = parseSnapshotEpisodes(body);
            }
          } finally {
            clearTimeout(ajaxTimeout);
          }
        }
        if (Array.isArray(data) && data.length) {
          data = {
            success: true,
            results: {
              totalSeasons: String(animeData.seasons?.length || 1),
              seasons: (animeData.seasons || [1]).map((number) => ({ season: String(number), text: `Season ${number}` })),
              episodes: data,
            },
          };
        }
      }
      if (!data) return null;
      if (!stale) await writeDataSnapshot(env, key, data);
      return { data, stale };
    }

    async function serveDataSnapshot(key, request, env, ctx) {
      const snapshot = await readDataSnapshot(env, key);
      const freshMs = key.startsWith("anime:") || key.startsWith("episodes:")
        ? DETAIL_SNAPSHOT_FRESH_MS
        : DATA_SNAPSHOT_FRESH_MS;
      const freshSeconds = Math.floor(freshMs / 1000);
      if (snapshot && snapshot.ageMs <= freshMs) {
        return snapshotJson(snapshot.data, request, "fresh", snapshot.ageMs / 1000, freshSeconds);
      }
      if (snapshot) {
        ctx?.waitUntil?.(refreshDataSnapshot(key, request, env, ctx).catch(() => null));
        return snapshotJson(snapshot.data, request, "stale", snapshot.ageMs / 1000, freshSeconds);
      }
      const refreshed = await refreshDataSnapshot(key, request, env, ctx);
      if (!refreshed) return jsonResponse({ success: false, message: "Data temporarily unavailable" }, 503, request);
      return snapshotJson(refreshed.data, request, refreshed.stale ? "stale" : "refreshed", 0, freshSeconds);
    }

    async function handleDataApi(url, request, env, ctx) {
      if (request.method !== "GET") return jsonResponse({ success: false, message: "Method not allowed" }, 405, request);
      if (url.pathname === "/data/homepage") return serveDataSnapshot("homepage", request, env, ctx);
      if (url.pathname === "/data/catalog") {
        const kinds = url.searchParams.getAll("kind");
        const pages = url.searchParams.getAll("page");
        const unexpected = [...url.searchParams.keys()].some((key) => key !== "kind" && key !== "page");
        const kind = kinds.length === 1 ? kinds[0] : "";
        const pageText = pages.length === 1 ? pages[0] : "1";
        const page = Number(pageText);
        if (unexpected || (kind !== "series" && kind !== "movies") || !/^[1-9]\d*$/.test(pageText) || page > 500 || !Number.isSafeInteger(page)) {
          return jsonResponse({ success: false, message: "Invalid catalog request" }, 400, request);
        }
        return serveDataSnapshot(`catalog:${kind}:${page}`, request, env, ctx).then(async (response) => {
          if (!response.ok) return response;
          const catalog = await response.json();
          return snapshotJson({ success: true, results: catalog }, request, response.headers.get("X-Data-Snapshot") || "fresh", Number(response.headers.get("X-Data-Age")) || 0, 900);
        });
      }
      if (url.pathname === "/data/anime" || url.pathname === "/data/episodes") {
        const allowed = url.pathname === "/data/anime" ? new Set(["slug"]) : new Set(["slug", "season"]);
        if (![...url.searchParams.keys()].every((key) => allowed.has(key))) return jsonResponse({ success: false, message: "Invalid data request" }, 400, request);
        const slugs = url.searchParams.getAll("slug");
        const slug = slugs.length === 1 ? slugs[0].toLowerCase() : "";
        if (!/^[a-z0-9]+(?:[a-z0-9_-]*[a-z0-9])?$/.test(slug) || slug.length > 120) return jsonResponse({ success: false, message: "Invalid anime slug" }, 400, request);
        if (url.pathname === "/data/anime") return serveDataSnapshot(`anime:${slug}`, request, env, ctx);
        const seasons = url.searchParams.getAll("season");
        const seasonText = seasons.length === 1 ? seasons[0] : seasons.length === 0 ? "1" : "";
        const season = Number(seasonText);
        if (!/^[1-9]\d*$/.test(seasonText) || !Number.isSafeInteger(season) || season > 100) return jsonResponse({ success: false, message: "Invalid season" }, 400, request);
        return serveDataSnapshot(`episodes:${slug}:${season}`, request, env, ctx);
      }
      return jsonResponse({ success: false, message: "Not found" }, 404, request);
    }

    function isAllowedGeneralTarget(url) {
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        url.hash ||
        !ALLOWED_GENERAL_HOSTS.has(url.hostname.toLowerCase())
      ) return false;

      const host = url.hostname.toLowerCase();
      if (host === "animesalt.cx" || host === "www.animesalt.cx" || host === "img.animesalt.cx") {
        return isAllowedAnimeSaltTarget(url);
      }
      if (ALLOWED_CDN_HOSTS.has(host)) {
        return true;
      }
      if (host === "ravok.buzz") {
        return isAllowedRavokTarget(url);
      }
      if (host === "animeflash.live" || host === "www.animeflash.live") {
        return isAllowedAnimeFlashTarget(url);
      }
      if (host === "archive.animeinfinity.me") {
        return /^\/player\/[a-zA-Z0-9+/=_%-]+$/.test(url.pathname);
      }
      return false;
    }

    function secretsMatch(received, expected) {
      if (received.length !== expected.length) return false;
      let mismatch = 0;
      for (let index = 0; index < received.length; index += 1) {
        mismatch |= received.charCodeAt(index) ^ expected.charCodeAt(index);
      }
      return mismatch === 0;
    }

    function limitProxyResponseBody(response, maxBytes, controller, timeout) {
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        clearTimeout(timeout);
        controller.abort();
        response.body?.cancel("response-size-limit").catch(() => {});
        return null;
      }
      if (!response.body) {
        clearTimeout(timeout);
        return response;
      }

      const reader = response.body.getReader();
      let receivedBytes = 0;
      const body = new ReadableStream({
        async pull(streamController) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              clearTimeout(timeout);
              reader.releaseLock();
              streamController.close();
              return;
            }
            receivedBytes += value.byteLength;
            if (receivedBytes > maxBytes) {
              clearTimeout(timeout);
              controller.abort();
              await reader.cancel("response-size-limit").catch(() => {});
              streamController.error(new Error("Proxy response exceeded size limit"));
              return;
            }
            streamController.enqueue(value);
          } catch (error) {
            clearTimeout(timeout);
            streamController.error(error);
          }
        },
        async cancel(reason) {
          clearTimeout(timeout);
          controller.abort();
          await reader.cancel(reason).catch(() => {});
        },
      });
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    function validateProxySecret(request, env, required = false) {
      const supplied = request.headers.get(PROXY_SECRET_HEADER);
      if (supplied === null && !required) return null;

      const expected = env?.[PROXY_SECRET_BINDING];
      if (typeof expected !== "string" || expected.length === 0) {
        console.error("[proxy-auth]", JSON.stringify({ event: "secret-binding-unavailable" }));
        return jsonResponse({ error: "Proxy authentication unavailable" }, 503, request);
      }
      if (supplied === null) {
        return jsonResponse({ error: "Unauthorized" }, 401, request);
      }
      if (!secretsMatch(supplied, expected)) {
        return jsonResponse({ error: "Unauthorized" }, 403, request);
      }
      return null;
    }

    async function fetchWithAllowedRedirects(request, isAllowedTarget, fetchOptions = {}, maxRedirects = 5) {
      let currentUrl = new URL(request.url);
      const redirectStatuses = new Set([301, 302, 303, 307, 308]);

      for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
        if (!isAllowedTarget(currentUrl)) return { response: null, blockedRedirect: redirects > 0 };
        const currentRequest = new Request(currentUrl.toString(), {
          method: request.method,
          headers: request.headers,
          redirect: "manual",
        });
        const response = await fetch(currentRequest, fetchOptions);
        const location = response.headers.get("location");
        if (!redirectStatuses.has(response.status) || !location) {
          return { response, blockedRedirect: false };
        }

        let nextUrl;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          await response.body?.cancel().catch(() => {});
          return { response: null, blockedRedirect: true };
        }
        await response.body?.cancel().catch(() => {});
        if (!isAllowedTarget(nextUrl) || redirects === maxRedirects) {
          return { response: null, blockedRedirect: true };
        }
        currentUrl = nextUrl;
      }

      return { response: null, blockedRedirect: true };
    }

    export default {
      async scheduled(controller, env, ctx) {
        const request = new Request("https://cloud.hindi-anime.com/data/homepage", { method: "GET" });
        const keys = ["homepage", "catalog:series:1", "catalog:movies:1"];
        const refreshes = keys.map((key) => refreshDataSnapshot(key, request, env, ctx));
        const results = await Promise.allSettled(refreshes);
        console.info("[data-snapshot]", JSON.stringify({
          event: "scheduled-refresh",
          cron: controller?.cron || "unknown",
          success: results.filter((result) => result.status === "fulfilled" && result.value).length,
          total: results.length,
        }));
      },

      async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // ── CORS preflight ────────────────────────────────────────────────────────
        if (request.method === "OPTIONS") {
          return new Response(null, { status: 204, headers: corsHeaders(request) });
        }

        // Validate credentials when supplied. Public browser routes remain usable
        // without a secret; server-only Toko proxy requests require one below.
        const suppliedSecretFailure = validateProxySecret(request, env);
        if (suppliedSecretFailure) return suppliedSecretFailure;

        // ── Route: /catalog — allowlisted AnimeSalt catalog fetch only ───────────
        if (url.pathname === "/catalog") {
          return handleCatalog(url, request);
        }

        // Parsed, persistent snapshots consumed directly by the frontend.
        if (url.pathname.startsWith("/data/")) {
          return handleDataApi(url, request, env, ctx);
        }

        // ── Route: /stream — resolve streaming sources via Toko ───────────────────
        if (url.pathname === "/stream") {
          if (request.method !== "GET") {
            return jsonResponse({ success: false, message: "Method not allowed" }, 405, request);
          }
          // Keep stream resolution server-only by default. Enable public browser
          // requests only after a Cloudflare rate-limit rule is active for /stream.
          const publicStreamEnabled = env?.[PUBLIC_STREAM_API_BINDING] === "true";
          const streamAuthFailure = validateProxySecret(request, env, !publicStreamEnabled);
          if (streamAuthFailure) return streamAuthFailure;
          const allowedStreamKeys = new Set(["id", "season", "ep", "movie"]);
          const ids = url.searchParams.getAll("id");
          const seasons = url.searchParams.getAll("season");
          const episodes = url.searchParams.getAll("ep");
          const movies = url.searchParams.getAll("movie");
          if (!hasOnlyQueryKeys(url, allowedStreamKeys) || ids.length !== 1 ||
            ids[0].length > 120 || !/^[a-z0-9]+(?:[a-z0-9_-]*[a-z0-9])?$/i.test(ids[0]) ||
            seasons.length > 1 || (seasons.length === 1 && !isPositiveInteger(seasons[0], 4)) ||
            episodes.length > 1 || (episodes.length === 1 && !isPositiveInteger(episodes[0], 5)) ||
            movies.length > 1 || (movies.length === 1 && movies[0] !== "0" && movies[0] !== "1")) {
            return jsonResponse({ success: false, message: "Invalid stream request" }, 400, request);
          }
          try {
            return await handleStream(url, request);
          } catch (err) {
            return jsonResponse(
              { success: false, message: "Stream handler exception", error: String(err) },
              500,
              request
            );
          }
        }

        // Worker-native source resolver. No Node backend or backend bearer token.
        if (url.pathname === "/sources") {
          if (request.method !== "GET") {
            return jsonResponse({ success: false, message: "Method not allowed" }, 405, request);
          }
          const publicSourceResolverDisabled = env?.[PUBLIC_SOURCE_RESOLVER_BINDING] === "false";
          const streamAuthFailure = validateProxySecret(request, env, publicSourceResolverDisabled);
          if (streamAuthFailure) return streamAuthFailure;
          const ids = url.searchParams.getAll("id");
          const seasons = url.searchParams.getAll("season");
          const episodes = url.searchParams.getAll("ep");
          const movies = url.searchParams.getAll("movie");
          const allowedKeys = new Set(["id", "season", "ep", "movie"]);
          if (!hasOnlyQueryKeys(url, allowedKeys) || ids.length !== 1 || ids[0].length > 120 ||
            !/^[a-z0-9]+(?:[a-z0-9_-]*[a-z0-9])?$/i.test(ids[0]) ||
            seasons.length > 1 || (seasons.length === 1 && !isPositiveInteger(seasons[0], 4)) ||
            episodes.length > 1 || (episodes.length === 1 && !isPositiveInteger(episodes[0], 5)) ||
            movies.length > 1 || (movies.length === 1 && movies[0] !== "0" && movies[0] !== "1")) {
            return jsonResponse({ success: false, message: "Invalid stream request" }, 400, request);
          }
          return await handleSourceLookup(url, request, env);
        }

        // ── Route: /hls-proxy — proxy HLS/M3U8 streams with required headers ───────
        if (url.pathname === "/hls-proxy") {
          return handleHlsProxy(url, request, env);
        }

        // ── Route: / — general CORS proxy via ?url= ───────────────────────────────
        if (request.method !== "GET") {
          return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json", ...corsHeaders(request) },
          });
        }

        const targetUrls = url.searchParams.getAll("url");
        const targetUrl = targetUrls[0];
        if (targetUrls.length !== 1 || !targetUrl) {
          return new Response(JSON.stringify({ error: "Missing ?url= parameter" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders(request) },
          });
        }

        let parsedTarget;
        try {
          parsedTarget = new URL(targetUrl);
        } catch {
          return new Response(JSON.stringify({ error: "Invalid URL" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders(request) },
          });
        }

        if (!isAllowedGeneralTarget(parsedTarget)) {
          return new Response(JSON.stringify({ error: "Target URL not allowed" }), {
            status: 403,
            headers: { "Content-Type": "application/json", ...corsHeaders(request) },
          });
        }
        if (targetUrl.length > 8192) {
          return new Response(JSON.stringify({ error: "Target URL too long" }), {
            status: 414,
            headers: { "Content-Type": "application/json", ...corsHeaders(request) },
          });
        }

        // The browser uses /stream for Toko. Direct Toko backend proxying is only
        // used server-to-server and must carry the configured shared secret.
        if (isAllowedTokoStreamTarget(parsedTarget)) {
          const tokoAuthFailure = validateProxySecret(request, env, true);
          if (tokoAuthFailure) return tokoAuthFailure;
        }

        const isAnimeSaltHost =
          parsedTarget.hostname === "animesalt.cx" ||
          parsedTarget.hostname === "www.animesalt.cx" ||
          parsedTarget.hostname.endsWith(".animesalt.cx");

        const isAnimeFlashHost =
          parsedTarget.hostname === "animeflash.live" ||
          parsedTarget.hostname === "www.animeflash.live";

        const proxyHeaders = {
          "User-Agent": BROWSER_UA,
          Accept: request.headers.get("Accept") || "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": request.headers.get("Accept-Language") || "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          ...(isAnimeSaltHost ? {
            Referer: "https://animesalt.cx/",
            Origin: "https://animesalt.cx",
            "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
          } : {}),
          ...(isAnimeFlashHost ? {
            Referer: "https://animeflash.live/",
            Origin: "https://animeflash.live",
          } : {}),
          ...(parsedTarget.pathname.includes("admin-ajax.php") ? { "X-Requested-With": "XMLHttpRequest" } : {}),
        };

        const targetHostPath = `${parsedTarget.hostname}${parsedTarget.pathname}`;
        console.info("[general-proxy]", JSON.stringify({
          event: "handler-entry",
          target: targetHostPath,
        }));

        const isAnimeSaltTarget = parsedTarget.hostname === "animesalt.cx";
        const targetCooldownKey = isAnimeSaltTarget ? `animesalt-target-cooldown:v1:${targetUrl}` : null;
        const homepageKv = env?.[HOMEPAGE_KV_BINDING];

        // Homepage reads bypass KV cooldown state so exhausted KV quotas or an
        // old cooldown entry cannot prevent the live AnimeSalt homepage fetch.
        if (isAnimeSaltTarget && targetUrl !== ANIMESALT_HOMEPAGE_URL && homepageKv && targetCooldownKey) {
          try {
            const rawCooldown = await homepageKv.get(targetCooldownKey);
            if (rawCooldown) {
              const parsedCooldown = JSON.parse(rawCooldown);
              if (typeof parsedCooldown?.retryAt === "number" && parsedCooldown.retryAt > Date.now()) {
                return new Response(JSON.stringify({ error: "AnimeSalt target temporarily unavailable due to challenge cooldown" }), {
                  status: 503,
                  headers: {
                    "Content-Type": "application/json",
                    "x-animesalt-challenge-cooldown": "1",
                    ...corsHeaders(request),
                  },
                });
              }
            }
          } catch {}
        }

        const upstreamStartedAt = Date.now();
        const upstreamController = new AbortController();
        const upstreamTimeout = setTimeout(
          () => upstreamController.abort(),
          isAllowedTokoStreamTarget(parsedTarget) ? 28000 : 10000
        );
        try {
          const proxyRequest = new Request(targetUrl, {
            method: "GET",
            headers: proxyHeaders,
            redirect: "manual",
          });

          const { response, blockedRedirect } = await fetchWithAllowedRedirects(
            proxyRequest,
            isAllowedGeneralTarget,
            { cf: { cacheTtl: 30, cacheEverything: false }, signal: upstreamController.signal }
          );
          if (!response) {
            clearTimeout(upstreamTimeout);
            if (blockedRedirect) {
              return new Response(JSON.stringify({ error: "Redirect target not allowed" }), {
                status: 403,
                headers: { "Content-Type": "application/json", ...corsHeaders(request) },
              });
            }
            throw new Error("Proxy request failed");
          }
          const upstreamLocation = response.headers.get("location");
          let locationHostPath = null;
          if (upstreamLocation) {
            try {
              const parsedLocation = new URL(upstreamLocation, targetUrl);
              locationHostPath = `${parsedLocation.hostname}${parsedLocation.pathname}`;
            } catch {
              locationHostPath = "invalid-location";
            }
          }
          console.info("[general-proxy]", JSON.stringify({
            event: "upstream-response",
            target: targetHostPath,
            status: response.status,
            server: response.headers.get("server"),
            cfRay: response.headers.get("cf-ray"),
            location: locationHostPath,
            contentType: response.headers.get("content-type"),
            elapsedMs: Date.now() - upstreamStartedAt,
          }));
          if (
            response.status === 403 &&
            parsedTarget.hostname === "animesalt.cx" &&
            parsedTarget.pathname === "/" &&
            (response.headers.get("content-type") || "").toLowerCase().includes("text/html")
          ) {
            const classifyPromise = readResponseTextWithLimit(response.clone(), 128 * 1024).then((html) => {
              const code = html.match(/\b(?:error\s*)?(1006|1009|1010|1015|1020|1026|1033)\b/i)?.[1] || null;
              const classification =
                response.headers.get("cf-mitigated")?.toLowerCase() === "challenge" ||
                /<title>\s*just a moment/i.test(html) ||
                /(?:id=["']challenge-form["']|__cf_chl_(?:tk|opt)|cf-chl-widget)/i.test(html)
                  ? "cloudflare-challenge"
                  : code === "1020" || /sorry, you have been blocked|access denied/i.test(html)
                    ? "access-denied"
                    : "unclassified-html-403";
              console.warn("[general-proxy]", JSON.stringify({
                event: "upstream-403-classification",
                target: targetHostPath,
                classification,
                cloudflareCode: code,
              }));
            }).catch((err) => {
              console.warn("[general-proxy]", JSON.stringify({
                event: "upstream-403-classification",
                target: targetHostPath,
                classification: "body-inspection-error",
                errorName: err instanceof Error ? err.name : "UnknownError",
              }));
            });
            if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(classifyPromise);
            else classifyPromise.catch(() => {});
          }
          const boundedResponse = limitProxyResponseBody(response, ANIMESALT_RESPONSE_MAX_BYTES, upstreamController, upstreamTimeout);
          if (!boundedResponse) {
            return new Response(JSON.stringify({ error: "Proxy response exceeded size limit" }), {
              status: 413,
              headers: { "Content-Type": "application/json", ...corsHeaders(request) },
            });
          }
          const responseHeaders = new Headers(response.headers);
          const corsH = corsHeaders(request);
          for (const [k, v] of Object.entries(corsH)) responseHeaders.set(k, v);
          responseHeaders.delete("x-frame-options");
          responseHeaders.delete("content-security-policy");
          responseHeaders.delete("content-security-policy-report-only");
          responseHeaders.delete("set-cookie");

          if (isAnimeSaltTarget && response.status === 403) {
            if (homepageKv && targetCooldownKey) {
              const retryAt = Date.now() + HOMEPAGE_CHALLENGE_COOLDOWN_MS;
              await homepageKv.put(targetCooldownKey, JSON.stringify({ version: 1, state: "challenge", retryAt }), {
                expirationTtl: Math.max(60, Math.ceil(HOMEPAGE_CHALLENGE_COOLDOWN_MS / 1000)),
              }).catch(() => {});
            }
            responseHeaders.set("x-animesalt-challenge-cooldown", "1");
          } else if (isAnimeSaltTarget && response.status === 200) {
            if (homepageKv && targetCooldownKey) {
              await homepageKv.delete(targetCooldownKey).catch(() => {});
            }
          }

          return new Response(boundedResponse.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
          });
        } catch (err) {
          clearTimeout(upstreamTimeout);
          console.warn("[general-proxy]", JSON.stringify({
            event: "fetch-exception",
            target: targetHostPath,
            errorName: err instanceof Error ? err.name : "UnknownError",
            elapsedMs: Date.now() - upstreamStartedAt,
          }));
          return new Response(JSON.stringify({ error: "Proxy fetch failed", detail: String(err) }), {
            status: 502,
            headers: { "Content-Type": "application/json", ...corsHeaders(request) },
          });
        }
      },
    };

    // This entrypoint is enabled for Workers Caching separately from the default
    // router entrypoint. The default router delegates only the exact homepage GET.
    export class AnimeSaltHomepageCache extends WorkerEntrypoint {
      async fetch(request) {
        const requestUrl = new URL(request.url);
        const targetUrl = requestUrl.searchParams.get("url");
        if (request.method !== "GET" || targetUrl !== ANIMESALT_HOMEPAGE_URL) {
          return homepageUnavailableResponse(request, 404);
        }

        const startedAt = Date.now();
        const targetHostPath = "animesalt.cx/";
        const freshCachedResponse = await getLastGoodHomepage(
          this.env,
          request,
          "fresh-cache-check",
          HOMEPAGE_FRESH_MS,
          true
        );
        if (freshCachedResponse) return freshCachedResponse;

        const now = Date.now();
        if (
          homepageLocalCooldownUntil > now ||
          homepageLocalProbeUntil > now ||
          homepageLocalProbeInProgress
        ) {
          const activeUntil = Math.max(homepageLocalCooldownUntil, homepageLocalProbeUntil, now);
          console.info("[general-proxy]", JSON.stringify({
            event: "homepage-upstream-cooldown",
            outcome: "active",
            state: homepageLocalCooldownUntil === activeUntil ? "challenge" : "probe",
            retryInMs: activeUntil - now,
          }));
          return await getLastGoodHomepage(this.env, request, "upstream-cooldown") || homepageUnavailableResponse(request);
        }

        // Set synchronously before reading KV so concurrent requests in this
        // isolate cannot all pass the cooldown check together.
        homepageLocalProbeInProgress = true;
        const cooldown = await getHomepageCooldown(this.env);
        const activeUntil = cooldown?.retryAt || 0;
        if (activeUntil > now) {
          homepageLocalProbeInProgress = false;
          if (cooldown.state === "challenge") homepageLocalCooldownUntil = activeUntil;
          else homepageLocalProbeUntil = activeUntil;
          console.info("[general-proxy]", JSON.stringify({
            event: "homepage-upstream-cooldown",
            outcome: "active",
            state: cooldown?.retryAt === activeUntil ? cooldown.state : homepageLocalCooldownUntil === activeUntil ? "challenge" : "probe",
            retryInMs: activeUntil - now,
          }));
          return await getLastGoodHomepage(this.env, request, "upstream-cooldown") || homepageUnavailableResponse(request);
        }

        // Reserve a brief probe window before the outbound fetch so later requests
        // reuse stale data instead of launching another simultaneous retry.
        const probeUntil = now + HOMEPAGE_PROBE_LEASE_MS;
        homepageLocalProbeUntil = probeUntil;
        homepageLocalCooldownUntil = 0;
        await writeHomepageCooldown(this.env, "probe", probeUntil);

        const homepageController = new AbortController();
        const homepageTimeout = setTimeout(() => homepageController.abort(), HOMEPAGE_TIMEOUT_MS);
        try {
          const homepageRequest = new Request(ANIMESALT_HOMEPAGE_URL, {
            method: "GET",
            headers: {
              "User-Agent": BROWSER_UA,
              Accept: "*/*",
              "Accept-Language": "en-US,en;q=0.9",
              "Cache-Control": "no-cache",
              Pragma: "no-cache",
            },
            redirect: "manual",
          });
          const { response: upstream, blockedRedirect } = await fetchWithAllowedRedirects(
            homepageRequest,
            isAllowedGeneralTarget,
            { signal: homepageController.signal }
          );
          if (!upstream) {
            if (blockedRedirect) {
              console.warn("[general-proxy]", JSON.stringify({
                event: "homepage-redirect-blocked",
                target: targetHostPath,
              }));
            }
            return await getLastGoodHomepage(this.env, request, "redirect-not-allowed") || homepageUnavailableResponse(request);
          }

          const contentType = upstream.headers.get("content-type");
          const location = upstream.headers.get("location");
          let locationHostPath = null;
          if (location) {
            try {
              const parsedLocation = new URL(location, ANIMESALT_HOMEPAGE_URL);
              locationHostPath = `${parsedLocation.hostname}${parsedLocation.pathname}`;
            } catch {
              locationHostPath = "invalid-location";
            }
          }
          console.info("[general-proxy]", JSON.stringify({
            event: "upstream-response",
            target: targetHostPath,
            status: upstream.status,
            server: upstream.headers.get("server"),
            cfRay: upstream.headers.get("cf-ray"),
            location: locationHostPath,
            contentType,
            elapsedMs: Date.now() - startedAt,
          }));

          if (upstream.status !== 200) {
            if (upstream.status === 403 && (contentType || "").toLowerCase().includes("text/html")) {
              await logHomepage403Classification(upstream, targetHostPath);
            }
            if (upstream.status === 403) {
              const retryAt = Date.now() + HOMEPAGE_CHALLENGE_COOLDOWN_MS;
              homepageLocalCooldownUntil = retryAt;
              homepageLocalProbeUntil = 0;
              await writeHomepageCooldown(this.env, "challenge", retryAt);
            }
            await upstream.body?.cancel().catch(() => {});
            const staleResponse = await getLastGoodHomepage(this.env, request, `upstream-http-${upstream.status}`);
            if (staleResponse) return staleResponse;
            if (isTransientHomepageStatus(upstream.status)) {
              console.warn("[general-proxy]", JSON.stringify({
                event: "homepage-cache-fallback",
                target: targetHostPath,
                upstreamStatus: upstream.status,
                responseStatus: 503,
              }));
              return homepageUnavailableResponse(request);
            }
            return homepageUnavailableResponse(request);
          }

          if (!(contentType || "").toLowerCase().includes("text/html")) {
            console.warn("[general-proxy]", JSON.stringify({
              event: "homepage-invalid-response",
              target: targetHostPath,
              upstreamStatus: upstream.status,
              contentType,
              reason: "not-html",
            }));
            await upstream.body?.cancel().catch(() => {});
            return await getLastGoodHomepage(this.env, request, "invalid-content-type") || homepageUnavailableResponse(request);
          }

          let html;
          try {
            html = await readResponseTextWithLimit(upstream.clone(), HOMEPAGE_MAX_BYTES);
          } catch (error) {
            await upstream.body?.cancel().catch(() => {});
            throw error;
          }
          const validation = validateAnimeSaltHomepage(html, upstream.headers);
          if (!validation.valid) {
            console.warn("[general-proxy]", JSON.stringify({
              event: "homepage-invalid-response",
              target: targetHostPath,
              upstreamStatus: upstream.status,
              contentType,
              responseBytes: new TextEncoder().encode(html).byteLength,
              entryCount: validation.entryCount,
              reason: validation.reason,
            }));
            await upstream.body?.cancel().catch(() => {});
            return await getLastGoodHomepage(this.env, request, "invalid-homepage-html") || homepageUnavailableResponse(request);
          }

          await storeLastGoodHomepage(this.env, html, contentType, validation.entryCount);
          homepageLocalCooldownUntil = 0;
          homepageLocalProbeUntil = 0;
          await clearHomepageCooldown(this.env);

          const headers = homepageResponseHeaders(upstream.headers, request);
          headers.set("Cache-Control", HOMEPAGE_CACHE_CONTROL);
          headers.set("Cloudflare-CDN-Cache-Control", HOMEPAGE_CACHE_CONTROL);
          headers.set("x-animesalt-cache", "fresh");
          headers.set("Vary", appendVary(headers.get("Vary"), "Origin"));
          console.info("[general-proxy]", JSON.stringify({
            event: "homepage-cacheable-response",
            target: targetHostPath,
            status: 200,
            responseBytes: new TextEncoder().encode(html).byteLength,
            entryCount: validation.entryCount,
            sections: validation.sections,
            elapsedMs: Date.now() - startedAt,
          }));
          return new Response(upstream.body, {
            status: 200,
            statusText: upstream.statusText,
            headers,
          });
        } catch (error) {
          console.warn("[general-proxy]", JSON.stringify({
            event: "homepage-fetch-exception",
            target: targetHostPath,
            errorName: error instanceof Error ? error.name : "UnknownError",
            elapsedMs: Date.now() - startedAt,
            responseStatus: 503,
          }));
          return await getLastGoodHomepage(this.env, request, "upstream-fetch-exception") || homepageUnavailableResponse(request);
        } finally {
          clearTimeout(homepageTimeout);
          homepageLocalProbeInProgress = false;
        }
      }
    }

    async function storeLastGoodHomepage(env, html, contentType, entryCount) {
      const kv = env?.[HOMEPAGE_KV_BINDING];
      if (!kv) {
        console.warn("[general-proxy]", JSON.stringify({
          event: "homepage-kv-unavailable",
          operation: "write",
          binding: HOMEPAGE_KV_BINDING,
        }));
        return;
      }

      try {
        await kv.put(HOMEPAGE_KV_KEY, JSON.stringify({
          version: 1,
          storedAt: Date.now(),
          contentType,
          html,
        }), { expirationTtl: Math.floor(HOMEPAGE_MAX_STALE_MS / 1000) });
        console.info("[general-proxy]", JSON.stringify({
          event: "homepage-kv-write",
          outcome: "success",
          entryCount,
          ttlSeconds: Math.floor(HOMEPAGE_MAX_STALE_MS / 1000),
        }));
      } catch (error) {
        console.warn("[general-proxy]", JSON.stringify({
          event: "homepage-kv-write",
          outcome: "error",
          errorName: error instanceof Error ? error.name : "UnknownError",
        }));
      }
    }

    async function getHomepageCooldown(env) {
      const kv = env?.[HOMEPAGE_KV_BINDING];
      if (!kv) return null;

      try {
        const value = await kv.get(HOMEPAGE_COOLDOWN_KEY);
        if (!value) return null;
        const state = JSON.parse(value);
        if (
          state?.version !== 1 ||
          (state.state !== "challenge" && state.state !== "probe") ||
          typeof state.retryAt !== "number" ||
          !Number.isFinite(state.retryAt) ||
          state.retryAt <= Date.now()
        ) return null;
        return state;
      } catch (error) {
        console.warn("[general-proxy]", JSON.stringify({
          event: "homepage-upstream-cooldown",
          outcome: "read-error",
          errorName: error instanceof Error ? error.name : "UnknownError",
        }));
        return null;
      }
    }

    async function writeHomepageCooldown(env, state, retryAt) {
      const kv = env?.[HOMEPAGE_KV_BINDING];
      if (!kv) return;

      try {
        const ttlSeconds = Math.max(60, Math.ceil((retryAt - Date.now()) / 1000));
        await kv.put(HOMEPAGE_COOLDOWN_KEY, JSON.stringify({ version: 1, state, retryAt }), {
          expirationTtl: ttlSeconds,
        });
        console.info("[general-proxy]", JSON.stringify({
          event: "homepage-upstream-cooldown",
          outcome: "stored",
          state,
          ttlSeconds,
        }));
      } catch (error) {
        console.warn("[general-proxy]", JSON.stringify({
          event: "homepage-upstream-cooldown",
          outcome: "write-error",
          state,
          errorName: error instanceof Error ? error.name : "UnknownError",
        }));
      }
    }

    async function clearHomepageCooldown(env) {
      const kv = env?.[HOMEPAGE_KV_BINDING];
      if (!kv) return;
      try {
        await kv.delete(HOMEPAGE_COOLDOWN_KEY);
      } catch (error) {
        console.warn("[general-proxy]", JSON.stringify({
          event: "homepage-upstream-cooldown",
          outcome: "clear-error",
          errorName: error instanceof Error ? error.name : "UnknownError",
        }));
      }
    }

    async function getLastGoodHomepage(
      env,
      request,
      reason,
      maxAgeMs = HOMEPAGE_MAX_STALE_MS,
      freshResponse = false
    ) {
      const kv = env?.[HOMEPAGE_KV_BINDING];
      if (!kv) {
        console.warn("[general-proxy]", JSON.stringify({
          event: "homepage-kv-unavailable",
          operation: "read",
          binding: HOMEPAGE_KV_BINDING,
          reason,
        }));
        return null;
      }

      try {
        const value = await kv.get(HOMEPAGE_KV_KEY);
        if (!value) {
          console.info("[general-proxy]", JSON.stringify({ event: "homepage-kv-read", outcome: "miss", reason }));
          return null;
        }

        let cached;
        try {
          cached = JSON.parse(value);
        } catch {
          console.warn("[general-proxy]", JSON.stringify({ event: "homepage-kv-read", outcome: "invalid-json", reason }));
          return null;
        }
        const ageMs = Date.now() - cached?.storedAt;
        if (
          cached?.version !== 1 ||
          typeof cached.html !== "string" ||
          typeof cached.storedAt !== "number" ||
          typeof cached.contentType !== "string" ||
          !cached.contentType.toLowerCase().includes("text/html") ||
          !Number.isFinite(ageMs) ||
          ageMs < 0 ||
          ageMs > maxAgeMs
        ) {
          const outcome = ageMs > maxAgeMs && maxAgeMs < HOMEPAGE_MAX_STALE_MS
            ? "not-fresh"
            : "invalid-or-expired";
          console.info("[general-proxy]", JSON.stringify({ event: "homepage-kv-read", outcome, reason, ageMs }));
          return null;
        }

        const validation = validateAnimeSaltHomepage(cached.html, new Headers({ "content-type": cached.contentType }));
        if (!validation.valid) {
          console.warn("[general-proxy]", JSON.stringify({
            event: "homepage-kv-read",
            outcome: "cached-html-rejected",
            reason: validation.reason,
          }));
          return null;
        }

        const headers = homepageResponseHeaders(new Headers({ "content-type": cached.contentType }), request);
        headers.set("Cache-Control", freshResponse ? HOMEPAGE_CACHE_CONTROL : "no-store");
        headers.set("Cloudflare-CDN-Cache-Control", freshResponse ? HOMEPAGE_CACHE_CONTROL : "no-store");
        headers.set("x-animesalt-cache", freshResponse ? "fresh" : "stale");
        headers.set("Vary", appendVary(headers.get("Vary"), "Origin"));
        console.info("[general-proxy]", JSON.stringify({
          event: "homepage-kv-read",
          outcome: freshResponse ? "fresh-hit" : "stale-hit",
          reason,
          ageMs,
          entryCount: validation.entryCount,
        }));
        return new Response(cached.html, { status: 200, headers });
      } catch (error) {
        console.warn("[general-proxy]", JSON.stringify({
          event: "homepage-kv-read",
          outcome: "error",
          reason,
          errorName: error instanceof Error ? error.name : "UnknownError",
        }));
        return null;
      }
    }

    function isTransientHomepageStatus(status) {
      return status === 403 || status === 408 || status === 425 || status === 429 || status >= 500;
    }

    function homepageResponseHeaders(upstreamHeaders, request) {
      const headers = new Headers(upstreamHeaders);
      for (const [key, value] of Object.entries(corsHeaders(request))) headers.set(key, value);
      headers.delete("x-frame-options");
      headers.delete("content-security-policy");
      headers.delete("content-security-policy-report-only");
      headers.delete("set-cookie");
      return headers;
    }

    function homepageUnavailableResponse(request, status = 503) {
      return new Response(JSON.stringify({ error: "AnimeSalt homepage temporarily unavailable" }), {
        status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "Cloudflare-CDN-Cache-Control": "no-store",
          ...corsHeaders(request),
        },
      });
    }

    function appendVary(current, value) {
      const values = new Set((current || "").split(",").map((item) => item.trim()).filter(Boolean));
      values.add(value);
      return [...values].join(", ");
    }

    function validateAnimeSaltHomepage(html, headers) {
      const challenge =
        headers.get("cf-mitigated")?.toLowerCase() === "challenge" ||
        /<title>\s*just a moment/i.test(html) ||
        /(?:id=["']challenge-form["']|__cf_chl_(?:tk|opt)|cf-chl-widget)/i.test(html) ||
        /sorry, you have been blocked|access denied/i.test(html);
      if (challenge) return { valid: false, entryCount: 0, sections: {}, reason: "challenge-or-denial" };
      if (!/<html\b/i.test(html)) return { valid: false, entryCount: 0, sections: {}, reason: "missing-html-document" };

      const sections = {
        freshDrops: countHomepageArticleEntries(html, "Fresh Drops"),
        mostWatchedSeries: countHomepageChartEntries(html, "Most-Watched Series"),
        mostWatchedFilms: countHomepageChartEntries(html, "Most-Watched Films"),
      };
      const entryCount = Object.values(sections).reduce((sum, count) => sum + count, 0);
      return {
        valid: entryCount >= 2,
        entryCount,
        sections,
        reason: entryCount >= 2 ? null : "no-recognized-homepage-entries",
      };
    }

    function homepageSectionChunk(html, sectionName) {
      const index = html.indexOf(sectionName);
      if (index < 0) return "";
      const sectionHtml = html.slice(index, index + 40000);
      const nextSection = sectionHtml.indexOf('class="section-title', 50);
      return nextSection > 0 ? sectionHtml.slice(0, nextSection) : sectionHtml;
    }

    function countHomepageArticleEntries(html, sectionName) {
      const chunk = homepageSectionChunk(html, sectionName);
      const articles = chunk.matchAll(/<article\b[^>]*class=["'][^"']*\bpost\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi);
      let count = 0;
      for (const [, article] of articles) if (isValidHomepageCard(article, false)) count += 1;
      return count;
    }

    function countHomepageChartEntries(html, sectionName) {
      const chunk = homepageSectionChunk(html, sectionName);
      const items = chunk.matchAll(/<div\b[^>]*class=["'][^"']*\bchart-item\b[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*\bchart-item\b|$)/gi);
      let count = 0;
      for (const [, item] of items) if (isValidHomepageCard(item, true)) count += 1;
      return count;
    }

    function isValidHomepageCard(markup, isChart) {
      const href = markup.match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[1];
      const imageMarkup = markup.match(/<img\b[^>]*>/i)?.[0] || "";
      const image = imageMarkup.match(/\b(?:src|data-src|data-lazy-src)=["']([^"']+)["']/i)?.[1];
      const title = isChart
        ? markup.match(/class=["']chart-title["'][^>]*>([\s\S]*?)<\//i)?.[1]
        : markup.match(/class=["']entry-title["'][^>]*>([\s\S]*?)<\//i)?.[1];
      if (!href || !image || !title?.replace(/<[^>]+>/g, "").trim()) return false;

      try {
        const detail = new URL(href, ANIMESALT_HOMEPAGE_URL);
        const poster = new URL(image, ANIMESALT_HOMEPAGE_URL);
        return detail.protocol === "https:" &&
          ["animesalt.cx", "www.animesalt.cx"].includes(detail.hostname) &&
          detail.pathname !== "/" &&
          ["http:", "https:"].includes(poster.protocol);
      } catch {
        return false;
      }
    }

    async function logHomepage403Classification(response, target) {
      try {
        const html = await readResponseTextWithLimit(response.clone(), 128 * 1024);
        const code = html.match(/\b(?:error\s*)?(1006|1009|1010|1015|1020|1026|1033)\b/i)?.[1] || null;
        const classification =
          response.headers.get("cf-mitigated")?.toLowerCase() === "challenge" ||
          /<title>\s*just a moment/i.test(html) ||
          /(?:id=["']challenge-form["']|__cf_chl_(?:tk|opt)|cf-chl-widget)/i.test(html)
            ? "cloudflare-challenge"
            : code === "1020" || /sorry, you have been blocked|access denied/i.test(html)
              ? "access-denied"
              : "unclassified-html-403";
        console.warn("[general-proxy]", JSON.stringify({
          event: "upstream-403-classification",
          target,
          classification,
          cloudflareCode: code,
        }));
      } catch (error) {
        console.warn("[general-proxy]", JSON.stringify({
          event: "upstream-403-classification",
          target,
          classification: "body-inspection-error",
          errorName: error instanceof Error ? error.name : "UnknownError",
        }));
      }
    }

    // Fetch only known AnimeSalt catalog pages. Callers provide a catalog kind and
    // page number, never an arbitrary target URL, so this route cannot proxy back to
    // this Worker or another host.
    async function readResponseTextWithLimit(response, maxBytes) {
      if (!response.body) return "";
      const reader = response.body.getReader();
      const chunks = [];
      let totalBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel("response-size-limit").catch(() => {});
            throw new Error("Response exceeded size limit");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder().decode(bytes);
    }

    async function fetchCatalogText(targetUrl, kind, headers, maxBytes, cfOptions = {}, preserveResponseBody = false) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
      try {
        const request = new Request(targetUrl, { method: "GET", headers, redirect: "manual" });
        const result = await fetchWithAllowedRedirects(
          request,
          (candidate) => isAllowedCatalogTarget(candidate, kind),
          { ...cfOptions, signal: controller.signal },
          3
        );
        if (!result.response) {
          return { response: null, text: null, blockedRedirect: result.blockedRedirect };
        }
        const contentLength = Number(result.response.headers.get("content-length"));
        if (result.response.ok && Number.isFinite(contentLength) && contentLength > maxBytes) {
          await result.response.body?.cancel().catch(() => {});
          throw new Error("Response exceeded size limit");
        }
        let text = null;
        if (result.response.ok) {
          try {
            text = await readResponseTextWithLimit(result.response.clone(), maxBytes);
          } catch (error) {
            await result.response.body?.cancel().catch(() => {});
            throw error;
          }
          if (!preserveResponseBody) await result.response.body?.cancel().catch(() => {});
        }
        return { response: result.response, text, blockedRedirect: false };
      } finally {
        clearTimeout(timer);
      }
    }

    async function handleCatalog(url, request) {
      const kinds = url.searchParams.getAll("kind");
      const pages = url.searchParams.getAll("page");
      const kind = kinds.length === 1 ? kinds[0] : "";
      const pageText = pages.length === 1 ? pages[0] : "";
      const page = Number(pageText);
      const hasUnexpectedParameter = Array.from(url.searchParams.keys()).some(
        (key) => key !== "kind" && key !== "page"
      );

      if (
        request.method !== "GET" ||
        hasUnexpectedParameter ||
        (kind !== "series" && kind !== "movies") ||
        !/^[1-9]\d*$/.test(pageText) ||
        !Number.isSafeInteger(page)
      ) {
        return jsonResponse({ success: false, message: "Invalid catalog request" }, 400, request);
      }

      const upstreamPath = `/${kind}/page/${page}/`;
      const targetUrl = `https://animesalt.cx${upstreamPath}`;
      const cacheKey = new Request(`${url.origin}/__catalog-cache/${kind}/${page}`);
      let lastGoodResponse = null;
      try {
        lastGoodResponse = await caches.default.match(cacheKey);
      } catch {
        // The restricted source route remains usable if the edge cache is unavailable.
      }
      if (lastGoodResponse && await isFreshCatalogCache(lastGoodResponse, kind)) {
        console.info("[catalog-proxy-cache]", JSON.stringify({
          kind,
          page,
          status: "fresh-hit",
          itemCount: Number(lastGoodResponse.headers.get("x-catalog-feed-item-count")) || null,
        }));
        return serveFreshCatalog(lastGoodResponse, request);
      }
      const proxyHeaders = {
        "User-Agent": BROWSER_UA,
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      };

      try {
        const feedResult = await fetchCatalogText(
          targetUrl,
          kind,
          proxyHeaders,
          CATALOG_FEED_MAX_BYTES,
          { cf: { cacheTtl: 30, cacheEverything: false } },
          true
        );
        const upstream = feedResult.response;
        if (!upstream) {
          if (lastGoodResponse) return serveStaleCatalog(lastGoodResponse, request);
          return jsonResponse({ success: false, message: "Catalog redirect was not allowed" }, 502, request);
        }

        const upstreamServer = upstream.headers.get("server");
        const upstreamCfRay = upstream.headers.get("cf-ray");
        if (!upstream.ok && lastGoodResponse) {
          console.warn("[catalog-proxy]", JSON.stringify({
            kind,
            page,
            upstreamPath,
            status: upstream.status,
            contentType: upstream.headers.get("content-type"),
            contentLength: upstream.headers.get("content-length"),
            server: upstreamServer,
            cfRay: upstreamCfRay,
            cacheStatus: "stale-hit",
          }));
          return serveStaleCatalog(lastGoodResponse, request);
        }

        let totalPages = null;
        let pageSize = null;
        let itemCount = null;
        let validItemCount = null;
        let catalogIsValid = false;
        if (upstream.ok) {
          try {
            const catalogText = feedResult.text || "";
            itemCount = (catalogText.match(/<article\b[^>]*\bclass=["'][^"']*\bpost\b/gi) || []).length;
            validItemCount = countValidCatalogHtmlItems(catalogText, kind);
            catalogIsValid = /<html\b/i.test(catalogText) && validItemCount > 0;
            if (!catalogIsValid) throw new Error("Catalog response was not a nonempty AnimeSalt listing");
            if (page === 1) pageSize = validItemCount;
            if (page !== 1) {
              const firstPage = await fetchCatalogText(
                `https://animesalt.cx/${kind}/page/1/`,
                kind,
                proxyHeaders,
                CATALOG_FEED_MAX_BYTES,
                { cf: { cacheTtl: 30, cacheEverything: false } }
              );
              if (firstPage.response?.ok && firstPage.text) {
                const firstPageSize = countValidCatalogHtmlItems(firstPage.text, kind);
                if (firstPageSize > 0) pageSize = firstPageSize;
              }
            }

            const sitemapIndex = await fetchCatalogText(
              "https://animesalt.cx/sitemap_index.xml",
              kind,
              proxyHeaders,
              CATALOG_SITEMAP_INDEX_MAX_BYTES,
              { cf: { cacheTtl: 3600, cacheEverything: false } }
            );
            if (sitemapIndex.response?.ok && sitemapIndex.text) {
              const sitemapXml = sitemapIndex.text;
              const sitemapUrls = [...sitemapXml.matchAll(/<loc>\s*(https?:[^<]+?)\s*<\/loc>/gi)]
                .map((match) => {
                  try {
                    const sitemapUrl = new URL(match[1]);
                    return sitemapUrl.protocol === "https:" &&
                      ["animesalt.cx", "www.animesalt.cx"].includes(sitemapUrl.hostname) &&
                      new RegExp(`^/${kind}-sitemap\\d+\\.xml$`).test(sitemapUrl.pathname)
                      ? sitemapUrl.toString()
                      : null;
                  } catch {
                    return null;
                  }
                })
                .filter(Boolean);

              const sitemapResults = sitemapUrls.length <= CATALOG_MAX_SITEMAPS
                ? await Promise.all(sitemapUrls.map(async (sitemapUrl) => {
                try {
                  const sitemap = await fetchCatalogText(
                    sitemapUrl,
                    kind,
                    proxyHeaders,
                    CATALOG_SITEMAP_MAX_BYTES,
                    { cf: { cacheTtl: 3600, cacheEverything: false } }
                  );
                  if (!sitemap.response?.ok || !sitemap.text) return [];
                  const xml = sitemap.text;
                  return [...xml.matchAll(/<loc>\s*(https?:[^<]+?)\s*<\/loc>/gi)]
                    .map((match) => {
                      try {
                        const entryUrl = new URL(match[1]);
                        const segments = entryUrl.pathname.split("/").filter(Boolean);
                        return entryUrl.protocol === "https:" &&
                          ["animesalt.cx", "www.animesalt.cx"].includes(entryUrl.hostname) &&
                          segments.length === 2 && segments[0] === kind
                          ? entryUrl.toString()
                          : null;
                      } catch {
                        return null;
                      }
                    })
                    .filter(Boolean);
                } catch {
                  return [];
                }
              }))
                : [];

              const catalogEntries = new Set(sitemapResults.flat());
              if (sitemapUrls.length <= CATALOG_MAX_SITEMAPS && pageSize > 0 && catalogEntries.size > 0) {
                totalPages = Math.ceil(catalogEntries.size / pageSize);
              }
            }
          } catch {
            // A valid listing remains usable if optional pagination discovery fails.
          }
        }

        if (upstream.ok && !catalogIsValid) {
          console.warn("[catalog-proxy]", JSON.stringify({
            kind,
            page,
            upstreamPath,
            status: upstream.status,
            contentType: upstream.headers.get("content-type"),
            contentLength: upstream.headers.get("content-length"),
            server: upstreamServer,
            cfRay: upstreamCfRay,
            cacheStatus: lastGoodResponse ? "stale-hit-invalid-listing" : "miss-invalid-listing",
          }));
          await upstream.body?.cancel().catch(() => {});
          if (lastGoodResponse) return serveStaleCatalog(lastGoodResponse, request);
          return jsonResponse({ success: false, message: "Catalog response was invalid" }, 502, request);
        }

        const headers = new Headers(upstream.headers);
        const cors = corsHeaders(request);
        for (const [key, value] of Object.entries(cors)) headers.set(key, value);
        headers.delete("x-frame-options");
        headers.delete("content-security-policy");
        headers.delete("content-security-policy-report-only");
        headers.delete("set-cookie");
        if (Number.isSafeInteger(totalPages) && totalPages > 0) {
          headers.set("x-catalog-total-pages", String(totalPages));
        }
        if (Number.isSafeInteger(pageSize) && pageSize > 0) {
          headers.set("x-catalog-page-size", String(pageSize));
        }
        headers.set(
          "Access-Control-Expose-Headers",
          `${headers.get("Access-Control-Expose-Headers") || ""}, X-Catalog-Total-Pages, X-Catalog-Page-Size`
            .replace(/^,\s*/, "")
        );

        if (upstreamServer) headers.set("x-catalog-upstream-server", upstreamServer);
        if (upstreamCfRay) headers.set("x-catalog-upstream-cf-ray", upstreamCfRay);

        console.info("[catalog-proxy]", JSON.stringify({
          kind,
          page,
          upstreamPath,
          status: upstream.status,
          contentType: upstream.headers.get("content-type"),
          contentLength: upstream.headers.get("content-length"),
          server: upstreamServer,
          cfRay: upstreamCfRay,
          itemCount: Number.isSafeInteger(itemCount) ? itemCount : null,
          validItemCount: Number.isSafeInteger(validItemCount) ? validItemCount : null,
          totalPages,
          cacheStatus: "refresh",
        }));

        if (upstream.ok && catalogIsValid) {
          try {
            const cachedHeaders = new Headers(headers);
            cachedHeaders.delete("access-control-allow-origin");
            cachedHeaders.delete("set-cookie");
            cachedHeaders.set("Cache-Control", "public, max-age=604800");
            cachedHeaders.set("x-catalog-feed-item-count", String(itemCount));
            cachedHeaders.set("x-catalog-cached-at", String(Date.now()));
            await caches.default.put(cacheKey, new Response(upstream.clone().body, {
              status: 200,
              headers: cachedHeaders,
            }));
          } catch (error) {
            console.warn("[catalog-proxy-cache]", JSON.stringify({
              kind,
              page,
              status: "write-failed",
              errorName: error?.name || "Error",
            }));
          }
        }

        return new Response(upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers,
        });
      } catch (error) {
        const message = String(error?.message || error || "Unknown error")
          .replace(/https?:\/\/\S+/gi, "[url]")
          .slice(0, 180);
        console.error("[catalog-proxy]", JSON.stringify({
          kind,
          page,
          upstreamPath,
          errorName: error?.name || "Error",
          errorMessage: message,
          cacheStatus: lastGoodResponse ? "stale-hit" : "miss",
        }));
        if (lastGoodResponse) return serveStaleCatalog(lastGoodResponse, request);
        return jsonResponse({ success: false, message: "Catalog upstream request failed" }, 502, request);
      }
    }

    function countValidCatalogFeedItems(feedText, kind) {
      const items = feedText.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi);
      let validCount = 0;

      for (const [, item] of items) {
        const rawTitle = item.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1] || "";
        const rawLink = item.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i)?.[1] || "";
        const title = rawTitle.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
        const link = rawLink
          .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
          .replace(/&amp;/gi, "&")
          .trim();

        try {
          const detail = new URL(link);
          const segments = detail.pathname.split("/").filter(Boolean);
          if (
            title &&
            detail.protocol === "https:" &&
            ["animesalt.cx", "www.animesalt.cx"].includes(detail.hostname) &&
            segments.length === 2 &&
            segments[0] === kind &&
            segments[1]
          ) validCount += 1;
        } catch {
          // Ignore malformed RSS entries when deciding whether the feed is cacheable.
        }
      }

      return validCount;
    }

    function catalogAttribute(attributes, name) {
      const escapedName = name.replace(/[.*+?^()|[\]\\]/g, "\\$&");
      return attributes.match(new RegExp("\\b" + escapedName + "\\s*=\\s*([\"'])(.*?)\\1", "i"))?.[2] || "";
    }
    function countValidCatalogHtmlItems(html, kind) {
      const articles = html.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/gi);
      let validCount = 0;

      for (const [, attributes, content] of articles) {
        if (!/(?:^|\s)post(?:\s|$)/i.test(catalogAttribute(attributes, "class"))) continue;
        const anchor = [...content.matchAll(/<a\b([^>]*)>/gi)].find(([, anchorAttributes]) =>
          /(?:^|\s)lnk-blk(?:\s|$)/i.test(catalogAttribute(anchorAttributes, "class"))
        );
        const href = anchor ? catalogAttribute(anchor[1], "href").replace(/&amp;/gi, "&") : "";
        const titleMarkup = content.match(/<h2\b[^>]*\bclass=["'][^"']*\bentry-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1] ||
          (anchor ? catalogAttribute(anchor[1], "title") : "");
        const title = titleMarkup.replace(/<[^>]+>/g, "").replace(/&nbsp;|&#160;/gi, " ").trim();

        try {
          const detail = new URL(href, "https://animesalt.cx");
          const segments = detail.pathname.split("/").filter(Boolean);
          if (
            title &&
            detail.protocol === "https:" &&
            ["animesalt.cx", "www.animesalt.cx"].includes(detail.hostname) &&
            segments.length === 2 &&
            segments[0] === kind &&
            segments[1]
          ) validCount += 1;
        } catch {
          // Ignore malformed entries when deciding whether a listing may be cached.
        }
      }

      return validCount;
    }

    function serveStaleCatalog(cachedResponse, request) {
      const headers = new Headers(cachedResponse.headers);
      for (const [key, value] of Object.entries(corsHeaders(request))) headers.set(key, value);
      headers.delete("x-catalog-cached-at");
      headers.set("Cache-Control", "no-store");
      headers.set("X-Catalog-Cache", "stale");
      const exposedHeaders = new Set(
        (headers.get("Access-Control-Expose-Headers") || "")
          .split(",")
          .map((header) => header.trim())
          .filter(Boolean)
      );
      exposedHeaders.add("X-Catalog-Total-Pages");
      exposedHeaders.add("X-Catalog-Page-Size");
      exposedHeaders.add("X-Catalog-Cache");
      headers.set("Access-Control-Expose-Headers", [...exposedHeaders].join(", "));
      console.info("[catalog-proxy-cache]", JSON.stringify({
        status: "stale-served",
        itemCount: Number(headers.get("x-catalog-feed-item-count")) || null,
      }));
      return new Response(cachedResponse.body, { status: 200, headers });
    }

    async function isFreshCatalogCache(cachedResponse, kind) {
      const cachedAt = Number(cachedResponse.headers.get("x-catalog-cached-at"));
      const ageMs = Date.now() - cachedAt;
      const contentType = cachedResponse.headers.get("content-type") || "";
      if (
        cachedResponse.status !== 200 ||
        !Number.isFinite(cachedAt) ||
        ageMs < 0 ||
        ageMs > CATALOG_FRESH_MS ||
        !/(?:rss\+xml|application\/xml|text\/xml|text\/html)/i.test(contentType)
      ) return false;

      try {
        const cachedText = await cachedResponse.clone().text();
        return /<rss\b/i.test(cachedText)
          ? countValidCatalogFeedItems(cachedText, kind) > 0
          : /<html\b/i.test(cachedText) && countValidCatalogHtmlItems(cachedText, kind) > 0;
      } catch {
        return false;
      }
    }

    function serveFreshCatalog(cachedResponse, request) {
      const headers = new Headers(cachedResponse.headers);
      for (const [key, value] of Object.entries(corsHeaders(request))) headers.set(key, value);
      headers.delete("x-catalog-cached-at");
      headers.set("Cache-Control", `public, max-age=${Math.floor(CATALOG_FRESH_MS / 1000)}`);
      headers.set("X-Catalog-Cache", "fresh");
      const exposedHeaders = new Set(
        (headers.get("Access-Control-Expose-Headers") || "")
          .split(",")
          .map((header) => header.trim())
          .filter(Boolean)
      );
      exposedHeaders.add("X-Catalog-Total-Pages");
      exposedHeaders.add("X-Catalog-Page-Size");
      exposedHeaders.add("X-Catalog-Cache");
      headers.set("Access-Control-Expose-Headers", [...exposedHeaders].join(", "));
      return new Response(cachedResponse.body, { status: 200, headers });
    }

    // ── /stream handler ───────────────────────────────────────────────────────────
    // Server Slot Layout (9 slots):
    //   1 = AnimeSalt Hindi source
    //   2 = RubyVidHub Hindi embed when available
    //   3 = Alternate AnimeSalt/Toko Hindi embed
    //   4 = Toko Hindi Dub Embed #2
    //   5 = Tamil (Toko or AnimeSalt Abyss)
    //   6 = Telugu (Toko or AnimeSalt Abyss)
    //   7 = English (Toko or AnimeSalt Abyss)
    //   8 = Japanese AnimeSalt embed

    async function fetchProviderText(target, options = {}, timeoutMs = 7000) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(target, { ...options, signal: controller.signal });
        return { response, text: await readResponseTextWithLimit(response, GENERAL_RESPONSE_MAX_BYTES) };
      } finally { clearTimeout(timer); }
    }

    function findAnimaHdEpisode(html, season, ep) {
      const regex = /<a[^>]*class=["'][^"']*app-ep-row-item[^"']*["'][^>]*data-season=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      const episodes = [];
      let match;
      while ((match = regex.exec(html)) !== null) {
        const file = match[2].match(/data-fileid=["']([a-zA-Z0-9_-]{20,100})["']/i);
        if (!file) continue;
        const titleMatch = match[2].match(/<div[^>]*font-size:\s*14px[^>]*>([\s\S]*?)<\/div>/i);
        const title = (titleMatch?.[1] || "").replace(/<[^>]+>/g, " ").trim();
        const seasonMatch = match[1].match(/\d+/);
        let seasonNum = seasonMatch ? Number(seasonMatch[0]) : 1;
        let epNum = episodes.length + 1;
        const both = title.match(/S(\d+)E(\d+)/i);
        const onlyEp = title.match(/(?:ep|episode)[-.\s]*(\d+)/i);
        if (both) { seasonNum = Number(both[1]); epNum = Number(both[2]); }
        else if (onlyEp) epNum = Number(onlyEp[1]);
        episodes.push({ fileId: file[1], title, seasonNum, epNum });
      }
      return episodes.find((item) => item.seasonNum === Number(season) && item.epNum === Number(ep)) || null;
    }

    async function fetchGoogleDriveSource(slug, season, ep) {
      const cleanSlug = slug.replace(/-season-\d+$/i, "").replace(/-s\d+$/i, "");
      let episode = null;
      try {
        const page = await fetchProviderText("https://animahd.com/" + encodeURIComponent(cleanSlug) + "/", {
          headers: { "User-Agent": BROWSER_UA, Accept: "text/html", Referer: "https://animahd.com/" },
        });
        if (page.response.ok) episode = findAnimaHdEpisode(page.text, season, ep);
      } catch { /* try WordPress search */ }
      if (!episode) {
        try {
          const query = "https://animahd.com/wp-json/wp/v2/posts?search=" +
            encodeURIComponent(cleanSlug.replace(/-/g, " ")) + "&_embed&per_page=8";
          const result = await fetchProviderText(query, {
            headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
          });
          if (result.response.ok) {
            const posts = JSON.parse(result.text);
            if (Array.isArray(posts) && posts.length) {
              const words = cleanSlug.split("-").filter((word) => word.length > 2);
              const best = posts.map((post) => {
                const normalized = (String(post.slug || "") + " " + String(post.title?.rendered || ""))
                  .toLowerCase().replace(/[^a-z0-9]+/g, " ");
                const tokens = new Set(normalized.split(/\s+/).filter(Boolean));
                return { post, score: words.length ? words.filter((word) => tokens.has(word)).length / words.length : 0 };
              }).sort((a, b) => b.score - a.score)[0];
              if (best && best.score >= 0.6 && typeof best.post.link === "string") {
                const page = await fetchProviderText(best.post.link, {
                  headers: { "User-Agent": BROWSER_UA, Accept: "text/html", Referer: "https://animahd.com/" },
                });
                if (page.response.ok) episode = findAnimaHdEpisode(page.text, season, ep);
              }
            }
          }
        } catch { /* no Drive result */ }
      }
      if (!episode) return null;
      const embed = "https://drive.google.com/file/d/" + encodeURIComponent(episode.fileId) + "/preview";
      return {
        server: "Google Drive", source: "GoogleDrive", sourceProvider: "GoogleDrive",
        label: "Google Drive", embed, url: embed, fileId: episode.fileId,
        type: "embed", audioLanguage: "hi", languageLabel: "Hindi Dub", adFree: true,
      };
    }

    async function fetchPlayZenSource(slug, season, ep) {
      const cleanSlug = slug.replace(/-season-\d+$/i, "").replace(/-s\d+$/i, "");
      const targets = [
        "https://animeflash.live/episode/" + cleanSlug + "/" + season + "x" + ep,
        "https://animeflash.live/episode/" + cleanSlug + "-" + season + "x" + ep,
      ];
      if (season === "1" && ep === "1") targets.push("https://animeflash.live/movie/" + cleanSlug);
      for (const target of targets) {
        try {
          const page = await fetchProviderText(target, {
            headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
          });
          if (!page.response.ok) continue;
          let playzenToken = null;
          const rscMatch = page.text.match(/:T([0-9a-fA-F]+),https?:\/\/archive\.animeinfinity\.me\/player\/([^\r\n"']+)/);
          if (rscMatch) {
            const totalLen = parseInt(rscMatch[1], 16);
            const prefixLen = "https://archive.animeinfinity.me/player/".length;
            const tokenLen = totalLen - prefixLen;
            if (tokenLen > 0 && rscMatch[2].length >= tokenLen) {
              playzenToken = rscMatch[2].slice(0, tokenLen);
            }
          }
          if (!playzenToken) {
            const quotedMatch = page.text.match(/https?:\/\/archive\.animeinfinity\.me\/player\/([A-Za-z0-9+/_=%-]+?)["'\s\\]/);
            if (quotedMatch) playzenToken = quotedMatch[1];
          }
          if (!playzenToken) {
            const chunkMatch = page.text.match(/https?:\/\/archive\.animeinfinity\.me\/player\/([A-Za-z0-9+/_=%-]+?)(?:[0-9a-f]{1,4}:[T\[]|["'\s\\]|$)/i);
            if (chunkMatch) playzenToken = chunkMatch[1];
          }
          if (!playzenToken) continue;
          const embed = "https://archive.animeinfinity.me/player/" + playzenToken.replace(/\\/g, "");
          return {
            server: "Server 3", source: "PlayZen", sourceProvider: "PlayZen",
            label: "Server 3", embed, url: embed, type: "embed",
            audioLanguage: "hi", languageLabel: "Hindi Dub", adFree: true,
          };
        } catch { /* try next URL */ }
      }
      return null;
    }

    async function resolveRavokHls(hash) {
      if (!/^[a-zA-Z0-9]{8,80}$/.test(hash || "")) return null;
      const cached = ravokHlsCache.get(hash);
      if (cached && cached.expiresAt > Date.now()) return cached.url;
      try {
        const body = new URLSearchParams({ hash, r: "https://animesalt.cx/" });
        const result = await fetchProviderText(
          "https://ravok.buzz/player/index.php?data=" + encodeURIComponent(hash) + "&do=getVideo",
          {
            method: "POST",
            headers: {
              "User-Agent": BROWSER_UA, Referer: "https://ravok.buzz/video/" + hash,
              "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
          },
          6000
        );
        if (!result.response.ok) return null;
        const data = JSON.parse(result.text);
        const source = data?.videoSource || data?.securedLink;
        if (typeof source !== "string") return null;
        const parsed = new URL(source);
        if (parsed.protocol !== "https:") return null;
        ravokHlsCache.set(hash, { url: source, expiresAt: Date.now() + 10 * 60 * 1000 });
        return source;
      } catch { return null; }
    }

    async function handleSourceLookup(url, request, env) {
      const id = slugify(url.searchParams.get("id") || "");
      const season = url.searchParams.get("season") || "1";
      const ep = url.searchParams.get("ep") || "1";
      const isMovie = url.searchParams.get("movie") === "1";
      if (!id || id.length > 120 || !/^[a-z0-9_-]+$/i.test(id) ||
        !/^\d{1,4}$/.test(season) || !/^\d{1,5}$/.test(ep)) {
        return jsonResponse({ success: false, message: "Invalid source request", results: [] }, 400, request);
      }
      const key = id + ":s" + season + ":e" + ep + ":m" + (isMovie ? "1" : "0");
      const cached = streamLookupCache.get(key);
      if (cached && cached.expiresAt > Date.now()) return jsonResponse(cached.payload, 200, request);
      const inflight = streamLookupInflight.get(key);
      if (inflight) return jsonResponse(await inflight, 200, request);

      const lookup = (async () => {
        const [salt, drive, playzen] = await Promise.all([
          fetchAnimeSaltStream(id, season, ep, isMovie).catch(() => []),
          fetchGoogleDriveSource(id, season, ep).catch(() => null),
          fetchPlayZenSource(id, season, ep).catch(() => null),
        ]);
        const mystream = salt.find((item) =>
          item.type === "embed" && /mystream|ravok\.buzz/i.test(String(item.label || "") + " " + String(item.embed || ""))
        );
        const selected = [
          { source: mystream, slot: 1, label: "Server 1" },
          { source: drive, slot: 2, label: "Server 2" },
          { source: playzen, slot: 3, label: "Server 3" },
        ].filter((entry) => Boolean(entry.source));
        const labels = [
          "Server 1",
          "Server 2",
          "Server 3",
        ];
        const results = [];
        for (const entry of selected) {
          const item = entry.source;
          const slot = entry.slot;
          let result = { ...item, adFree: true };
          if (slot === 1 || /mystream|ravok\.buzz/i.test(String(item.label || "") + " " + String(item.embed || ""))) {
            result.restrictNavigation = true;
          }
          if (item.type === "hls" && item.directHlsUrl) {
            const referer = item.referer || "https://ravok.buzz/";
            const origin = item.origin || "https://ravok.buzz";
            let playbackUrl = item.directHlsUrl;
            const secret = env?.[PROXY_SECRET_BINDING];
            if (secret) {
              const exp = String(Math.floor(Date.now() / 1000) + 86400);
              const sig = await signHlsToken(item.directHlsUrl, referer, origin, exp, secret);
              const proxy = new URL("/hls-proxy", url.origin);
              proxy.searchParams.set("url", item.directHlsUrl);
              proxy.searchParams.set("referer", referer);
              proxy.searchParams.set("origin", origin);
              proxy.searchParams.set("exp", exp);
              proxy.searchParams.set("sig", sig);
              playbackUrl = proxy.toString();
            }
            result = {
              ...result, url: playbackUrl, hlsProxyUrl: secret ? playbackUrl : undefined,
              directHlsUrl: item.directHlsUrl, source: "AnimeSalt", sourceProvider: "AnimeSalt",
            };
          }
          results.push({
            ...result, server: "Server " + slot, slot: "server-" + slot, label: labels[slot - 1],
          });
        }
        return {
          success: results.length > 0,
          message: results.length ? "Stream sources found" : "No matching sources found",
          id, season, ep, total: results.length, results, sources: results,
          serverSlots: {
            server1: results.find((item) => item.slot === "server-1") || null,
            server2: results.find((item) => item.slot === "server-2") || null,
            server3: results.find((item) => item.slot === "server-3") || null,
            server4: results.find((item) => item.slot === "server-4") || null,
          },
        };
      })();

      streamLookupInflight.set(key, lookup);
      try {
        const payload = await lookup;
        if (payload.results.length) {
          streamLookupCache.set(key, { payload, expiresAt: Date.now() + STREAM_LOOKUP_CACHE_TTL_MS });
        }
        return jsonResponse(payload, payload.results.length ? 200 : 404, request);
      } catch (error) {
        console.error("[source-resolver] lookup failed", JSON.stringify({
          id, season, ep, errorName: error instanceof Error ? error.name : "unknown",
        }));
        return jsonResponse({ success: false, message: "Source resolver failed", results: [] }, 502, request);
      } finally {
        streamLookupInflight.delete(key);
      }
    }

    async function handleStream(url, request) {
      const id = url.searchParams.get("id");
      const season = url.searchParams.get("season") || "1";
      const ep = url.searchParams.get("ep") || "1";

      if (!id) {
        return jsonResponse({ success: false, message: "Missing id" }, 400, request);
      }
      if (!/^\d{1,4}$/.test(season) || !/^\d{1,5}$/.test(ep)) {
        return jsonResponse({ success: false, message: "Invalid season/ep" }, 400, request);
      }

      const cleanId = slugify(id);

      // Fetch AnimeSalt sources (MyStream + Abyss mirrors)
      const animeSaltItems = await fetchAnimeSaltStream(cleanId, season, ep);

      if (!animeSaltItems || animeSaltItems.length === 0) {
        return jsonResponse({ success: false, message: "No valid streams found", results: [] }, 404, request);
      }

      // ── Language helpers ───────────────────────────────────────────────────────
      function isHindi(s) {
        const a = (s.audioLanguage || "").toLowerCase();
        const l = (s.language || "").toLowerCase();
        const lb = (s.languageLabel || "").toLowerCase();
        return a === "hi" || l.includes("hindi") || lb.includes("hindi");
      }

      // Build a result item from an AnimeSalt item
      function buildSaltResult(s, serverNum, customLabel) {
        return {
          ...s,
          server: `Server ${serverNum}`,
          label: customLabel || `Server ${serverNum} · ${s.label || "Mirror"}`,
        };
      }

      const list = [];
      const usedUrls = new Set();

      function addSalt(s, label) {
        if (!s) return false;
        const key = s.embed || s.url;
        if (!key || usedUrls.has(key)) return false;
        usedUrls.add(key);
        list.push(buildSaltResult(s, list.length + 1, label));
        return true;
      }

      // Slot 1 — MyStream (ravok.buzz)
      const mystream = animeSaltItems.find((s) =>
        isHindi(s) && (s.embed || "").includes("ravok.buzz")
      ) || animeSaltItems.find((s) => (s.embed || "").includes("ravok.buzz"));
      if (mystream) addSalt(mystream, "Server 1");

      // Remaining AnimeSalt mirrors (skip Abyss multi-audio bundles)
      for (const s of animeSaltItems) {
        if (list.length >= 6) break;
        if ((s.embed || "").includes("abyssplayer.com") || (s.label || "").toLowerCase().includes("abyss")) continue;
        addSalt(s, `Server ${list.length + 1}`);
      }

      // Renumber sequentially
      const finalResults = list.map((item, idx) => {
        const num = idx + 1;
        return {
          ...item,
          server: `Server ${num}`,
          label: `Server ${num}`,
        };
      });

      if (finalResults.length > 0) {
        return jsonResponse(
          {
            success: true,
            message: "Stream Found!!",
            results: finalResults,
          },
          200,
          request
        );
      }

      return jsonResponse({ success: false, message: "No valid streams found", results: [] }, 404, request);
    }

    // ── HLS Proxy Handler ────────────────────────────────────────────────────────
    // Proxies HLS/M3U8 and TS segment requests with the Referer & Origin
    // headers that the source CDN requires but the browser cannot set natively.

    const HLS_UPSTREAM_TIMEOUT_MS = 30000;
    const HLS_MAX_REDIRECTS = 5;

    function isPrivateIpv4(hostname) {
      if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
      const octets = hostname.split(".").map(Number);
      if (octets.some((octet) => octet < 0 || octet > 255)) return true;
      const [a, b, c] = octets;
      return a === 0 || a === 10 || a === 127 || a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2) || (b === 88 && c === 99))) ||
        (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
        (a === 203 && b === 0 && c === 113);
    }

    function parseIpv6Groups(hostname) {
      let address = hostname.replace(/^\[|\]$/g, "").toLowerCase();
      if (!address.includes(":")) return null;

      const dotted = address.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
      if (dotted) {
        if (isPrivateIpv4(dotted[1])) return { embeddedPrivateIpv4: true };
        const octets = dotted[1].split(".").map(Number);
        if (octets.some((octet) => octet > 255)) return null;
        const replacement = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
        address = address.replace(dotted[1], replacement);
      }

      const halves = address.split("::");
      if (halves.length > 2) return null;
      const left = halves[0] ? halves[0].split(":") : [];
      const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
      const missing = 8 - left.length - right.length;
      if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
      const groups = [...left, ...Array(missing).fill("0"), ...right].map((part) => {
        if (!/^[\da-f]{1,4}$/.test(part)) return NaN;
        return parseInt(part, 16);
      });
      return groups.length === 8 && groups.every(Number.isInteger) ? groups : null;
    }

    function isPrivateOrLocalHost(hostname) {
      const host = hostname.toLowerCase().replace(/\.$/, "");
      if (
        host === "localhost" || host === "localhost.localdomain" ||
        /\.(?:localhost|local|lan|internal|home\.arpa|test|invalid|example)$/.test(host)
      ) return true;
      if (isPrivateIpv4(host)) return true;

      if (host.includes(":")) {
        const groups = parseIpv6Groups(host);
        if (!groups || groups.embeddedPrivateIpv4) return true;
        const [a, b, c, d, e, f] = groups;
        const unspecifiedOrLoopback = groups.slice(0, 7).every((group) => group === 0) && (groups[7] === 0 || groups[7] === 1);
        const uniqueLocal = (a & 0xfe00) === 0xfc00;
        const linkLocal = (a & 0xffc0) === 0xfe80;
        const siteLocal = (a & 0xffc0) === 0xfec0;
        const multicast = (a & 0xff00) === 0xff00;
        const mappedIpv4 = groups.slice(0, 5).every((group) => group === 0) && f === 0xffff;
        const nat64 = a === 0x0064 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0;
        if (mappedIpv4 || nat64) {
          const ipv4 = `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
          return isPrivateIpv4(ipv4);
        }
        return unspecifiedOrLoopback || uniqueLocal || linkLocal || siteLocal || multicast || (a === 0x2001 && b === 0x0db8);
      }

      return false;
    }

    const ALLOWED_HLS_BASE_DOMAINS = new Set([
      "vmget.online",
      "ravok.buzz",
      "as-cdn.top",
      "as-cdn23.top",
      "as-cdn24.top",
      "as-cdn25.top",
      "as-cdn26.top",
      "as-cdn27.top",
      "as-cdn28.top",
      "as-cdn29.top",
      "as-cdn30.top",
      "as-cdn31.top",
      "sendvid.com",
      "videos2.sendvid.com",
      "megaplay.buzz",
      "4anime.com.ro",
      "player.animeinfinity.me",
      "archive.animeinfinity.me",
      "animeflash.live",
      "animeinfinity.me",
      "as-cdn23.top",
      "as-cdn24.top",
      "as-cdn25.top",
      "as-cdn26.top",
      "as-cdn27.top",
      "as-cdn28.top",
      "as-cdn29.top",
      "as-cdn30.top",
      "as-cdn31.top",
      "vmpx.online",
      "vmeas.cloud",
      "vmnow.online",
      "fastream.to",
      "vidmoly.to",
      "vidmoly.net",
      "vidmoly.me",
      "hakunaymatata.com",
      "hakuna.my",
      "sibnet.ru",
      "video.sibnet.ru",
      "filesforever.in",
      "filesforever.org",
      "abyssplayer.com",
      "vidzy.org",
      "vidzy.online",
    ]);

    const PROVIDER_CLUSTER_GROUPS = [
      // Vidmoly cluster: master/variants/segments spread across these domains
      new Set(["vidmoly.to", "vidmoly.net", "vidmoly.me", "vmpx.online", "vmeas.cloud", "vmnow.online"]),
      // Fastream cluster
      new Set(["fastream.to"]),
      // Hakunamatata cluster
      new Set(["hakunaymatata.com", "hakuna.my"]),
      // Sibnet cluster
      new Set(["sibnet.ru", "video.sibnet.ru"]),
      // FilesForever / Abyss cluster
      new Set(["filesforever.in", "filesforever.org", "abyssplayer.com"]),
      // Vidzy cluster
      new Set(["vidzy.org", "vidzy.online"]),
      new Set(["ravok.buzz", "as-cdn.top", "as-cdn23.top", "as-cdn24.top", "as-cdn25.top", "as-cdn26.top", "as-cdn27.top", "as-cdn28.top", "as-cdn29.top", "as-cdn30.top", "as-cdn31.top"]),
      new Set(["sendvid.com", "videos2.sendvid.com"]),
      new Set(["player.animeinfinity.me", "archive.animeinfinity.me", "animeflash.live", "animeinfinity.me"]),
    ];

    function areHostsInSameCluster(hostA, hostB) {
      if (hostA === hostB) return true;
      for (const cluster of PROVIDER_CLUSTER_GROUPS) {
        const inClusterA = cluster.has(hostA) || Array.from(cluster).some((d) => hostA.endsWith(`.${d}`));
        const inClusterB = cluster.has(hostB) || Array.from(cluster).some((d) => hostB.endsWith(`.${d}`));
        if (inClusterA && inClusterB) return true;
      }
      return false;
    }

    const ALLOWED_HLS_EXT_REGEX = /\.(m3u8|ts|mp4|m4s|aac|vtt|key)(\?.*)?$/i;
    const ALLOWED_HLS_PATH_REGEX = /\/(hls|hls2|stream|playlist|bt|resource)\//i;
    const ALLOWED_HLS_BASE_DOMAINS_ARRAY = Array.from(ALLOWED_HLS_BASE_DOMAINS);

    function isAllowedHlsHostName(hostname) {
      if (/^as-cdn\d*\.top$/i.test(hostname)) return true;
      for (let i = 0; i < ALLOWED_HLS_BASE_DOMAINS_ARRAY.length; i++) {
        const allowed = ALLOWED_HLS_BASE_DOMAINS_ARRAY[i];
        if (hostname === allowed || hostname.endsWith(`.${allowed}`)) return true;
      }
      return false;
    }

    function hasAllowedHlsMediaExtension(pathname) {
      return ALLOWED_HLS_EXT_REGEX.test(pathname) || ALLOWED_HLS_PATH_REGEX.test(pathname);
    }

    function isAllowedHlsTarget(target) {
      if (
        target.protocol !== "https:" || target.username || target.password || target.port ||
        isPrivateOrLocalHost(target.hostname)
      ) return false;

      const hostname = target.hostname.toLowerCase();
      const isAllowedHost = isAllowedHlsHostName(hostname);
      const pathname = target.pathname.toLowerCase();
      const isAllowedPath = hasAllowedHlsMediaExtension(pathname);

      if (!isAllowedHost || !isAllowedPath) {
        console.warn("[hls-proxy] Rejected unallowlisted HLS target:", JSON.stringify({
          host: hostname,
          path: pathname,
          reason: !isAllowedHost ? "disallowed-host" : "disallowed-path",
        }));
        return false;
      }

      return true;
    }

    async function fetchHlsWithValidatedRedirects(target, headers, signal) {
      let current = new URL(target.toString());
      const redirectStatuses = new Set([301, 302, 303, 307, 308]);

      for (let redirects = 0; redirects <= HLS_MAX_REDIRECTS; redirects += 1) {
        if (!isAllowedHlsTarget(current)) return { response: null, blockedRedirect: redirects > 0 };
        const response = await fetch(current.toString(), {
          method: "GET",
          headers,
          signal,
          redirect: "manual",
        });
        const location = response.headers.get("location");
        if (!redirectStatuses.has(response.status) || !location) {
          return { response, finalUrl: current, blockedRedirect: false };
        }

        let next;
        try {
          next = new URL(location, current);
        } catch {
          await response.body?.cancel().catch(() => {});
          return { response: null, blockedRedirect: true };
        }
        await response.body?.cancel().catch(() => {});
        if (!isAllowedHlsTarget(next) || redirects === HLS_MAX_REDIRECTS) {
          return { response: null, blockedRedirect: true };
        }
        current = next;
      }

      return { response: null, blockedRedirect: true };
    }

    function streamBodyWithTimeout(body, controller, timer) {
      const reader = body.getReader();
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try { reader.releaseLock(); } catch { /* already released */ }
      };

      return new ReadableStream({
        async pull(streamController) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              streamController.close();
              finish();
            } else {
              streamController.enqueue(value);
            }
          } catch (error) {
            streamController.error(error);
            finish();
          }
        },
        async cancel(reason) {
          controller.abort();
          try {
            await reader.cancel(reason);
          } finally {
            finish();
          }
        },
      });
    }

    async function verifyHlsToken(targetUrl, referer, origin, exp, sig, secret) {
      if (!targetUrl || !exp || !sig || !secret) return false;
      if (!/^[0-9a-fA-F]{64}$/.test(sig)) return false;
      const expNum = Number(exp);
      if (!Number.isSafeInteger(expNum) || expNum <= 0) return false;
      if (Math.floor(Date.now() / 1000) > expNum) return false;

      try {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          "raw",
          encoder.encode(secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["verify"]
        );
        const payload = encoder.encode(`${targetUrl}:${referer || ""}:${origin || ""}:${exp}`);
        const sigBytes = new Uint8Array(
          sig.match(/.{1,2}/g).map((byte) => parseInt(byte, 16))
        );
        return await crypto.subtle.verify("HMAC", key, sigBytes, payload);
      } catch {
        return false;
      }
    }

    async function signHlsToken(targetUrl, referer, origin, exp, secret) {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const payload = encoder.encode(`${targetUrl}:${referer || ""}:${origin || ""}:${exp}`);
      const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, payload));
      return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }

    async function handleHlsProxy(url, request, env) {
      const targetUrl = url.searchParams.get("url");
      const parentUrl = url.searchParams.get("parent");
      const referer = url.searchParams.get("referer") || "";
      const origin = url.searchParams.get("origin") || "";
      const exp = url.searchParams.get("exp");
      const sig = url.searchParams.get("sig");
      const secret = env?.[PROXY_SECRET_BINDING];

      if (!targetUrl) {
        return new Response(JSON.stringify({ error: "Missing ?url= parameter" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders(request) },
        });
      }

      let parsedTarget;
      try {
        parsedTarget = new URL(targetUrl);
      } catch {
        return new Response(JSON.stringify({ error: "Invalid URL" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders(request) },
        });
      }

      // Only allow proxying actual media streams from allowlisted base domains
      if (!isAllowedHlsTarget(parsedTarget)) {
        return new Response(JSON.stringify({ error: "URL type not allowed" }), {
          status: 403,
          headers: { "Content-Type": "application/json", ...corsHeaders(request) },
        });
      }

      // If parentUrl is present, verify related provider cluster scope
      let rootParentUrl = targetUrl;
      if (parentUrl) {
        let parsedParent;
        try {
          parsedParent = new URL(parentUrl);
        } catch {
          return new Response(JSON.stringify({ error: "Invalid parent URL" }), {
            status: 403,
            headers: { "Content-Type": "application/json", ...corsHeaders(request) },
          });
        }
        if (!isAllowedHlsTarget(parsedParent)) {
          return new Response(JSON.stringify({ error: "Parent URL not allowed" }), {
            status: 403,
            headers: { "Content-Type": "application/json", ...corsHeaders(request) },
          });
        }
        // Target and parent must be in the exact same provider domain cluster
        const targetHost = parsedTarget.hostname.toLowerCase();
        const parentHost = parsedParent.hostname.toLowerCase();
        if (!areHostsInSameCluster(targetHost, parentHost)) {
          console.warn("[hls-proxy] Rejected cross-provider segment:", JSON.stringify({ targetHost, parentHost }));
          return new Response(JSON.stringify({ error: "Host not in parent provider cluster" }), {
            status: 403,
            headers: { "Content-Type": "application/json", ...corsHeaders(request) },
          });
        }
        rootParentUrl = parentUrl;
      }

      // Constant-time HMAC token validation against root parent
      const isValidToken = await verifyHlsToken(rootParentUrl, referer, origin, exp, sig, secret);
      if (!isValidToken) {
        return new Response(JSON.stringify({ error: "Unauthorized or expired media token" }), {
          status: 403,
          headers: { "Content-Type": "application/json", ...corsHeaders(request) },
        });
      }

      const proxyHeaders = {
        "User-Agent": BROWSER_UA,
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        ...(referer ? { Referer: referer } : {}),
        ...(origin ? { Origin: origin } : {}),
        // Forward range header for segment seeking
        ...(request.headers.get("Range") ? { Range: request.headers.get("Range") } : {}),
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HLS_UPSTREAM_TIMEOUT_MS);
      let timeoutTransferredToBody = false;
      try {
        const { response: res, finalUrl, blockedRedirect } = await fetchHlsWithValidatedRedirects(
          parsedTarget,
          proxyHeaders,
          controller.signal
        );
        if (!res) {
          return new Response(JSON.stringify({ error: blockedRedirect ? "Redirect target not allowed" : "URL type not allowed" }), {
            status: 403,
            headers: { "Content-Type": "application/json", ...corsHeaders(request) },
          });
        }

        if (!res.ok) {
          return new Response(JSON.stringify({ error: `Upstream media server returned HTTP ${res.status}` }), {
            status: res.status,
            headers: { "Content-Type": "application/json", ...corsHeaders(request) },
          });
        }

        const responseHeaders = new Headers();
        // Pass through content headers
        const ct = res.headers.get("Content-Type");
        if (ct) responseHeaders.set("Content-Type", ct);
        const cl = res.headers.get("Content-Length");
        if (cl) responseHeaders.set("Content-Length", cl);
        const cr = res.headers.get("Content-Range");
        if (cr) responseHeaders.set("Content-Range", cr);
        const acc = res.headers.get("Accept-Ranges");
        if (acc) responseHeaders.set("Accept-Ranges", acc);
        const lm = res.headers.get("Last-Modified");
        if (lm) responseHeaders.set("Last-Modified", lm);
        const etag = res.headers.get("ETag");
        if (etag) responseHeaders.set("ETag", etag);
        responseHeaders.set("Cache-Control", "public, max-age=60");

        // Add CORS headers
        const corsH = corsHeaders(request);
        for (const [k, v] of Object.entries(corsH)) responseHeaders.set(k, v);
        responseHeaders.delete("set-cookie");

        // For M3U8 playlists, rewrite segment URLs to also go through this proxy
        if (finalUrl.pathname.toLowerCase().endsWith(".m3u8") || (ct && ct.includes("mpegurl"))) {
          const text = await res.text();
          const baseUrl = `${finalUrl.protocol}//${finalUrl.host}${finalUrl.pathname.replace(/\/[^\/]*$/, "/")}`;
          const workerBase = url.origin + "/hls-proxy";
          // Always propagate the original parent URL across master -> variant -> segment chain
          const rootParent = parentUrl || targetUrl;
          const targetHost = parsedTarget.hostname.toLowerCase();
          const hostDecisionCache = new Map();

          function checkHostAllowedAndClustered(segHost) {
            let allowed = hostDecisionCache.get(segHost);
            if (allowed !== undefined) return allowed;

            allowed = isAllowedHlsHostName(segHost) && areHostsInSameCluster(segHost, targetHost);
            hostDecisionCache.set(segHost, allowed);
            if (!allowed) {
              console.warn("[hls-proxy] Rejected host outside provider cluster:", JSON.stringify({ segHost, targetHost }));
            }
            return allowed;
          }

          const lines = text.split("\n");
          const rewrittenLines = [];
          let pendingTagLines = [];
          let validMediaEntryCount = 0;

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
              rewrittenLines.push(line);
              continue;
            }

            // Rewrite URI attributes in tags like #EXT-X-KEY (encryption) and #EXT-X-MEDIA
            if (trimmed.startsWith("#")) {
              if (trimmed.includes("URI=")) {
                const match = trimmed.match(/URI=["']([^"']+)["']/);
                if (match) {
                  try {
                    const segUrl = new URL(match[1], baseUrl);
                    const isKeyLine = trimmed.includes("#EXT-X-KEY");
                    const segHost = segUrl.hostname.toLowerCase();
                    if (!checkHostAllowedAndClustered(segHost) || !hasAllowedHlsMediaExtension(segUrl.pathname.toLowerCase())) {
                      if (isKeyLine) {
                        console.warn("[hls-proxy] Dropped untrusted #EXT-X-KEY line:", JSON.stringify({
                          keyHost: segHost,
                          parentHost: targetHost,
                          rawLine: trimmed,
                        }));
                      }
                      continue; // Drop line
                    }
                    const params = new URLSearchParams({
                      url: segUrl.toString(),
                      parent: rootParent,
                      exp: String(exp),
                      sig: sig || "",
                    });
                    if (referer) params.set("referer", referer);
                    if (origin)  params.set("origin", origin);
                    rewrittenLines.push(trimmed.replace(match[0], `URI="${workerBase}?${params.toString()}"`));
                    continue;
                  } catch {
                    if (trimmed.includes("#EXT-X-KEY")) {
                      console.warn("[hls-proxy] Dropped malformed #EXT-X-KEY line:", trimmed);
                    }
                    continue;
                  }
                }
              }

              // Buffer preceding metadata tags that describe the next URL entry (#EXTINF, #EXT-X-STREAM-INF, #EXT-X-BYTERANGE)
              if (
                trimmed.startsWith("#EXTINF:") ||
                trimmed.startsWith("#EXT-X-STREAM-INF:") ||
                trimmed.startsWith("#EXT-X-BYTERANGE:")
              ) {
                pendingTagLines.push(line);
                continue;
              }

              // Flush any pending tag lines before standalone playlist tags
              if (pendingTagLines.length > 0) {
                for (const pending of pendingTagLines) rewrittenLines.push(pending);
                pendingTagLines = [];
              }
              rewrittenLines.push(line);
              continue;
            }

            // Non-tag line: this is a segment or variant playlist URL
            let segUrl;
            try {
              segUrl = new URL(trimmed, baseUrl);
            } catch {
              // Drop malformed URL and its preceding metadata tag
              pendingTagLines = [];
              continue;
            }

            const segHost = segUrl.hostname.toLowerCase();
            if (!checkHostAllowedAndClustered(segHost) || !hasAllowedHlsMediaExtension(segUrl.pathname.toLowerCase())) {
              // Drop disallowed URL and also drop its preceding metadata tags (#EXTINF / #EXT-X-STREAM-INF)
              console.warn("[hls-proxy] Dropped media URL and preceding tags:", JSON.stringify({
                droppedHost: segHost,
                droppedPath: segUrl.pathname,
                parentHost: targetHost,
              }));
              pendingTagLines = [];
              continue;
            }

            // URL is valid and allowlisted: flush its preceding metadata tags and output the rewritten URL
            validMediaEntryCount++;
            if (pendingTagLines.length > 0) {
              for (const pending of pendingTagLines) rewrittenLines.push(pending);
              pendingTagLines = [];
            }

            const params = new URLSearchParams({
              url: segUrl.toString(),
              parent: rootParent,
              exp: String(exp),
              sig: sig || "",
            });
            if (referer) params.set("referer", referer);
            if (origin)  params.set("origin", origin);
            rewrittenLines.push(`${workerBase}?${params.toString()}`);
          }

          // If the playlist had media lines but all were dropped, return clear 502 error
          if (validMediaEntryCount === 0 && lines.some((l) => l.trim().startsWith("#EXTINF") || l.trim().startsWith("#EXT-X-STREAM-INF"))) {
            return new Response(JSON.stringify({ error: "No valid streams found in playlist; all segments were dropped" }), {
              status: 502,
              headers: { "Content-Type": "application/json", ...corsHeaders(request) },
            });
          }

          const rewritten = rewrittenLines.join("\n");

          responseHeaders.set("Content-Type", "application/vnd.apple.mpegurl");
          responseHeaders.delete("Content-Length");
          // Playlists contain time-sensitive tokens: never cache
          responseHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate");
          responseHeaders.set("Pragma", "no-cache");
          return new Response(rewritten, { status: res.status, headers: responseHeaders });
        }

        if (!res.body) return new Response(null, { status: res.status, headers: responseHeaders });
        timeoutTransferredToBody = true;
        return new Response(streamBodyWithTimeout(res.body, controller, timer), {
          status: res.status,
          headers: responseHeaders,
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "HLS proxy fetch failed", detail: String(err) }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...corsHeaders(request) },
        });
      } finally {
        if (!timeoutTransferredToBody) clearTimeout(timer);
      }
    }

    // ── Toko Fetcher removed — Toko (anime-api2) is no longer a source ──────────

    /**
     * Fetch streaming embed sources directly from AnimeSalt (animesalt.cx).
     * Extracts AbyssPlayer multi-language embeds (Hindi, Japanese, English, etc.)
     * and direct video iframes (MyStream / ravok.buzz).
     */
    async function fetchAnimeSaltStream(id, season, ep, isMovie = false) {
      const sNum = parseInt(season, 10) || 1;
      const epNum = parseInt(ep, 10) || 1;
      const baseSlug = id
        .replace(/-season-\d+$/i, "")
        .replace(/-s\d+$/i, "")
        .replace(/-\d+(st|nd|rd|th)-season$/i, "");

      const candidates = isMovie
        ? [`https://animesalt.cx/movies/${baseSlug}/`]
        : [...new Set([
          `https://animesalt.cx/episode/${baseSlug}-${sNum}x${epNum}/`,
          `https://animesalt.cx/episode/${id}-${sNum}x${epNum}/`,
          `https://animesalt.cx/episode/${baseSlug}-${epNum}/`,
        ])];

      for (const targetUrl of candidates) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        try {
          const res = await fetch(targetUrl, {
            signal: controller.signal,
            headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
          });
          // A 4xx is final for this AnimeSalt episode lookup. Do not probe the
          // remaining aliases after a denial/not-found response; the caller can
          // still use the independently resolved Toko sources.
          if (res.status >= 400 && res.status < 500) return [];
          if (!res.ok) continue;
          const html = await readResponseTextWithLimit(res, ANIMESALT_RESPONSE_MAX_BYTES);
          if (!html || html.length < 1000 || html.includes("404 Not Found")) continue;

          const items = [];
          const usedUrls = new Set();

          // 1. Look for Plyr base64 JSON (Abyssplayer by language)
          const plyrMatch = html.match(/player\.php\?data=([A-Za-z0-9%_-]+)/);
          if (plyrMatch) {
            try {
              const rawB64 = decodeURIComponent(plyrMatch[1]);
              const decoded = atob(rawB64);
              const parsed = JSON.parse(decoded);
              if (Array.isArray(parsed)) {
                for (const p of parsed) {
                  if (p.link && !usedUrls.has(p.link) && !BLOCKED_STREAM_DOMAINS.some((d) => p.link.includes(d))) {
                    usedUrls.add(p.link);
                    const lang = p.language || "Multi";
                    const isHi = /hindi/i.test(lang);
                    const isJa = /japanese/i.test(lang);
                    items.push({
                      server: `AnimeSalt ${lang}`,
                      label: `AnimeSalt · ${isHi ? "🇮🇳 Hindi" : isJa ? "🇯🇵 Japanese" : "🌐 " + lang} (Abyss)`,
                      embed: p.link,
                      type: "embed",
                      audioLanguage: isHi ? "hi" : isJa ? "ja" : "en",
                      languageLabel: lang,
                      adFree: false,
                    });
                  }
                }
              }
            } catch { /* ignore */ }
          }

          // 2. Look for iframe embeds (e.g. ravok.buzz / mystream)
          const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/gi;
          let m;
          while ((m = iframeRegex.exec(html)) !== null) {
            const src = m[1];
            if (src && !usedUrls.has(src) && !src.includes("player.php") && !BLOCKED_STREAM_DOMAINS.some((d) => src.includes(d))) {
              usedUrls.add(src);
              const isRavok = src.includes("ravok.buzz");
              items.push({
                server: isRavok ? "AnimeSalt MyStream" : "AnimeSalt Embed",
                label: isRavok ? "AnimeSalt · 🇮🇳 MyStream" : "AnimeSalt · Embed",
                embed: src,
                type: "embed",
                audioLanguage: "hi",
                languageLabel: "🇮🇳 Hindi",
                adFree: false,
              });
            }
          }

          // Resolve a MyStream multi-audio HLS manifest as the preferred source.
          const ravokFrame = [...html.matchAll(/(?:src|data-src)=["']([^"']*ravok\.buzz\/(?:video|embed|e)\/([a-zA-Z0-9]+)[^"']*)["']/gi)][0];
          const ravokHash = ravokFrame?.[2] || html.match(/https?:\/\/ravok\.buzz\/(?:video|embed|e)\/([a-zA-Z0-9]+)/i)?.[1];
          if (ravokHash) {
            const directHlsUrl = await resolveRavokHls(ravokHash);
            if (directHlsUrl) {
              const embed = `https://ravok.buzz/video/${ravokHash}`;
              items.unshift({
                server: "AnimeSalt MyStream HLS",
                source: "AnimeSalt",
                sourceProvider: "AnimeSalt",
                label: "Hindi Dub HLS (Multi-Audio)",
                embed,
                url: directHlsUrl,
                directHlsUrl,
                referer: embed,
                origin: "https://ravok.buzz",
                type: "hls",
                audioLanguage: "hi",
                languageLabel: "Hindi Dub (Multi-Audio)",
                adFree: true,
              });
            }
          }

          if (items.length > 0) {
            return items;
          }
        } catch { /* ignore */ }
        finally { clearTimeout(timer); }
      }
      return [];
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────

    function slugify(s) {
      return s
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
    }

    /**
     * Generate season-aware title variants for Toko.
     * Toko does NOT route by the ?season= param — it routes by title.
     * For Season 2+ we embed the season number in the title string.
     */
    function slugToSeasonTitles(slug, season) {
      // Strip any season suffix already in the slug (e.g. attack-on-titan-season-2)
      const cleanSlug = slug
        .replace(/-season-\d+$/i, "")
        .replace(/-s\d+$/i, "")
        .replace(/-\d+(st|nd|rd|th)-season$/i, "");

      const base = cleanSlug
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();

      const sNum = parseInt(season, 10) || 1;

      if (sNum <= 1) {
        return [base];
      }

      // Season 2+: Season-specific titles MUST come first so providers match Season 2
      const ordinal = sNum === 2 ? "2nd" : sNum === 3 ? "3rd" : `${sNum}th`;
      return [
        `${base} Season ${sNum}`,
        `${base} ${ordinal} Season`,
        `${base} S${sNum}`,
        base,
      ];
    }

    // Legacy alias kept for potential future use
    function slugToTitles(slug) {
      return slugToSeasonTitles(slug, "1");
    }

    const BLOCKED_STREAM_DOMAINS = [
      // ── Link shorteners / ad-walls ──────────────────────────────────────────────
      "mvlink",
      "linkskit",
      "linkvertise",
      "hindmovie",
      "hshare",
      "shortx",
      "ouo.io",
      "ouo.press",
      "shareus",
      "gofile",
      "dropgalaxy",
      "katfile",
      "turbobit",
      "rapidgator",
      "1fichier",
      "mediafire",
      "mega.nz",
      "mega.co",
      "shorte.st",
      "adf.ly",
      "adfly",
      "shrinkme",
      "earn4link",
      "droplink",
      "clicksfly",
      "gplinks",
      "cuty.io",
      "exe.io",
      // ── Ad-wall video hosts (show "AdBlock/Sandbox" error in iframe) ────────────
      "multishows",
      "streamtape",
      "doodstream",
      "dood.watch",
      "dood.la",
      "dood.pm",
      "dood.to",
      "ds2play",
      "voe.sx",
      "voe.network",
      "mixdrop",
      "sendvid",
      "uqload",
      "upstream.to",
      "evoload",
      "clipwatching",
      "waaw.tv",
      "gounlimited",
      "vudeo",
      // ── Broken / Timeout / ASN-locked stream hosts ─────────────────────────────
      "rubystm",
      "cloudy.upns.one",
      "upns.one",
      "acek-cdn",
      "dramiyos-cdn",
      "prx-am",
      "animesama",
    ];

    function isBlockedStreamSource(s) {
      const provider = (s.providerName || s.source || s.server || "").toLowerCase();
      if (provider.includes("hindmovie") || provider.includes("mvlink") || provider.includes("animesama")) return true;

      const urlStr = (s.url || "").toLowerCase();
      if (/\.(mkv|zip|rar|7z|tar|gz|torrent|iso)(\?|$)/i.test(urlStr)) return true;
      if (BLOCKED_STREAM_DOMAINS.some((d) => urlStr.includes(d) || provider.includes(d))) return true;

      try {
        const u = new URL(urlStr);
        const host = u.hostname.toLowerCase();
        if (BLOCKED_STREAM_DOMAINS.some((d) => host.includes(d))) return true;
      } catch {
        return true;
      }
      return false;
    }

    function isValidUrl(s) {
      if (!s || typeof s !== "string") return false;
      if (/\.(mkv|zip|rar|7z|tar|gz|torrent|iso)(\?|$)/i.test(s)) return false;
      try {
        const u = new URL(s);
        if (u.protocol !== "http:" && u.protocol !== "https:") return false;
        const p = u.pathname.replace(/\/+$/, "");
        if (!p) return false;
        const host = u.hostname.toLowerCase();
        if (BLOCKED_STREAM_DOMAINS.some((d) => host.includes(d))) return false;
        return true;
      } catch {
        return false;
      }
    }

    /** Looser validator for embed URLs — only requires http(s) and a non-blocked domain */
    function isValidEmbedUrl(s) {
      if (!s || typeof s !== "string") return false;
      const trimmed = s.trim();
      if (!trimmed || trimmed.toLowerCase() === "not found" || trimmed.toLowerCase() === "error loading") return false;
      if (/\.(mkv|zip|rar|7z|tar|gz|torrent|iso)(\?|$)/i.test(trimmed)) return false;
      try {
        const u = new URL(trimmed);
        if (u.protocol !== "http:" && u.protocol !== "https:") return false;
        const host = u.hostname.toLowerCase();
        if (BLOCKED_STREAM_DOMAINS.some((d) => host.includes(d))) return false;
        return true;
      } catch {
        return false;
      }
    }

    function jsonResponse(body, status, request) {
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          ...corsHeaders(request),
        },
      });
    }

    function corsHeaders(request) {
      const origin = request.headers.get("Origin") || "";
      const headers = {
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Range, X-Requested-With, X-Turnstile-Token, x-turnstile-token, x-hindianime-proxy-secret, Cache-Control, Pragma",
        "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Type, X-AnimeSalt-Challenge-Cooldown",
        "Access-Control-Max-Age": "86400",
      };
      if (origin && (ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".vercel.app") || origin.includes("localhost"))) {
        headers["Access-Control-Allow-Origin"] = origin;
        headers.Vary = "Origin";
      }
      return headers;
    }
