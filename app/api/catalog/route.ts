import { type NextRequest, NextResponse } from "next/server";
import { getCatalog } from "@/lib/api/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/catalog?kind=series|movies&page=<page> */
export async function GET(request: NextRequest) {
  const kindParam = request.nextUrl.searchParams.get("kind");
  if (kindParam !== "series" && kindParam !== "movies") {
    return NextResponse.json({ error: "Invalid catalog kind" }, { status: 400 });
  }

  const rawPage = Number(request.nextUrl.searchParams.get("page")) || 1;
  const page = Math.min(500, Math.max(1, Math.floor(rawPage)));
  const catalog = await getCatalog(kindParam, page, {
    allowHomepageFallback: false,
    signal: request.signal,
  });

  if (!catalog?.results?.results?.length) {
    return NextResponse.json({ error: "Catalog is temporarily unavailable" }, { status: 502 });
  }

  return NextResponse.json(catalog, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
