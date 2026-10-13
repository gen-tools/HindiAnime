import { type NextRequest, NextResponse } from "next/server";
import { getSearchSuggestions } from "@/lib/api/client";

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

  try {
    const results = await getSearchSuggestions(q);
    return NextResponse.json({ results, query: q });
  } catch {
    return NextResponse.json({ results: [], query: q });
  }
}
