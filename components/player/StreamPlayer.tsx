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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseValidServers(results: StreamItem[]): ValidServer[] {
  return results
    .filter((r) => isValidEmbedUrl(r.embed))
    .map((r, i) => {
      // Use the API's own server name when it's meaningful (not a generic options-N id)
      let label = r.server || "";
      if (!label || /^options-\d+$/.test(label)) {
        // Fall back to position-based names for anonymous servers
        label = i === 0 ? "Server 1 (Primary)" : `Server ${i + 1}`;
      }
      return {
        label,
        embed: r.embed,
      };
    });
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
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
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
    fetchStreams();
  }, [fetchStreams]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-col gap-3 transition-all duration-200",
        isTheater && "relative z-30 lg:-mx-16 xl:-mx-28",
        isFullscreen && "fixed inset-0 z-50 h-screen w-screen bg-black p-0"
      )}
    >
      <div
        className={cn(
          "relative w-full overflow-hidden bg-black transition-all",
          isFullscreen
            ? "h-full w-full rounded-none border-0"
            : isTheater
            ? "aspect-video max-h-[90vh] w-full rounded-xl border border-border-line shadow-2xl"
            : "aspect-video max-h-[90vh] w-full rounded-xl border border-border-line shadow-2xl"
        )}
      >
        {state === "loading" && <LoadingState episodeTitle={episodeTitle} />}
        {state === "error" && <ErrorState onRetry={fetchStreams} />}
        {state === "unavailable" && <UnavailableState />}
        {state === "ready" && activeServer && (
          <EmbedFrame embed={activeServer.embed} title={episodeTitle} />
        )}
      </div>

      {/* Control bar: Servers + Theater & Fullscreen Actions */}
      {state === "ready" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-line bg-surface px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
              <Server className="h-3.5 w-3.5 text-green-bright" />
              <span>Server:</span>
            </div>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Select streaming server"
            >
              {servers.map((srv) => {
                const isActive = srv.embed === activeServer?.embed;
                return (
                  <button
                    key={srv.embed}
                    onClick={() => setActiveServer(srv)}
                    aria-pressed={isActive}
                    className={cn(
                      "focus-ring rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm",
                      isActive
                        ? "border-green-bright bg-green-primary/20 text-green-light font-bold"
                        : "border-border-line bg-surface-elevated/40 text-text-secondary hover:border-green-primary/50 hover:text-white"
                    )}
                  >
                    {srv.label}
                  </button>
                );
              })}
            </div>
          </div>

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

function EmbedFrame({ embed, title }: { embed: string; title: string }) {
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
      // Allow scripts, same-origin storage (needed by gdmirrorbot/plyr for localStorage),
      // user-activated top navigation (needed by some player auth flows),
      // popups (needed by some players), forms, and fullscreen presentation.
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation allow-pointer-lock allow-top-navigation-by-user-activation allow-storage-access-by-user-activation"
    />
  );
}
