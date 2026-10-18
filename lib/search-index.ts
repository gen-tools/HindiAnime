import { COMMON_ACRONYMS, fuzzySearch } from "@/lib/fuzzy-search";
import type { Anime } from "@/types/anime";

let searchIndexPromise: Promise<Anime[]> | null = null;

export function loadSearchIndex(): Promise<Anime[]> {
  if (!searchIndexPromise) {
    searchIndexPromise = fetch("/search-index.json", { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Search index returned HTTP ${response.status}`);
        const data = await response.json() as unknown;
        if (!Array.isArray(data)) throw new Error("Search index has an invalid format");
        return data as Anime[];
      })
      .catch((error) => {
        searchIndexPromise = null;
        throw error;
      });
  }
  return searchIndexPromise;
}

export function searchLocalIndex(query: string, index: Anime[], limit = 12): Anime[] {
  const normalized = query.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (normalized.length < 3) return [];

  const terms = [normalized];
  const alias = COMMON_ACRONYMS[normalized.toLowerCase()];
  if (alias && alias.toLowerCase() !== normalized.toLowerCase()) terms.push(alias);

  const ranked = new Map<string, { item: Anime; score: number }>();
  for (const term of terms) {
    for (const result of fuzzySearch(term, index, 0.4)) {
      const previous = ranked.get(result.item.slug);
      if (!previous || result.score > previous.score) {
        ranked.set(result.item.slug, { item: result.item, score: result.score });
      }
    }
  }

  return [...ranked.values()]
    .sort((a, b) => b.score - a.score || b.item.rating - a.item.rating)
    .slice(0, limit)
    .map(({ item }) => item);
}
