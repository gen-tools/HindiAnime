import { type NextRequest, NextResponse } from "next/server";
import { getSearchSuggestions } from "@/lib/api/client";

export const runtime = "nodejs";

/**
 * GET /api/suggestions?q=<query>[&page=<page>]
 *
 * Returns ranked autocomplete suggestions from the complete existing API
 * catalog. The shared global index handles exact, partial, and typo matches.
 *
 * Min 3 characters enforced server-side. Max 8 results, deduped by slug.
 * Responses are cached by the browser for 60 s (stale-while-revalidate: 120).
 */
export async function GET(req: NextRequest) {
  const rawQ = req.nextUrl.searchParams.get("q") ?? "";
  const q = rawQ.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase().slice(0, 100);

  // 3-character minimum — reject shorter queries without hitting the Worker
  if (!q || q.length < 3) {
    return NextResponse.json({ results: [] }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const results = await getSearchSuggestions(q);
    return NextResponse.json({ results, query: q }, {
      headers: {
        // Cache for 60s in the browser; Vercel edge caches for 5 min (s-maxage);
        // serve stale for another 120s while the server refreshes in the background.
        "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=120",
      },
    });
  } catch {
    return NextResponse.json({ results: [], query: q }, {
      headers: { "Cache-Control": "no-store" },
    });
  }
}
