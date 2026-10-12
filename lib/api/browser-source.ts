"use client";

import {
  mapHomepageFeedToData,
  mapSearchItemToAnime,
  parseAnimeSaltArticles,
  parseHomepageSourceHtml,
  type HomepageData,
} from "@/lib/api/client";
import type { Anime } from "@/types/anime";

const ANIMESALT_ORIGIN = "https://animesalt.cx";

async function fetchAnimeSaltPage(target: string, signal?: AbortSignal): Promise<string> {
  // Keep browser fallbacks on our same-origin API; never expose the general
  // Worker URL proxy to client-side requests.
  const proxyUrl = `/api/animesalt-proxy?url=${encodeURIComponent(target)}`;
  const response = await fetch(proxyUrl, { cache: "no-store", signal });
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  if (!response.ok || !contentType.includes("text/html")) {
    throw new Error(`AnimeSalt Worker returned HTTP ${response.status}`);
  }
  return response.text();
}

export async function fetchHomepageDataInBrowser(signal?: AbortSignal): Promise<HomepageData> {
  const html = await fetchAnimeSaltPage(`${ANIMESALT_ORIGIN}/`, signal);
  const feed = parseHomepageSourceHtml(html);
  if (!feed) throw new Error("AnimeSalt homepage did not contain recognized sections");
  const data = mapHomepageFeedToData(feed);
  if (data.trendingItems.length === 0 && data.latestEpisodes.length === 0) {
    throw new Error("AnimeSalt homepage contained no ranked titles or episodes");
  }
  return data;
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

