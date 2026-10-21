"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

function NavigationFeedbackInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locationKey = `${pathname}?${searchParams.toString()}`;
  const [isPending, setIsPending] = useState(false);
  const pendingHref = useRef<string | null>(null);
  const pendingAnchor = useRef<HTMLAnchorElement | null>(null);
  const timeout = useRef<number | null>(null);

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

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

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
