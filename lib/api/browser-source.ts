"use client";

import {
  mapSearchItemToAnime,
  parseAnimeSaltArticles,
} from "@/lib/api/client";
import type { Anime } from "@/types/anime";

const ANIMESALT_ORIGIN = "https://animesalt.cx";

function getWorkerBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_CF_PROXY_URL ||
    "https://proxy.hindi-anime.com"
  ).replace(/\?url=.*$/, "").replace(/\/+$/, "");
}

async function fetchAnimeSaltPage(target: string, signal?: AbortSignal): Promise<string> {
  const proxyUrl = `${getWorkerBaseUrl()}/?url=${encodeURIComponent(target)}`;
  const response = await fetch(proxyUrl, { cache: "no-store", signal });
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  if (!response.ok || !contentType.includes("text/html")) {
    throw new Error(`AnimeSalt Worker returned HTTP ${response.status}`);
  }
  return response.text();
}

export async function searchAnimeInBrowser(
  query: string,
  page = 1,
  signal?: AbortSignal
): Promise<{ items: Anime[]; totalPages: number }> {
  const target = new URL(ANIMESALT_ORIGIN);
  if (page > 1) target.pathname = `/page/${page}/`;
  target.searchParams.set("s", query.trim());
  const html = await fetchAnimeSaltPage(target.toString(), signal);
  const parsed = parseAnimeSaltArticles(html, page);
  if (!parsed) return { items: [], totalPages: 1 };
  return {
    items: parsed.results.map((item) => mapSearchItemToAnime(item)),
    totalPages: parsed.totalPages,
  };
}

