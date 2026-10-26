"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const POPUNDER_SCRIPT_URL =
  "https://pl31917244.profitableratecpmnetwork.com/89/e4/e8/89e4e830f97d279bf0b57a442e0062bf.js";

const EXCLUDED_PATHS = ["/about", "/contact", "/dmca", "/privacy", "/terms"];

function isAdPage(pathname: string): boolean {
  return !EXCLUDED_PATHS.some(
    (excludedPath) => pathname === excludedPath || pathname.startsWith(`${excludedPath}/`)
  );
}


export function AdsterraPopunder() {
  const pathname = usePathname();

  useEffect(() => {
    if (!isAdPage(pathname)) return;
    // Keep one loaded popunder script alive across client-side navigation.
    // Re-inserting it for each route delays its click handler and can miss
    // quick navigation clicks made while another copy is still loading.
    if (document.querySelector("script[data-adsterra-popunder]")) return;

    // Adsterra's install instructions place this script in the document head.
    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src = POPUNDER_SCRIPT_URL;
    script.dataset.adsterraPopunder = "true";
    document.head.appendChild(script);
  }, [pathname]);

  return null;
}
