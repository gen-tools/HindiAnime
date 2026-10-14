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
  PictureInPicture2,
} from "lucide-react";
import { StreamItem } from "@/types/api";
import { isValidEmbedUrl } from "@/lib/api/client";
import { ALLOWED_WORKER_HOSTS, DEFAULT_WORKER_BASE_URL } from "@/lib/api/worker-config";
import { buildAnimeSaltEpisodeCandidates, buildAnimeSaltMovieUrl } from "@/lib/animesalt-stream";
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

  for (let i = 0; i < results.length && servers.length < 9; i++) {
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
    let isWorkerProxy = false;
    try {
      const streamHost = new URL(streamUrl).hostname.toLowerCase();
      isWorkerProxy =
        streamHost === "proxy.hindi-anime.com" ||
        streamHost === "cloud.hindi-anime.com" ||
        streamHost.endsWith(".workers.dev");
    } catch {
      // Relative application API URLs are handled separately below.
    }
    const isOwnProxy = streamUrl.startsWith("/api/") || isWorkerProxy;
    const isAllowedRubyServer4 = (() => {
      if (
        item.server !== "Server 4" ||
        item.type !== "embed" ||
        item.audioLanguage?.toLowerCase() !== "hi" ||
        !item.label?.includes("Hindi Dub (Toko Alt)")
      ) return false;
      try {
        const url = new URL(streamUrl);
        return url.protocol === "https:" && url.hostname.toLowerCase() === "rubystm.com" &&
          /^\/e\/[a-z0-9]+\.html$/i.test(url.pathname);
      } catch {
        return false;
      }
    })();
    if (!isOwnProxy && !isAllowedRubyServer4 && !isValidEmbedUrl(streamUrl)) continue;

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

function isAbortError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError"
  );
}

function abortPlaybackRequest(controller: AbortController | null, message: string) {
  if (!controller || controller.signal.aborted) return;
  controller.abort(new DOMException(message, "AbortError"));
}

function parseStreamResponse(text: string): { results?: StreamItem[] } | null {
  try {
    const parsed = JSON.parse(text) as { results?: StreamItem[] };
    if (Array.isArray(parsed.results)) return parsed;
  } catch {
    // The POST stream can contain multiple newline-delimited snapshots.
  }
  let latest: { results?: StreamItem[] } | null = null;
  for (const line of text.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    try {
      const parsed = JSON.parse(line) as { results?: StreamItem[] };
      if (Array.isArray(parsed.results)) latest = parsed;
    } catch {
      // Ignore incomplete or non-JSON stream lines.
    }
  }
  return latest;
}

function hasAnimeSaltResult(data: { results?: StreamItem[] } | null): boolean {
  return Boolean(data?.results?.some((item) =>
    /animesalt|mystream|abyss/i.test(`${item.server || ""} ${item.label || ""} ${item.embed || ""}`)
  ));
}

// Stream aggregation runs through /api/stream-proxy. If its server-side
// AnimeSalt fetch is missing, the browser fetches AnimeSalt through the public
// Worker proxy and submits the HTML back to that same route for parsing.

// ─── Component ───────────────────────────────────────────────────────────────

export function StreamPlayer({
  animeSlug,
  season,
  episode,
  episodeTitle,
  isMovie = false,
}: {
  animeSlug: string;
  season: number;
  episode: number;
  episodeTitle: string;
  isMovie?: boolean;
  languages?: string[];
}) {
  const playbackIdentity = `${animeSlug}:s${season}:e${episode}`;
  const playbackIdentityRef = useRef(playbackIdentity);
  playbackIdentityRef.current = playbackIdentity;
  const requestGenerationRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);

  const [state, setState] = useState<PlayerState>("loading");
  const [servers, setServers] = useState<ValidServer[]>([]);
  const [activeServer, setActiveServer] = useState<ValidServer | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pictureInPictureSupported, setPictureInPictureSupported] = useState(false);
  const [isPictureInPicture, setIsPictureInPicture] = useState(false);
  const [showExitButton, setShowExitButton] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const playerFrameRef = useRef<HTMLDivElement>(null);
  const hideExitTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setPictureInPictureSupported(document.pictureInPictureEnabled);
  }, []);

  useEffect(() => {
    const video = playerFrameRef.current?.querySelector("video");
    if (!video) {
      setIsPictureInPicture(false);
      return;
    }

    const onEnter = () => setIsPictureInPicture(true);
    const onLeave = () => setIsPictureInPicture(false);
    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, [activeServer?.id, state]);

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

  const togglePictureInPicture = useCallback(async () => {
    const video = playerFrameRef.current?.querySelector("video");
    if (!video || !document.pictureInPictureEnabled) return;

    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (error) {
      console.warn("Picture-in-picture toggle error:", error);
    }
  }, []);

  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStreams = useCallback(async (isRetry = false) => {
    abortPlaybackRequest(requestControllerRef.current, "Playback request superseded");
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const requestGeneration = ++requestGenerationRef.current;
    const requestIdentity = playbackIdentity;
    const isCurrentRequest = () =>
      !controller.signal.aborted &&
      requestGenerationRef.current === requestGeneration &&
      playbackIdentityRef.current === requestIdentity;

    if (!isRetry) {
      setState("loading");
      setServers([]);
      setActiveServer(null);
    }

    const qs = `?id=${encodeURIComponent(animeSlug)}&season=${season}&ep=${episode}`;

    try {
      // Start with the server-side aggregator, then use the browser Worker
      // fallback below if the server response has no AnimeSalt source.
      let data: { results?: StreamItem[] } | null = null;

      try {
        const res = await fetch(`/api/stream-proxy${qs}`, { signal: controller.signal });
        if (res.ok) {
          data = parseStreamResponse(await res.text());
        }
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) return;
      }

      // Production server egress can fail to retrieve AnimeSalt while the same
      // Worker endpoint is reachable from the viewer's browser. Use the existing
      // POST route to parse that browser-fetched HTML and merge it with Toko.
      if (!isCurrentRequest()) return;
      if (!hasAnimeSaltResult(data)) {
        const configuredWorkerUrl = (process.env.NEXT_PUBLIC_CF_PROXY_URL || DEFAULT_WORKER_BASE_URL).trim();
        let workerOrigin: string | null = null;
        try {
          const parsed = new URL(configuredWorkerUrl.split("?")[0].replace(/\/+$/, ""));
          if (parsed.protocol === "https:" && ALLOWED_WORKER_HOSTS.has(parsed.hostname)) workerOrigin = parsed.origin;
        } catch {
          // Keep the initial server-side results if public Worker configuration is invalid.
        }

        const animeSaltTargets = isMovie
          ? [buildAnimeSaltMovieUrl(animeSlug)]
          : buildAnimeSaltEpisodeCandidates(animeSlug, season, episode);

        if (workerOrigin) {
          for (const targetUrl of animeSaltTargets) {
            try {
              const workerUrl = new URL("/", workerOrigin);
              workerUrl.searchParams.set("url", targetUrl);
              const htmlResponse = await fetch(workerUrl, {
                signal: controller.signal,
                cache: "no-store",
                headers: { Accept: "text/html" },
              });
              if (!htmlResponse.ok || !(htmlResponse.headers.get("content-type") || "").toLowerCase().includes("text/html")) continue;

              const animeSaltHtml = await htmlResponse.text();
              if (new TextEncoder().encode(animeSaltHtml).byteLength > 512 * 1024) continue;

              const parsedResponse = await fetch("/api/stream-proxy", {
                method: "POST",
                signal: controller.signal,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  id: animeSlug,
                  season,
                  ep: episode,
                  isMovie,
                  animeSaltTargetUrl: targetUrl,
                  animeSaltHtml,
                }),
              });
              if (!parsedResponse.ok) continue;
              const parsedData = parseStreamResponse(await parsedResponse.text());
              if (hasAnimeSaltResult(parsedData)) {
                data = parsedData;
                break;
              }
            } catch (error) {
              if (isAbortError(error) || controller.signal.aborted) return;
              // Try the next supported AnimeSalt episode alias.
            }
          }
        }
      }

      if (!isCurrentRequest()) return;
      const parsed = parseServers(data?.results ?? []);
      if (parsed.length === 0) {
        if (!isRetry) {
          retryTimerRef.current = setTimeout(() => { fetchStreams(true); }, 1500);
          return;
        }
        setState("unavailable");
      } else {
        const currentEmbed = activeServerRef.current?.embed;
        const stillAvailable = currentEmbed
          ? parsed.find((server) => server.embed === currentEmbed)
          : undefined;
        setServers(parsed);
        setActiveServer(stillAvailable || parsed[0]);
        setState("ready");
      }
    } catch (error) {
      if (isAbortError(error)) return;
      if (!isCurrentRequest()) return;
      if (!isRetry) {
        retryTimerRef.current = setTimeout(() => {
          if (isCurrentRequest()) void fetchStreams(true);
        }, 1500);
        return;
      }
      setState("error");
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    }
  }, [animeSlug, season, episode, playbackIdentity, isMovie]);


  useEffect(() => {
    const t = window.setTimeout(() => { void fetchStreams(false); }, 0);
    return () => {
      window.clearTimeout(t);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      requestGenerationRef.current += 1;
      const controller = requestControllerRef.current;
      requestControllerRef.current = null;
      abortPlaybackRequest(controller, "Playback request cleaned up");
    };
  }, [fetchStreams]);

  const serversRef = useRef<ValidServer[]>([]);
  serversRef.current = servers;
  const activeServerRef = useRef<ValidServer | null>(null);
  activeServerRef.current = activeServer;

  const handleDirectPlaybackError = useCallback(() => {
    // 1. If the current activeServer has a playable embed fallback (e.g. Vidmoly embed URL),
    // seamlessly convert it to an embed so the episode continues playing without error
    const current = activeServerRef.current;
    if (
      current &&
      current.embed &&
      isValidEmbedUrl(current.embed) &&
      !current.embed.includes(".m3u8") &&
      current.embed !== current.url
    ) {
      console.warn(`[StreamPlayer] Direct stream failed on ${current.label}, falling back to embed player`);
      setActiveServer((prev) => (prev ? { ...prev, type: "embed", isDirect: false } : null));
      setState("ready");
      return;
    }

    // 2. Otherwise auto-advance to the next server if alternatives exist
    const curServers = serversRef.current;
    if (curServers.length > 1) {
      console.warn(`[StreamPlayer] Direct stream failed, auto-advancing to next available server`);
      handleNextServer();
      return;
    }

    // 3. Only show error state if no fallback or other servers exist
    setState("error");
  }, [handleNextServer]);

  const handleServerSelect = useCallback((server: ValidServer) => {
    setActiveServer(server);
  }, []);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 transition-all duration-200"
      )}
    >
      <div
        ref={playerFrameRef}
        className={cn(
          "relative w-full overflow-hidden bg-black transition-all",
          isFullscreen
            ? "fixed inset-0 z-50 !h-screen !w-screen !max-h-none !aspect-auto rounded-none border-0"
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
                restrictNavigation={/mystream|animesalt/i.test(activeServer.label)}
              />
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

      {/* Control bar: Server select + Change Server + PiP & Fullscreen */}
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
                  className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-border-line bg-surface-elevated/40 px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-[color,background-color,border-color,transform] duration-200 hover:-translate-y-px hover:border-green-primary/50 hover:bg-green-primary/10 hover:text-green-light active:translate-y-0 active:scale-[0.98] cursor-pointer"
                >
                  <Server className="h-3.5 w-3.5 text-green-bright" />
                  <span>Change Server</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                title="Reload current player"
                className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-border-line bg-surface-elevated/40 px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-[color,background-color,border-color,transform] duration-200 hover:-translate-y-px hover:border-green-primary/50 hover:bg-green-primary/10 hover:text-green-light active:translate-y-0 active:scale-[0.98] cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5 text-green-bright" />
                <span>Reload</span>
              </button>
            </div>

            {/* Picture-in-picture & Fullscreen controls */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={togglePictureInPicture}
                disabled={!pictureInPictureSupported || state !== "ready" || activeServer?.type === "embed"}
                title={isPictureInPicture ? "Exit picture-in-picture" : "Picture-in-picture"}
                aria-label={isPictureInPicture ? "Exit picture-in-picture" : "Picture-in-picture"}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-line px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-green-primary/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <PictureInPicture2 className="h-4 w-4" />
                <span className="hidden sm:inline">PiP</span>
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
// Keep other provider embeds permissive. AnimeSalt embeds and MyStream use a
// sandbox that blocks popups and top-frame navigation while allowing scripts,
// media presentation, and fullscreen. This limits popup ads from those sources.
// We intentionally do NOT gate player health on the iframe `onload` event:
// cross-origin embeds initialize their video via deferred subresource/script
// loads whose completion the parent frame cannot observe, and a short
// onload-timeout falsely reports a reachable server as "Could not reach the
// stream server". A manual Reload is offered via the trouble hint instead.

function EmbedFrame({
  embed,
  title,
  reloadKey,
  restrictNavigation = false,
}: {
  embed: string;
  title: string;
  reloadKey: number;
  restrictNavigation?: boolean;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

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
      sandbox={restrictNavigation ? "allow-scripts allow-same-origin allow-presentation" : undefined}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
      allowFullScreen
      // @ts-expect-error legacy browser attributes
      webkitallowfullscreen="true"
      mozallowfullscreen="true"
      loading="eager"
      referrerPolicy="strict-origin-when-cross-origin"
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
          const isMediaRawUrl = Boolean(rawUrl && (rawUrl.includes(".m3u8") || rawUrl.includes("/hls") || rawUrl.includes(".mp4")));
          // Detect repeated fragment load errors (e.g. 403 on .ts segments)
          if (
            data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR ||
            data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT
          ) {
            fragErrorCount++;
            if (fragErrorCount >= 2) {
              console.warn("[HlsPlayer] Repeated fragment load error:", data.details);
              if (!triedRaw && isMediaRawUrl && rawUrl && rawUrl !== src) {
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
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !triedRaw && isMediaRawUrl && rawUrl && rawUrl !== src) {
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

