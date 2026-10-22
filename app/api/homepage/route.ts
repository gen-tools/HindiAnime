import { NextResponse } from "next/server";
import { getHomepageData } from "@/lib/api/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getHomepageData();
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
