import { NextRequest, NextResponse } from "next/server";
import { getEpisodes, cleanAnimeSlug } from "@/lib/api/client";
import { getAnimeBySlug } from "@/lib/mock/anime";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const rawSlug = request.nextUrl.searchParams.get("slug") || "";
  const slug = cleanAnimeSlug(rawSlug);
  const season = Number(request.nextUrl.searchParams.get("season") || 1);
  if (!slug || !/^[a-z0-9-]{1,120}$/.test(slug) || !Number.isInteger(season) || season < 1 || season > 100) {
    return NextResponse.json({ error: "Invalid anime or season" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const record = getAnimeBySlug(slug);
  if (record?.isMock) {
    return NextResponse.json({ episodes: [] }, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=21600",
        "Cloudflare-CDN-Cache-Control": "public, max-age=21600",
      },
    });
  }

  const data = await getEpisodes(slug, season);
  const rawEpisodes = data?.results?.episodes || [];
  if (!rawEpisodes.length) {
    return NextResponse.json({ error: "Episodes unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ episodes: rawEpisodes }, {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=21600",
      "Cloudflare-CDN-Cache-Control": "public, max-age=21600",
    },
  });
}
