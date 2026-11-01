"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function NavigationFeedbackInner() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const locationKey = `${pathname}?${searchParams.toString()}`;
  const [isPending, setIsPending] = useState(false);
  const pendingHref = useRef<string | null>(null);
  const pendingAnchor = useRef<HTMLAnchorElement | null>(null);
  const timeout = useRef<number | null>(null);
  const prefetchedHrefs = useRef(new Set<string>());

  const prefetchLink = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;

    let destination: URL;
    try {
      destination = new URL(anchor.href, window.location.href);
    } catch {
      return;
    }

    if (destination.origin !== window.location.origin) return;
    const href = `${destination.pathname}${destination.search}`;
    const currentHref = `${window.location.pathname}${window.location.search}`;
    if (href === currentHref || prefetchedHrefs.current.has(href)) return;

    // Prefetch only after the visitor signals intent, avoiding the many
    // background requests caused by prefetching every visible catalog card.
    prefetchedHrefs.current.add(href);
    if (prefetchedHrefs.current.size > 40) {
      const oldestHref = prefetchedHrefs.current.values().next().value;
      if (oldestHref) prefetchedHrefs.current.delete(oldestHref);
    }
    router.prefetch(href);
  }, [router]);

  useEffect(() => {
    const clearPending = () => {
      pendingHref.current = null;
      pendingAnchor.current?.removeAttribute("data-navigation-pending");
      pendingAnchor.current?.removeAttribute("aria-busy");
      pendingAnchor.current = null;
      if (timeout.current !== null) window.clearTimeout(timeout.current);
      timeout.current = null;
      setIsPending(false);
    };

    clearPending();
    return clearPending;
  }, [locationKey]);

  useEffect(() => {
    const handlePointerOver = (event: PointerEvent) => {
      if (event.pointerType === "mouse" || event.pointerType === "pen") {
        prefetchLink(event.target);
      }
    };
    const handlePointerDown = (event: PointerEvent) => prefetchLink(event.target);
    const handleClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented || event.button !== 0 || event.metaKey ||
        event.ctrlKey || event.shiftKey || event.altKey
      ) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      let destination: URL;
      try {
        destination = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      if (destination.origin !== window.location.origin) return;
      const destinationKey = `${destination.pathname}?${destination.searchParams.toString()}`;
      const currentKey = `${window.location.pathname}?${new URLSearchParams(window.location.search).toString()}`;
      if (destinationKey === currentKey) return;

      if (pendingHref.current === destinationKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      pendingHref.current = destinationKey;
      pendingAnchor.current = anchor;
      anchor.setAttribute("data-navigation-pending", "true");
      anchor.setAttribute("aria-busy", "true");
      setIsPending(true);

      if (timeout.current !== null) window.clearTimeout(timeout.current);
      timeout.current = window.setTimeout(() => {
        pendingHref.current = null;
        pendingAnchor.current?.removeAttribute("data-navigation-pending");
        pendingAnchor.current?.removeAttribute("aria-busy");
        pendingAnchor.current = null;
        timeout.current = null;
        setIsPending(false);
      }, 15000);
    };

    document.addEventListener("pointerover", handlePointerOver, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("pointerover", handlePointerOver, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("click", handleClick, true);
    };
  }, [prefetchLink]);

  return (
    <div
      className="navigation-progress-track"
      data-visible={isPending ? "true" : "false"}
      role="progressbar"
      aria-label="Loading page"
      aria-valuetext={isPending ? "Loading" : undefined}
      aria-hidden={!isPending}
    >
      <span />
    </div>
  );
}

export function NavigationFeedback() {
  return <Suspense fallback={null}><NavigationFeedbackInner /></Suspense>;
}
