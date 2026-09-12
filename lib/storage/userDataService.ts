/**
 * Client-side service layer for HINDIANIME user data.
 * Purely browser-backed (IndexedDB + localStorage guest profile).
 * Designed for easy future transition to MongoDB / backend APIs without UI redesign.
 */

import {
  STORES,
  dbGetAll,
  dbGet,
  dbPut,
  dbDelete,
  dbClearStore,
  dbClearAllStores,
  isIndexedDbSupported,
} from "./indexedDb";

export interface GuestProfile {
  id: string; // e.g. "guest-X7K29"
  name: string; // e.g. "Guest · guest-X7K29"
  createdAt: string;
}

export interface ContinueWatchingItem {
  animeSlug: string;
  animeTitle: string;
  animePoster: string;
  season: number;
  episode: number;
  episodeId: string;
  episodeTitle: string;
  durationMinutes: number;
  genres: string[];
  updatedAt: string;
}

export interface WatchHistoryItem {
  id: string; // `${animeSlug}_s${season}_e${episode}`
  animeSlug: string;
  animeTitle: string;
  animePoster: string;
  season: number;
  episode: number;
  episodeId: string;
  episodeTitle: string;
  durationMinutes: number;
  genres: string[];
  watchedAt: string;
  completed: boolean;
}

export interface FavoriteItem {
  animeSlug: string;
  title: string;
  poster: string;
  rating?: number;
  type?: string;
  genres?: string[];
  languages?: string[];
  addedAt: string;
}

export type AnimeStatus = "watching" | "completed" | "dropped" | "plan_to_watch";

export interface AnimeStatusItem {
  animeSlug: string;
  status: AnimeStatus;
  updatedAt: string;
}

export interface GenreStat {
  genre: string;
  count: number;
  percentage: number;
}

export interface ProfileStats {
  totalEpisodesWatched: number;
  totalWatchTimeMinutes: number;
  completedCount: number;
  favoritesCount: number;
  continueWatchingCount: number;
  topGenre: string | null;
  watchingStreakDays: number;
  genreStats: GenreStat[];
}

export interface PlaybackPreferences {
  autoplayNext: boolean;
  autoHideControls: boolean;
  theaterMode: boolean;
  lowDataMode: boolean;
}

const GUEST_ID_KEY = "hindianime_guest_id";
const GUEST_CREATED_KEY = "hindianime_guest_created_at";
const PREFERENCES_KEY = "hindianime_playback_prefs";
export const USER_DATA_EVENT = "hindianime:userdata-changed";

const DEFAULT_PREFERENCES: PlaybackPreferences = {
  autoplayNext: true,
  autoHideControls: true,
  theaterMode: false,
  lowDataMode: false,
};

function notifyChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(USER_DATA_EVENT));
  }
}

function generateGuestId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 5; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `guest-${id}`;
}

// ─── Guest Identity ──────────────────────────────────────────────────────────

export function getGuestProfile(): GuestProfile {
  if (typeof window === "undefined") {
    return {
      id: "guest-GUEST",
      name: "Guest · guest-GUEST",
      createdAt: new Date().toISOString(),
    };
  }

  let guestId = localStorage.getItem(GUEST_ID_KEY);
  let createdAt = localStorage.getItem(GUEST_CREATED_KEY);

  if (!guestId) {
    guestId = generateGuestId();
    createdAt = new Date().toISOString();
    localStorage.setItem(GUEST_ID_KEY, guestId);
    localStorage.setItem(GUEST_CREATED_KEY, createdAt);
  }

  return {
    id: guestId,
    name: `Guest · ${guestId}`,
    createdAt: createdAt || new Date().toISOString(),
  };
}

// ─── Watch Progress & History ────────────────────────────────────────────────

export async function recordWatchProgress(entry: {
  animeSlug: string;
  animeTitle: string;
  animePoster: string;
  season: number;
  episode: number;
  episodeId: string;
  episodeTitle: string;
  durationMinutes?: number;
  genres?: string[];
  completed?: boolean;
}): Promise<void> {
  if (!isIndexedDbSupported()) return;

  const now = new Date().toISOString();
  const duration = entry.durationMinutes || 24;
  const genres = entry.genres || [];

  // 1. Update Continue Watching (unique per animeSlug)
  const continueItem: ContinueWatchingItem = {
    animeSlug: entry.animeSlug,
    animeTitle: entry.animeTitle,
    animePoster: entry.animePoster,
    season: entry.season,
    episode: entry.episode,
    episodeId: entry.episodeId,
    episodeTitle: entry.episodeTitle,
    durationMinutes: duration,
    genres,
    updatedAt: now,
  };
  await dbPut(STORES.CONTINUE_WATCHING, continueItem);

  // 2. Update Watch History (unique per animeSlug + season + episode)
  const historyId = `${entry.animeSlug}_s${entry.season}_e${entry.episode}`;
  const historyItem: WatchHistoryItem = {
    id: historyId,
    animeSlug: entry.animeSlug,
    animeTitle: entry.animeTitle,
    animePoster: entry.animePoster,
    season: entry.season,
    episode: entry.episode,
    episodeId: entry.episodeId,
    episodeTitle: entry.episodeTitle,
    durationMinutes: duration,
    genres,
    watchedAt: now,
    completed: Boolean(entry.completed),
  };
  await dbPut(STORES.WATCH_HISTORY, historyItem);

  // 3. Mark status as watching if not already set
  const currentStatus = await getAnimeStatus(entry.animeSlug);
  if (!currentStatus) {
    await setAnimeStatus(entry.animeSlug, "watching");
  }

  notifyChange();
}

export async function getContinueWatching(): Promise<ContinueWatchingItem[]> {
  const items = await dbGetAll<ContinueWatchingItem>(STORES.CONTINUE_WATCHING);
  return items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function removeFromContinueWatching(animeSlug: string): Promise<void> {
  await dbDelete(STORES.CONTINUE_WATCHING, animeSlug);
  notifyChange();
}

export async function clearContinueWatching(): Promise<void> {
  await dbClearStore(STORES.CONTINUE_WATCHING);
  notifyChange();
}

export async function getWatchHistory(): Promise<WatchHistoryItem[]> {
  const items = await dbGetAll<WatchHistoryItem>(STORES.WATCH_HISTORY);
  return items.sort((a, b) => new Date(b.watchedAt).getTime() - new Date(a.watchedAt).getTime());
}

export async function clearWatchHistory(): Promise<void> {
  await dbClearStore(STORES.WATCH_HISTORY);
  notifyChange();
}

// ─── Favorites / My List ─────────────────────────────────────────────────────

export async function getFavorites(): Promise<FavoriteItem[]> {
  const items = await dbGetAll<FavoriteItem>(STORES.FAVORITES);
  return items.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
}

export async function isFavorite(animeSlug: string): Promise<boolean> {
  const item = await dbGet<FavoriteItem>(STORES.FAVORITES, animeSlug);
  return Boolean(item);
}

export async function toggleFavorite(anime: {
  animeSlug: string;
  title: string;
  poster: string;
  rating?: number;
  type?: string;
  genres?: string[];
  languages?: string[];
}): Promise<boolean> {
  const exists = await isFavorite(anime.animeSlug);
  if (exists) {
    await dbDelete(STORES.FAVORITES, anime.animeSlug);
    notifyChange();
    return false;
  } else {
    const item: FavoriteItem = {
      animeSlug: anime.animeSlug,
      title: anime.title,
      poster: anime.poster,
      rating: anime.rating,
      type: anime.type,
      genres: anime.genres,
      languages: anime.languages,
      addedAt: new Date().toISOString(),
    };
    await dbPut(STORES.FAVORITES, item);
    notifyChange();
    return true;
  }
}

export async function removeFavorite(animeSlug: string): Promise<void> {
  await dbDelete(STORES.FAVORITES, animeSlug);
  notifyChange();
}

export async function clearFavorites(): Promise<void> {
  await dbClearStore(STORES.FAVORITES);
  notifyChange();
}

// ─── Anime Status (Watching / Completed / Dropped) ───────────────────────────

export async function getAnimeStatus(animeSlug: string): Promise<AnimeStatus | null> {
  const item = await dbGet<AnimeStatusItem>(STORES.ANIME_STATUS, animeSlug);
  return item ? item.status : null;
}

export async function setAnimeStatus(animeSlug: string, status: AnimeStatus): Promise<void> {
  const item: AnimeStatusItem = {
    animeSlug,
    status,
    updatedAt: new Date().toISOString(),
  };
  await dbPut(STORES.ANIME_STATUS, item);
  notifyChange();
}

export async function getAllAnimeStatuses(): Promise<AnimeStatusItem[]> {
  return dbGetAll<AnimeStatusItem>(STORES.ANIME_STATUS);
}

// ─── Watching Streak ─────────────────────────────────────────────────────────

export function calculateWatchingStreak(history: WatchHistoryItem[]): number {
  if (!history || history.length === 0) return 0;

  // Extract unique sorted calendar date strings (YYYY-MM-DD)
  const uniqueDates = Array.from(
    new Set(
      history.map((h) => {
        try {
          return new Date(h.watchedAt).toISOString().split("T")[0];
        } catch {
          return "";
        }
      }).filter(Boolean)
    )
  ).sort().reverse();

  if (uniqueDates.length === 0) return 0;

  const today = new Date().toISOString().split("T")[0];
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toISOString().split("T")[0];

  // If latest activity was not today or yesterday, streak is reset to 0
  const latestDate = uniqueDates[0];
  if (latestDate !== today && latestDate !== yesterday) {
    return 0;
  }

  let streak = 0;
  let currentDate = new Date(latestDate);

  for (const dateStr of uniqueDates) {
    const expectedStr = currentDate.toISOString().split("T")[0];
    if (dateStr === expectedStr) {
      streak++;
      currentDate.setDate(currentDate.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

// ─── Calculated Statistics (Derived from real stored data) ────────────────────

export async function getProfileStats(): Promise<ProfileStats> {
  const history = await getWatchHistory();
  const favorites = await getFavorites();
  const continueItems = await getContinueWatching();
  const statuses = await getAllAnimeStatuses();

  const totalEpisodesWatched = history.length;
  const totalWatchTimeMinutes = history.reduce((sum, h) => sum + (h.durationMinutes || 24), 0);
  const completedCount = statuses.filter((s) => s.status === "completed").length;
  const watchingStreakDays = calculateWatchingStreak(history);

  // Compute real genre statistics from history
  const genreCounts: Record<string, number> = {};
  let totalGenreTags = 0;

  for (const h of history) {
    if (Array.isArray(h.genres) && h.genres.length > 0) {
      for (const g of h.genres) {
        const cleanG = g.toLowerCase().trim();
        if (cleanG) {
          genreCounts[cleanG] = (genreCounts[cleanG] || 0) + 1;
          totalGenreTags++;
        }
      }
    }
  }

  const genreStats: GenreStat[] = Object.entries(genreCounts)
    .map(([genre, count]) => ({
      genre,
      count,
      percentage: totalGenreTags > 0 ? Math.round((count / totalGenreTags) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const topGenre = genreStats.length > 0 ? genreStats[0].genre : null;

  return {
    totalEpisodesWatched,
    totalWatchTimeMinutes,
    completedCount,
    favoritesCount: favorites.length,
    continueWatchingCount: continueItems.length,
    topGenre,
    watchingStreakDays,
    genreStats,
  };
}

// ─── Playback Preferences ────────────────────────────────────────────────────

export function getPlaybackPreferences(): PlaybackPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const stored = localStorage.getItem(PREFERENCES_KEY);
    if (!stored) return DEFAULT_PREFERENCES;
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(stored) };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function setPlaybackPreferences(prefs: Partial<PlaybackPreferences>): PlaybackPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  const current = getPlaybackPreferences();
  const updated = { ...current, ...prefs };
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(updated));
  notifyChange();
  return updated;
}

export function resetPlaybackPreferences(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(PREFERENCES_KEY);
    notifyChange();
  }
}

// ─── Manage / Clear All Data ─────────────────────────────────────────────────

export async function clearAllLocalData(): Promise<void> {
  if (typeof window !== "undefined") {
    // 1. Clear IndexedDB stores
    await dbClearAllStores();

    // 2. Reset preferences
    resetPlaybackPreferences();

    // 3. Generate a fresh guest profile
    const newGuestId = generateGuestId();
    const now = new Date().toISOString();
    localStorage.setItem(GUEST_ID_KEY, newGuestId);
    localStorage.setItem(GUEST_CREATED_KEY, now);

    notifyChange();
  }
}
