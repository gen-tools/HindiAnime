/**
 * HindiAnime Stream Worker (Toko Backend Powered)
 *
 * Routes:
 *   GET /stream?id=&season=&ep=  — Stream resolver: Toko aggregator exclusively
 *                                   Priority: Server 1 = Hindi Dub (Direct HLS/MP4 first),
 *                                   then English, Japanese, and other languages.
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

  // Fetch all streaming sources from Toko aggregator
  const tokoData = await fetchToko(cleanId, ep);
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
  // 1 = Direct HLS (ad-free)
  // 2 = Direct MP4 (ad-free)
  // 3 = Embed player
  function getTypePriority(s) {
    if (s.type === "hls" || s.isM3U8) return 1;
    if (s.type === "mp4") return 2;
    return 3;
  }

  // Sort sources: Hindi first (HLS -> MP4 -> Embed), then English, Japanese, etc.
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
    const streamUrl = s.url;
    if (!streamUrl || !isValidUrl(streamUrl) || seen.has(streamUrl)) continue;
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

    merged.push({
      server: `Server ${idx}`,
      label: `Server ${idx} · ${flag} ${langName}${typeLabel}${qualityLabel}${providerHint}`,
      embed: streamUrl,
      url: isDirect ? streamUrl : undefined,
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

// ── Toko Fetcher ──────────────────────────────────────────────────────────────

async function fetchToko(cleanId, ep) {
  const titleVariants = slugToTitles(cleanId);
  const params = new URLSearchParams();
  for (const t of titleVariants) params.append("titles[]", t);
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

function isValidUrl(s) {
  if (!s || typeof s !== "string") return false;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const p = u.pathname.replace(/\/+$/, "");
    if (!p) return false;
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
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Range",
    "Access-Control-Max-Age": "86400",
  };
}
