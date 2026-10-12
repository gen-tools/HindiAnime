"use client";

import { useEffect, useState } from "react";
import type { Anime } from "@/types/anime";
import type { AnimeSearchResult } from "@/types/api";
import { AnimeGrid } from "@/components/anime/AnimeGrid";
import { Pagination } from "@/components/ui/Pagination";
import { cleanAnimeSlug, isUsableImageUrl, mapSearchItemToAnime } from "@/lib/api/client";

type CatalogKind = "series" | "movies";
type LoadState = "loading" | "ready" | "error";

const ANIMESALT_ORIGIN = "https://animesalt.cx";
const ALLOWED_HOSTS = new Set(["animesalt.cx", "www.animesalt.cx"]);

function cleanSlug(raw: string): string {
  try {
    const url = new URL(raw);
    return url.pathname.split("/").filter(Boolean).at(-1) || "";
  } catch {
    return raw.replace(/^\/+|\/+$/g, "");
  }
}

function usableImageUrl(value?: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function parseFeed(xmlText: string, kind: CatalogKind): AnimeSearchResult[] {
  const document = new DOMParser().parseFromString(xmlText, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("Invalid catalog feed");

  const seen = new Set<string>();
  return Array.from(document.querySelectorAll("item")).flatMap((item) => {
    const title = item.querySelector("title")?.textContent?.trim() || "";
    const rawLink = item.querySelector("link")?.textContent?.trim() || "";
    try {
      const link = new URL(rawLink);
      const segments = link.pathname.split("/").filter(Boolean);
      if (
        !title ||
        link.protocol !== "https:" ||
        !ALLOWED_HOSTS.has(link.hostname) ||
        segments.length !== 2 ||
        segments[0] !== kind
      ) return [];

      const slug = segments[1];
      if (seen.has(slug)) return [];
      seen.add(slug);
      return [{ title, anime_id: link.toString(), poster: null }];
    } catch {
      return [];
    }
  });
}

function extractPosters(html: string, kind: CatalogKind): Map<string, string> {
  const document = new DOMParser().parseFromString(html, "text/html");
  const posters = new Map<string, string>();

  for (const article of Array.from(document.querySelectorAll("article.post"))) {
    const href = article.querySelector("a.lnk-blk")?.getAttribute("href");
    const image = article.querySelector("img");
    const rawPoster = image?.getAttribute("data-src") ||
      image?.getAttribute("data-lazy-src") ||
      image?.getAttribute("data-original") ||
      image?.getAttribute("src");
    if (!href || !rawPoster) continue;

    try {
      const detail = new URL(href, ANIMESALT_ORIGIN);
      const segments = detail.pathname.split("/").filter(Boolean);
      if (
        detail.protocol !== "https:" ||
        !ALLOWED_HOSTS.has(detail.hostname) ||
        segments.length !== 2 ||
        segments[0] !== kind
      ) continue;

      const poster = new URL(rawPoster, ANIMESALT_ORIGIN).toString();
      if (usableImageUrl(poster)) posters.set(segments[1], poster);
    } catch {
      // Invalid article and image URLs are ignored; catalog entries remain usable.
    }
  }

  return posters;
}

export function BrowserCatalogFallback({
  kind,
  page,
}: {
  kind: CatalogKind;
  page: number;
}) {
  const [items, setItems] = useState<Anime[]>([]);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const load = async () => {
      setState("loading");
      setItems([]);
      const catalogUrl = new URL("/api/catalog-proxy", window.location.origin);
      catalogUrl.searchParams.set("kind", kind);
      catalogUrl.searchParams.set("page", String(page));

      const response = await fetch(catalogUrl, {
        cache: "no-store",
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type")?.toLowerCase() || "";
      if (!response.ok || !/(?:rss\+xml|application\/xml|text\/xml)/.test(contentType)) {
        throw new Error(`Catalog Worker returned HTTP ${response.status}`);
      }

      const rawItems = parseFeed(await response.text(), kind);
      if (rawItems.length === 0) throw new Error("Catalog feed had no valid entries");

      const reportedPages = Number(response.headers.get("x-catalog-total-pages"));
      const nextTotalPages = Number.isSafeInteger(reportedPages) && reportedPages >= page
        ? reportedPages
        : null;
      if (!active) return;
      setItems(rawItems.map((item) =>
        mapSearchItemToAnime(item, kind === "movies" ? "Movie" : "TV")
      ));
      setTotalPages(nextTotalPages);
      setState("ready");

      // Poster lookup is a separate best-effort request. Catalog titles and
      // pagination remain visible even if the article HTML cannot be fetched.
      const articlePage = page === 1
        ? `${ANIMESALT_ORIGIN}/${kind}/`
        : `${ANIMESALT_ORIGIN}/${kind}/page/${page}/`;
      const proxyUrl = `/api/animesalt-proxy?url=${encodeURIComponent(articlePage)}`;
      try {
        const posterResponse = await fetch(proxyUrl, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!posterResponse.ok || !posterResponse.headers.get("content-type")?.toLowerCase().includes("text/html")) return;
        const posterMap = extractPosters(await posterResponse.text(), kind);
        if (!active) return;
        setItems((current) => current.map((item) => {
          if (isUsableImageUrl(item.poster)) return item;
          const poster = posterMap.get(cleanAnimeSlug(item.slug));
          return poster ? { ...item, poster, backdrop: poster } : item;
        }));
      } catch {
        // Keep valid feed entries if optional poster enrichment fails.
      }
    };

    load().catch(() => {
      if (active && !controller.signal.aborted) setState("error");
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [kind, page, retry]);

  if (state === "loading") {
    return <p className="mt-8 py-12 text-center text-sm text-text-muted" role="status">Loading catalog from the source…</p>;
  }

  if (state === "error") {
    return (
      <div className="mt-8 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border-line py-20 text-center">
        <p className="font-display text-lg font-bold text-text-primary">Catalog temporarily unavailable</p>
        <p className="max-w-sm text-sm text-text-muted">The source did not return catalog entries. Try again shortly.</p>
        <button
          type="button"
          onClick={() => setRetry((value) => value + 1)}
          className="focus-ring mt-2 rounded-lg border border-border-line px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:border-green-primary/60 hover:text-green-light"
        >
          Try again
        </button>
      </div>
    );
  }

  const buildHref = (nextPage: number) => `/${kind}?page=${nextPage}`;
  return (
    <div className="mt-8">
      <p className="mb-5 text-xs text-text-muted">
        Page {page}{totalPages ? ` of ${totalPages}` : ""} • Showing {items.length} {kind === "series" ? "anime series" : "anime movies"}
      </p>
      <AnimeGrid items={items} />
      {totalPages !== null && (
        <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />
      )}
    </div>
  );
}
