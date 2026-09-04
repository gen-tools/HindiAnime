import type { LanguageCode } from "./language";

export type AnimeType = "TV" | "Movie" | "OVA" | "ONA" | "Special";
export type AnimeStatus = "Ongoing" | "Completed" | "Upcoming";

export interface Anime {
  id: string;
  slug: string;
  title: string;
  alternativeTitle?: string;
  synopsis: string;
  poster: string;
  backdrop: string;
  rating: number;
  year: number;
  type: AnimeType;
  status: AnimeStatus;
  durationMinutes: number;
  episodeCount: number;
  genres: string[];
  languages: LanguageCode[];
  seasons: number;
  studio: string;
  popularityRank?: number;
  trendingRank?: number;
  isFeatured?: boolean;
  updatedAt: string;
}
