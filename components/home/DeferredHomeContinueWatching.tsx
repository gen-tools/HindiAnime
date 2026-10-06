"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

const ContinueWatching = dynamic(
  () => import("@/components/home/HomeContinueWatching").then((module) => module.HomeContinueWatching),
  { ssr: false }
);

export function DeferredHomeContinueWatching() {
  const [shouldLoad, setShouldLoad] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || !("IntersectionObserver" in window)) {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "500px 0px" }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <div ref={containerRef}>{shouldLoad && <ContinueWatching />}</div>;
}
