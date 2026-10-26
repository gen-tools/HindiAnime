import { NextResponse } from "next/server";
import { koyebFetch } from "@/lib/api/koyeb-client";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET() {
  try {
    const data = await koyebFetch("/api/homepage", {
      next: { revalidate: 300 },
      timeoutSeconds: 25,
    });

    const d = data as Record<string, unknown>;
    const sections = (d?.data as Record<string, unknown>)?.results as Record<string, unknown> | undefined;
    const hasData =
      (Array.isArray(sections?.fresh_drops) && (sections.fresh_drops as unknown[]).length > 0) ||
      (Array.isArray(sections?.mostWatched_Series) && (sections.mostWatched_Series as unknown[]).length > 0) ||
      (Array.isArray(d?.trendingItems) && (d.trendingItems as unknown[]).length > 0);

    if (!hasData) {
      return NextResponse.json(
        { error: "Homepage activity feed is temporarily unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    console.error("[api/homepage] Koyeb fetch failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Homepage activity feed is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}