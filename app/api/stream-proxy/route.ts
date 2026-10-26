/**
 * GET /api/stream-proxy?id=<slug>&season=<n>&ep=<n>
 *
 * Proxies the authenticated stream list from api.hindi-anime.com. The player
 * applies its preferred order (MyStream, Google Drive, then PlayZen) while
 * preserving any other valid sources after those.
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
