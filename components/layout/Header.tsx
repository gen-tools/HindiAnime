"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "./Logo";
import { Navigation } from "./Navigation";
import { MobileNavigation } from "./MobileNavigation";
import { SearchBar } from "@/components/search/SearchBar";

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 12);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-colors duration-300",
        scrolled
          ? "border-border-line bg-background/80 backdrop-blur-sm"
          : "border-transparent bg-gradient-to-b from-black/50 to-transparent"
      )}
    >
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <Logo />
          <Navigation />
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden md:block w-64">
            <SearchBar size="sm" />
          </div>
          <button
            className="focus-ring rounded-lg p-2 text-text-primary hover:bg-white/5 md:hidden"
            aria-label="Open search"
            onClick={() => setMobileSearchOpen((v) => !v)}
          >
            <Search className="h-5 w-5" />
          </button>

          <MobileNavigation />
        </div>
      </div>

      {mobileSearchOpen && (
        <div className="border-t border-border-line px-4 py-3 md:hidden">
          <SearchBar size="sm" autoFocus />
        </div>
      )}
    </header>
  );
}
