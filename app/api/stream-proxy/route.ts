/**
 * GET /api/stream-proxy?id=<slug>&season=<n>&ep=<n>
 *
 * Proxies streams directly from the backend server resolver.
 * Server priority order is managed by the backend:
 *   Server 1 -> HLS multi-language stream (HindiAnime Player)
 *   Server 2 -> MyStream (AnimeSalt embed)
 *   Server 3 -> Google Drive 1080p HD (AnimaHD)
 *   Server 4 -> Abyss Multi-Audio (combined languages)
 *   Server 5+ -> PlayZen and remaining sources
 */
import { NextResponse } from "next/server";
import { koyebFetch } from "@/lib/api/koyeb-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface StreamItem {
  server?: string;
  label?: string;
  embed?: string;
  url?: string;
  hlsProxyUrl?: string;
  directHlsUrl?: string;
  type?: string;
  audioLanguage?: string;
  languageLabel?: string;
  source?: string;
  languageSources?: { code: string; label: string; embed: string }[];
  qualities?: { quality: string; url: string }[];
  [key: string]: unknown;
}

interface BackendStreamResponse {
  success: boolean;
  message?: string;
  results?: StreamItem[];
  byLanguage?: Record<string, { sources: StreamItem[] }>;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id     = searchParams.get("id") || "";
  const season = searchParams.get("season") || "1";
  const ep     = searchParams.get("ep") || "1";

  if (!id) {
    return NextResponse.json(
      { success: false, message: "Missing required parameter: id" },
      { status: 400 }
    );
  }

  let cleanId = id;
  try {
    if (id.includes("%")) cleanId = decodeURIComponent(id);
  } catch { /* use raw */ }
  cleanId = cleanId.trim().replace(/^\/+|\/+$/g, "");

  try {
    const data = await koyebFetch<BackendStreamResponse>(
      `/api/stream?id=${encodeURIComponent(cleanId)}&season=${season}&ep=${ep}&source=all`,
      { timeoutSeconds: 28 }
    );

    if (!data?.success || !Array.isArray(data?.results) || data.results.length === 0) {
      return NextResponse.json(
        { success: false, message: "No valid streams found", results: [] },
        { status: 404, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
      );
    }

    // Pass through backend results directly as ordered by the backend
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (/HTTP 404\b/.test(errorMessage)) {
      return NextResponse.json(
        { success: false, message: "No playable streams are available for this episode", results: [] },
        { status: 404, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    console.error(
      "[api/stream-proxy] Backend fetch failed:",
      errorMessage
    );
    return NextResponse.json(
      { success: false, message: "Stream resolver temporarily unavailable", results: [] },
      { status: 502, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  }
}
