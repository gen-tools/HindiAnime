import { type NextRequest, NextResponse } from "next/server";
import { searchGlobalAnime } from "@/lib/api/client";

export const runtime = "nodejs";

/** GET /api/search?q=<query>&page=<page> */
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q")?.trim().slice(0, 100) ?? "";
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page")) || 1);

  if (!query) {
    return NextResponse.json({ results: [], totalPages: 1 }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const result = await searchGlobalAnime(query, page);
    return NextResponse.json({
      results: result.results.map(({ item }) => item),
      totalPages: result.totalPages,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("/api/search failed:", error);
    return NextResponse.json({ results: [], totalPages: 1 }, {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
