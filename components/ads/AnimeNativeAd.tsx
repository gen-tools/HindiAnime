"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const AD_SCRIPT_URL =
  "https://pl31914733.profitableratecpmnetwork.com/d7d096b58231e86b9fdebbbf26057435/invoke.js";

export function AnimeNativeAd() {
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const script = document.createElement("script");
    script.async = true;
    script.setAttribute("data-cfasync", "false");
    script.src = AD_SCRIPT_URL;
    container.insertAdjacentElement("beforebegin", script);

    return () => {
      script.remove();
      container.replaceChildren();
    };
  }, [pathname]);

  return (
    <section className="container-page mt-8" aria-label="Advertisement">
      <div id="container-d7d096b58231e86b9fdebbbf26057435" ref={containerRef} />
    </section>
  );
}
