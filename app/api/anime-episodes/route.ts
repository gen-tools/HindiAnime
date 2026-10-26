import { NextRequest, NextResponse } from "next/server";
import { koyebFetch } from "@/lib/api/koyeb-client";
import { getAnimeBySlug } from "@/lib/mock/anime";

export const runtime = "nodejs";

function cleanAnimeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

export async function GET(request: NextRequest) {
  const rawSlug = request.nextUrl.searchParams.get("slug") || "";
  const slug = cleanAnimeSlug(rawSlug);
  const season = Number(request.nextUrl.searchParams.get("season") || 1);

  if (
    !slug ||
    !/^[a-z0-9-]{1,120}$/.test(slug) ||
    !Number.isInteger(season) ||
    season < 1 ||
    season > 100
  ) {
    return NextResponse.json(
      { error: "Invalid anime or season" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const record = getAnimeBySlug(slug);
  if (record?.isMock) {
    return NextResponse.json(
      { episodes: [] },
      { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } }
    );
  }

  try {
    const data = await koyebFetch<Record<string, unknown>>(
      `/api/episodes?slug=${encodeURIComponent(slug)}&season=${season}`,
      { timeoutSeconds: 25 }
    );

    const rawEpisodes =
      (data?.results as Record<string, unknown>)?.episodes ??
      data?.episodes ??
      [];

    if (!Array.isArray(rawEpisodes) || rawEpisodes.length === 0) {
      return NextResponse.json(
        { error: "Episodes unavailable" },
        { status: 502, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      { episodes: rawEpisodes },
      { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } }
    );
  } catch (err) {
    console.error("[api/anime-episodes] Koyeb fetch failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Episodes unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}