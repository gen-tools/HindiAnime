"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  User,
  Play,
  Bookmark,
  History,
  Clock,
  CheckCircle2,
  Trash2,
  Sparkles,
  AlertTriangle,
  Layers,
  Flame,
  Settings,
  RefreshCw,
  Film,
  Sliders,
  Check,
} from "lucide-react";
import {
  getGuestProfile,
  getProfileStats,
  getContinueWatching,
  getWatchHistory,
  getFavorites,
  removeFromContinueWatching,
  removeFavorite,
  clearWatchHistory,
  clearContinueWatching,
  clearFavorites,
  clearAllLocalData,
  getPlaybackPreferences,
  setPlaybackPreferences,
  resetPlaybackPreferences,
  type GuestProfile,
  type ProfileStats,
  type ContinueWatchingItem,
  type WatchHistoryItem,
  type FavoriteItem,
  type PlaybackPreferences,
} from "@/lib/storage/userDataService";
import { PosterArt } from "@/components/anime/PosterArt";
import { cn } from "@/lib/utils";

interface ProfileViewProps {
  initialTab?: "continue" | "favorites" | "history" | "settings";
}

type ConfirmActionType = "all" | "history" | "continue" | "favorites" | "prefs" | null;

export function ProfileView({ initialTab = "continue" }: ProfileViewProps) {
  const [mounted, setMounted] = useState(false);
  const [guest, setGuest] = useState<GuestProfile | null>(null);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [continueList, setContinueList] = useState<ContinueWatchingItem[]>([]);
  const [historyList, setHistoryList] = useState<WatchHistoryItem[]>([]);
  const [favoritesList, setFavoritesList] = useState<FavoriteItem[]>([]);
  const [preferences, setPreferences] = useState<PlaybackPreferences>({
    autoplayNext: true,
    autoHideControls: true,
    theaterMode: false,
    lowDataMode: false,
  });
  const [activeTab, setActiveTab] = useState<"continue" | "favorites" | "history" | "settings">(initialTab);
  const [confirmAction, setConfirmAction] = useState<ConfirmActionType>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const profile = getGuestProfile();
      setGuest(profile);
      setPreferences(getPlaybackPreferences());

      const [s, c, h, f] = await Promise.all([
        getProfileStats(),
        getContinueWatching(),
        getWatchHistory(),
        getFavorites(),
      ]);

      setStats(s);
      setContinueList(c);
      setHistoryList(h);
      setFavoritesList(f);
    } catch (err) {
      console.warn("Error loading user data:", err);
    }
  }, []);

  useEffect(() => {
    setMounted(true);

    // One-time migration: clear stale IndexedDB records that have cross-contaminated
    // poster URLs (wrong anime images saved before the poster extraction fix).
    const POSTER_MIGRATION_KEY = "hindianime_poster_fix_v1";
    const migrationDone = typeof window !== "undefined" && localStorage.getItem(POSTER_MIGRATION_KEY);
    if (!migrationDone) {
      clearContinueWatching().catch(() => {}).finally(() => {
        if (typeof window !== "undefined") {
          localStorage.setItem(POSTER_MIGRATION_KEY, "1");
        }
        loadData();
      });
    } else {
      loadData();
    }

    const handleChange = () => loadData();
    window.addEventListener("hindianime:userdata-changed", handleChange);
    return () => window.removeEventListener("hindianime:userdata-changed", handleChange);
  }, [loadData]);

  const handleRemoveContinue = async (slug: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await removeFromContinueWatching(slug);
    setContinueList((prev) => prev.filter((item) => item.animeSlug !== slug));
  };

  const handleRemoveFavorite = async (slug: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await removeFavorite(slug);
    setFavoritesList((prev) => prev.filter((item) => item.animeSlug !== slug));
  };

  const handleTogglePref = (key: keyof PlaybackPreferences) => {
    const updated = setPlaybackPreferences({ [key]: !preferences[key] });
    setPreferences(updated);
  };

  const handleConfirmAction = async () => {
    setIsProcessing(true);
    try {
      if (confirmAction === "all") {
        await clearAllLocalData();
      } else if (confirmAction === "history") {
        await clearWatchHistory();
      } else if (confirmAction === "continue") {
        await clearContinueWatching();
      } else if (confirmAction === "favorites") {
        await clearFavorites();
      } else if (confirmAction === "prefs") {
        resetPlaybackPreferences();
      }
      setConfirmAction(null);
      await loadData();
    } finally {
      setIsProcessing(false);
    }
  };

  function formatMinutes(mins: number): string {
    if (!mins || mins <= 0) return "0m";
    const hours = Math.floor(mins / 60);
    const remaining = mins % 60;
    if (hours === 0) return `${remaining}m`;
    return `${hours}h ${remaining}m`;
  }

  function formatDate(isoString: string): string {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return "Recently";
    }
  }

  if (!mounted) {
    return (
      <div className="container-page py-12 animate-pulse">
        <div className="h-36 rounded-2xl bg-surface-card" />
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <div className="h-24 rounded-xl bg-surface-card" />
          <div className="h-24 rounded-xl bg-surface-card" />
          <div className="h-24 rounded-xl bg-surface-card" />
          <div className="h-24 rounded-xl bg-surface-card" />
          <div className="h-24 rounded-xl bg-surface-card" />
          <div className="h-24 rounded-xl bg-surface-card" />
        </div>
      </div>
    );
  }

  return (
    <div className="container-page py-8">
      {/* ─── Profile Header ────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-border-line bg-gradient-to-r from-surface via-surface-dark to-background p-6 shadow-xl sm:p-8">
        <div className="relative z-10 flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-500/20 via-green-primary/20 to-green-bright/30 border border-green-primary/30 shadow-inner">
              <User className="h-8 w-8 text-green-light" />
              <span className="absolute -bottom-1 -right-1 flex h-4 w-4">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-bright opacity-75" />
                <span className="relative inline-flex h-4 w-4 rounded-full bg-green-bright" />
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl font-black text-text-primary sm:text-3xl">
                  {guest?.name ?? "Guest User"}
                </h1>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-elevated px-2.5 py-0.5 font-medium text-green-light border border-green-primary/20">
                  <Sparkles className="h-3 w-3" />
                  Browser-Only Profile
                </span>
                <span>•</span>
                <span>No login or server DB required</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setActiveTab("settings")}
            className="flex items-center gap-1.5 rounded-lg border border-border-line bg-surface px-3 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:border-green-primary/50 hover:text-white"
          >
            <Settings className="h-3.5 w-3.5 text-green-bright" />
            <span>Preferences & Data</span>
          </button>
        </div>
      </div>

      {/* ─── Real Dynamic Stats Grid ──────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl border border-border-line bg-surface p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            <Play className="h-3.5 w-3.5 text-green-bright" />
            <span>Episodes</span>
          </div>
          <p className="mt-2 font-display text-2xl font-bold text-text-primary">
            {stats?.totalEpisodesWatched ?? 0}
          </p>
          <p className="text-[11px] text-text-muted">Episodes streamed</p>
        </div>

        <div className="rounded-xl border border-border-line bg-surface p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            <Clock className="h-3.5 w-3.5 text-cyan-400" />
            <span>Watch Time</span>
          </div>
          <p className="mt-2 font-display text-2xl font-bold text-text-primary">
            {formatMinutes(stats?.totalWatchTimeMinutes ?? 0)}
          </p>
          <p className="text-[11px] text-text-muted">Total watch time</p>
        </div>

        <div className="rounded-xl border border-border-line bg-surface p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            <Flame className="h-3.5 w-3.5 text-orange-400" />
            <span>Streak</span>
          </div>
          <p className="mt-2 font-display text-2xl font-bold text-text-primary">
            {stats?.watchingStreakDays ? `${stats.watchingStreakDays} Days` : "0 Days"}
          </p>
          <p className="text-[11px] text-text-muted">Daily viewing streak</p>
        </div>

        <div className="rounded-xl border border-border-line bg-surface p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            <Bookmark className="h-3.5 w-3.5 text-yellow-400" />
            <span>My List</span>
          </div>
          <p className="mt-2 font-display text-2xl font-bold text-text-primary">
            {stats?.favoritesCount ?? 0}
          </p>
          <p className="text-[11px] text-text-muted">Bookmarked anime</p>
        </div>

        <div className="rounded-xl border border-border-line bg-surface p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            <span>Completed</span>
          </div>
          <p className="mt-2 font-display text-2xl font-bold text-text-primary">
            {stats?.completedCount ?? 0}
          </p>
          <p className="text-[11px] text-text-muted">Finished series</p>
        </div>

        <div className="rounded-xl border border-border-line bg-surface p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            <Sparkles className="h-3.5 w-3.5 text-purple-400" />
            <span>Top Genre</span>
          </div>
          <p className="mt-2 font-display text-lg font-bold text-text-primary capitalize truncate">
            {stats?.topGenre ? stats.topGenre.replace("-", " ") : "None"}
          </p>
          <p className="text-[11px] text-text-muted">Most watched</p>
        </div>
      </div>

      {/* ─── Real Genre Statistics (Derived from actual watched anime) ─ */}
      {stats && stats.genreStats && stats.genreStats.length > 0 && (
        <div className="mt-6 rounded-xl border border-border-line bg-surface p-5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            <Layers className="h-3.5 w-3.5 text-green-bright" />
            <span>Your Top Watched Genres</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2.5">
            {stats.genreStats.map((item) => (
              <div
                key={item.genre}
                className="flex items-center gap-2 rounded-lg border border-border-line bg-surface-elevated px-3 py-1.5 text-xs"
              >
                <span className="font-semibold capitalize text-text-primary">
                  {item.genre.replace("-", " ")}
                </span>
                <span className="rounded-full bg-green-primary/20 px-2 py-0.5 text-[10px] font-bold text-green-light">
                  {item.percentage}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Tabs Navigation ──────────────────────────────────────────── */}
      <div className="mt-8 flex items-center gap-2 border-b border-border-line pb-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab("continue")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all whitespace-nowrap",
            activeTab === "continue"
              ? "bg-green-primary/20 text-green-light border border-green-primary/30"
              : "text-text-secondary hover:text-white"
          )}
        >
          <Play className="h-4 w-4" />
          <span>Continue Watching</span>
          {continueList.length > 0 && (
            <span className="rounded-full bg-green-primary/40 px-2 py-0.2 text-xs font-bold text-white">
              {continueList.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("favorites")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all whitespace-nowrap",
            activeTab === "favorites"
              ? "bg-green-primary/20 text-green-light border border-green-primary/30"
              : "text-text-secondary hover:text-white"
          )}
        >
          <Bookmark className="h-4 w-4" />
          <span>My List</span>
          {favoritesList.length > 0 && (
            <span className="rounded-full bg-green-primary/40 px-2 py-0.2 text-xs font-bold text-white">
              {favoritesList.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("history")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all whitespace-nowrap",
            activeTab === "history"
              ? "bg-green-primary/20 text-green-light border border-green-primary/30"
              : "text-text-secondary hover:text-white"
          )}
        >
          <History className="h-4 w-4" />
          <span>Watch History</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("settings")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all whitespace-nowrap",
            activeTab === "settings"
              ? "bg-green-primary/20 text-green-light border border-green-primary/30"
              : "text-text-secondary hover:text-white"
          )}
        >
          <Sliders className="h-4 w-4" />
          <span>Preferences & Storage</span>
        </button>
      </div>

      {/* ─── Tab 1: Continue Watching ─────────────────────────────────── */}
      {activeTab === "continue" && (
        <div className="mt-6">
          {continueList.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-line py-16 text-center">
              <Film className="h-12 w-12 text-text-muted" />
              <h3 className="mt-3 font-display text-lg font-bold text-text-primary">
                No episodes in progress
              </h3>
              <p className="mt-1 max-w-sm text-sm text-text-secondary">
                When you stream anime, your progress will automatically appear here so you can resume where you left off.
              </p>
              <Link
                href="/latest"
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-green-primary px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-green-primary/25 hover:bg-green-bright hover:text-black transition-all"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>Explore Anime</span>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {continueList.map((item) => (
                <div
                  key={item.animeSlug}
                  className="group relative flex overflow-hidden rounded-xl border border-border-line bg-surface transition-all hover:border-green-primary/40 hover:shadow-lg hover:shadow-green-primary/5"
                >
                  <div className="relative w-28 shrink-0 sm:w-32 bg-surface-card">
                    <PosterArt
                      seed={item.animePoster}
                      title={item.animeTitle}
                      className="h-full w-full object-cover"
                    />
                  </div>

                  <div className="flex flex-1 flex-col justify-between p-3.5">
                    <div>
                      <h4 className="font-display font-bold text-text-primary line-clamp-1 group-hover:text-green-light transition-colors">
                        {item.animeTitle}
                      </h4>
                      <p className="mt-0.5 text-xs text-text-secondary line-clamp-1">
                        Season {item.season} · Episode {item.episode}
                      </p>
                      <p className="mt-1 text-[11px] text-text-muted">
                        Watched {formatDate(item.updatedAt)}
                      </p>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <Link
                        href={`/watch/${item.animeSlug}/${item.episodeId}`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-green-primary px-3 py-1.5 text-xs font-semibold text-white shadow-md transition-all hover:bg-green-bright hover:text-black active:scale-95"
                      >
                        <Play className="h-3.5 w-3.5 fill-current" />
                        <span>Resume</span>
                      </Link>

                      <button
                        type="button"
                        onClick={(e) => handleRemoveContinue(item.animeSlug, e)}
                        title="Remove from Continue Watching"
                        className="rounded-lg p-1.5 text-text-muted hover:bg-white/5 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Tab 2: My List / Favorites ──────────────────────────────── */}
      {activeTab === "favorites" && (
        <div className="mt-6">
          {favoritesList.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-line py-16 text-center">
              <Bookmark className="h-12 w-12 text-text-muted" />
              <h3 className="mt-3 font-display text-lg font-bold text-text-primary">
                Your list is empty
              </h3>
              <p className="mt-1 max-w-sm text-sm text-text-secondary">
                Bookmark anime you love by clicking &ldquo;Add to List&rdquo; on any anime page to save them here.
              </p>
              <Link
                href="/popular"
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-green-primary px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-green-primary/25 hover:bg-green-bright hover:text-black transition-all"
              >
                <span>Browse Popular Anime</span>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {favoritesList.map((item) => (
                <div
                  key={item.animeSlug}
                  className="group relative flex flex-col overflow-hidden rounded-xl border border-border-line bg-surface transition-all hover:border-green-primary/40 hover:shadow-lg"
                >
                  <Link href={`/anime/${item.animeSlug}`} className="block relative aspect-[2/3] w-full overflow-hidden">
                    <PosterArt
                      seed={item.poster}
                      title={item.title}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <button
                      type="button"
                      onClick={(e) => handleRemoveFavorite(item.animeSlug, e)}
                      title="Remove from favorites"
                      className="absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/75 text-white/70 backdrop-blur-sm transition-all hover:bg-red-500 hover:text-white"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </Link>

                  <div className="p-3">
                    <Link href={`/anime/${item.animeSlug}`}>
                      <h4 className="font-display text-sm font-bold text-text-primary line-clamp-1 group-hover:text-green-light transition-colors">
                        {item.title}
                      </h4>
                    </Link>
                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-text-muted">
                      <span>{item.type || "TV"}</span>
                      {item.rating ? (
                        <span className="font-semibold text-green-light">★ {item.rating.toFixed(1)}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Tab 3: Watch History ────────────────────────────────────── */}
      {activeTab === "history" && (
        <div className="mt-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs text-text-muted">
              {historyList.length} episode records stored locally
            </p>
            {historyList.length > 0 && (
              <button
                type="button"
                onClick={() => setConfirmAction("history")}
                className="flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-red-400 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear History</span>
              </button>
            )}
          </div>

          {historyList.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-line py-16 text-center">
              <History className="h-12 w-12 text-text-muted" />
              <h3 className="mt-3 font-display text-lg font-bold text-text-primary">
                No watch history yet
              </h3>
              <p className="mt-1 text-sm text-text-secondary">
                Episodes you stream will be cataloged here chronologically.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border-line rounded-xl border border-border-line bg-surface overflow-hidden">
              {historyList.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-4 p-3.5 transition-colors hover:bg-surface-elevated"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg">
                      <PosterArt
                        seed={item.animePoster}
                        title={item.animeTitle}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <Link
                        href={`/watch/${item.animeSlug}/${item.episodeId}`}
                        className="font-display font-semibold text-text-primary hover:text-green-light line-clamp-1 transition-colors"
                      >
                        {item.animeTitle}
                      </Link>
                      <p className="text-xs text-text-secondary line-clamp-1">
                        Season {item.season} · Episode {item.episode} &mdash; {item.episodeTitle}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[11px] text-text-muted hidden sm:inline">
                      {formatDate(item.watchedAt)}
                    </span>
                    <Link
                      href={`/watch/${item.animeSlug}/${item.episodeId}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-border-line bg-surface px-2.5 py-1 text-xs font-medium text-text-secondary hover:border-green-primary/50 hover:text-white"
                    >
                      <Play className="h-3 w-3" />
                      <span>Rewatch</span>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Tab 4: Preferences & Storage ────────────────────────────── */}
      {activeTab === "settings" && (
        <div className="mt-6 space-y-6 max-w-2xl">
          {/* Playback Preferences */}
          <div className="rounded-xl border border-border-line bg-surface p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-border-line pb-3">
              <div>
                <h3 className="font-display text-base font-bold text-text-primary">
                  Playback Preferences
                </h3>
                <p className="text-xs text-text-secondary">
                  Configure browser-stored playback settings
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmAction("prefs")}
                className="text-xs text-text-muted hover:text-white transition-colors"
              >
                Reset Defaults
              </button>
            </div>

            <div className="divide-y divide-border-line pt-1 text-xs">
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-semibold text-text-primary">Autoplay Next Episode</p>
                  <p className="text-text-muted">Automatically offer next episode links upon finishing</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleTogglePref("autoplayNext")}
                  className={cn(
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                    preferences.autoplayNext ? "bg-green-primary" : "bg-surface-elevated border border-border-line"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                      preferences.autoplayNext ? "translate-x-6" : "translate-x-1"
                    )}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-semibold text-text-primary">Auto-hide Fullscreen Controls</p>
                  <p className="text-text-muted">Hide screen exit icons when cursor is idle</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleTogglePref("autoHideControls")}
                  className={cn(
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                    preferences.autoHideControls ? "bg-green-primary" : "bg-surface-elevated border border-border-line"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                      preferences.autoHideControls ? "translate-x-6" : "translate-x-1"
                    )}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-semibold text-text-primary">Default Theater Mode</p>
                  <p className="text-text-muted">Expand the player viewport by default</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleTogglePref("theaterMode")}
                  className={cn(
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                    preferences.theaterMode ? "bg-green-primary" : "bg-surface-elevated border border-border-line"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                      preferences.theaterMode ? "translate-x-6" : "translate-x-1"
                    )}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-semibold text-text-primary">Low-data Mode</p>
                  <p className="text-text-muted">Prioritize lightweight server sources and posters</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleTogglePref("lowDataMode")}
                  className={cn(
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                    preferences.lowDataMode ? "bg-green-primary" : "bg-surface-elevated border border-border-line"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                      preferences.lowDataMode ? "translate-x-6" : "translate-x-1"
                    )}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Local Browser Storage Info */}
          <div className="rounded-xl border border-border-line bg-surface p-5">
            <h3 className="font-display text-base font-bold text-text-primary">
              Local Browser Storage
            </h3>
            <p className="mt-1 text-xs text-text-secondary leading-relaxed">
              HINDIANIME stores your guest identity, continue watching progress, watch history, and bookmarked favorites directly in your browser&apos;s IndexedDB database (<code className="rounded bg-surface-elevated px-1 py-0.5 text-green-light">hindianime_user_db</code>). No account or server-side database is required.
            </p>

            <div className="mt-4 divide-y divide-border-line border-t border-border-line pt-3 text-xs">
              <div className="flex justify-between py-2">
                <span className="text-text-muted">Guest ID</span>
                <span className="font-mono text-text-primary">{guest?.id}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-text-muted">Created</span>
                <span className="text-text-primary">{formatDate(guest?.createdAt || "")}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-text-muted">Database Engine</span>
                <span className="text-green-light font-medium">IndexedDB (Browser Native)</span>
              </div>
            </div>
          </div>

          {/* Granular Storage Management */}
          <div className="rounded-xl border border-border-line bg-surface p-5">
            <h3 className="font-display text-base font-bold text-text-primary">
              Manage Stored Data
            </h3>
            <p className="mt-1 text-xs text-text-secondary">
              Selectively clear specific categories or reset all HINDIANIME data.
            </p>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmAction("continue")}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-border-line bg-surface-elevated px-3 py-2 text-xs font-semibold text-text-secondary hover:border-red-500/40 hover:text-red-400 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear Continue Watching</span>
              </button>

              <button
                type="button"
                onClick={() => setConfirmAction("favorites")}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-border-line bg-surface-elevated px-3 py-2 text-xs font-semibold text-text-secondary hover:border-red-500/40 hover:text-red-400 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear My List</span>
              </button>

              <button
                type="button"
                onClick={() => setConfirmAction("history")}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-border-line bg-surface-elevated px-3 py-2 text-xs font-semibold text-text-secondary hover:border-red-500/40 hover:text-red-400 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear Watch History</span>
              </button>
            </div>
          </div>

          {/* Master Reset All Data */}
          <div className="rounded-xl border border-red-500/20 bg-red-950/10 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-display text-sm font-bold text-red-300">
                  Reset All Local Data
                </h4>
                <p className="mt-1 text-xs text-red-200/70 leading-relaxed">
                  Reset your viewing history, favorites, continue watching, preferences, and generate a new guest ID. This action only affects HINDIANIME data on this browser.
                </p>
                <button
                  type="button"
                  onClick={() => setConfirmAction("all")}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow hover:bg-red-500 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Clear All HINDIANIME Data</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Confirmation Modal ──────────────────────────────────────── */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl border border-border-line bg-surface-dark p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle className="h-6 w-6" />
              <h3 className="font-display text-lg font-bold text-white">
                {confirmAction === "all" && "Reset All Data?"}
                {confirmAction === "history" && "Clear Watch History?"}
                {confirmAction === "continue" && "Clear Continue Watching?"}
                {confirmAction === "favorites" && "Clear My List?"}
                {confirmAction === "prefs" && "Reset Playback Preferences?"}
              </h3>
            </div>
            <p className="mt-3 text-sm text-text-secondary leading-relaxed">
              {confirmAction === "all" &&
                "Are you sure you want to delete all watch history, favorites, and continue watching progress? A new guest identity will be assigned. This cannot be undone."}
              {confirmAction === "history" &&
                "Are you sure you want to delete all recorded watch history? Continue Watching and My List will remain intact."}
              {confirmAction === "continue" &&
                "Are you sure you want to clear your Continue Watching progress?"}
              {confirmAction === "favorites" &&
                "Are you sure you want to clear all anime from your My List / Favorites?"}
              {confirmAction === "prefs" &&
                "Reset all playback preferences to their default values?"}
            </p>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => setConfirmAction(null)}
                className="rounded-lg border border-border-line px-4 py-2 text-xs font-semibold text-text-secondary hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleConfirmAction}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 transition-colors"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>Confirm</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
