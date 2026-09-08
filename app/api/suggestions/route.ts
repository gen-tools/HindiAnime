import { type NextRequest, NextResponse } from "next/server";
import { searchGlobalAnime } from "@/lib/api/client";

export const runtime = "nodejs";

/**
 * GET /api/suggestions?q=<query>
 *
 * Returns ranked autocomplete suggestions from the complete existing API
 * catalog. The shared global index handles exact, partial, and typo matches.
 *
 * Max 8 results, deduped by slug.
 */
export async function GET(req: NextRequest) {
  const rawQ = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const q = rawQ.slice(0, 100);

  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const results: {
    slug: string;
    title: string;
    poster: string;
    year: number;
    type: string;
    score: number;
  }[] = [];

  try {
    const globalSearch = await searchGlobalAnime(q);
    results.push(
      ...globalSearch.results.slice(0, 8).map(({ item, score }) => ({
        slug: item.slug,
        title: item.title,
        poster: item.poster,
        year: item.year,
        type: item.type,
        score,
      }))
    );
  } catch {
    // Keep the existing empty-result behavior if the catalog is unavailable.
  }

  return NextResponse.json({
    results: results.slice(0, 8),
    query: q,
  });
}
