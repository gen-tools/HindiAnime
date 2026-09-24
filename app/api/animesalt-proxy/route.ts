import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/** Allowed AnimeSalt CDN hostnames — reject anything outside this allowlist */
const ALLOWED_HOSTS = [
  "as-cdn26.top",
  "as-cdn25.top",
  "as-cdn24.top",
  "as-cdn23.top",
  "as-cdn.top",
  "animesalt.cx",
];

function isAllowedHost(hostname: string): boolean {
  return ALLOWED_HOSTS.some(
    (h) => hostname === h || hostname.endsWith(`.${h}`)
  );
}

const CF_PROXY_RAW =
  process.env.CF_PROXY_URL ||
  process.env.NEXT_PUBLIC_CF_PROXY_URL ||
  "https://wispy-cherry-6934.shahazaibseo038.workers.dev/?url=";

const CF_PROXY = CF_PROXY_RAW.includes("?url=")
  ? CF_PROXY_RAW
  : `${CF_PROXY_RAW.replace(/\/+$/, "")}/?url=`;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://animesalt.cx/",
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json({ error: "Missing url param" }, { status: 400 });
  }

  let decodedUrl = targetUrl;
  try {
    if (targetUrl.includes("%")) decodedUrl = decodeURIComponent(targetUrl);
  } catch { /* use raw */ }

  let parsedTarget: URL;
  try {
    parsedTarget = new URL(decodedUrl);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  if (!isAllowedHost(parsedTarget.hostname)) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 403 });
  }

  // 1. Direct fetch
  let upstreamResponse: Response | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    upstreamResponse = await fetch(decodedUrl, {
      headers: BROWSER_HEADERS,
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!upstreamResponse.ok && upstreamResponse.status >= 500) {
      upstreamResponse = null;
    }
  } catch {
    upstreamResponse = null;
  }

  // 2. Cloudflare Worker fallback (handles 522 / IP bans)
  if (!upstreamResponse?.ok) {
    try {
      const proxyUrl = `${CF_PROXY}${encodeURIComponent(decodedUrl)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      upstreamResponse = await fetch(proxyUrl, {
        headers: BROWSER_HEADERS,
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch {
      upstreamResponse = null;
    }
  }

  if (!upstreamResponse?.ok) {
    return new Response(
      `<html><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh"><p style="color:#888;font-family:sans-serif;font-size:14px">Stream source temporarily unavailable. Try another server.</p></body></html>`,
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
    );
  }

  const contentType = upstreamResponse.headers.get("content-type") || "text/html; charset=utf-8";
  const isHtml = contentType.includes("text/html");

  const safeHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "no-store, no-cache",
    // Explicitly override Next.js global X-Frame-Options: SAMEORIGIN with ALLOWALL
    // so this proxied page can be embedded inside our sandboxed iframe.
    "X-Frame-Options": "ALLOWALL",
  };

  for (const h of ["content-language", "vary"]) {
    const v = upstreamResponse.headers.get(h);
    if (v) safeHeaders[h] = v;
  }

  if (!isHtml) {
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: safeHeaders,
    });
  }

  const html = await upstreamResponse.text();
  const rewritten = html
    .replace(/<meta[^>]+http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, "<!-- xfo stripped -->")
    .replace(/frame-ancestors[^;'"]*[;'"]/gi, "");

  return new Response(rewritten, { status: 200, headers: safeHeaders });
}

