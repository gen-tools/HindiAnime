/**
 * HindiAnime Proxy + Stream Worker
 *
 * Routes:
 *   GET /?url=<encoded>          — General proxy (AnimeSalt, Toko, etc.)
 *   GET /stream?id=&season=&ep=  — Stream resolver: MultiShows + Toko
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
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ── CORS preflight ────────────────────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // ── Route: /stream — resolve streaming sources ────────────────────────────
    if (url.pathname === "/stream") {
      return handleStream(url, request);
    }

    // ── Route: / — general proxy via ?url= ───────────────────────────────────
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

    const isAnimeSalt = parsedTarget.hostname.includes("animesalt");
    let proxyHeaders;
    if (isAnimeSalt) {
      proxyHeaders = {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Referer: parsedTarget.origin + "/",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      };
    } else {
      proxyHeaders = {
        "User-Agent": BROWSER_UA,
        Accept: request.headers.get("Accept") || "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      };
    }

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

  // Run MultiShows + Toko in parallel — failures are independent
  const [msResults, tokoResults] = await Promise.all([
    scrapeMultiShows(cleanId, season, ep).catch(() => []),
    fetchToko(cleanId, ep).catch(() => []),
  ]);

  const merged = [];
  const seen = new Set();

  // Server 1 = MultiShows
  for (const r of msResults) {
    if (merged.length >= 1) break;
    const key = r.embed;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...r, server: "Server 1" });
  }

  // Server 2+ = Toko HLS
  let idx = 2;
  for (const r of tokoResults) {
    if (merged.length >= 4) break;
    if (r.type !== "hls") continue;
    const key = r.url || r.embed;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...r, server: `Server ${idx}`, adFree: true });
    idx++;
  }

  // Toko embeds fill remaining slots
  for (const r of tokoResults) {
    if (merged.length >= 4) break;
    if (r.type === "hls") continue;
    const key = r.url || r.embed;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...r, server: `Server ${idx}`, type: "embed" });
    idx++;
  }

  if (merged.length > 0) {
    return jsonResponse({ success: true, message: "Stream Found!!", results: merged }, 200, request);
  }
  return jsonResponse({ success: false, message: "No valid streams found", results: [] }, 404, request);
}

// ── MultiShows scraper ────────────────────────────────────────────────────────

async function scrapeMultiShows(cleanId, season, ep) {
  const urls = [
    `https://multishows.top/episode/${encodeURIComponent(cleanId)}/${season}-${ep}`,
    `https://multishows.top/episode/${encodeURIComponent(cleanId)}-${season}x${ep}/`,
    `https://multishows.top/episode/${encodeURIComponent(cleanId)}-season-${season}-episode-${ep}/`,
  ];
  if (season === "1" && ep === "1") {
    urls.push(`https://multishows.top/movie/${encodeURIComponent(cleanId)}/`);
    urls.push(`https://multishows.top/movies/${encodeURIComponent(cleanId)}/`);
  }

  const msHeaders = {
    "User-Agent": BROWSER_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://multishows.top/",
  };

  for (const pageUrl of urls) {
    let html = null;
    try {
      const r = await fetch(pageUrl, { headers: msHeaders });
      if (r.ok) {
        const text = await r.text();
        if (text.length > 3000) html = text;
      }
    } catch { /* ignore */ }

    if (!html) continue;

    const results = [];
    const seen = new Set();

    // selectServer onclick handlers
    const selectRe = /selectServer\('([^']+)',\s*'([^']+)'\)/g;
    let m;
    while ((m = selectRe.exec(html)) !== null) {
      const embed = m[1]?.replace(/&#038;/g, "&").trim();
      const name = m[2]?.replace(/&amp;/g, "&").trim();
      if (embed && isValidUrl(embed) && !seen.has(embed)) {
        seen.add(embed);
        results.push({ server: name || `Server ${results.length + 1}`, embed, type: "embed" });
      }
    }

    // iframe src/data-src
    const iframeRe = /<iframe[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
    while ((m = iframeRe.exec(html)) !== null) {
      let src = m[1]?.replace(/&#038;/g, "&").trim();
      if (!src || src.includes("about:blank")) continue;
      if (src.startsWith("//")) src = "https:" + src;
      if (isValidUrl(src) && !seen.has(src)) {
        seen.add(src);
        results.push({ server: `Server ${results.length + 1}`, embed: src, type: "embed" });
      }
    }

    if (results.length > 0) return results;
  }
  return [];
}

// ── Toko fetcher ──────────────────────────────────────────────────────────────

async function fetchToko(cleanId, ep) {
  const titleVariants = slugToTitles(cleanId);
  const params = new URLSearchParams();
  for (const t of titleVariants) params.append("titles[]", t);
  params.set("episode", ep);
  params.set("stream", "0");

  const tokoUrl = `${TOKO_API_URL}/api/v3/toko/stream?${params.toString()}`;

  let data = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(tokoUrl, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": BROWSER_UA },
    });
    clearTimeout(timer);
    const text = await res.text();
    if (res.ok && !text.includes("<!DOCTYPE html") && !text.includes("challenge")) {
      data = JSON.parse(text);
    }
  } catch { /* ignore */ }

  if (!data || !Array.isArray(data.sources) || data.sources.length === 0) return [];

  return data.sources
    .filter(s => s.type !== "torrent" && s.url)
    .map((s, i) => {
      const label = s.languageLabel || s.language || "";
      const name = [s.providerName || "Toko", label, s.quality].filter(Boolean).join(" · ");
      if (s.type === "hls" || s.isM3U8) {
        return { server: name || `Toko HLS ${i + 1}`, embed: s.url, url: s.url, type: "hls", adFree: true, headers: s.headers };
      }
      if (s.type === "mp4") {
        return { server: name || `Toko MP4 ${i + 1}`, embed: s.url, url: s.url, type: "mp4", adFree: true };
      }
      if (isValidUrl(s.url)) {
        return { server: name || `Toko Embed ${i + 1}`, embed: s.url, type: "embed" };
      }
      return null;
    })
    .filter(Boolean);
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
    .replace(/\b\w/g, c => c.toUpperCase());
  const lower = base.toLowerCase();
  return lower !== base ? [base, lower] : [base];
}

function isValidUrl(s) {
  if (!s || typeof s !== "string") return false;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const p = u.pathname.replace(/\/+$/, "");
    if (!p) return false;
    return true;
  } catch { return false; }
}

function jsonResponse(body, status, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(request) },
  });
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Range",
    "Access-Control-Max-Age": "86400",
  };
}
