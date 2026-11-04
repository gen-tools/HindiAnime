import { NextResponse } from "next/server";
import { createHmac } from "crypto";
import { BLOCKED_STREAM_DOMAINS, cleanAnimeSlug } from "@/lib/api/client";
import { ALLOWED_WORKER_HOSTS, DEFAULT_WORKER_BASE_URL } from "@/lib/api/worker-config";
import { buildAnimeSaltEpisodeCandidates, buildAnimeSaltMovieUrl, isValidAnimeSaltHtml } from "@/lib/animesalt-stream";
import { buildServerWorkerProxyUrl, getServerWorkerHeaders } from "@/lib/api/worker-auth";
import type { StreamItem } from "@/types/api";

function isCloudflareChallenge(text: string): boolean {
  return (
    text.includes("Just a moment...") ||
    text.includes("cf-chl-widget") ||
    text.includes("id=\"challenge-stage\"") ||
    text.includes("id=\"challenge-form\"") ||
    text.includes("_cf_chl_opt") ||
    text.includes("cf-browser-verification") ||
    text.includes("Attention Required! | Cloudflare") ||
    text.includes("security check")
  );
}

// Stream links are dynamic and short-lived
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;



const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  Accept: "application/json",
};

const rawCfProxy = (
  process.env.CF_PROXY_URL ||
  `${DEFAULT_WORKER_BASE_URL}/?url=`
).trim(); // trim trailing newlines/spaces common in .env files

/**
 * Base URL for the Cloudflare Worker endpoint.
 * Accepted hostnames: wispy-cherry-6934.sheztech.workers.dev (legacy)
 * and cloud.hindi-anime.com (new custom domain).
 * Robustly extracted using URL().origin so trailing /?url=, newlines,
 * or slash variants in the env var never produce a malformed proxy URL.
 */
function getCfWorkerBase(): string {
  try {
    const parsed = new URL(rawCfProxy);
    const allowedQuery = parsed.search === "" ||
      (parsed.searchParams.size === 1 && parsed.searchParams.has("url") && parsed.searchParams.get("url") === "");
    if (
      parsed.protocol === "https:" &&
      ALLOWED_WORKER_HOSTS.has(parsed.hostname) &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname === "/" &&
      allowedQuery &&
      !parsed.hash
    ) {
      return parsed.origin;
    }
  } catch { /* fall through */ }
  // Absolute fallback
  return DEFAULT_WORKER_BASE_URL;
}
const CF_WORKER_BASE = getCfWorkerBase();

function buildCfProxyUrl(targetUrl: string): string {
  const proxyUrl = new URL("/", CF_WORKER_BASE);
  proxyUrl.searchParams.set("url", targetUrl);
  return proxyUrl.toString();
}

function isValidStreamUrl(s: string): boolean {
  if (!s || typeof s !== "string") return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isHindi(s: { audioLanguage?: string; language?: string; languageLabel?: string }): boolean {
  const a = (s.audioLanguage || "").toLowerCase();
  const l = (s.language || "").toLowerCase();
  const lb = (s.languageLabel || "").toLowerCase();
  return a === "hi" || l.includes("hindi") || lb.includes("hindi");
}

function buildSignedHlsUrl(streamUrl: string, referer?: string, origin?: string): string {
  const secret = process.env.CF_PROXY_SHARED_SECRET?.trim();
  const exp = String(Math.floor(Date.now() / 1000) + 7200);
  const p = new URLSearchParams({ url: streamUrl, exp });
  if (referer) p.set("referer", referer);
  if (origin)  p.set("origin",  origin);
  if (secret) {
    const payload = `${streamUrl}:${exp}`;
    const sig = createHmac("sha256", secret).update(payload).digest("hex");
    p.set("sig", sig);
  }
  return `/api/hls-proxy?${p.toString()}`;
}

async function resolveRavokHls(hash: string): Promise<string | null> {
  if (!/^[a-zA-Z0-9]{8,80}$/.test(hash || "")) return null;
  try {
    const body = new URLSearchParams({ hash, r: "https://animesalt.cx/" });
    const res = await fetch(
      "https://ravok.buzz/player/index.php?data=" + encodeURIComponent(hash) + "&do=getVideo",
      {
        method: "POST",
        headers: {
          ...DEFAULT_HEADERS,
          Referer: "https://ravok.buzz/video/" + hash,
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const source = (data?.videoSource || data?.securedLink) as string | undefined;
    if (typeof source !== "string") return null;
    const parsed = new URL(source);
    if (parsed.protocol !== "https:") return null;
    return source;
  } catch {
    return null;
  }
}

function findAnimaHdFileId(html: string, season: string, ep: string): string | null {
  const regex = /<a[^>]*class=["'][^"']*app-ep-row-item[^"']*["'][^>]*data-season=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  const episodes: Array<{ fileId: string; seasonNum: number; epNum: number }> = [];
  const lastEpisodeBySeason = new Map<number, number>();
  while ((match = regex.exec(html)) !== null) {
    const file = match[2].match(/data-fileid=["']([a-zA-Z0-9_-]{20,100})["']/i);
    if (!file) continue;
    const titleMatch = match[2].match(/<div[^>]*font-size:\s*14px[^>]*>([\s\S]*?)<\/div>/i);
    const title = (titleMatch?.[1] || "").replace(/<[^>]+>/g, " ").trim();
    const seasonMatch = match[1].match(/\d+/);
    let seasonNum = seasonMatch ? Number(seasonMatch[0]) : 1;
    let epNum = (lastEpisodeBySeason.get(seasonNum) || 0) + 1;
    const both = title.match(/S(\d+)E(\d+)/i);
    const onlyEp = title.match(/(?:ep|episode)[-.\s]*(\d+)/i);
    if (both) {
      seasonNum = Number(both[1]);
      // AnimaHD currently labels one Grand Blue S3 file "S03E0". Treat zero
      // as a missing episode number and use its ordinal within that season.
      epNum = Number(both[2]) || (lastEpisodeBySeason.get(seasonNum) || 0) + 1;
    } else if (onlyEp) {
      epNum = Number(onlyEp[1]) || epNum;
    }
    lastEpisodeBySeason.set(seasonNum, Math.max(lastEpisodeBySeason.get(seasonNum) || 0, epNum));
    episodes.push({ fileId: file[1], seasonNum, epNum });
  }
  const epTarget = episodes.find((item) => item.seasonNum === Number(season) && item.epNum === Number(ep));
  return epTarget?.fileId || null;
}

async function fetchGoogleDriveSource(slug: string, season: string, ep: string): Promise<StreamItem | null> {
  const cleanSlug = slug.replace(/-season-\d+$/i, "").replace(/-s\d+$/i, "");
  let fileId: string | null = null;
  try {
    const res = await fetch("https://animahd.com/" + encodeURIComponent(cleanSlug) + "/", {
      headers: { ...DEFAULT_HEADERS, Accept: "text/html", Referer: "https://animahd.com/" },
    });
    if (res.ok) {
      const html = await res.text();
      fileId = findAnimaHdFileId(html, season, ep);
    }
  } catch { /* try WP search */ }

  if (!fileId) {
    try {
      const query = "https://animahd.com/wp-json/wp/v2/posts?search=" +
        encodeURIComponent(cleanSlug.replace(/-/g, " ")) + "&_embed&per_page=8";
      const res = await fetch(query, { headers: { ...DEFAULT_HEADERS, Accept: "application/json" } });
      if (res.ok) {
        const posts = (await res.json()) as Array<{ slug?: string; title?: { rendered?: string }; link?: string }>;
        if (Array.isArray(posts) && posts.length) {
          const words = cleanSlug.split("-").filter((word) => word.length > 2);
          const best = posts.map((post) => {
            const normalized = (String(post.slug || "") + " " + String(post.title?.rendered || ""))
              .toLowerCase().replace(/[^a-z0-9]+/g, " ");
            const tokens = new Set(normalized.split(/\s+/).filter(Boolean));
            return { post, score: words.length ? words.filter((word) => tokens.has(word)).length / words.length : 0 };
          }).sort((a, b) => b.score - a.score)[0];
          if (best && best.score >= 0.6 && typeof best.post.link === "string") {
            const pageRes = await fetch(best.post.link, {
              headers: { ...DEFAULT_HEADERS, Accept: "text/html", Referer: "https://animahd.com/" },
            });
            if (pageRes.ok) {
              const html = await pageRes.text();
              fileId = findAnimaHdFileId(html, season, ep);
            }
          }
        }
      }
    } catch { /* no Drive result */ }
  }

  if (!fileId) return null;
  const embed = "https://drive.google.com/file/d/" + encodeURIComponent(fileId) + "/preview";
  return {
    server: "Server 2",
    slot: "server-2",
    source: "GoogleDrive",
    sourceProvider: "GoogleDrive",
    label: "Server 2",
    embed,
    url: embed,
    type: "embed",
    audioLanguage: "hi",
    languageLabel: "Hindi Dub",
    adFree: true,
  };
}

async function fetchPlayZenSource(slug: string, season: string, ep: string): Promise<StreamItem | null> {
  const cleanSlug = slug.replace(/-season-\d+$/i, "").replace(/-s\d+$/i, "");
  const targets = [
    "https://animeflash.live/episode/" + cleanSlug + "/" + season + "x" + ep,
    "https://animeflash.live/episode/" + cleanSlug + "-" + season + "x" + ep,
  ];
  if (season === "1" && ep === "1") targets.push("https://animeflash.live/movie/" + cleanSlug);

  const workerSecret = process.env.CF_PROXY_SHARED_SECRET?.trim();

  for (const target of targets) {
    // Try direct fetch first for animeflash.live (not CF-protected), then Worker as fallback.
    // This ensures PlayZen tokens are found on Vercel where Worker may not proxy this host.
    const fetchCandidates: Array<{ url: string; throughWorker: boolean }> = [
      { url: target, throughWorker: false },
      { url: buildCfProxyUrl(target), throughWorker: true },
    ];

    for (const { url, throughWorker } of fetchCandidates) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            ...DEFAULT_HEADERS,
            Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
            Referer: "https://animeflash.live/",
            ...(throughWorker && workerSecret ? { "x-hindianime-proxy-secret": workerSecret } : {}),
          },
        });
        if (!res.ok) continue;
        const text = await res.text();

        // Extract PlayZen token cleanly without RSC chunk metadata
        let playzenToken: string | null = null;
        const rscMatch = text.match(/:T([0-9a-fA-F]+),https?:\/\/archive\.animeinfinity\.me\/player\/([^\r\n"']+)/);
        if (rscMatch) {
          const totalLen = parseInt(rscMatch[1], 16);
          const prefixLen = "https://archive.animeinfinity.me/player/".length;
          const tokenLen = totalLen - prefixLen;
          if (tokenLen > 0 && rscMatch[2].length >= tokenLen) {
            playzenToken = rscMatch[2].slice(0, tokenLen);
          }
        }
        if (!playzenToken) {
          const quotedMatch = text.match(/https?:\/\/archive\.animeinfinity\.me\/player\/([A-Za-z0-9+/_=%-]+?)["'\s\\]/);
          if (quotedMatch) playzenToken = quotedMatch[1];
        }
        if (!playzenToken) {
          const chunkMatch = text.match(/https?:\/\/archive\.animeinfinity\.me\/player\/([A-Za-z0-9+/_=%-]+?)(?:[0-9a-f]{1,4}:[T\[]|["'\s\\]|$)/i);
          if (chunkMatch) playzenToken = chunkMatch[1];
        }
        if (!playzenToken) continue;

        const embed = "https://archive.animeinfinity.me/player/" + playzenToken.replace(/\\/g, "");
        return {
          server: "Server 3",
          slot: "server-3",
          source: "PlayZen",
          sourceProvider: "PlayZen",
          label: "Server 3",
          embed,
          url: embed,
          type: "embed",
          audioLanguage: "hi",
          languageLabel: "Hindi Dub",
          adFree: true,
        };
      } catch {
        // try next candidate
      } finally {
        clearTimeout(timer);
      }
    }
  }

  // Fallback: Query the Worker's native /sources endpoint which resolves PlayZen inside Cloudflare's network
  try {
    const workerSourcesUrl = new URL("/sources", CF_WORKER_BASE);
    workerSourcesUrl.searchParams.set("id", cleanSlug);
    workerSourcesUrl.searchParams.set("season", season);
    workerSourcesUrl.searchParams.set("ep", ep);
    workerSourcesUrl.searchParams.set("movie", (season === "1" && ep === "1") ? "1" : "0");
    const workerController = new AbortController();
    const workerTimer = setTimeout(() => workerController.abort(), 8_000);
    try {
      const wRes = await fetch(workerSourcesUrl.toString(), {
        signal: workerController.signal,
        headers: {
          ...DEFAULT_HEADERS,
          ...(workerSecret ? { "x-hindianime-proxy-secret": workerSecret } : {}),
        },
      });
      if (wRes.ok) {
        const wData = (await wRes.json()) as { results?: StreamItem[]; serverSlots?: Record<string, StreamItem> };
        const playzen = wData.results?.find((s) => (s.sourceProvider || s.source) === "PlayZen" || (s.embed || "").includes("animeinfinity.me"))
          || wData.serverSlots?.server4
          || wData.serverSlots?.server3;
        if (playzen?.embed) {
          return {
            server: "Server 3",
            slot: "server-3",
            source: "PlayZen",
            sourceProvider: "PlayZen",
            label: "Server 3",
            embed: playzen.embed,
            url: playzen.embed,
            type: "embed",
            audioLanguage: "hi",
            languageLabel: "Hindi Dub",
            adFree: true,
          };
        }
      }
    } finally {
      clearTimeout(workerTimer);
    }
  } catch {
    // ignore
  }

  return null;
}

function assembleServers(
  animeSaltItems: StreamItem[],
  animeSlug: string,
  gdriveSource?: StreamItem | null,
  playzenSource?: StreamItem | null
): StreamItem[] {
  const list: StreamItem[] = [];
  const usedUrls = new Set<string>();

  function add(item: StreamItem | null | undefined, label: string, slot?: string) {
    if (!item) return;
    const key = item.type !== "embed" ? (item.url || item.embed || "") : (item.embed || item.url || "");
    if (!key) return;
    if (usedUrls.has(key)) return;
    usedUrls.add(key);
    const server = label.match(/^Server\s+\d+/)?.[0] || `Server ${list.length + 1}`;
    list.push({ ...item, server, label, slot: slot || item.slot });
  }

  // ── Slot 1: MyStream Embed (default; no ads, navigation restricted) ───────
  const mystream = animeSaltItems.find(
    (s) => s.type === "embed" && !s.languageSources?.length && isHindi(s) && (s.embed.includes("ravok.buzz") || (s.label || "").toLowerCase().includes("mystream")) && !usedUrls.has(s.embed)
  ) || animeSaltItems.find(
    (s) => s.type === "embed" && !s.languageSources?.length && (s.embed.includes("ravok.buzz") || (s.label || "").toLowerCase().includes("mystream")) && !usedUrls.has(s.embed)
  );

  if (mystream) {
    add({ ...mystream, adFree: true, restrictNavigation: true }, "Server 1", "server-1");
  }

  // ── Slot 2: Google Drive ─────────────────────────────────────────────────
  if (gdriveSource) {
    add(gdriveSource, "Server 2", "server-2");
  }

  // ── Slot 3: PlayZen ──────────────────────────────────────────────────────
  if (playzenSource) {
    add(playzenSource, "Server 3", "server-3");
  }

  // ── Slot 4: Abyss Multi-Audio (multi-language bundle from AnimeSalt) ──────
  const abyssItem = animeSaltItems.find(
    (s) => (s.languageSources?.length || 0) > 0 && !usedUrls.has(s.embed)
  );
  if (abyssItem) {
    add(
      { ...abyssItem, adFree: false },
      "Server 4 · 🌐 Multi-Audio",
      "server-4"
    );
  }

  // ── Additional AnimeSalt mirrors (no Abyss, no multi-audio bundles) ──────
  for (const s of animeSaltItems) {
    if (list.length >= 6) break;
    if ((s.languageSources?.length || 0) > 0) continue;
    if (!usedUrls.has(s.embed)) {
      add(s, `Server ${list.length + 1}`);
    }
  }

  return list;
}

/**
 * Parse streaming embed sources from AnimeSalt HTML, fetched either by the
 * existing Worker request (GET) or by the browser through that same Worker (POST).
 * Extracts AbyssPlayer multi-language embeds (Hindi, Japanese, English, etc.)
 * and direct video iframes (MyStream / ravok.buzz).
 */
async function fetchAnimeSaltSources(
  slug: string,
  season: string,
  episode: string,
  browserResult?: { targetUrl: string; html: string; isMovie?: boolean } | null,
  isMovieRequest = false
): Promise<StreamItem[]> {
  const sNum = parseInt(season, 10);
  const epNum = parseInt(episode, 10);
  const baseSlug = cleanAnimeSlug(slug);
  const episodeCandidates = [
    `https://animesalt.cx/episode/${baseSlug}-${sNum}x${epNum}/`,
    `https://animesalt.cx/episode/${slug}-${sNum}x${epNum}/`,
    `https://animesalt.cx/episode/${baseSlug}-${epNum}/`,
  ];
  const movieCandidates = [
    `https://animesalt.cx/movies/${slug}/`,
    `https://animesalt.cx/movies/${baseSlug}/`,
  ];
  const movieLookup = isMovieRequest || browserResult?.isMovie === true;
  // For episode requests: try episode URLs first, then movie URLs as fallback
  // (fixes movies that AnimeSalt only has at /movies/, and single-episode anime
  // whose episode path doesn't exist on AnimeSalt).
  const primaryCandidates = movieLookup ? movieCandidates : episodeCandidates;
  const fallbackCandidates = movieLookup ? [] : movieCandidates;
  const candidates = [...primaryCandidates, ...fallbackCandidates];
  const validMovieUrl = browserResult?.isMovie && primaryCandidates.some((c) => c.includes("/movies/") && browserResult.targetUrl === c);
  if (browserResult && !validMovieUrl && !primaryCandidates.includes(browserResult.targetUrl)) return [];

  // Retrieve AnimeSalt through the general Worker proxy. Use direct fallback
  // only for network/server failures; a 4xx on a candidate moves to the next candidate.
  for (const targetUrl of new Set(candidates)) {
    const proxyUrl = buildCfProxyUrl(targetUrl);
    // Try CF proxy first on production so Cloudflare IP protection on animesalt.cx is bypassed.
    // Also include direct fetch as a fallback so MyStream iframes are found even if the Worker
    // doesn't proxy animesalt.cx correctly on Vercel's egress IP range.
    const fetchUrls: Array<string | null> = browserResult ? [null] : [proxyUrl, targetUrl];

    for (const urlToFetch of fetchUrls) {
      const attemptType = browserResult ? "Browser Worker" : "Worker";
      const target = new URL(targetUrl);
      const targetHostPath = `${target.hostname}${target.pathname}`;
      let httpStatus: number | null = null;
      let contentType: string | null = null;
      let responseBodyLength: number | null = null;
      let passedResponseChecks = false;
      let parserResultCount = 0;
      let caughtError: string | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;

      try {
        let html: string;
        if (urlToFetch === null) {
          if (!browserResult?.html) continue;
          html = browserResult.html;
          passedResponseChecks = html.length >= 1000 && !html.includes("404 Not Found") && !isCloudflareChallenge(html);
          if (!passedResponseChecks) continue;
        } else {
          const controller = new AbortController();
          // The Worker allows up to 10 seconds for upstream AnimeSalt fetches.
          // Leave enough time for the Worker response to return to Vercel too.
          timer = setTimeout(() => controller.abort(), 12_000);
          const res = await fetch(urlToFetch, {
            signal: controller.signal,
            cache: "no-store",
            headers: {
              ...DEFAULT_HEADERS,
              Accept: "text/html",
              ...(attemptType === "Worker" ? { Origin: "https://hindianime-seven.vercel.app" } : {}),
            },
          });
          httpStatus = res.status;
          contentType = res.headers.get("content-type");
          html = await res.text();
          responseBodyLength = html.length;
          if (res.status >= 400 && res.status < 500) continue;
          if (isCloudflareChallenge(html)) continue;
          passedResponseChecks = res.ok && html.length >= 1000 && !html.includes("404 Not Found") && !isCloudflareChallenge(html);
          if (!passedResponseChecks) continue;
        }

        const items: StreamItem[] = [];
        const usedUrls = new Set<string>();

        // 1. Look for Plyr base64 JSON (Abyssplayer by language)
        const plyrMatch = html.match(/player\.php\?data=([A-Za-z0-9%_-]+)/);
        if (plyrMatch) {
          try {
            const rawB64 = decodeURIComponent(plyrMatch[1]);
            const decoded = Buffer.from(rawB64, "base64").toString("utf8");
            const parsed = JSON.parse(decoded) as Array<{ language?: string; link?: string }>;
            if (Array.isArray(parsed)) {
              const languageSources: NonNullable<StreamItem["languageSources"]> = [];
              for (const p of parsed) {
                if (p.link && !usedUrls.has(p.link) && !BLOCKED_STREAM_DOMAINS.some((d) => p.link!.includes(d))) {
                  usedUrls.add(p.link);
                  const lang = p.language || "Multi";
                  const isHi = /hindi/i.test(lang);
                  const isJa = /japanese/i.test(lang);
                  const isTamil = /tamil/i.test(lang);
                  const isTelugu = /telugu/i.test(lang);
                  const isEnglish = /english/i.test(lang);
                  const code = isHi ? "hi" : isJa ? "ja" : isTamil ? "ta" : isTelugu ? "te" : isEnglish ? "en" : lang.toLowerCase();
                  languageSources.push({ code, label: lang, embed: p.link });
                }
              }
              if (languageSources.length > 0) {
                const defaultSource = languageSources.find((source) => source.code === "hi") || languageSources[0];
                items.push({
                  server: "AnimeSalt Abyss",
                  sourceProvider: "AnimeSalt",
                  label: "AnimeSalt · Abyss Multi-Audio",
                  embed: defaultSource.embed,
                  type: "embed",
                  audioLanguage: defaultSource.code,
                  languageLabel: defaultSource.label,
                  languageSources,
                  adFree: false,
                });
              }
            }
          } catch (err) {
            caughtError = err instanceof Error ? err.message : String(err);
          }
        }

        // 2. Look for iframe embeds (e.g. ravok.buzz / mystream)
        const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/gi;
        let m: RegExpExecArray | null;
        while ((m = iframeRegex.exec(html)) !== null) {
          const src = m[1];
          if (src && !usedUrls.has(src) && !src.includes("player.php") && !BLOCKED_STREAM_DOMAINS.some((d) => src.includes(d))) {
            usedUrls.add(src);
            const isRavok = src.includes("ravok.buzz");
            items.push({
              server: "Server 1",
              sourceProvider: "AnimeSalt",
              label: "Server 1",
              embed: src,
              type: "embed",
              audioLanguage: "hi",
              languageLabel: "🇮🇳 Hindi",
              adFree: false,
            });
          }
        }

        // HLS (direct stream) is disabled until VPS hosting is available.
        // MyStream embed is used as Server 1 instead.
        // const ravokMatch = html.match(/https?:\/\/ravok\.buzz\/(?:video|embed|e)\/([a-zA-Z0-9]+)/i);
        // const ravokHash = ravokMatch?.[1];
        // if (ravokHash) {
        //   const directHlsUrl = await resolveRavokHls(ravokHash);
        //   if (directHlsUrl) { ... }
        // }

        const myStream = items.find((item) => item.embed.includes("ravok.buzz"));
        const unavailableMyStream = myStream
          ? await isKnownUnavailableMyStream(myStream.embed)
          : false;
        const validatedItems = unavailableMyStream
          ? items.filter((item) => item !== myStream)
          : items;

        parserResultCount = validatedItems.length;
        if (validatedItems.length > 0) {
          return validatedItems;
        }
      } catch (err) {
        caughtError = err instanceof Error ? err.message : String(err);
        // try next fetchUrl or candidate
      } finally {
        if (timer) clearTimeout(timer);
        console.info("[AnimeSalt attempt]", {
          attemptType,
          targetHostPath,
          httpStatus,
          contentType,
          responseBodyLength,
          passedResponseChecks,
          parserResultCount,
          caughtError,
        });
      }
    }
  }

  // Fallback: If scraping AnimeSalt was blocked on this host (e.g. Vercel),
  // get MyStream directly from the Worker's /sources endpoint
  if (!browserResult) {
    const workerSecret = process.env.CF_PROXY_SHARED_SECRET?.trim();

    try {
      const workerSourcesUrl = new URL("/sources", CF_WORKER_BASE);
      workerSourcesUrl.searchParams.set("id", baseSlug || slug);
      workerSourcesUrl.searchParams.set("season", season);
      workerSourcesUrl.searchParams.set("ep", episode);
      workerSourcesUrl.searchParams.set("movie", isMovieRequest ? "1" : "0");
      const workerController = new AbortController();
      const workerTimer = setTimeout(() => workerController.abort(), 8_000);
      try {
        const wRes = await fetch(workerSourcesUrl.toString(), {
          signal: workerController.signal,
          headers: {
            ...DEFAULT_HEADERS,
            ...(workerSecret ? { "x-hindianime-proxy-secret": workerSecret } : {}),
          },
        });
        if (wRes.ok) {
          const wData = (await wRes.json()) as { results?: StreamItem[]; serverSlots?: Record<string, StreamItem> };
          const mystream = wData.results?.find(
            (s) => (s.embed || "").includes("ravok.buzz") || (s.label || "").toLowerCase().includes("mystream")
          ) || wData.serverSlots?.server2;
          if (mystream && mystream.embed) {
            return [{
              server: "Server 1",
              sourceProvider: "AnimeSalt",
              label: "Server 1",
              embed: mystream.embed,
              type: "embed",
              audioLanguage: "hi",
              languageLabel: "🇮🇳 Hindi",
              adFree: true,
              restrictNavigation: true,
            }];
          }
        }
      } finally {
        clearTimeout(workerTimer);
      }
    } catch {
      // ignore
    }

    // Movie fallback: if not an explicit movie request and episode lookup returned
    // no stream, retry with movie=1. This handles titles that AnimeSalt only has
    // at /movies/ (misclassified movies and single-episode OVAs/specials).
    if (!isMovieRequest) {
      try {
        const movieWorkerUrl = new URL("/sources", CF_WORKER_BASE);
        movieWorkerUrl.searchParams.set("id", baseSlug || slug);
        movieWorkerUrl.searchParams.set("season", season);
        movieWorkerUrl.searchParams.set("ep", episode);
        movieWorkerUrl.searchParams.set("movie", "1");
        const movieController = new AbortController();
        const movieTimer = setTimeout(() => movieController.abort(), 8_000);
        try {
          const mRes = await fetch(movieWorkerUrl.toString(), {
            signal: movieController.signal,
            headers: {
              ...DEFAULT_HEADERS,
              ...(workerSecret ? { "x-hindianime-proxy-secret": workerSecret } : {}),
            },
          });
          if (mRes.ok) {
            const mData = (await mRes.json()) as { results?: StreamItem[]; serverSlots?: Record<string, StreamItem> };
            const mystream = mData.results?.find(
              (s) => (s.embed || "").includes("ravok.buzz") || (s.label || "").toLowerCase().includes("mystream")
            ) || mData.serverSlots?.server2;
            if (mystream && mystream.embed) {
              return [{
                server: "Server 1",
                sourceProvider: "AnimeSalt",
                label: "Server 1",
                embed: mystream.embed,
                type: "embed",
                audioLanguage: "hi",
                languageLabel: "🇮🇳 Hindi",
                adFree: true,
                restrictNavigation: true,
              }];
            }
          }
        } finally {
          clearTimeout(movieTimer);
        }
      } catch {
        // ignore
      }
    }
  }

  return [];
}

async function buildStreamResponse(
  cleanId: string,
  season: string,
  ep: string,
  browserResult?: { targetUrl: string; html: string; isMovie?: boolean } | null,
  isMovieRequest = false
) {
  const [animeSaltItems, gdriveSource, playzenSource] = await Promise.all([
    (browserResult === undefined
      ? fetchAnimeSaltSources(cleanId, season, ep, undefined, isMovieRequest)
      : browserResult === null
        ? Promise.resolve([] as StreamItem[])
        : fetchAnimeSaltSources(cleanId, season, ep, browserResult, isMovieRequest)
    ).catch(() => [] as StreamItem[]),
    fetchGoogleDriveSource(cleanId, season, ep).catch(() => null),
    fetchPlayZenSource(cleanId, season, ep).catch(() => null),
  ]);

  const finalResults = assembleServers(animeSaltItems, cleanId, gdriveSource, playzenSource);

  if (finalResults.length > 0) {
    return NextResponse.json(
      {
        success: true,
        message: "Stream Found!!",
        version: "v2-cf-animesalt",
        saltCount: animeSaltItems.length,
        results: finalResults,
      },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  }

  return NextResponse.json(
    { success: false, message: "No valid streams found", results: [], saltCount: 0 },
    {
      status: 404,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    }
  );
}

async function isKnownUnavailableMyStream(embedUrl: string): Promise<boolean> {
  try {
    if (new URL(embedUrl).hostname.toLowerCase() !== "ravok.buzz") return false;
  } catch {
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(buildServerWorkerProxyUrl(embedUrl), {
      signal: controller.signal,
      cache: "no-store",
      headers: getServerWorkerHeaders({ ...DEFAULT_HEADERS, Accept: "text/html" }),
    });
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
      return false;
    }

    const html = await response.text();
    return (
      html.length <= 64 * 1024 &&
      /<title[^>]*>\s*error\s*<\/title>/i.test(html) &&
      /\bvideo not found\b/i.test(html)
    );
  } catch {
    // A failed health check is inconclusive; leave source handling unchanged.
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function isAuthorizedFrontendRequest(request: Request): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") {
    return false;
  }

  const host = request.headers.get("host")?.toLowerCase() || "";
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  const isTrustedHost = (h: string) =>
    h === host ||
    h === "localhost:3000" ||
    h.includes("localhost") ||
    h.endsWith(".hindi-anime.com") ||
    h === "hindi-anime.com";

  if (origin) {
    try {
      const u = new URL(origin);
      if (!isTrustedHost(u.host.toLowerCase())) return false;
    } catch {
      return false;
    }
  }

  if (referer) {
    try {
      const u = new URL(referer);
      if (!isTrustedHost(u.host.toLowerCase())) return false;
    } catch {
      return false;
    }
  }

  return true;
}

export async function GET(request: Request) {
  if (!isAuthorizedFrontendRequest(request)) {
    return NextResponse.json(
      { success: false, message: "Unauthorized: Request rejected." },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const season = searchParams.get("season") || "1";
  const ep = searchParams.get("ep") || "1";
  const isMovieRequest = searchParams.get("movie") === "1";

  if (!id) {
    return NextResponse.json(
      { success: false, message: "Missing required parameter: id" },
      { status: 400 }
    );
  }

  let decodedId = id;
  try {
    if (id.includes("%")) {
      decodedId = decodeURIComponent(id);
    }
  } catch {
    // ignore
  }

  const cleanId = cleanAnimeSlug(decodedId) || decodedId;

  return buildStreamResponse(cleanId, season, ep, undefined, isMovieRequest);
}

export async function POST(request: Request) {
  if (!isAuthorizedFrontendRequest(request)) {
    return NextResponse.json(
      { success: false, message: "Unauthorized: Request rejected." },
      { status: 403 }
    );
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 512 * 1024) {
    return NextResponse.json({ success: false, message: "AnimeSalt response is too large" }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body" }, { status: 400 });
  }
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ success: false, message: "Invalid request body" }, { status: 400 });
  }

  const body = payload as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ success: false, message: "Missing required parameter: id" }, { status: 400 });
  }
  const season = String(body.season ?? "1");
  const ep = String(body.ep ?? "1");
  const cleanId = cleanAnimeSlug(id) || id;

  let browserResult: { targetUrl: string; html: string; isMovie?: boolean } | null = null;
  if (body.animeSaltHtml !== undefined && body.animeSaltHtml !== null) {
    const targetUrl = typeof body.animeSaltTargetUrl === "string" ? body.animeSaltTargetUrl : "";
    const html = typeof body.animeSaltHtml === "string" ? body.animeSaltHtml : "";
    const isMovie = body.isMovie === true;
    const byteLength = new TextEncoder().encode(html).byteLength;
    if (
      !(isMovie
        ? targetUrl === buildAnimeSaltMovieUrl(cleanId)
        : buildAnimeSaltEpisodeCandidates(cleanId, season, ep).includes(targetUrl)) ||
      byteLength > 512 * 1024 ||
      !isValidAnimeSaltHtml(html)
    ) {
      return NextResponse.json({ success: false, message: "Invalid AnimeSalt response" }, { status: 400 });
    }
    browserResult = { targetUrl, html, isMovie };
  }

  const animeSaltPromise = browserResult
    ? fetchAnimeSaltSources(cleanId, season, ep, browserResult)
    : Promise.resolve([] as StreamItem[]);
  const encoder = new TextEncoder();

  const bodyStream = new ReadableStream<Uint8Array>({
    start(controller) {
      let animeSaltItems: StreamItem[] | null = null;
      let gdriveSource: StreamItem | null = null;
      let playzenSource: StreamItem | null = null;
      let lastSnapshot = "";
      const emit = (value: Record<string, unknown>) => {
        if (request.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        } catch {
          // Client navigated away
        }
      };

      const emitSnapshot = (complete: boolean) => {
        if (!animeSaltItems) return;
        const results = assembleServers(animeSaltItems, cleanId, gdriveSource, playzenSource);
        const signature = results.map((item) => `${item.server}\0${item.label}\0${item.embed}`).join("\x01");
        if (!complete && signature === lastSnapshot) return;
        lastSnapshot = signature;
        if (results.length > 0 || complete) {
          emit({
            ...(complete
              ? {
                  success: results.length > 0,
                  message: results.length > 0 ? "Stream Found!!" : "No valid streams found",
                  version: "v2-cf-animesalt",
                }
              : {}),
            results,
            saltCount: animeSaltItems.length,
            complete,
          });
        }
      };

      const gdrivePromise = fetchGoogleDriveSource(cleanId, season, ep).catch(() => null);
      const playzenPromise = fetchPlayZenSource(cleanId, season, ep).catch(() => null);
      void gdrivePromise.then((source) => {
        gdriveSource = source;
        emitSnapshot(false);
      });
      void playzenPromise.then((source) => {
        playzenSource = source;
        emitSnapshot(false);
      });

      void (async () => {
        animeSaltItems = await animeSaltPromise;
        emitSnapshot(false);
        // Await parallel source resolution then emit final snapshot
        await Promise.all([gdrivePromise, playzenPromise]);
        emitSnapshot(true);
        controller.close();
      })().catch((error) => controller.error(error));
    },
  });

  return new Response(bodyStream, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Content-Type": "application/x-ndjson; charset=utf-8",
    },
  });
}
