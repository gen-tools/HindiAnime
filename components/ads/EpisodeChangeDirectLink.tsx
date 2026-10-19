"use client";

import { useEffect } from "react";

const DIRECT_LINK_URL =
  "https://www.profitableratecpmnetwork.com/dhkh9azm?key=cf159f5cc904cdf9a3b583e2b3108cc8";
const WATCH_EPISODE_PATH = /^\/watch\/([^/]+)\/([^/]+)\/?$/;

export function openEpisodeChangeDirectLink(): void {
  window.open(DIRECT_LINK_URL, "_blank", "noopener,noreferrer");
}

/** Open the direct-link ad only when a viewer switches episodes of the same anime. */
export function EpisodeChangeDirectLink() {
  useEffect(() => {
    const handleEpisodeChange = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.hasAttribute("download") || anchor.target === "_blank") return;

      if (anchor.dataset.directLinkAd === "true") {
        openEpisodeChangeDirectLink();
        return;
      }

      try {
        const destination = new URL(anchor.href, window.location.href);
        if (destination.origin !== window.location.origin) return;

        const currentMatch = window.location.pathname.match(WATCH_EPISODE_PATH);
        const destinationMatch = destination.pathname.match(WATCH_EPISODE_PATH);
        if (
          !currentMatch ||
          !destinationMatch ||
          currentMatch[1] !== destinationMatch[1] ||
          currentMatch[2] === destinationMatch[2]
        ) {
          return;
        }

        openEpisodeChangeDirectLink();
      } catch {
        // Ignore malformed or non-navigation links.
      }
    };

    document.addEventListener("click", handleEpisodeChange, true);
    return () => document.removeEventListener("click", handleEpisodeChange, true);
  }, []);

  return null;
}
