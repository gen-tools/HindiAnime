"use client";

import { useEffect } from "react";

export const WATCH_DIRECT_AD_URL =
  "https://www.profitableratecpmnetwork.com/dhkh9azm?key=cf159f5cc904cdf9a3b583e2b3108cc8";

/** Open the ad in a separate tab while allowing the watch navigation to continue. */
export function openWatchDirectAd(): void {
  if (typeof window === "undefined") return;
  window.open(WATCH_DIRECT_AD_URL, "_blank", "noopener,noreferrer");
  // Keep the anime site in front if the browser focuses the newly opened tab.
  window.focus();
}

/** Apply one direct-link ad to each deliberate click that opens a watch page. */
export function WatchDirectLinkAd() {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
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

      try {
        const destination = new URL(anchor.href, window.location.href);
        if (
          destination.origin === window.location.origin &&
          /^\/watch(?:\/|$)/.test(destination.pathname)
        ) {
          openWatchDirectAd();
        }
      } catch {
        // Ignore malformed or non-navigation links.
      }
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  return null;
}
