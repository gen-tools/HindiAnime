"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Hls from "hls.js";
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
  id: string;
  label: string;
  embed: string;
  url?: string;
  type: "hls" | "mp4" | "embed";
  isDirect: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse raw stream results into up to 3 deduped ValidServer entries.
 *  The stream-proxy already returns them in the correct priority order:
 *  Server 1 = AnimeSalt embed (multi-language), Server 2/3 = HLS direct streams. */
function parseServers(results: StreamItem[]): ValidServer[] {
  const servers: ValidServer[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < results.length && servers.length < 3; i++) {
    const item = results[i];
    const isDirect = (item.type === "hls" || item.type === "mp4") && Boolean(item.url || item.embed);
    const streamUrl = item.url || item.embed;

    if (!streamUrl || typeof streamUrl !== "string") continue;
    if (seen.has(streamUrl)) continue;
    if (!isValidEmbedUrl(streamUrl)) continue;

    seen.add(streamUrl);
    const finalType: "hls" | "mp4" | "embed" = isDirect ? (item.type as "hls" | "mp4") : "embed";
    servers.push({
      id: `${finalType}-${i}-${streamUrl}`,
      label: `Server ${servers.length + 1}`,
      embed: streamUrl,
      url: isDirect ? streamUrl : undefined,
      type: finalType,
      isDirect,
    });
  }

  return servers;
}

// ─── Auto-retry guard ─────────────────────────────────────────────────────────

const MAX_AUTO_RETRIES = 2;

function getRetryCount(key: string): number {
  try { return parseInt(sessionStorage.getItem(key) ?? "0", 10) || 0; } catch { return 0; }
}

function incrementRetryCount(key: string): number {
  try {
    const next = getRetryCount(key) + 1;
    sessionStorage.setItem(key, String(next));
    return next;
  } catch { return MAX_AUTO_RETRIES; }
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
  const [reloadKey, setReloadKey] = useState(0);
  const [isReloading, setIsReloading] = useState(false);
  const [showTroubleHint, setShowTroubleHint] = useState(false);
  const playerFrameRef = useRef<HTMLDivElement>(null);
  const hideExitTimerRef = useRef<NodeJS.Timeout | null>(null);

  const retryKey = `hindianime_retry_${animeSlug}_s${season}_e${episode}`;

  useEffect(() => {
    if (state !== "ready") { setShowTroubleHint(false); return; }
    const t = setTimeout(() => setShowTroubleHint(true), 5000);
    return () => clearTimeout(t);
  }, [state, reloadKey]);

  const handleReload = useCallback(() => {
    setIsReloading(true);
    setShowTroubleHint(false);
    setReloadKey((k) => k + 1);
    setTimeout(() => setIsReloading(false), 600);
  }, []);

  const triggerShowExit = useCallback(() => {
    setShowExitButton(true);
    if (hideExitTimerRef.current) clearTimeout(hideExitTimerRef.current);
    hideExitTimerRef.current = setTimeout(() => setShowExitButton(false), 3000);
  }, []);

  const cancelHideExit = useCallback(() => {
    if (hideExitTimerRef.current) { clearTimeout(hideExitTimerRef.current); hideExitTimerRef.current = null; }
  }, []);

  useEffect(() => {
    function onFsChange() {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      if (!active) {
        setShowExitButton(false);
        if (hideExitTimerRef.current) { clearTimeout(hideExitTimerRef.current); hideExitTimerRef.current = null; }
      }
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    const onMouseMove = (e: MouseEvent) => {
      if (e.clientY >= window.innerHeight - 100) triggerShowExit();
      else if (e.clientY < window.innerHeight - 160) setShowExitButton(false);
    };
    window.addEventListener("mousemove", onMouseMove);
    return () => { window.removeEventListener("mousemove", onMouseMove); if (hideExitTimerRef.current) clearTimeout(hideExitTimerRef.current); };
  }, [isFullscreen, triggerShowExit]);

  const toggleFullscreen = useCallback(async () => {
    const el = playerFrameRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) await el.requestFullscreen();
      else await document.exitFullscreen();
    } catch (err) { console.warn("Fullscreen toggle error:", err); }
  }, []);

  const fetchStreams = useCallback(async () => {
    setState("loading");
    setServers([]);
    setActiveServer(null);
    try {
      const res = await fetch(
        `/api/stream-proxy?id=${encodeURIComponent(animeSlug)}&season=${season}&ep=${episode}`
      );
      if (!res.ok) { setState("error"); return; }
      const data = await res.json();
      const parsed = parseServers(data?.results ?? []);
      if (parsed.length === 0) {
        setState("unavailable");
      } else {
        setServers(parsed);
        setActiveServer(parsed[0]);
        setState("ready");
      }
    } catch {
      setState("error");
    }
  }, [animeSlug, season, episode]);

  useEffect(() => {
    const t = window.setTimeout(fetchStreams, 0);
    return () => window.clearTimeout(t);
  }, [fetchStreams]);

  const handleIframeLoadTimeout = useCallback(() => {
    const count = incrementRetryCount(retryKey);
    if (count <= MAX_AUTO_RETRIES) {
      fetchStreams();
    } else {
      setState("error");
    }
  }, [fetchStreams, retryKey]);

  const handleDirectPlaybackError = useCallback(() => {
    // On direct stream failure, try to fall back to the next server (or the embed)
    setServers((prev) => {
      const idx = prev.findIndex((s) => s.id === activeServer?.id);
      const next = prev[idx + 1] || prev.find((s) => !s.isDirect) || null;
      if (next) setActiveServer(next);
      else setState("error");
      return prev;
    });
  }, [activeServer]);

  const handleServerSelect = useCallback((server: ValidServer) => {
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
          <>
            {activeServer.type === "hls" && activeServer.url ? (
              <HlsPlayer
                key={activeServer.id}
                url={activeServer.url}
                title={episodeTitle}
                reloadKey={reloadKey}
                onError={handleDirectPlaybackError}
              />
            ) : activeServer.type === "mp4" && activeServer.url ? (
              <Mp4Player
                key={activeServer.id}
                url={activeServer.url}
                title={episodeTitle}
                reloadKey={reloadKey}
                onError={handleDirectPlaybackError}
              />
            ) : (
              <EmbedFrame
                key={activeServer.id}
                embed={activeServer.embed}
                title={episodeTitle}
                reloadKey={reloadKey}
                onLoadTimeout={handleIframeLoadTimeout}
              />
            )}
            {showTroubleHint && !isFullscreen && (
              <div className="absolute top-3 right-3 z-30">
                <button
                  type="button"
                  onClick={handleReload}
                  title="Reload player if screen is stuck or showing error"
                  className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-black/85 px-2.5 py-1.5 text-xs font-medium text-white shadow-xl backdrop-blur-md transition-all hover:border-green-bright hover:bg-black hover:text-green-light active:scale-95"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5 text-green-bright", isReloading && "animate-spin")} />
                  <span>Reload Player</span>
                </button>
              </div>
            )}
          </>
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

      {/* Control bar: Server row on top, Audio Languages row underneath */}
      {state === "ready" && !isFullscreen && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-border-line bg-surface p-3 sm:px-4 sm:py-3">
          {/* Top row: Server button + Reload + Theater & Fullscreen */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Server selector */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
                <Server className="h-3.5 w-3.5 text-green-bright" />
                <span>Server:</span>
              </div>
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Streaming server">
                {servers.map((srv) => {
                  const isActive = srv.id === activeServer?.id;
                  return (
                    <button
                      key={srv.id}
                      type="button"
                      onClick={() => handleServerSelect(srv)}
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
                <button
                  type="button"
                  onClick={handleReload}
                  title="Reload video player without refreshing the page"
                  className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-border-line bg-surface-elevated/40 px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-all hover:border-green-primary/50 hover:bg-green-primary/10 hover:text-green-light active:scale-95"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", isReloading && "animate-spin text-green-bright")} />
                  <span>Reload</span>
                </button>
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

const IFRAME_LOAD_TIMEOUT_MS = 12_000;

function EmbedFrame({
  embed,
  title,
  reloadKey,
  onLoadTimeout,
}: {
  embed: string;
  title: string;
  reloadKey: number;
  onLoadTimeout: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRef = useRef(false);

  const onLoadTimeoutRef = useRef(onLoadTimeout);
  useEffect(() => { onLoadTimeoutRef.current = onLoadTimeout; }, [onLoadTimeout]);

  useEffect(() => {
    loadedRef.current = false;
    timeoutRef.current = setTimeout(() => {
      if (!loadedRef.current) onLoadTimeoutRef.current();
    }, IFRAME_LOAD_TIMEOUT_MS);
    return () => { if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; } };
  }, [embed, reloadKey]);

  // Block popup ads from embed scripts
  useEffect(() => {
    const orig = window.open;
    window.open = () => null;
    return () => { window.open = orig; };
  }, []);

  const handleLoad = useCallback(() => {
    loadedRef.current = true;
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
  }, []);

  const srcUrl =
    reloadKey > 0
      ? embed.includes("?")
        ? `${embed}&_r=${reloadKey}`
        : `${embed}?_r=${reloadKey}`
      : embed;

  return (
    <iframe
      ref={iframeRef}
      key={`${embed}-${reloadKey}`}
      src={srcUrl}
      title={title}
      className="absolute inset-0 h-full w-full border-0"
      sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
      allowFullScreen
      // @ts-expect-error legacy browser attributes
      webkitallowfullscreen="true"
      mozallowfullscreen="true"
      loading="eager"
      referrerPolicy="no-referrer"
      onLoad={handleLoad}
    />
  );
}

// ─── Native / HLS.js Player ──────────────────────────────────────────────────

function HlsPlayer({
  url,
  title,
  reloadKey,
  onError,
}: {
  url: string;
  title: string;
  reloadKey: number;
  onError: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls | null = null;
    let networkRetries = 0;

    const timeout = setTimeout(() => {
      console.warn("[HlsPlayer] HLS stream loading timed out");
      onErrorRef.current();
    }, 15_000);

    const handleCanPlay = () => {
      clearTimeout(timeout);
    };

    video.addEventListener("canplay", handleCanPlay);

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Native HLS support (Safari, iOS Safari)
      video.src = url;
      video.play().catch(() => {});
    } else if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
      });

      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          console.warn("[HlsPlayer] Fatal HLS error:", data.type, data.details);
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 1) {
            networkRetries++;
            hls?.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls?.recoverMediaError();
          } else {
            clearTimeout(timeout);
            hls?.destroy();
            onErrorRef.current();
          }
        }
      });
    } else {
      clearTimeout(timeout);
      onErrorRef.current();
    }

    return () => {
      clearTimeout(timeout);
      video.removeEventListener("canplay", handleCanPlay);
      if (hls) {
        hls.destroy();
        hls = null;
      }
    };
  }, [url, reloadKey]);

  return (
    <video
      ref={videoRef}
      title={title}
      className="absolute inset-0 h-full w-full bg-black object-contain"
      controls
      autoPlay
      playsInline
      onError={() => onErrorRef.current()}
    />
  );
}

// ─── Native MP4 Player ───────────────────────────────────────────────────────

function Mp4Player({
  url,
  title,
  reloadKey,
  onError,
}: {
  url: string;
  title: string;
  reloadKey: number;
  onError: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const timeout = setTimeout(() => {
      console.warn("[Mp4Player] MP4 stream loading timed out");
      onErrorRef.current();
    }, 15_000);

    const handleCanPlay = () => {
      clearTimeout(timeout);
    };

    video.addEventListener("canplay", handleCanPlay);
    video.play().catch(() => {});

    return () => {
      clearTimeout(timeout);
      video.removeEventListener("canplay", handleCanPlay);
    };
  }, [url, reloadKey]);

  return (
    <video
      key={`${url}-${reloadKey}`}
      ref={videoRef}
      src={url}
      title={title}
      className="absolute inset-0 h-full w-full bg-black object-contain"
      controls
      autoPlay
      playsInline
      onError={() => onErrorRef.current()}
    />
  );
}

