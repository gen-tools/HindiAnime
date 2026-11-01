"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { openAdLink } from "@/components/ads/adLinks";

const EXCLUDED_PATHS = ["/about", "/contact", "/dmca", "/privacy", "/terms"];

function isAdPage(pathname: string): boolean {
  if (pathname === "/watch" || pathname.startsWith("/watch/")) return false;
  return !EXCLUDED_PATHS.some(
    (excludedPath) => pathname === excludedPath || pathname.startsWith(`${excludedPath}/`)
  );
}

export function OnePerRouteAd() {
  const pathname = usePathname();
  const lastAdPath = useRef<string | null>(null);

  useEffect(() => {
    if (!isAdPage(pathname)) return;

    const handleInternalNavigation = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.hasAttribute("download") || anchor.target === "_blank") return;

      try {
        const destination = new URL(anchor.href, window.location.href);
        if (destination.origin !== window.location.origin) return;
        if (destination.pathname === window.location.pathname) return;
        if (!isAdPage(destination.pathname)) return;
        if (lastAdPath.current === pathname) return;

        // Count the attempt even when the browser blocks a new tab, so one
        // route visit never creates repeated popup attempts.
        lastAdPath.current = pathname;
        openAdLink();
      } catch {
        // Ignore malformed or non-navigation links.
      }
    };

    document.addEventListener("click", handleInternalNavigation, true);
    return () => document.removeEventListener("click", handleInternalNavigation, true);
  }, [pathname]);

  return null;
}
