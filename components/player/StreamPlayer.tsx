"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Loader2,
  WifiOff,
  ServerCrash,
  RefreshCw,
  Server,
  Maximize,
  Minimize,
  RectangleHorizontal,
} from "lucide-react";
import { StreamItem } from "@/types/api";
import { isValidEmbedUrl } from "@/lib/api/client";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

type PlayerState = "loading" | "ready" | "unavailable" | "error";

interface ValidServer {
  label: string;
  embed: string;
}

function isSourceB(embed: string): boolean {
  if (!embed || typeof embed !== "string") return false;
  try {
    const parsed = new URL(embed);
    // Source B is a direct video endpoint (/video/), video player endpoint (/player),
    // or contains a media content token/hash (16+ hex characters),
    // distinct from numeric embed wrappers (/(?:public/)?embed/\d+)
    if (parsed.pathname.includes("/video/") || parsed.pathname.includes("/player")) {
      return true;
    }
    if (/[a-f0-9]{16,}/i.test(parsed.pathname) || parsed.searchParams.has("data")) {
      return true;
    }
  } catch {
    if (embed.includes("/video/") || embed.includes("/player") || /[a-f0-9]{16,}/i.test(embed)) {
      return true;
    }
  }
  return false;
}

function parseValidServers(results: StreamItem[]): ValidServer[] {
  const valid = results.filter((r) => isValidEmbedUrl(r.embed));
  if (valid.length === 0) return [];

  // Identify Source B reliably from existing stream data:
  // Source B provides direct video stream playback (/video/ with content hash or player endpoints).
  const sourceB = valid.find((r) => isSourceB(r.embed));

  // Prioritize Source B when available; otherwise gracefully fall back to first valid stream
  const selected = sourceB || valid[0];

  return [
    {
      label: "Server 1",
      embed: selected.embed,
    },
  ];
}

// ─── Auto-retry guard ─────────────────────────────────────────────────────────
// Prevents infinite reload loops. Keyed per episode so switching episodes resets
// the counter automatically. Stored in sessionStorage so a manual page refresh
// always resets the counter and allows a clean start.

const MAX_AUTO_RETRIES = 2;

function getRetryCount(key: string): number {
  try {
    return parseInt(sessionStorage.getItem(key) ?? "0", 10) || 0;
  } catch {
    return 0;
  }
}

function incrementRetryCount(key: string): number {
  try {
    const next = getRetryCount(key) + 1;
    sessionStorage.setItem(key, String(next));
    return next;
  } catch {
    return MAX_AUTO_RETRIES; // treat as exhausted if storage is unavailable
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function StreamPlayer({
  animeSlug,
  season,
  episode,
  episodeTitle,
}: {
  animeSlug: string;
  season: number;
  episode: number;
  episodeTitle: string;
  languages?: string[];
}) {
  const [state, setState] = useState<PlayerState>("loading");
  const [servers, setServers] = useState<ValidServer[]>([]);
  const [activeServer, setActiveServer] = useState<ValidServer | null>(null);
  const [isTheater, setIsTheater] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showExitButton, setShowExitButton] = useState(false);
  const playerFrameRef = useRef<HTMLDivElement>(null);
  const hideExitTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Session key for auto-retry guard — unique per episode so switching
  // episodes always resets the counter without any explicit cleanup.
  const retryKey = `hindianime_retry_${animeSlug}_s${season}_e${episode}`;

  const triggerShowExit = useCallback(() => {
    setShowExitButton(true);
    if (hideExitTimerRef.current) {
      clearTimeout(hideExitTimerRef.current);
    }
    hideExitTimerRef.current = setTimeout(() => {
      setShowExitButton(false);
    }, 3000);
  }, []);

  const cancelHideExit = useCallback(() => {
    if (hideExitTimerRef.current) {
      clearTimeout(hideExitTimerRef.current);
      hideExitTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    function onFullscreenChange() {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      if (!active) {
        setShowExitButton(false);
        if (hideExitTimerRef.current) {
          clearTimeout(hideExitTimerRef.current);
          hideExitTimerRef.current = null;
        }
      }
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;

    const handleMouseMove = (e: MouseEvent) => {
      // If cursor is within bottom 100px or bottom 15% of the viewport, reveal the exit button
      const bottomThreshold = window.innerHeight - 100;
      if (e.clientY >= bottomThreshold) {
        triggerShowExit();
      } else if (e.clientY < bottomThreshold - 60) {
        setShowExitButton(false);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (hideExitTimerRef.current) {
        clearTimeout(hideExitTimerRef.current);
        hideExitTimerRef.current = null;
      }
    };
  }, [isFullscreen, triggerShowExit]);

  const toggleFullscreen = useCallback(async () => {
    const el = playerFrameRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn("Fullscreen toggle error:", err);
    }
  }, []);

  const fetchStreams = useCallback(async () => {
    setState("loading");
    setServers([]);
    setActiveServer(null);

    try {
      const res = await fetch(
        `/api/stream-proxy?id=${encodeURIComponent(animeSlug)}&season=${season}&ep=${episode}`
      );

      if (!res.ok) {
        setState("error");
        return;
      }

      const data = await res.json();
      const validServers = parseValidServers(data?.results ?? []);

      if (validServers.length === 0) {
        setState("unavailable");
      } else {
        setServers(validServers);
        setActiveServer(validServers[0]);
        setState("ready");
      }
    } catch {
      setState("error");
    }
  }, [animeSlug, season, episode]);

  useEffect(() => {
    // Defer the first load so the effect only schedules external work; the
    // fetch callback owns the subsequent loading/error state transitions.
    const timer = window.setTimeout(fetchStreams, 0);
    return () => window.clearTimeout(timer);
  }, [fetchStreams]);

  // ── Auto-recovery: handle iframe load timeout ────────────────────────────
  // Cross-origin iframes cannot propagate internal errors (e.g. "connection
  // was reset") to the parent page. The only reliably detectable signal from
  // our side is that the iframe's onload event never fires within a reasonable
  // window. When that happens we re-fetch streams via the existing fetchStreams
  // path (which runs a fresh scrape and may return a new embed URL).
  // The sessionStorage counter caps retries at MAX_AUTO_RETRIES per episode;
  // after that the existing ErrorState UI is shown so the user can retry manually.
  const handleIframeLoadTimeout = useCallback(() => {
    const count = incrementRetryCount(retryKey);
    if (count <= MAX_AUTO_RETRIES) {
      console.info(
        `[StreamPlayer] iframe load timeout — auto-retry ${count}/${MAX_AUTO_RETRIES} (${retryKey})`
      );
      fetchStreams();
    } else {
      // Retries exhausted — surface error UI; user can still press Retry manually
      console.warn(
        `[StreamPlayer] iframe load timeout — retry limit reached (${retryKey})`
      );
      setState("error");
    }
  }, [fetchStreams, retryKey]);

  const selectServer = useCallback((server: ValidServer) => {
    setActiveServer(server);
  }, []);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 transition-all duration-200",
        isTheater && "relative z-30 lg:-mx-16 xl:-mx-28"
      )}
    >
      <div
        ref={playerFrameRef}
        className={cn(
          "relative w-full overflow-hidden bg-black transition-all",
          isFullscreen
            ? "fixed inset-0 z-50 !h-screen !w-screen !max-h-none !aspect-auto rounded-none border-0"
            : isTheater
            ? "aspect-video max-h-[90vh] w-full rounded-xl border border-border-line shadow-2xl"
            : "aspect-video max-h-[90vh] w-full rounded-xl border border-border-line shadow-2xl"
        )}
      >
        {state === "loading" && <LoadingState episodeTitle={episodeTitle} />}
        {state === "error" && <ErrorState onRetry={fetchStreams} />}
        {state === "unavailable" && <UnavailableState />}
        {state === "ready" && activeServer && (
          <EmbedFrame
            embed={activeServer.embed}
            title={episodeTitle}
            onLoadTimeout={handleIframeLoadTimeout}
          />
        )}
        {/* Fullscreen exit controls */}
        {isFullscreen && (
          <>
            {/* ── Mobile: always-visible sticky exit button (no hover on touch) ── */}
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label="Exit fullscreen"
              className="sm:hidden absolute bottom-4 right-4 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/80 text-white shadow-xl backdrop-blur-md active:scale-90"
            >
              <Minimize className="h-4 w-4 text-green-bright" />
            </button>

            {/* ── Desktop: hover-reveal exit button ── */}
            {/* Bottom edge hover trigger strip */}
            <div
              onMouseEnter={triggerShowExit}
              onMouseMove={triggerShowExit}
              className="hidden sm:block absolute inset-x-0 bottom-0 z-30 h-4 pointer-events-auto"
              aria-hidden="true"
            />
            {/* Bottom-right corner hover trigger zone */}
            <div
              onMouseEnter={triggerShowExit}
              onMouseMove={triggerShowExit}
              className="hidden sm:block absolute bottom-0 right-0 z-30 h-24 w-60 pointer-events-auto"
              aria-hidden="true"
            />
            <div
              onMouseEnter={cancelHideExit}
              onMouseLeave={() => {
                if (hideExitTimerRef.current) clearTimeout(hideExitTimerRef.current);
                hideExitTimerRef.current = setTimeout(() => setShowExitButton(false), 1200);
              }}
              className={cn(
                "hidden sm:flex absolute bottom-5 right-5 z-40 transition-all duration-300 ease-out",
                showExitButton
                  ? "translate-y-0 opacity-100 pointer-events-auto"
                  : "translate-y-4 opacity-0 pointer-events-none"
              )}
            >
              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label="Exit fullscreen"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/80 text-white shadow-xl backdrop-blur-md transition-all hover:border-green-primary/50 hover:bg-black hover:text-green-light hover:scale-110 active:scale-90"
              >
                <Minimize className="h-4 w-4 text-green-bright" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Control bar: Server buttons + Theater & Fullscreen */}
      {state === "ready" && !isFullscreen && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-line bg-surface px-4 py-2.5">
          {/* Server selector buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
              <Server className="h-3.5 w-3.5 text-green-bright" />
              <span>Server:</span>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Select streaming server">
              {servers.map((srv) => {
                const isActive = srv.embed === activeServer?.embed;
                return (
                  <button
                    key={srv.embed}
                    onClick={() => selectServer(srv)}
                    aria-pressed={isActive}
                    className={cn(
                      "focus-ring rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all",
                      isActive
                        ? "border-green-bright bg-green-primary/20 text-green-light shadow-[0_0_8px_rgba(34,197,94,0.3)]"
                        : "border-border-line bg-surface-elevated/40 text-text-secondary hover:border-green-primary/50 hover:text-white"
                    )}
                  >
                    {srv.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Theater & Fullscreen controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsTheater((t) => !t)}
              title={isTheater ? "Default view" : "Theater mode"}
              aria-label={isTheater ? "Default view" : "Theater mode"}
              className={cn(
                "hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-border-line px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-green-primary/50 hover:text-white",
                isTheater && "border-green-bright bg-green-primary/20 text-green-light font-bold"
              )}
            >
              <RectangleHorizontal className="h-4 w-4" />
              <span>{isTheater ? "Normal" : "Theater"}</span>
            </button>
            <button
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-line px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-green-primary/50 hover:text-white"
            >
              {isFullscreen ? (
                <>
                  <Minimize className="h-4 w-4" />
                  <span className="hidden sm:inline">Exit</span>
                </>
              ) : (
                <>
                  <Maximize className="h-4 w-4" />
                  <span className="hidden sm:inline">Fullscreen</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── Sub-states ──────────────────────────────────────────────────────────────

function LoadingState({ episodeTitle }: { episodeTitle: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/90 text-center">
      <Loader2 className="h-10 w-10 animate-spin text-green-bright" />
      <p className="text-sm font-medium text-text-secondary">
        Loading&nbsp;
        <span className="text-white">{episodeTitle}</span>
        &hellip;
      </p>
    </div>
  );
}

function UnavailableState() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/90 px-6 text-center">
      <WifiOff className="h-12 w-12 text-text-muted" />
      <div>
        <p className="text-base font-semibold text-white">
          Video source unavailable
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          Please try another server or episode.
        </p>
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/90 px-6 text-center">
      <ServerCrash className="h-12 w-12 text-text-muted" />
      <div>
        <p className="text-base font-semibold text-white">
          Playback unavailable
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          Could not reach the stream server. Check your connection and try
          again.
        </p>
      </div>
      <button
        onClick={onRetry}
        className="focus-ring mt-1 flex items-center gap-2 rounded-lg border border-border-line bg-surface px-4 py-2 text-sm font-medium text-white transition-colors hover:border-green-primary/50 hover:text-green-light"
      >
        <RefreshCw className="h-4 w-4" />
        Retry
      </button>
    </div>
  );
}

// ─── EmbedFrame with load-timeout detection ──────────────────────────────────
//
// Cross-origin iframes cannot propagate internal load failures (e.g. "connection
// was reset") to the parent page. What we CAN observe from the parent is whether
// the iframe's onload event fires within a reasonable window.
//
// Strategy:
//   • Start a 28-second timeout when the iframe mounts (or its src changes).
//   • If onload fires before the timeout → success; cancel the timer.
//   • If the timeout fires before onload → the provider likely failed to serve
//     the embed. Call onLoadTimeout so the parent can re-fetch a fresh URL.
//   • 28 s is longer than a typical browser TCP connection timeout (~20 s) but
//     short enough that users aren't left staring at a blank frame indefinitely.
//   • A successful onload does NOT guarantee the video plays; that determination
//     is entirely inside the cross-origin provider and outside our reach.

const IFRAME_LOAD_TIMEOUT_MS = 28_000;

function EmbedFrame({
  embed,
  title,
  onLoadTimeout,
}: {
  embed: string;
  title: string;
  onLoadTimeout: () => void;
}) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRef = useRef(false);

  // Stable ref so the timeout closure always calls the latest callback
  // without the embed-change effect needing to depend on it.
  const onLoadTimeoutRef = useRef(onLoadTimeout);
  useEffect(() => {
    onLoadTimeoutRef.current = onLoadTimeout;
  }, [onLoadTimeout]);

  useEffect(() => {
    // Reset loaded flag each time the embed URL changes (retry or server switch)
    loadedRef.current = false;

    timeoutRef.current = setTimeout(() => {
      if (!loadedRef.current) {
        onLoadTimeoutRef.current();
      }
    }, IFRAME_LOAD_TIMEOUT_MS);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [embed]); // intentionally only re-runs when the embed URL changes

  const handleLoad = useCallback(() => {
    loadedRef.current = true;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  return (
    <iframe
      src={embed}
      title={title}
      className="absolute inset-0 h-full w-full border-0"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
      allowFullScreen
      // @ts-expect-error legacy browser attributes
      webkitallowfullscreen="true"
      mozallowfullscreen="true"
      loading="eager"
      referrerPolicy="no-referrer-when-downgrade"
      onLoad={handleLoad}
    />
  );
}
