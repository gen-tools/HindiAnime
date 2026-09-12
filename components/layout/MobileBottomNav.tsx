"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Home, Compass, Search, Bookmark, User } from "lucide-react";
import { cn } from "@/lib/utils";

function MobileBottomNavInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // When video player is in fullscreen, hide bottom nav so it never interferes with playback
  if (isFullscreen) {
    return null;
  }

  const tab = searchParams.get("tab");

  // Canonical active route matching
  const isHomeActive = pathname === "/";
  const isBrowseActive =
    pathname.startsWith("/genre") ||
    pathname.startsWith("/series") ||
    pathname.startsWith("/movies") ||
    pathname.startsWith("/popular") ||
    pathname.startsWith("/latest") ||
    pathname.startsWith("/language");
  const isSearchActive = pathname.startsWith("/search");
  const isListActive = pathname === "/profile" && tab === "favorites";
  const isYouActive = pathname === "/profile" && tab !== "favorites";

  return (
    <nav
      className="mobile-bottom-nav-container"
      role="navigation"
      aria-label="Navigation Dock"
    >
      <div className="flex items-center gap-2 sm:gap-4 px-3 sm:px-5 py-1 rounded-2xl sm:rounded-full bg-surface-dark/95 backdrop-blur-2xl border border-border-line/90 shadow-[0_12px_40px_rgba(0,0,0,0.85)]">
        {/* 1. Home */}
        <Link
          href="/"
          className={cn(
            "flex flex-col items-center justify-center py-1 px-2.5 sm:px-3.5 transition-colors group",
            isHomeActive ? "text-green-light font-bold" : "text-text-muted hover:text-white"
          )}
        >
          <Home className={cn("h-5 w-5 transition-transform group-hover:scale-110", isHomeActive && "scale-110 text-green-light")} />
          <span className="text-[10px] mt-0.5 tracking-tight font-medium">Home</span>
          {isHomeActive && (
            <span className="mt-0.5 h-1 w-1 rounded-full bg-green-bright shadow-[0_0_8px_rgba(34,197,94,0.9)]" />
          )}
        </Link>

        {/* 2. Browse */}
        <Link
          href="/genre"
          className={cn(
            "flex flex-col items-center justify-center py-1 px-2.5 sm:px-3.5 transition-colors group",
            isBrowseActive ? "text-green-light font-bold" : "text-text-muted hover:text-white"
          )}
        >
          <Compass className={cn("h-5 w-5 transition-transform group-hover:scale-110", isBrowseActive && "scale-110 text-green-light")} />
          <span className="text-[10px] mt-0.5 tracking-tight font-medium">Browse</span>
          {isBrowseActive && (
            <span className="mt-0.5 h-1 w-1 rounded-full bg-green-bright shadow-[0_0_8px_rgba(34,197,94,0.9)]" />
          )}
        </Link>

        {/* 3. Center Elevated Search Button (Emerald Green Theme) */}
        <div className="relative -top-4 sm:-top-5 flex flex-col items-center px-1 sm:px-2">
          <Link
            href="/search"
            aria-label="Search anime"
            className={cn(
              "flex h-13 w-13 sm:h-14 sm:w-14 items-center justify-center rounded-full bg-green-bright text-black shadow-[0_0_24px_rgba(34,197,94,0.7)] border-4 border-background transition-all duration-200 hover:scale-105 active:scale-95",
              isSearchActive && "ring-2 ring-green-light ring-offset-2 ring-offset-background scale-105"
            )}
          >
            <Search className="h-6 w-6 stroke-[2.8] text-black" />
          </Link>
          <span
            className={cn(
              "text-[10px] mt-0.5 font-bold tracking-tight",
              isSearchActive ? "text-green-light" : "text-text-muted"
            )}
          >
            Search
          </span>
        </div>

        {/* 4. List */}
        <Link
          href="/profile?tab=favorites"
          className={cn(
            "flex flex-col items-center justify-center py-1 px-2.5 sm:px-3.5 transition-colors group",
            isListActive ? "text-green-light font-bold" : "text-text-muted hover:text-white"
          )}
        >
          <Bookmark className={cn("h-5 w-5 transition-transform group-hover:scale-110", isListActive && "scale-110 text-green-light")} />
          <span className="text-[10px] mt-0.5 tracking-tight font-medium">List</span>
          {isListActive && (
            <span className="mt-0.5 h-1 w-1 rounded-full bg-green-bright shadow-[0_0_8px_rgba(34,197,94,0.9)]" />
          )}
        </Link>

        {/* 5. You */}
        <Link
          href="/profile"
          className={cn(
            "flex flex-col items-center justify-center py-1 px-2.5 sm:px-3.5 transition-colors group",
            isYouActive ? "text-green-light font-bold" : "text-text-muted hover:text-white"
          )}
        >
          <User className={cn("h-5 w-5 transition-transform group-hover:scale-110", isYouActive && "scale-110 text-green-light")} />
          <span className="text-[10px] mt-0.5 tracking-tight font-medium">You</span>
          {isYouActive && (
            <span className="mt-0.5 h-1 w-1 rounded-full bg-green-bright shadow-[0_0_8px_rgba(34,197,94,0.9)]" />
          )}
        </Link>
      </div>
    </nav>
  );
}

export function MobileBottomNav() {
  return (
    <Suspense fallback={null}>
      <MobileBottomNavInner />
    </Suspense>
  );
}
