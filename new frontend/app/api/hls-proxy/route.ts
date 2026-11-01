import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_HLS_HOSTS = new Set([
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
]);

function isAllowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (ALLOWED_HLS_HOSTS.has(h)) return true;
  if (/^as-cdn\d*\.top$/i.test(h)) return true;
  return false;
}

function verifyHlsSignature(url: string, exp: string | null, sig: string | null): boolean {
  const secret = process.env.CF_PROXY_SHARED_SECRET?.trim();
  if (!secret) return true; // If no secret configured, allow internal requests
  if (!exp || !sig) return false;
  if (Date.now() / 1000 > Number(exp)) return false;

  const payload = `${url}:${exp}`;
  const expectedSig = createHmac("sha256", secret).update(payload).digest("hex");
  return sig === expectedSig;
}

export function signHlsProxyUrl(streamUrl: string): string {
  const secret = process.env.CF_PROXY_SHARED_SECRET?.trim();
  const exp = String(Math.floor(Date.now() / 1000) + 7200);
  const p = new URLSearchParams({ url: streamUrl, exp });
  if (secret) {
    const payload = `${streamUrl}:${exp}`;
    const sig = createHmac("sha256", secret).update(payload).digest("hex");
    p.set("sig", sig);
  }
  return `/api/hls-proxy?${p.toString()}`;
}

export async function GET(request: NextRequest) {
  // Security: Block cross-site hotlinking
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");
  const referer = searchParams.get("referer") || "https://ravok.buzz/";
  const exp = searchParams.get("exp");
  const sig = searchParams.get("sig");

  if (!targetUrl) {
    return new NextResponse("Missing url parameter", { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return new NextResponse("Invalid target url", { status: 400 });
  }

  if (!isAllowedHost(parsed.hostname)) {
    return new NextResponse("Host not allowed", { status: 403 });
  }

  if (!verifyHlsSignature(targetUrl, exp, sig)) {
    return new NextResponse("Invalid or expired signature", { status: 403 });
  }

  try {
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "*/*",
      Referer: referer,
      Origin: "https://ravok.buzz",
    };

    const range = request.headers.get("range");
    if (range) {
      headers["Range"] = range;
    }

    const upstreamRes = await fetch(targetUrl, {
      headers,
      cache: "no-store",
    });

    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      return new NextResponse(`Upstream returned ${upstreamRes.status}`, {
        status: upstreamRes.status,
      });
    }

    const contentType = (upstreamRes.headers.get("content-type") || "").toLowerCase();
    const isPlaylist =
      parsed.pathname.toLowerCase().endsWith(".m3u8") ||
      contentType.includes("mpegurl") ||
      targetUrl.includes("/hls/") ||
      targetUrl.includes("/cdn/hls/");

    if (isPlaylist) {
      const text = await upstreamRes.text();
      const baseUrl = new URL("./", targetUrl).toString();

      const rewritten = text
        .split(/\r?\n/)
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return line;

          // Rewrite #EXT-X-MEDIA URI="..."
          if (trimmed.startsWith("#EXT-X-MEDIA:") && trimmed.includes('URI="')) {
            return line.replace(/URI="([^"]+)"/, (_, uri) => {
              const absUrl = new URL(uri, baseUrl).toString();
              const proxied = signHlsProxyUrl(absUrl);
              return `URI="${proxied}&referer=${encodeURIComponent(referer)}"`;
            });
          }

          // Rewrite variant streams and chunk URLs (non-comment lines)
          if (!trimmed.startsWith("#")) {
            const absUrl = trimmed.startsWith("http://") || trimmed.startsWith("https://")
              ? trimmed
              : new URL(trimmed, baseUrl).toString();
            const proxied = signHlsProxyUrl(absUrl);
            return `${proxied}&referer=${encodeURIComponent(referer)}`;
          }

          return line;
        })
        .join("\n");

      return new NextResponse(rewritten, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Cache-Control": "public, max-age=60",
        },
      });
    }

    // Binary segment / media chunk pass-through
    const responseHeaders = new Headers();
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    responseHeaders.set("Cache-Control", "public, max-age=3600");

    const passHeaders = ["content-type", "content-length", "content-range", "accept-ranges"];
    for (const h of passHeaders) {
      const v = upstreamRes.headers.get(h);
      if (v) responseHeaders.set(h, v);
    }

    return new NextResponse(upstreamRes.body, {
      status: upstreamRes.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return new NextResponse(`Proxy error: ${error instanceof Error ? error.message : String(error)}`, {
      status: 502,
    });
  }
}
