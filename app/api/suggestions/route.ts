import { type NextRequest, NextResponse } from "next/server";
import { anime as mockAnime } from "@/lib/mock/anime";
import { fuzzySearch } from "@/lib/fuzzy-search";
import { searchAnime, mapSearchItemToAnime } from "@/lib/api/client";

export const runtime = "nodejs";

/**
 * GET /api/suggestions?q=<query>
 *
 * Returns ranked autocomplete suggestions combining:
 * 1. Live API results (exact backend match)
 * 2. Fuzzy-ranked mock catalog (typo-tolerant fallback)
 *
 * Max 8 results, deduped by slug.
 */
export async function GET(req: NextRequest) {
  const rawQ = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const q = rawQ.slice(0, 100);

  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const seen = new Set<string>();
  const results: {
    slug: string;
    title: string;
    poster: string;
    year: number;
    type: string;
    score: number;
  }[] = [];

  // ── 1. Live API search (fast, limit timeout to 2s) ──────────────────────────
  try {
    const apiPromise = searchAnime(q, 1);
    const apiRes = await Promise.race([
      apiPromise,
      new Promise<null>((res) => setTimeout(() => res(null), 2000)),
    ]);

    if (apiRes?.results?.results) {
      const apiItems = apiRes.results.results
        .slice(0, 5)
        .map((item) => mapSearchItemToAnime(item));
      for (const item of apiItems) {
        if (!seen.has(item.slug)) {
          seen.add(item.slug);
          results.push({
            slug: item.slug,
            title: item.title,
            poster: item.poster,
            year: item.year,
            type: item.type,
            score: 1.0, // API results are always considered top-ranked
          });
        }
      }
    }
  } catch {
    // Silently continue to local fallback
  }

  // ── 2. Fuzzy-ranked local catalog (fills gaps, handles typos) ───────────────
  const fuzzyResults = fuzzySearch(q, mockAnime, 0.2);
  for (const { item, score } of fuzzyResults.slice(0, 8)) {
    if (!seen.has(item.slug)) {
      seen.add(item.slug);
      results.push({
        slug: item.slug,
        title: item.title,
        poster: item.poster ?? "",
        year: item.year,
        type: item.type,
        score,
      });
    }
  }

  // Re-sort: API results first (score=1.0) then by fuzzy score
  results.sort((a, b) => b.score - a.score);

  return NextResponse.json({
    results: results.slice(0, 8),
    query: q,
  });
}
