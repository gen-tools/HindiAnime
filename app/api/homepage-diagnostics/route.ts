import { NextResponse } from "next/server";
import { parseHomepageSourceHtml } from "@/lib/api/client";
import {
  ALLOWED_WORKER_HOSTS,
  DEFAULT_WORKER_BASE_URL,
} from "@/lib/api/worker-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM_URL = "https://animesalt.cx/";
const MAX_HTML_BYTES = 1024 * 1024;

function workerBaseUrl(): string {
  const configured = process.env.CF_PROXY_URL || process.env.NEXT_PUBLIC_CF_PROXY_URL;
  try {
    const parsed = new URL(configured || DEFAULT_WORKER_BASE_URL);
    if (parsed.protocol === "https:" && ALLOWED_WORKER_HOSTS.has(parsed.hostname)) {
      return parsed.origin;
    }
  } catch {
    // Fall back to the allowlisted default below.
  }
  return DEFAULT_WORKER_BASE_URL;
}

export async function GET() {
  const target = new URL("/", workerBaseUrl());
  target.searchParams.set("url", UPSTREAM_URL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(target, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    const contentType = response.headers.get("content-type");
    const declaredBytes = Number(response.headers.get("content-length")) || null;
    if (!response.ok || !contentType?.toLowerCase().includes("text/html")) {
      return NextResponse.json({
        workerStatus: response.status,
        contentType,
        declaredBytes,
        parsed: false,
        reason: "worker-non-html-response",
      }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }

    const html = await response.text();
    const bytes = new TextEncoder().encode(html).byteLength;
    if (bytes > MAX_HTML_BYTES) {
      return NextResponse.json({
        workerStatus: response.status,
        contentType,
        bytes,
        parsed: false,
        reason: "worker-response-too-large",
      }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }

    const feed = parseHomepageSourceHtml(html, true);
    const sections = feed?.data?.results;
    return NextResponse.json({
      workerStatus: response.status,
      contentType,
      bytes,
      workerCache: response.headers.get("cf-cache-status"),
      parsed: Boolean(feed),
      sections: {
        mostWatchedSeries: sections?.mostWatched_Series?.length ?? 0,
        mostWatchedFilms: sections?.mostWatched_Films?.length ?? 0,
        freshDrops: sections?.fresh_drops?.length ?? 0,
        onAirSeries: sections?.on_air_series?.length ?? 0,
        latestAnimeMovies: sections?.latest_animeMovies?.length ?? 0,
      },
      reason: feed ? null : "homepage-html-had-no-recognized-sections",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      parsed: false,
      reason: controller.signal.aborted ? "worker-request-timeout" : "worker-request-failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
    }, { status: 502, headers: { "Cache-Control": "no-store" } });
  } finally {
    clearTimeout(timer);
  }
}
