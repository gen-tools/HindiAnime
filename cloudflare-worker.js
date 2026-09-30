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
      return handleStream(url, request);
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

// ── /stream handler (Toko Backend Exclusive) ──────────────────────────────────

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

  // Fetch all streaming sources from Toko aggregator (pass season so Season 2 fetches Season 2)
  const tokoData = await fetchToko(cleanId, season, ep);
  const rawSources = tokoData?.sources || [];

  if (rawSources.length === 0) {
    return jsonResponse({ success: false, message: "No valid streams found", results: [] }, 404, request);
  }

  // Language priority weighting:
  // 1 = Hindi (Highest Priority -> Server 1)
  // 2 = English
  // 3 = Japanese
  // 4 = Other languages
  function getLangPriority(s) {
    const audio = (s.audioLanguage || "").toLowerCase();
    const lang = (s.language || "").toLowerCase();
    const label = (s.languageLabel || "").toLowerCase();

    if (audio === "hi" || lang.includes("hindi") || label.includes("hindi")) return 1;
    if (audio === "en" || lang.includes("english") || label.includes("english")) return 2;
    if (audio === "ja" || lang.includes("japanese") || label.includes("japanese")) return 3;
    return 4;
  }

  // Type priority within same language:
  // 1 = Direct HLS (ad-free, best quality)
  // 2 = Direct MP4 (ad-free)
  // 3 = Embed player (fallback)
  function getTypePriority(s) {
    if (s.type === "hls" || s.isM3U8) return 1;
    if (s.type === "mp4") return 2;
    if (s.type === "embed" || s.isEmbed) return 3;
    return 4;
  }

  // Sort sources: Hindi first (Embed 1 & Embed 2 -> HLS -> MP4), then English, Japanese, etc.
  const sorted = [...rawSources].sort((a, b) => {
    const lpA = getLangPriority(a);
    const lpB = getLangPriority(b);
    if (lpA !== lpB) return lpA - lpB;
    const tpA = getTypePriority(a);
    const tpB = getTypePriority(b);
    if (tpA !== tpB) return tpA - tpB;
    return 0;
  });

  const merged = [];
  const seen = new Set();

  for (const s of sorted) {
    if (merged.length >= 8) break; // Maximum 8 distinct server options
    if (isBlockedStreamSource(s)) continue;
    const streamUrl = s.url;
    // For embed types, only require a non-empty http(s) URL — skip the path-depth check
    if (!streamUrl) continue;
    const isEmbedType = s.type === "embed" || s.isEmbed;
    if (!isEmbedType && !isValidUrl(streamUrl)) continue;
    if (isEmbedType && !isValidEmbedUrl(streamUrl)) continue;
    if (seen.has(streamUrl)) continue;
    seen.add(streamUrl);

    const idx = merged.length + 1;
    const isDirect = (s.type === "hls" || s.type === "mp4" || s.isM3U8);
    const flag =
      s.audioLanguage === "hi" || /hindi/i.test(s.language || s.languageLabel || "")
        ? "🇮🇳"
        : s.audioLanguage === "en" || /english/i.test(s.language || s.languageLabel || "")
        ? "🇬🇧"
        : s.audioLanguage === "ja" || /japanese/i.test(s.language || s.languageLabel || "")
        ? "🇯🇵"
        : "🌐";

    const langName =
      s.audioLanguage === "hi" || /hindi/i.test(s.language || "")
        ? "Hindi Dub"
        : s.audioLanguage === "en" || /english/i.test(s.language || "")
        ? "English Dub"
        : s.audioLanguage === "ja" || /japanese/i.test(s.language || "")
        ? "Japanese"
        : (s.language || "Multi");

    const qualityLabel = s.quality && s.quality !== "unknown" ? ` · ${s.quality}` : "";
    const typeLabel = isDirect ? (s.type === "hls" || s.isM3U8 ? " · HLS" : " · MP4") : "";
    const providerHint = s.server || s.providerName ? ` (${s.server || s.providerName})` : "";

    // For HLS streams with required Referer/Origin headers, build a proxied URL
    // through our /hls-proxy route so the browser can play without CORS issues.
    let hlsProxyUrl;
    if (isDirect && (s.type === "hls" || s.isM3U8) && s.headers) {
      const referer = s.headers.Referer || s.headers.referer || "";
      const origin = s.headers.Origin || s.headers.origin || "";
      if (referer || origin) {
        const workerBase = url.origin; // e.g. https://wispy-cherry-6934.shahazaibseo038.workers.dev
        const params = new URLSearchParams({ url: streamUrl });
        if (referer) params.set("referer", referer);
        if (origin) params.set("origin", origin);
        hlsProxyUrl = `${workerBase}/hls-proxy?${params.toString()}`;
      }
    }

    merged.push({
      server: `Server ${idx}`,
      label: `Server ${idx} · ${flag} ${langName}${typeLabel}${qualityLabel}${providerHint}`,
      embed: streamUrl,
      url: isDirect ? (hlsProxyUrl || streamUrl) : undefined,
      hlsProxyUrl,
      type: isDirect ? (s.type === "mp4" ? "mp4" : "hls") : "embed",
      audioLanguage: s.audioLanguage || (flag === "🇮🇳" ? "hi" : flag === "🇬🇧" ? "en" : "ja"),
      languageLabel: s.languageLabel || `${flag} ${langName}`,
      adFree: isDirect,
      headers: s.headers,
    });
  }

  if (merged.length > 0) {
    return jsonResponse(
      {
        success: true,
        message: "Stream Found!!",
        results: merged,
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
  const isAllowedMedia =
    pathname.endsWith(".m3u8") ||
    pathname.endsWith(".ts") ||
    pathname.endsWith(".mp4") ||
    pathname.endsWith(".aac") ||
    pathname.endsWith(".vtt") ||
    pathname.includes("/hls") ||
    pathname.includes("/stream") ||
    parsedTarget.hostname.includes("vmpx.online") ||
    parsedTarget.hostname.includes("vidmoly") ||
    parsedTarget.hostname.includes("streamcdn") ||
    parsedTarget.hostname.includes("cdn");

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
  const titleVariants = slugToTitles(cleanId);
  const params = new URLSearchParams();
  for (const t of titleVariants) params.append("titles[]", t);
  // Pass both season and episode so Season 2 Episode 1 ≠ Season 1 Episode 1
  params.set("season", season);
  params.set("episode", ep);
  params.set("stream", "0");

  const tokoUrl = `${TOKO_API_URL}/api/v3/toko/stream?${params.toString()}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugToTitles(slug) {
  const base = slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const lower = base.toLowerCase();
  return lower !== base ? [base, lower] : [base];
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
];

function isBlockedStreamSource(s) {
  const provider = (s.providerName || s.source || s.server || "").toLowerCase();
  if (provider.includes("hindmovie") || provider.includes("mvlink")) return true;

  const urlStr = s.url || "";
  if (/\.(mkv|zip|rar|7z|tar|gz|torrent|iso)(\?|$)/i.test(urlStr)) return true;

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
  // Allow any localhost origin for local development
  const isLocalhost = origin.startsWith("http://localhost:") || origin.startsWith("https://localhost:");
  const allowedOrigin = (ALLOWED_ORIGINS.includes(origin) || isLocalhost) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Range",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}
