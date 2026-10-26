import { type NextRequest, NextResponse } from "next/server";
import { koyebFetch } from "@/lib/api/koyeb-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const kindParam = request.nextUrl.searchParams.get("kind");
  if (kindParam !== "series" && kindParam !== "movies") {
    return NextResponse.json({ error: "Invalid catalog kind" }, {
      status: 400, headers: { "Cache-Control": "no-store" },
    });
  }

  const rawPage = Number(request.nextUrl.searchParams.get("page")) || 1;
  const page = Math.min(500, Math.max(1, Math.floor(rawPage)));

  try {
    const catalog = await koyebFetch(
      `/api/catalog?kind=${kindParam}&page=${page}`,
      { timeoutSeconds: 25 }
    );

    const c = catalog as Record<string, unknown>;
    const results = (c?.results as Record<string, unknown>)?.results;
    if (!Array.isArray(results) || results.length === 0) {
      return NextResponse.json({ error: "Catalog is temporarily unavailable" }, {
        status: 502, headers: { "Cache-Control": "no-store" },
      });
    }

    return NextResponse.json(catalog, {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    console.error("[api/catalog] Koyeb fetch failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Catalog is temporarily unavailable" }, {
      status: 502, headers: { "Cache-Control": "no-store" },
    });
  }
}