"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Hls from "hls.js";
import {
  Loader2,
  Play,
  WifiOff,
  ServerCrash,
  RefreshCw,
  Server,
  Maximize,
  Minimize,
  PictureInPicture2,
  Volume2,
  X,
} from "lucide-react";
import { HindiAnimePlayer } from "./HindiAnimePlayer";
import { StreamItem } from "@/types/api";
import { isValidEmbedUrl } from "@/lib/api/client";

const MAX_AUTOMATIC_STREAM_RETRIES = 2;
const STREAM_RETRY_BASE_DELAY_MS = 1_000;
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

type PlayerState = "idle" | "loading" | "ready" | "unavailable" | "error";

interface ValidServer {
  id: string;
  label: string;
  embed: string;
  url?: string;
  type: "hls" | "mp4" | "embed";
  isDirect: boolean;
  /** True when this is a direct HLS/MP4 stream — no ads, no iframe */
  adFree: boolean;
  languageSources?: NonNullable<StreamItem["languageSources"]>;
  displayLanguage?: string;
  restrictNavigation: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseServers(results: StreamItem[]): ValidServer[] {
  const servers: ValidServer[] = [];
  const seen = new Set<string>();
  const priority = (item: StreamItem) => {
    const provider = `${item.label || ""} ${item.source || ""} ${item.sourceProvider || ""} ${item.server || ""} ${item.embed || ""} ${item.url || ""}`;
    if (/my\s*stream|ravok/i.test(provider)) return 0;
    if (/google\s*drive|animahd/i.test(provider)) return 1;
    if (/play\s*zen/i.test(provider)) return 2;
    return 3;
  };
  const orderedResults = results
    .map((item, index) => ({ item, index }))
    .sort((a, b) => priority(a.item) - priority(b.item) || a.index - b.index);

  for (let i = 0; i < orderedResults.length && servers.length < 7; i++) {
    const { item } = orderedResults[i];
    const isDirect = (item.type === "hls" || item.type === "mp4") && Boolean(item.url || item.embed);
    // For direct streams: prefer item.url (the proxy URL), else fall back to item.embed (raw HLS/MP4)
    // For embeds: use item.embed directly
    const proxyUrl = isDirect ? (item.url || item.embed) : undefined;
    const rawEmbed = item.embed || item.url || "";
    const streamUrl = isDirect ? (proxyUrl || rawEmbed) : rawEmbed;

    if (!streamUrl || typeof streamUrl !== "string") continue;
    // Deduplicate on raw embed URL so the same raw source doesn't appear twice
    const dedupeKey = isDirect ? `direct:${streamUrl}` : `embed:${rawEmbed || streamUrl}`;
    if (seen.has(dedupeKey)) continue;

    // Same-origin backend proxy URLs are safe by construction. External
    // provider embeds still pass through the normal URL validator below.
    const isOwnProxy = streamUrl.startsWith("/api/") || streamUrl.includes("/hls-proxy");
    const isAllowedRubyEmbed = (() => {
      if (
        item.type !== "embed" ||
        !/rubyvidhub|hindi dub \(toko alt\)/i.test(item.label || "")
      ) return false;
      try {
        const url = new URL(streamUrl);
        return url.protocol === "https:" && url.hostname.toLowerCase() === "rubystm.com" &&
          /^\/e\/[a-z0-9]+\.html$/i.test(url.pathname);
      } catch {
        return false;
      }
    })();
    if (!isOwnProxy && !isAllowedRubyEmbed && !isValidEmbedUrl(streamUrl)) continue;

    seen.add(dedupeKey);
    const finalType: "hls" | "mp4" | "embed" = isDirect ? (item.type as "hls" | "mp4") : "embed";
    const serverNum = servers.length + 1;
    // Use the backend's language label if available, e.g. "🇮🇳 Hindi Dub · HLS"
    const providerLabel = item.label?.replace(/^Server\s+\d+\s*[·—:-]\s*/i, "").trim();
    const label = providerLabel
      ? `Server ${serverNum} · ${providerLabel}`
      : item.languageLabel
        ? `Server ${serverNum} — ${item.languageLabel}`
        : `Server ${serverNum}`;
    servers.push({
      id: `${finalType}-${i}-${dedupeKey}`,
      label,
      // embed: always hold the raw source URL (used by EmbedFrame and HLS fallback)
      embed: rawEmbed || streamUrl,
      url: isDirect ? streamUrl : undefined,
      type: finalType,
      isDirect,
      adFree: Boolean(item.adFree) || isDirect,
      languageSources: item.languageSources,
      displayLanguage: /mega\s*play/i.test(item.label || "")
        ? "Mega"
        : /vidmoly/i.test(item.label || "")
          ? "VidMoly"
          : item.languageSources?.length
        ? `Multi-Audio${item.languageLabel ? ` · ${item.languageLabel}` : ""}`
        : item.languageLabel || ({
            hi: "Hindi Dub",
            ta: "Tamil Dub",
            te: "Telugu Dub",
            en: "English",
            ja: "Japanese",
            fr: "French Dub",
          } as Record<string, string>)[item.audioLanguage || ""],
      restrictNavigation: /mystream/i.test(item.label || ""),
    });
  }

  return servers.map((server, index) => ({
    ...server,
    server: `Server ${index + 1}`,
    label: server.label || `Server ${index + 1}`,
  }));
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

function parseStreamResponse(text: string): { results?: StreamItem[]; byLanguage?: Record<string, { sources?: StreamItem[] }> } | null {
  try {
    const parsed = JSON.parse(text) as { results?: StreamItem[]; byLanguage?: Record<string, { sources?: StreamItem[] }> };
    if (Array.isArray(parsed.results)) return withLanguageSources(parsed);
  } catch {
    // The POST stream can contain multiple newline-delimited snapshots.
  }
  let latest: { results?: StreamItem[]; byLanguage?: Record<string, { sources?: StreamItem[] }> } | null = null;
  for (const line of text.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    try {
      const parsed = JSON.parse(line) as { results?: StreamItem[]; byLanguage?: Record<string, { sources?: StreamItem[] }> };
      if (Array.isArray(parsed.results)) latest = withLanguageSources(parsed);
    } catch {
      // Ignore incomplete or non-JSON stream lines.
    }
  }
  return latest;
}

function withLanguageSources(
  response: { results?: StreamItem[]; byLanguage?: Record<string, { sources?: StreamItem[] }> }
): { results?: StreamItem[]; byLanguage?: Record<string, { sources?: StreamItem[] }> } {
  const combined = [
    ...(response.results ?? []),
    ...Object.values(response.byLanguage ?? {}).flatMap((entry) => entry.sources ?? []),
  ];
  const seen = new Set<string>();
  return {
    ...response,
    results: combined.filter((item) => {
      const key = item.url || item.embed || `${item.server}:${item.label}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}



interface DocumentPictureInPictureController {
  window: Window | null;
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}

type PictureInPictureCapableWindow = Window & {
  documentPictureInPicture?: DocumentPictureInPictureController;
};

type WebkitPictureInPictureVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
};

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
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const [showExitButton, setShowExitButton] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const playerFrameRef = useRef<HTMLDivElement>(null);
  const embedPictureInPictureRef = useRef<Window | null>(null);
  const hideExitTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isLanguageMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsLanguageMenuOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isLanguageMenuOpen]);

  useEffect(() => {
    const video = playerFrameRef.current?.querySelector("video");
    if (!video) {
      setIsPictureInPicture(false);
      const embedPiP = (window as PictureInPictureCapableWindow).documentPictureInPicture;
      setPictureInPictureSupported(activeServer?.type === "embed" && Boolean(embedPiP));
      return;
    }

    const onEnter = () => setIsPictureInPicture(true);
    const onLeave = () => setIsPictureInPicture(false);
    const onWebkitModeChange = () => {
      const webkitMode = (video as WebkitPictureInPictureVideo & { webkitPresentationMode?: string })
        .webkitPresentationMode;
      setIsPictureInPicture(webkitMode === "picture-in-picture");
    };
    const webkitVideo = video as WebkitPictureInPictureVideo;
    const supportsWebkitPiP = Boolean(
      webkitVideo.webkitSupportsPresentationMode?.("picture-in-picture")
    );
    setPictureInPictureSupported(Boolean(document.pictureInPictureEnabled) || supportsWebkitPiP);
    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);
    video.addEventListener("webkitpresentationmodechanged", onWebkitModeChange);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
      video.removeEventListener("webkitpresentationmodechanged", onWebkitModeChange);
    };
  }, [activeServer?.id, activeServer?.type, state, reloadKey]);

  const handleNextServer = useCallback(() => {
    if (servers.length <= 1) return;
    if (embedPictureInPictureRef.current && !embedPictureInPictureRef.current.closed) {
      embedPictureInPictureRef.current.close();
      embedPictureInPictureRef.current = null;
    }
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
    try {
      if (activeServer?.type === "embed") {
        const activePiPWindow = embedPictureInPictureRef.current;
        if (activePiPWindow && !activePiPWindow.closed) {
          activePiPWindow.close();
          embedPictureInPictureRef.current = null;
          setIsPictureInPicture(false);
          return;
        }

        const controller = (window as PictureInPictureCapableWindow).documentPictureInPicture;
        const sourceFrame = playerFrameRef.current?.querySelector("iframe");
        if (!controller || !sourceFrame) return;

        const pipWindow = await controller.requestWindow({ width: 480, height: 270 });
        embedPictureInPictureRef.current = pipWindow;
        pipWindow.document.title = `${episodeTitle} — Hindi Anime`;
        pipWindow.document.documentElement.style.cssText = "width:100%;height:100%;background:#000";
        pipWindow.document.body.style.cssText = "width:100%;height:100%;margin:0;overflow:hidden;background:#000";
        const style = pipWindow.document.createElement("style");
        style.textContent = "*{box-sizing:border-box}iframe{display:block;width:100%;height:100%;border:0;background:#000}";
        pipWindow.document.head.append(style);

        const pipFrame = pipWindow.document.createElement("iframe");
        pipFrame.src = sourceFrame.src;
        pipFrame.title = episodeTitle;
        pipFrame.allow = sourceFrame.allow;
        pipFrame.allowFullscreen = true;
        pipFrame.referrerPolicy = sourceFrame.referrerPolicy;
        if (sourceFrame.hasAttribute("sandbox")) {
          pipFrame.setAttribute("sandbox", sourceFrame.getAttribute("sandbox") || "");
        }
        pipWindow.document.body.append(pipFrame);
        const originalEmbedUrl = sourceFrame.src;
        sourceFrame.src = "about:blank";
        pipWindow.addEventListener("pagehide", () => {
          embedPictureInPictureRef.current = null;
          if (sourceFrame.isConnected) sourceFrame.src = originalEmbedUrl;
          setIsPictureInPicture(false);
        }, { once: true });
        setIsPictureInPicture(true);
        return;
      }

      if (!video) return;
      const webkitVideo = video as WebkitPictureInPictureVideo;
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
        await video.requestPictureInPicture();
      } else if (webkitVideo.webkitSupportsPresentationMode?.("picture-in-picture")) {
        const isInWebkitPiP = (video as WebkitPictureInPictureVideo & { webkitPresentationMode?: string })
          .webkitPresentationMode === "picture-in-picture";
        webkitVideo.webkitSetPresentationMode?.(isInWebkitPiP ? "inline" : "picture-in-picture");
      } else {
        return;
      }
    } catch (error) {
      console.warn("Picture-in-picture toggle error:", error);
    }
  }, [activeServer, episodeTitle]);

  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStreams = useCallback(async (retryAttempt = 0) => {
    if (retryAttempt === 0 && retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    abortPlaybackRequest(requestControllerRef.current, "Playback request superseded");
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const requestGeneration = ++requestGenerationRef.current;
    const requestIdentity = playbackIdentity;
    const isCurrentRequest = () =>
      !controller.signal.aborted &&
      requestGenerationRef.current === requestGeneration &&
      playbackIdentityRef.current === requestIdentity;

    if (retryAttempt === 0) {
      setState("loading");
      setServers([]);
      setActiveServer(null);
    }

    const scheduleAutomaticRetry = () => {
      if (retryAttempt >= MAX_AUTOMATIC_STREAM_RETRIES) return false;
      const nextAttempt = retryAttempt + 1;
      const delay = STREAM_RETRY_BASE_DELAY_MS * 2 ** retryAttempt;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (isCurrentRequest()) void fetchStreams(nextAttempt);
      }, delay);
      return true;
    };

    try {
      // Keep the backend credential server-side; the Vercel route calls only
      // api.hindi-anime.com and refuses requests without KOYEB_AUTH_TOKEN.
      if (!isCurrentRequest()) return;
      const fallbackQs = `?id=${encodeURIComponent(animeSlug)}&season=${season}&ep=${episode}`;
      const response = await fetch(`/api/stream-proxy${fallbackQs}`, { signal: controller.signal });
      const data = response.ok ? parseStreamResponse(await response.text()) : null;
      if (!isCurrentRequest()) return;
      const parsed = parseServers(data?.results ?? []);
      if (parsed.length === 0) {
        if (scheduleAutomaticRetry()) return;
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
      if (scheduleAutomaticRetry()) return;
      setState("error");
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    }
  }, [animeSlug, season, episode, playbackIdentity, isMovie]);


  useEffect(() => {
    setState((current) => current === "loading" ? "idle" : current);
  }, []);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      requestGenerationRef.current += 1;
      const controller = requestControllerRef.current;
      requestControllerRef.current = null;
      abortPlaybackRequest(controller, "Playback request cleaned up");
    };
  }, [playbackIdentity]);

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
    if (embedPictureInPictureRef.current && !embedPictureInPictureRef.current.closed) {
      embedPictureInPictureRef.current.close();
      embedPictureInPictureRef.current = null;
    }
    setIsLanguageMenuOpen(false);
    setActiveServer(server);
  }, []);

  const handleLanguageSelect = useCallback((embed: string) => {
    setActiveServer((current) => {
      const source = current?.languageSources?.find((entry) => entry.embed === embed);
      return current && source
        ? { ...current, embed: source.embed }
        : current;
    });
    setIsLanguageMenuOpen(false);
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
        {state === "idle" && <IdleState onPlay={() => void fetchStreams(0)} />}
        {state === "loading" && <LoadingState episodeTitle={episodeTitle} />}
        {state === "error" && (
          <ErrorState
            onRetry={() => fetchStreams(0)}
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
              <HindiAnimePlayer
                key={activeServer.id}
                src={activeServer.url}
                animeTitle={episodeTitle || animeSlug.replace(/-/g, " ")}
                season={season}
                episode={episode}
                logoUrl="/hindi-anime-logo-transparent.png"
                autoPlay={true}
                className="w-full h-full !aspect-auto !rounded-none !border-0 !shadow-none"
                onError={(err) => {
                  console.warn("[HindiAnimePlayer] playback error:", err);
                }}
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
                key={`${activeServer.id}:${activeServer.embed}`}
                embed={activeServer.embed}
                title={episodeTitle}
                animeSlug={animeSlug}
                season={season}
                episode={episode}
                reloadKey={reloadKey}
                restrictNavigation={activeServer.restrictNavigation}
              />
            )}
</>
        )}
        {state === "ready" && activeServer && activeServer.type !== "hls" && (activeServer.languageSources?.length || 0) > 1 && (
          <>
            <button
              type="button"
              onClick={() => setIsLanguageMenuOpen((open) => !open)}
              aria-haspopup="dialog"
              aria-expanded={isLanguageMenuOpen}
              className="focus-ring absolute right-3 top-3 z-20 inline-flex min-h-8 items-center gap-1.5 rounded-md bg-green-bright px-3 text-xs font-semibold text-black shadow-lg transition hover:bg-green-light"
            >
              <Volume2 className="h-3.5 w-3.5" />
              {activeServer.languageSources?.find((source) => source.embed === activeServer.embed)?.label || "Audio"}
            </button>
            {isLanguageMenuOpen && (
              <div
                className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
                onClick={() => setIsLanguageMenuOpen(false)}
              >
                <section
                  role="dialog"
                  aria-modal="true"
                  aria-label="Audio selection"
                  className="w-full max-w-xs rounded-xl border border-green-primary/30 bg-[#111712] p-4 shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-green-light">Audio Selection</h2>
                    <button
                      type="button"
                      onClick={() => setIsLanguageMenuOpen(false)}
                      aria-label="Close audio selection"
                      className="focus-ring flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-white/10 hover:text-white"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {activeServer.languageSources?.map((source) => (
                      <button
                        key={`${source.code}:${source.embed}`}
                        type="button"
                        onClick={() => handleLanguageSelect(source.embed)}
                        aria-pressed={source.embed === activeServer.embed}
                        className={cn(
                          "focus-ring flex min-h-10 items-center justify-center gap-2 rounded-md border px-3 text-xs font-semibold transition-colors",
                          source.embed === activeServer.embed
                            ? "border-green-primary/60 bg-green-primary/20 text-green-light"
                            : "border-border-line bg-surface-elevated/50 text-text-primary hover:border-green-primary/50 hover:bg-green-primary/10"
                        )}
                      >
                        <Volume2 className="h-3.5 w-3.5 text-green-bright" />
                        {source.label}
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </>
        )}
        {isPictureInPicture && activeServer?.type === "embed" && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black px-4 text-center">
            <PictureInPicture2 className="h-8 w-8 text-green-bright" />
            <p className="text-sm text-text-secondary">Playing in the floating picture-in-picture window.</p>
            <button
              type="button"
              onClick={togglePictureInPicture}
              className="focus-ring min-h-11 rounded-lg border border-border-line px-4 text-sm font-semibold text-text-primary hover:border-green-primary/60 hover:text-green-light"
            >
              Return to player
            </button>
          </div>
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
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
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
                className="focus-ring min-h-11 min-w-0 flex-1 cursor-pointer rounded-lg border border-border-line bg-surface-elevated/60 px-2.5 text-xs font-semibold text-text-primary transition-colors hover:border-green-primary/50 hover:text-white sm:min-w-36 sm:flex-none"
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
                  className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border-line bg-surface-elevated/40 px-2.5 text-xs font-medium text-text-secondary transition-[color,background-color,border-color,transform] duration-200 hover:-translate-y-px hover:border-green-primary/50 hover:bg-green-primary/10 hover:text-green-light active:translate-y-0 active:scale-[0.98] cursor-pointer"
                >
                  <Server className="h-3.5 w-3.5 text-green-bright" />
                  <span>Change Server</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                title="Reload current player"
                className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border-line bg-surface-elevated/40 px-2.5 text-xs font-medium text-text-secondary transition-[color,background-color,border-color,transform] duration-200 hover:-translate-y-px hover:border-green-primary/50 hover:bg-green-primary/10 hover:text-green-light active:translate-y-0 active:scale-[0.98] cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5 text-green-bright" />
                <span>Reload</span>
              </button>
            </div>

            {/* Picture-in-picture & Fullscreen controls */}
            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              <button
                type="button"
                onClick={togglePictureInPicture}
                disabled={!pictureInPictureSupported || state !== "ready"}
                title={isPictureInPicture ? "Exit picture-in-picture" : "Picture-in-picture"}
                aria-label={isPictureInPicture ? "Exit picture-in-picture" : "Picture-in-picture"}
                aria-pressed={isPictureInPicture}
                className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border-line px-3 text-xs font-medium text-text-secondary transition-colors hover:border-green-primary/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <PictureInPicture2 className="h-4 w-4" />
                <span className="hidden sm:inline">PiP</span>
              </button>
              <button
                type="button"
                onClick={toggleFullscreen}
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border-line px-3 text-xs font-medium text-text-secondary transition-colors hover:border-green-primary/50 hover:text-white"
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

function IdleState({ onPlay }: { onPlay: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/90 text-center">
      <button
        type="button"
        onClick={onPlay}
        aria-label="Load video sources and play"
        className="focus-ring flex h-20 w-20 items-center justify-center rounded-full border border-green-primary/50 bg-green-primary text-white shadow-lg transition-transform hover:scale-105 hover:bg-green-hover active:scale-95"
      >
        <Play className="ml-1 h-9 w-9 fill-current" />
      </button>
      <div>
        <p className="text-base font-semibold text-white">Play video</p>
        <p className="mt-1 text-sm text-text-secondary">Click to load available servers</p>
      </div>
    </div>
  );
}

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
          No playable sources were returned for this episode. Try another episode.
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
  animeSlug,
  season,
  episode,
  reloadKey,
  restrictNavigation = false,
}: {
  embed: string;
  title: string;
  animeSlug?: string;
  season?: number;
  episode?: number;
  reloadKey: number;
  restrictNavigation?: boolean;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const srcUrl =
    reloadKey > 0
      ? embed.includes("?")
        ? `${embed}&_r=${reloadKey}`
        : `${embed}?_r=${reloadKey}`
      : embed;

  return (
    <div className="relative w-full h-full group">
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

      {/* Overlay Header: Logo + S01 E01 Badge on Left, Anime Name on Right (Clean Player Overlay) */}
      <div className="absolute top-0 left-0 right-0 p-3 sm:p-4 bg-gradient-to-b from-black/90 via-black/40 to-transparent flex items-center justify-between pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">
        {/* Left: Logo + Season/Episode Badge */}
        <div className="flex items-center gap-2 sm:gap-3 pointer-events-auto">
          <img
            src="/hindi-anime-logo-transparent.png"
            alt="Hindi Anime"
            className="h-6 sm:h-7 w-auto object-contain bg-transparent drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] filter"
          />
          {(season !== undefined || episode !== undefined) && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-green-500/40 text-[11px] sm:text-xs font-semibold text-white shadow-lg">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
              <span>
                {season ? `S${String(season).padStart(2, '0')}` : 'S01'}{' '}
                {episode ? `E${String(episode).padStart(2, '0')}` : 'E01'}
              </span>
            </div>
          )}
        </div>

        {/* Right: Anime Title */}
        <div className="flex items-center gap-2 sm:gap-3 pointer-events-auto">
          <span className="text-xs font-semibold text-white drop-shadow truncate max-w-[200px]">
            {animeSlug || title}
          </span>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────

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

