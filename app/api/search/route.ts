import { type NextRequest, NextResponse } from "next/server";
import { koyebFetch } from "@/lib/api/koyeb-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get("s") || "").trim().slice(0, 100);
  const rawPage = Number(request.nextUrl.searchParams.get("page")) || 1;
  const page = Math.min(500, Math.max(1, Math.floor(rawPage)));
  if (!query) {
    return NextResponse.json(
      { error: "Search query is required" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  try {
    const data = await koyebFetch<Record<string, unknown>>(
      `/api/search?s=${encodeURIComponent(query)}&page=${page}`
    );
    const results = (data?.results as Record<string, unknown> | undefined)?.results;
    if (!Array.isArray(results)) {
      return NextResponse.json(
        { error: "Search is temporarily unavailable" },
        { status: 502, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("[api/search] Authenticated backend request failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Search is temporarily unavailable" },
      { status: 502, headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
