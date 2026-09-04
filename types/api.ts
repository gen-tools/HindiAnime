export interface AnimeListItem {
  title: string;
  anime_id: string;
  poster: string | null;
}

export type AnimeSearchResult = AnimeListItem;

export interface AnimeSearchResponse {
  success: boolean;
  mmessage?: string;
  message?: string;
  results: {
    currentPage: number;
    totalPages: number;
    results: AnimeSearchResult[];
  };
}

export interface AnimeCatalogResponse {
  success: boolean;
  message?: string;
  results: {
    currentPage: number;
    totalPages: number;
    results: AnimeSearchResult[];
  };
}

export interface HomepageFreshDropItem extends AnimeListItem {
  season: string | number;
  episode: string | number;
}

export interface HomepageRankedItem extends AnimeListItem {
  rank: string | number;
}

export interface HomepageApiSections {
  fresh_drops: HomepageFreshDropItem[];
  latest_animeMovies: AnimeListItem[];
  mostWatched_Films: HomepageRankedItem[];
  mostWatched_Series: HomepageRankedItem[];
  on_air_series: AnimeListItem[];
}

export interface HomepageApiResponse {
  success: boolean;
  cached?: boolean;
  data: {
    success: boolean;
    message?: string;
    results: HomepageApiSections;
  };
}

export interface LatestEpisodeItem {
  title: string;
  anime_id: string;
  season: string | number;
  episode: string | number;
  poster: string | null;
}

export interface LatestEpisodesResponse {
  success: boolean;
  message?: string;
  results: LatestEpisodeItem[] | null;
}

export type ApiTextValue =
  | string
  | string[]
  | { text?: string; content?: string; overview?: string; description?: string }
  | null;

export interface AnimeInfoData {
  title: string;
  anime_id: string;
  poster: string;
  /** Primary plot text from /api/info (cheerio `.description p`). */
  overview?: ApiTextValue;
  description?: ApiTextValue;
  synopsis?: ApiTextValue;
  plot?: ApiTextValue;
  story?: ApiTextValue;
  storyline?: ApiTextValue;
  about?: ApiTextValue;
  content?: ApiTextValue;
  /**
   * language: Comma-separated string e.g. "Hindi, English, Japanese"
   * NOTE: This field may be undefined in the actual API response.
   * Always use parseLanguages() to normalize it.
   */
  language?: string;
  quality: string;
  runningTime: string;
  genres: string[];
  year: string;
  seasons: string;
  episodes: string;
  rating: string;
}

export interface MovieInfoData {
  title: string;
  anime_id: string;
  poster?: string;
  /** Primary plot text from /api/movie (cheerio `.description p` / `.wp-content p`). */
  overview?: ApiTextValue;
  description?: ApiTextValue;
  synopsis?: ApiTextValue;
  plot?: ApiTextValue;
  story?: ApiTextValue;
  storyline?: ApiTextValue;
  about?: ApiTextValue;
  content?: ApiTextValue;
  languages?: string[];
  run_time?: string;
  runningTime?: string;
  genres?: string[];
  year?: string;
  rating?: string;
}

export interface MovieInfoResponse {
  success: boolean;
  message?: string;
  /** Redis may return this as a JSON string instead of an object. */
  results?: MovieInfoData | string | null;
}

export interface AnimeInfoResponse {
  success: boolean;
  cached?: boolean;
  /** Redis may return this as a JSON string instead of an object. */
  data: AnimeInfoData | string;
}

export interface SeasonItem {
  season: string;
  text: string;
}

/**
 * NOTE: The real API response does NOT have an `episode` field.
 * The `season` field contains the episode number (e.g. "1" = Episode 1).
 * The actual season is determined by the ?season= query parameter.
 */
export interface EpisodeItem {
  title: string;
  /** This is actually the episode number in the API response */
  season: string;
  /** Not present in API response — always undefined */
  episode?: string;
  image: string;
}

export interface EpisodeResponse {
  success: boolean;
  message?: string;
  results: {
    totalSeasons: string;
    /** Always an empty array [] in the real API response */
    seasons: SeasonItem[];
    episodes: EpisodeItem[];
  };
}

// ─── Streaming ──────────────────────────────────────────────────────────────

export interface StreamItem {
  /** Server identifier e.g. "options-0" */
  server: string;
  /**
   * Embed URL — may be a real URL or an error string.
   * Always validate with isValidEmbedUrl() before use.
   */
  embed: string;
}

export interface StreamResponse {
  success: boolean;
  message?: string;
  results?: StreamItem[];
}
