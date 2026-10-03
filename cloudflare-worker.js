/**
 * HindiAnime Stream Worker (Toko Backend Powered)
 *
 * Routes:
 *   GET /stream?id=&season=&ep=  — Stream resolver: Toko aggregator exclusively
 *                                   Priority: Server 1 = Hindi Dub (Direct HLS/MP4 first),
 *                                   then English, Japanese, and other languages.
 *   GET /hls-proxy?url=<encoded>&referer=<encoded>&origin=<encoded>
 *                                — Proxies HLS/M3U8 streams with the required Referer/Origin
 *                                   headers so browsers can play them cross-origin (incl. localhost).
 *   GET /?url=<encoded>          — General CORS proxy for media streams
 *
 * Deploy at: dash.cloudflare.com → Workers & Pages → wispy-cherry-6934
 */

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const TOKO_API_URL = "https://api-delta-taupe-46.vercel.app";

const ALLOWED_ORIGINS = [
  "https://hindianime-seven.vercel.app",
  "http://localhost:3000",
  "https://localhost:3000",
  "http://localhost:3001",
  "https://localhost:3001",
  // allow any localhost for dev convenience
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ── CORS preflight ────────────────────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // ── Route: /stream — resolve streaming sources via Toko ───────────────────
    if (url.pathname === "/stream") {
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

    // ── Route: /hls-proxy — proxy HLS/M3U8 streams with required headers ───────
    if (url.pathname === "/hls-proxy") {
      return handleHlsProxy(url, request);
    }

    // ── Route: / — general CORS proxy via ?url= ───────────────────────────────
    const targetUrl = url.searchParams.get("url");
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

    const proxyHeaders = {
      "User-Agent": BROWSER_UA,
      Accept: request.headers.get("Accept") || "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    };

    try {
      const proxyRequest = new Request(targetUrl, {
        method: request.method === "HEAD" ? "GET" : request.method,
        headers: proxyHeaders,
        body: ["POST", "PUT", "PATCH"].includes(request.method) ? request.body : undefined,
        redirect: "follow",
      });

      const response = await fetch(proxyRequest, { cf: { cacheTtl: 30, cacheEverything: false } });
      const responseHeaders = new Headers(response.headers);
      const corsH = corsHeaders(request);
      for (const [k, v] of Object.entries(corsH)) responseHeaders.set(k, v);
      responseHeaders.delete("x-frame-options");
      responseHeaders.delete("content-security-policy");
      responseHeaders.delete("content-security-policy-report-only");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Proxy fetch failed", detail: String(err) }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders(request) },
      });
    }
  },
};

// ── /stream handler ───────────────────────────────────────────────────────────
// Server Slot Layout (9 slots):
//   1 = Toko Hindi Dub HLS
//   2 = AnimeSalt MyStream (ravok.buzz iframe) — Hindi Dub
//   3 = Toko Hindi Dub Embed #1
//   4 = Toko Hindi Dub Embed #2
//   5 = Tamil (Toko or AnimeSalt Abyss)
//   6 = Telugu (Toko or AnimeSalt Abyss)
//   7 = English (Toko or AnimeSalt Abyss)
//   8 = Japanese HLS
//   9 = Japanese HLS (Alt)

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

  // Fetch Toko + AnimeSalt in parallel
  const [tokoData, animeSaltItems] = await Promise.all([
    fetchToko(cleanId, season, ep),
    fetchAnimeSaltStream(cleanId, season, ep),
  ]);
  const rawSources = tokoData?.sources || [];

  if (rawSources.length === 0 && (!animeSaltItems || animeSaltItems.length === 0)) {
    return jsonResponse({ success: false, message: "No valid streams found", results: [] }, 404, request);
  }

  // ── Language helpers ───────────────────────────────────────────────────────
  function isHindi(s) {
    const a = (s.audioLanguage || "").toLowerCase();
    const l = (s.language || "").toLowerCase();
    const lb = (s.languageLabel || "").toLowerCase();
    return a === "hi" || l.includes("hindi") || lb.includes("hindi");
  }
  function isJapanese(s) {
    const a = (s.audioLanguage || "").toLowerCase();
    const l = (s.language || "").toLowerCase();
    const lb = (s.languageLabel || "").toLowerCase();
    return a === "ja" || l.includes("japanese") || lb.includes("japanese");
  }
  function isTamil(s) {
    const a = (s.audioLanguage || "").toLowerCase();
    const l = (s.language || "").toLowerCase();
    const lb = (s.languageLabel || "").toLowerCase();
    return a === "ta" || l.includes("tamil") || lb.includes("tamil");
  }
  function isTelugu(s) {
    const a = (s.audioLanguage || "").toLowerCase();
    const l = (s.language || "").toLowerCase();
    const lb = (s.languageLabel || "").toLowerCase();
    return a === "te" || l.includes("telugu") || lb.includes("telugu");
  }
  function isEnglish(s) {
    const a = (s.audioLanguage || "").toLowerCase();
    const l = (s.language || "").toLowerCase();
    const lb = (s.languageLabel || "").toLowerCase();
    return a === "en" || l.includes("english") || lb.includes("english");
  }
  function isDirect(s) {
    return s.type === "hls" || s.type === "mp4" || Boolean(s.isM3U8);
  }

  // Build a result item from a Toko raw source
  function buildTokoResult(s, serverNum, customLabel) {
    const isDirectStream = isDirect(s);
    const flag = isHindi(s) ? "🇮🇳" : isJapanese(s) ? "🇯🇵" : isTamil(s) ? "🌐" : isTelugu(s) ? "🌐" : isEnglish(s) ? "🇬🇧" : "🌐";
    const langName = isHindi(s) ? "Hindi Dub" : isJapanese(s) ? "Japanese" : isTamil(s) ? "Tamil" : isTelugu(s) ? "Telugu" : isEnglish(s) ? "English" : (s.language || "Multi");
    const streamUrl = (s.url || "")
      .replace(/\\+u0026/gi, "&")
      .replace(/&amp;/gi, "&")
      .trim();
    let hlsProxyUrl;
    if (isDirectStream && streamUrl) {
      const referer = s.headers?.Referer || s.headers?.referer || "";
      const origin  = s.headers?.Origin  || s.headers?.origin  || "";
      const p = new URLSearchParams({ url: streamUrl });
      if (referer) p.set("referer", referer);
      if (origin)  p.set("origin",  origin);
      hlsProxyUrl = `${url.origin}/hls-proxy?${p.toString()}`;
    }
    return {
      server: `Server ${serverNum}`,
      label: customLabel || `Server ${serverNum} · ${flag} ${langName}`,
      embed: streamUrl,
      url: isDirectStream ? (hlsProxyUrl || streamUrl) : undefined,
      hlsProxyUrl,
      type: isDirectStream ? (s.type === "mp4" ? "mp4" : "hls") : "embed",
      audioLanguage: s.audioLanguage || (isHindi(s) ? "hi" : isJapanese(s) ? "ja" : isEnglish(s) ? "en" : ""),
      languageLabel: s.languageLabel || `${flag} ${langName}`,
      adFree: isDirectStream,
      headers: s.headers,
    };
  }

  // Build a result item from an AnimeSalt item (already has embed, server, label)
  function buildSaltResult(s, serverNum, customLabel) {
    return {
      ...s,
      server: `Server ${serverNum}`,
      label: customLabel || `Server ${serverNum} · ${s.label || "Mirror"}`,
    };
  }

  // ── 9-Slot Assembly ────────────────────────────────────────────────────────
  const list = [];
  const usedUrls = new Set();

  function addToko(s, serverNum, label) {
    if (!s || !s.url || usedUrls.has(s.url)) return false;
    usedUrls.add(s.url);
    list.push(buildTokoResult(s, serverNum, label));
    return true;
  }
  function addSalt(s, serverNum, label) {
    const key = s.embed || s.url;
    if (!s || !key || usedUrls.has(key)) return false;
    usedUrls.add(key);
    list.push(buildSaltResult(s, serverNum, label));
    return true;
  }

  // Slot 1 — Toko Hindi Dub HLS
  const s1 = rawSources.find((s) => !isBlockedStreamSource(s) && s.url && isHindi(s) && isDirect(s));
  addToko(s1, 1, "Server 1 · 🇮🇳 Hindi Dub HLS ⚡");

  // Slot 2 — AnimeSalt MyStream (ravok.buzz iframe) — Hindi Dub
  const myStream = (animeSaltItems || []).find((s) =>
    (s.embed || "").includes("ravok.buzz") || (s.label || "").includes("MyStream")
  );
  const saltHindi = (animeSaltItems || []).find((s) => s.audioLanguage === "hi" && !usedUrls.has(s.embed || ""));
  const s2Salt = myStream || saltHindi;
  if (s2Salt) {
    addSalt(s2Salt, 2, "Server 2 · 🇮🇳 MyStream");
  } else {
    // Fallback: Toko Hindi embed
    const s2Toko = rawSources.find((s) => !isBlockedStreamSource(s) && s.url && isHindi(s) && !isDirect(s) && !usedUrls.has(s.url));
    addToko(s2Toko, 2, "Server 2 · 🇮🇳 Hindi Dub");
  }

  // Slot 3 — Toko Hindi Dub Embed #1
  const s3 = rawSources.find((s) => !isBlockedStreamSource(s) && s.url && isHindi(s) && !isDirect(s) && !usedUrls.has(s.url));
  if (!addToko(s3, 3, "Server 3 · 🇮🇳 Hindi Dub (Toko)")) {
    // Fallback: any remaining AnimeSalt Hindi
    const s3Salt = (animeSaltItems || []).find((s) => s.audioLanguage === "hi" && !usedUrls.has(s.embed || ""));
    addSalt(s3Salt, 3, "Server 3 · 🇮🇳 Hindi Dub (Abyss)");
  }

  // Slot 4 — Toko Hindi Dub Embed #2
  const s4 = rawSources.find((s) => !isBlockedStreamSource(s) && s.url && isHindi(s) && !isDirect(s) && !usedUrls.has(s.url));
  if (!addToko(s4, 4, "Server 4 · 🇮🇳 Hindi Dub (Toko Alt)")) {
    const s4Salt = (animeSaltItems || []).find((s) => s.audioLanguage === "hi" && !usedUrls.has(s.embed || ""));
    addSalt(s4Salt, 4, "Server 4 · 🇮🇳 Hindi Dub (Abyss Alt)");
  }

  // Slot 5 — Tamil (Toko first, then AnimeSalt Abyss Tamil)
  const s5Toko = rawSources.find((s) => !isBlockedStreamSource(s) && s.url && isTamil(s) && !usedUrls.has(s.url));
  if (!addToko(s5Toko, 5, "Server 5 · 🌐 Tamil")) {
    const s5Salt = (animeSaltItems || []).find((s) => (s.languageLabel || "").toLowerCase().includes("tamil") && !usedUrls.has(s.embed || ""));
    addSalt(s5Salt, 5, "Server 5 · 🌐 Tamil (Abyss)");
  }

  // Slot 6 — Telugu (Toko first, then AnimeSalt Abyss Telugu)
  const s6Toko = rawSources.find((s) => !isBlockedStreamSource(s) && s.url && isTelugu(s) && !usedUrls.has(s.url));
  if (!addToko(s6Toko, 6, "Server 6 · 🌐 Telugu")) {
    const s6Salt = (animeSaltItems || []).find((s) => (s.languageLabel || "").toLowerCase().includes("telugu") && !usedUrls.has(s.embed || ""));
    addSalt(s6Salt, 6, "Server 6 · 🌐 Telugu (Abyss)");
  }

  // Slot 7 — English (Toko first, then AnimeSalt Abyss English)
  const s7Toko = rawSources.find((s) => !isBlockedStreamSource(s) && s.url && isEnglish(s) && !usedUrls.has(s.url));
  if (!addToko(s7Toko, 7, "Server 7 · 🇬🇧 English")) {
    const s7Salt = (animeSaltItems || []).find((s) => s.audioLanguage === "en" && !usedUrls.has(s.embed || ""));
    addSalt(s7Salt, 7, "Server 7 · 🇬🇧 English (Abyss)");
  }

  // Slot 8 — Japanese HLS #1
  const s8 = rawSources.find((s) => !isBlockedStreamSource(s) && s.url && isJapanese(s) && isDirect(s) && !usedUrls.has(s.url));
  addToko(s8, 8, "Server 8 · 🇯🇵 Japanese HLS ⚡");

  // Slot 9 — Japanese HLS #2 (Alt) or AnimeSalt Japanese
  const s9Toko = rawSources.find((s) => !isBlockedStreamSource(s) && s.url && isJapanese(s) && isDirect(s) && !usedUrls.has(s.url));
  if (!addToko(s9Toko, 9, "Server 9 · 🇯🇵 Japanese HLS (Alt) ⚡")) {
    const s9Salt = (animeSaltItems || []).find((s) => s.audioLanguage === "ja" && !usedUrls.has(s.embed || ""));
    addSalt(s9Salt, 9, "Server 9 · 🇯🇵 Japanese (Abyss)");
  }

  if (list.length > 0) {
    return jsonResponse(
      {
        success: true,
        message: "Stream Found!!",
        results: list,
        byLanguage: tokoData?.byLanguage || {},
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

async function handleHlsProxy(url, request) {
  const targetUrl = url.searchParams.get("url");
  const referer = url.searchParams.get("referer") || "";
  const origin = url.searchParams.get("origin") || "";

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

  // Only allow proxying actual media streams (m3u8, ts segments, mp4)
  const pathname = parsedTarget.pathname.toLowerCase();
  const hostname = parsedTarget.hostname.toLowerCase();
  const isAllowedMedia =
    pathname.endsWith(".m3u8") ||
    pathname.endsWith(".ts") ||
    pathname.endsWith(".mp4") ||
    pathname.endsWith(".aac") ||
    pathname.endsWith(".vtt") ||
    pathname.includes("/hls") ||
    pathname.includes("/hls2") ||
    pathname.includes("/stream") ||
    pathname.includes("/bt/") ||
    pathname.includes("/resource") ||
    hostname.includes("vmpx.online") ||
    hostname.includes("vmeas.cloud") ||
    hostname.includes("vidmoly") ||
    hostname.includes("hakunaymatata") ||
    hostname.includes("sibnet") ||
    hostname.includes("acek-cdn") ||
    hostname.includes("vidzy") ||
    hostname.includes("streamcdn") ||
    hostname.includes("cdn");

  if (!isAllowedMedia) {
    return new Response(JSON.stringify({ error: "URL type not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json", ...corsHeaders(request) },
    });
  }

  const proxyHeaders = {
    "User-Agent": BROWSER_UA,
    Accept: request.headers.get("Accept") || "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    ...(referer ? { Referer: referer } : {}),
    ...(origin ? { Origin: origin } : {}),
    // Forward range header for segment seeking
    ...(request.headers.get("Range") ? { Range: request.headers.get("Range") } : {}),
  };

  try {
    const res = await fetch(targetUrl, {
      headers: proxyHeaders,
      redirect: "follow",
    });

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

    // For M3U8 playlists, rewrite segment URLs to also go through this proxy
    if (pathname.endsWith(".m3u8") || (ct && ct.includes("mpegurl"))) {
      const text = await res.text();
      const baseUrl = `${parsedTarget.protocol}//${parsedTarget.host}${parsedTarget.pathname.replace(/\/[^\/]*$/, "/")}`;
      const workerBase = url.origin + "/hls-proxy";

      const rewritten = text.split("\n").map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return line;
        // Rewrite relative or absolute segment URLs through our proxy
        let segUrl;
        try {
          segUrl = new URL(trimmed.startsWith("http") ? trimmed : baseUrl + trimmed);
        } catch {
          return line;
        }
        const proxySegUrl = `${workerBase}?url=${encodeURIComponent(segUrl.toString())}` +
          (referer ? `&referer=${encodeURIComponent(referer)}` : "") +
          (origin ? `&origin=${encodeURIComponent(origin)}` : "");
        return proxySegUrl;
      }).join("\n");

      responseHeaders.set("Content-Type", "application/vnd.apple.mpegurl");
      responseHeaders.delete("Content-Length");
      return new Response(rewritten, { status: res.status, headers: responseHeaders });
    }

    return new Response(res.body, { status: res.status, headers: responseHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: "HLS proxy fetch failed", detail: String(err) }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...corsHeaders(request) },
    });
  }
}

// ── Toko Fetcher ──────────────────────────────────────────────────────────────

async function fetchToko(cleanId, season, ep) {
  const titleVariants = slugToSeasonTitles(cleanId, season);
  const params = new URLSearchParams();
  for (const t of titleVariants) params.append("titles[]", t);
  // Pass both season and episode so Season 2 Episode 1 ≠ Season 1 Episode 1
  params.set("season", season);
  params.set("episode", ep);
  params.set("stream", "0");

  const tokoUrl = `${TOKO_API_URL}/api/v3/toko/stream?${params.toString()}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const res = await fetch(tokoUrl, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": BROWSER_UA },
    });
    clearTimeout(timer);
    const text = await res.text();
    if (res.ok && !text.includes("<!DOCTYPE html") && !text.includes("challenge")) {
      return JSON.parse(text);
    }
  } catch { /* ignore */ }

  return null;
}

/**
 * Fetch streaming embed sources directly from AnimeSalt (animesalt.cx).
 * Extracts AbyssPlayer multi-language embeds (Hindi, Japanese, English, etc.)
 * and direct video iframes (MyStream / ravok.buzz).
 */
async function fetchAnimeSaltStream(id, season, ep) {
  const sNum = parseInt(season, 10) || 1;
  const epNum = parseInt(ep, 10) || 1;
  const baseSlug = id
    .replace(/-season-\d+$/i, "")
    .replace(/-s\d+$/i, "")
    .replace(/-\d+(st|nd|rd|th)-season$/i, "");

  const candidates = [
    `https://animesalt.cx/episode/${baseSlug}-${sNum}x${epNum}/`,
    `https://animesalt.cx/episode/${id}-${sNum}x${epNum}/`,
    `https://animesalt.cx/episode/${baseSlug}-${epNum}/`,
  ];

  for (const targetUrl of candidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(targetUrl, {
        signal: controller.signal,
        headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const html = await res.text();
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

      if (items.length > 0) {
        return items;
      }
    } catch { /* ignore */ }
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
    const lower = base.toLowerCase();
    const variants = [base];
    if (lower !== base) variants.push(lower);
    variants.push(base + " Season 1");
    return [...new Set(variants)];
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
  "hakunaymatata",
  "moviebox",
  // ── Broken / Timeout / ASN-locked stream hosts ─────────────────────────────
  "rubystm",
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
  // Always allow the requesting origin to prevent CORS failures across all deployment URLs and localhost
  const allowedOrigin = origin || "*";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Range",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}
