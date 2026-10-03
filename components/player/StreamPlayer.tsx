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
  /** True when this is a direct HLS/MP4 stream — no ads, no iframe */
  adFree: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseServers(results: StreamItem[]): ValidServer[] {
  const servers: ValidServer[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < results.length && servers.length < 8; i++) {
    const item = results[i];
    const isDirect = (item.type === "hls" || item.type === "mp4") && Boolean(item.url || item.embed);
    // For direct streams: prefer item.url (the proxy URL), else fall back to item.embed (raw HLS/MP4)
    // For embeds: use item.embed directly
    const proxyUrl = isDirect ? (item.url || item.embed) : undefined;
    const rawEmbed = item.embed || item.url || "";
    const streamUrl = isDirect ? (proxyUrl || rawEmbed) : rawEmbed;

    if (!streamUrl || typeof streamUrl !== "string") continue;
    // Deduplicate on raw embed URL so the same raw source doesn't appear twice
    const dedupeKey = rawEmbed || streamUrl;
    if (seen.has(dedupeKey)) continue;

    // Our own /api/ proxy URLs and Cloudflare Worker proxy URLs are safe by
    // construction — skip the external URL validator (which rejects root-path URLs).
    const isOwnProxy =
      streamUrl.startsWith("/api/") ||
      streamUrl.includes(".workers.dev");
    if (!isOwnProxy && !isValidEmbedUrl(streamUrl)) continue;

    seen.add(dedupeKey);
    const finalType: "hls" | "mp4" | "embed" = isDirect ? (item.type as "hls" | "mp4") : "embed";
    const serverNum = servers.length + 1;
    // Use the backend's language label if available, e.g. "🇮🇳 Hindi Dub · HLS"
    const label = item.label || (item.languageLabel
      ? `Server ${serverNum} — ${item.languageLabel}`
      : `Server ${serverNum}`);
    servers.push({
      id: `${finalType}-${i}-${dedupeKey}`,
      label,
      // embed: always hold the raw source URL (used by EmbedFrame and HLS fallback)
      embed: rawEmbed || streamUrl,
      url: isDirect ? streamUrl : undefined,
      type: finalType,
      isDirect,
      adFree: Boolean(item.adFree) || isDirect,
    });
  }

  return servers;
}

// CF Worker /stream endpoint — bypasses Vercel WAF which blocks /api/stream-proxy on production.
const CF_WORKER_BASE = (
  process.env.NEXT_PUBLIC_CF_PROXY_URL || "https://wispy-cherry-6934.shahazaibseo038.workers.dev"
)
  .replace(/\/\?url=$/, "")
  .replace(/\?url=$/, "")
  .replace(/\/$/, "");
const CF_STREAM_URL = `${CF_WORKER_BASE}/stream`;

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
  const playerFrameRef = useRef<HTMLDivElement>(null);
  const hideExitTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleNextServer = useCallback(() => {
    if (servers.length <= 1) return;
    const currentIndex = servers.findIndex((s) => s.id === activeServer?.id);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % servers.length;
    const next = servers[nextIndex];
    if (next) {
      console.info(`[StreamPlayer] Switching to next server: ${next.label}`);
      setActiveServer(next);
      setState("ready");
    }
  }, [servers, activeServer]);

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

  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStreams = useCallback(async (isRetry = false) => {
    if (!isRetry) {
      setState("loading");
      setServers([]);
      setActiveServer(null);
    }

    const qs = `?id=${encodeURIComponent(animeSlug)}&season=${season}&ep=${episode}`;

    // Try CF Worker first (not blocked by Vercel WAF), fall back to local API route
    const endpoints = [
      `${CF_STREAM_URL}${qs}`,
      `/api/stream-proxy${qs}`,
    ];

    try {
      let data: { results?: unknown[] } | null = null;

      for (const endpoint of endpoints) {
        try {
          const res = await fetch(endpoint);
          if (res.ok) {
            const json = await res.json();
            if (Array.isArray(json?.results) && json.results.length > 0) {
              data = json;
              break;
            }
          }
        } catch { /* try next endpoint */ }
      }

      const parsed = parseServers((data?.results ?? []) as import("@/types/api").StreamItem[]);
      if (parsed.length === 0) {
        if (!isRetry) {
          retryTimerRef.current = setTimeout(() => { fetchStreams(true); }, 1500);
          return;
        }
        setState("unavailable");
      } else {
        setServers(parsed);
        setActiveServer(parsed[0]);
        setState("ready");
      }
    } catch {
      if (!isRetry) {
        retryTimerRef.current = setTimeout(() => { fetchStreams(true); }, 1500);
        return;
      }
      setState("error");
    }
  }, [animeSlug, season, episode]);


  useEffect(() => {
    const t = window.setTimeout(() => fetchStreams(false), 0);
    return () => {
      window.clearTimeout(t);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [fetchStreams]);

  const serversRef = useRef<ValidServer[]>([]);
  serversRef.current = servers;
  const activeServerRef = useRef<ValidServer | null>(null);
  activeServerRef.current = activeServer;

  const handleDirectPlaybackError = useCallback(() => {
    // When direct playback fails or stream times out, show error state with Change Server button
    // (Never auto-switch server behind the user's back)
    setState("error");
  }, []);

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
        {state === "error" && (
          <ErrorState
            onRetry={() => fetchStreams(false)}
            onNextServer={handleNextServer}
            hasMoreServers={servers.length > 1}
          />
        )}
        {state === "unavailable" && (
          <UnavailableState
            onNextServer={handleNextServer}
            hasMoreServers={servers.length > 1}
          />
        )}
        {state === "ready" && activeServer && (
          <>
            {activeServer.type === "hls" && activeServer.url ? (
              <HlsPlayer
                key={activeServer.id}
                url={activeServer.url}
                rawUrl={activeServer.url !== activeServer.embed ? activeServer.embed : undefined}
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
              />
            )}
            {servers.length > 1 && !isFullscreen && (
              <div className="absolute top-3 right-3 z-30">
                <button
                  type="button"
                  onClick={handleNextServer}
                  title="Switch to next server if video is blank or not working"
                  className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-black/85 px-3 py-1.5 text-xs font-semibold text-white shadow-xl backdrop-blur-md transition-all hover:border-green-bright hover:bg-black hover:text-green-light active:scale-95 cursor-pointer"
                >
                  <Server className="h-3.5 w-3.5 text-green-bright" />
                  <span>Change Server</span>
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

      {/* Control bar: Server select + Change Server + Theater & Fullscreen */}
      {servers.length > 0 && state !== "loading" && !isFullscreen && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-border-line bg-surface p-3 sm:px-4 sm:py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Server dropdown */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
                <Server className="h-3.5 w-3.5 text-green-bright" />
                <span>Server:</span>
              </div>
              <select
                id="server-select"
                aria-label="Select streaming server"
                value={activeServer?.id ?? ""}
                onChange={(e) => {
                  const srv = servers.find((s) => s.id === e.target.value);
                  if (srv) handleServerSelect(srv);
                }}
                className="focus-ring rounded-lg border border-border-line bg-surface-elevated/60 px-2.5 py-1.5 text-xs font-semibold text-text-primary transition-colors hover:border-green-primary/50 hover:text-white cursor-pointer"
                style={{ minWidth: "9rem" }}
              >
                {servers.map((srv) => (
                  <option key={srv.id} value={srv.id}>
                    {srv.label}{srv.adFree ? " ⚡" : ""}
                  </option>
                ))}
              </select>
              {servers.length > 1 && (
                <button
                  type="button"
                  onClick={handleNextServer}
                  title="Switch to next server if video is blank or not working"
                  className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-border-line bg-surface-elevated/40 px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-all hover:border-green-primary/50 hover:bg-green-primary/10 hover:text-green-light active:scale-95 cursor-pointer"
                >
                  <Server className="h-3.5 w-3.5 text-green-bright" />
                  <span>Change Server</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                title="Reload current player"
                className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-border-line bg-surface-elevated/40 px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-all hover:border-green-primary/50 hover:bg-green-primary/10 hover:text-green-light active:scale-95 cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5 text-green-bright" />
                <span>Reload</span>
              </button>
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

function UnavailableState({
  onNextServer,
  hasMoreServers,
}: {
  onNextServer?: () => void;
  hasMoreServers?: boolean;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/90 px-6 text-center z-20">
      <WifiOff className="h-12 w-12 text-text-muted" />
      <div>
        <p className="text-base font-semibold text-white">
          Video source unavailable
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          Could not load this server. Please try switching to another server.
        </p>
      </div>
      {hasMoreServers && onNextServer && (
        <button
          onClick={onNextServer}
          className="focus-ring mt-1 flex items-center gap-2 rounded-lg bg-green-primary px-4 py-2 text-sm font-semibold text-white shadow-lg transition-all hover:bg-green-hover active:scale-95 cursor-pointer"
        >
          <Server className="h-4 w-4" />
          Change Server
        </button>
      )}
    </div>
  );
}

function ErrorState({
  onRetry,
  onNextServer,
  hasMoreServers,
}: {
  onRetry: () => void;
  onNextServer?: () => void;
  hasMoreServers?: boolean;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/90 px-6 text-center z-20">
      <ServerCrash className="h-12 w-12 text-text-muted" />
      <div>
        <p className="text-base font-semibold text-white">
          Playback unavailable
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          Could not reach the stream server or screen went blank. Try switching server.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
        {hasMoreServers && onNextServer && (
          <button
            onClick={onNextServer}
            className="focus-ring flex items-center gap-2 rounded-lg bg-green-primary px-4 py-2 text-sm font-semibold text-white shadow-lg transition-all hover:bg-green-hover active:scale-95 cursor-pointer"
          >
            <Server className="h-4 w-4" />
            Change Server
          </button>
        )}
        <button
          onClick={onRetry}
          className="focus-ring flex items-center gap-2 rounded-lg border border-border-line bg-surface px-4 py-2 text-sm font-medium text-white transition-colors hover:border-green-primary/50 hover:text-green-light cursor-pointer"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    </div>
  );
}

// ─── EmbedFrame ──────────────────────────────────────────────────────────────
//
// Embed providers (toonstream, AnimeSalt, etc.) are loaded without a `sandbox`
// attribute so they cannot detect us as an ad-blocker/sandbox environment.
// Popup ads are blocked at the JS level via the `window.open` override below.
// We intentionally do NOT gate player health on the iframe `onload` event:
// cross-origin embeds initialize their video via deferred subresource/script
// loads whose completion the parent frame cannot observe, and a short
// onload-timeout falsely reports a reachable server as "Could not reach the
// stream server". A manual Reload is offered via the trouble hint instead.

function EmbedFrame({
  embed,
  title,
  reloadKey,
}: {
  embed: string;
  title: string;
  reloadKey: number;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Block popup ads launched from the parent scope while the embed is mounted
  useEffect(() => {
    const orig = window.open;
    window.open = () => null;
    return () => { window.open = orig; };
  }, []);

  // Cache-bust only on manual reload so a stale embed is re-fetched; the
  // initial render always uses the original `embed` URL untouched.
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
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
      allowFullScreen
      // @ts-expect-error legacy browser attributes
      webkitallowfullscreen="true"
      mozallowfullscreen="true"
      loading="eager"
      referrerPolicy="no-referrer"
    />
  );
}

// ─── Native / HLS.js Player ──────────────────────────────────────────────────

function HlsPlayer({
  url,
  rawUrl,
  title,
  reloadKey,
  onError,
}: {
  url: string;
  /** Optional raw (non-proxied) HLS URL to try if the proxy URL fails */
  rawUrl?: string;
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
    let triedRaw = false;
    let fragErrorCount = 0;

    const timeout = setTimeout(() => {
      console.warn("[HlsPlayer] HLS stream loading timed out");
      onErrorRef.current();
    }, 6_000);

    const handleCanPlay = () => {
      clearTimeout(timeout);
    };

    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("playing", handleCanPlay);

    // Capture non-null reference for use inside nested functions
    // (TypeScript narrows only in the outer scope, not in closures)
    const v = video;

    function loadUrl(src: string) {
      if (v.canPlayType("application/vnd.apple.mpegurl")) {
        // Native HLS support (Safari, iOS Safari)
        v.src = src;
        v.play().catch(() => {});
      } else if (Hls.isSupported()) {
        if (hls) { hls.destroy(); hls = null; }
        hls = new Hls({ enableWorker: true });
        hls.loadSource(src);
        hls.attachMedia(v);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          v.play().catch(() => {});
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          // Detect repeated fragment load errors (e.g. 403 on .ts segments)
          if (
            data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR ||
            data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT
          ) {
            fragErrorCount++;
            if (fragErrorCount >= 2) {
              console.warn("[HlsPlayer] Repeated fragment load error:", data.details);
              if (!triedRaw && rawUrl && rawUrl !== src) {
                triedRaw = true;
                fragErrorCount = 0;
                console.info("[HlsPlayer] Falling back to raw URL:", rawUrl.substring(0, 60));
                loadUrl(rawUrl);
                return;
              }
              clearTimeout(timeout);
              hls?.destroy();
              onErrorRef.current();
              return;
            }
          }

          if (data.fatal) {
            console.warn("[HlsPlayer] Fatal HLS error:", data.type, data.details, "src:", src.substring(0, 60));
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !triedRaw && rawUrl && rawUrl !== src) {
              // Proxy failed — try the raw stream URL directly
              triedRaw = true;
              networkRetries = 0;
              fragErrorCount = 0;
              console.info("[HlsPlayer] Falling back to raw URL:", rawUrl.substring(0, 60));
              loadUrl(rawUrl);
            } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 1) {
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
    }

    loadUrl(url);

    return () => {
      clearTimeout(timeout);
      v.removeEventListener("canplay", handleCanPlay);
      v.removeEventListener("playing", handleCanPlay);
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

