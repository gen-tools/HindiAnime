/**
 * HindiAnime Proxy Worker — Fixed Upstream Headers
 *
 * KEY FIX: Removed generic loop forwarding request.headers to AnimeSalt.
 * Fixed explicit upstream headers are constructed using only normal browser headers:
 * User-Agent, Accept, Accept-Language, Referer, Cache-Control, Pragma, etc.
 * No x-vercel-*, x-forwarded-*, deployment, or arbitrary caller headers are forwarded.
 *
 * Deploy at: dash.cloudflare.com → Workers & Pages → wispy-cherry-6934
 */

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Allowed origin domains for CORS
const ALLOWED_ORIGINS = [
  "https://hindianime-seven.vercel.app",
  "http://localhost:3000",
  "https://localhost:3000",
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      });
    }

    // Get target URL from ?url= query param
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "Missing ?url= parameter" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(request) },
      });
    }

    // Basic URL validation
    let parsedTarget;
    try {
      parsedTarget = new URL(targetUrl);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid URL" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(request) },
      });
    }

    // ── FIXED UPSTREAM HEADERS ────────────────────────────────────────────────
    // Construct fixed explicit upstream headers.
    // Do NOT forward generic request.headers (especially x-vercel-*, x-forwarded-*)
    // so AnimeSalt does not trigger bot/datacenter challenge pages.
    // ──────────────────────────────────────────────────────────────────────────
    const isAnimeSalt = parsedTarget.hostname.includes("animesalt");

    let proxyHeaders;
    if (isAnimeSalt) {
      proxyHeaders = {
        "User-Agent": BROWSER_UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
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
        body: ["POST", "PUT", "PATCH"].includes(request.method)
          ? request.body
          : undefined,
        redirect: "follow",
      });

      const response = await fetch(proxyRequest, {
        cf: {
          cacheTtl: 30,
          cacheEverything: false,
        },
      });

      // Stream response back with CORS headers
      const responseHeaders = new Headers(response.headers);
      const corsH = corsHeaders(request);
      for (const [k, v] of Object.entries(corsH)) {
        responseHeaders.set(k, v);
      }

      // Remove headers that conflict with our response
      responseHeaders.delete("x-frame-options");
      responseHeaders.delete("content-security-policy");
      responseHeaders.delete("content-security-policy-report-only");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Proxy fetch failed", detail: String(err) }),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(request),
          },
        }
      );
    }
  },
};

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Range",
    "Access-Control-Max-Age": "86400",
  };
}
