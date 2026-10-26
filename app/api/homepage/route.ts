import { NextResponse } from "next/server";
import { getHomepageData } from "@/lib/api/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function GET() {
  try {
    const data = await getHomepageData();
    const hasData = Object.values(data).some((items) => Array.isArray(items) && items.length > 0);

    if (!hasData) {
      return NextResponse.json(
        { error: "Homepage activity feed is temporarily unavailable" },
        { status: 503, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[api/homepage] Feed resolution failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Homepage activity feed is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
