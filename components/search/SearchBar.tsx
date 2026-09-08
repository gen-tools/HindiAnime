"use client";

import { Search, Loader2, TrendingUp } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/lib/hooks/useDebounce";

interface Suggestion {
  slug: string;
  title: string;
  poster: string;
  year: number;
  type: string;
  score: number;
}

export function SearchBar({
  className,
  size = "md",
  defaultValue = "",
  autoFocus = false,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  defaultValue?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const debouncedValue = useDebounce(value, 260);

  // Fetch suggestions whenever debounced value changes
  useEffect(() => {
    const q = debouncedValue.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    fetch(`/api/suggestions?q=${encodeURIComponent(q)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (abortRef.current !== controller) return;
        setSuggestions(data.results ?? []);
        setOpen(true);
        setActiveIndex(-1);
      })
      .catch(() => {})
      .finally(() => {
        if (abortRef.current === controller) setLoading(false);
      });
  }, [debouncedValue]);

  // Close dropdown on outside click
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function navigateTo(slug: string) {
    setOpen(false);
    setSuggestions([]);
    router.push(`/anime/${slug}`);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;

    // If there's an active suggestion, navigate directly to it
    if (activeIndex >= 0 && suggestions[activeIndex]) {
      navigateTo(suggestions[activeIndex].slug);
      return;
    }

    setOpen(false);
    const params = new URLSearchParams();
    params.set("q", trimmed);
    router.push(`/search?${params.toString()}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    } else if (e.key === "Enter") {
      // handled by handleSubmit
    }
  }

  const sizeClass = {
    sm: "py-1.5 pl-9 text-sm",
    md: "py-2.5 pl-10 text-sm",
    lg: "py-3.5 pl-12 text-base",
  }[size];

  const iconSize = {
    sm: "left-3 h-3.5 w-3.5",
    md: "left-3.5 h-4 w-4",
    lg: "left-4 h-5 w-5",
  }[size];

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <form onSubmit={handleSubmit} role="search" className="relative w-full">
        {loading ? (
          <Loader2
            className={cn(
              "pointer-events-none absolute top-1/2 -translate-y-1/2 animate-spin text-green-bright",
              iconSize
            )}
          />
        ) : (
          <Search
            className={cn(
              "pointer-events-none absolute top-1/2 -translate-y-1/2 text-text-muted",
              iconSize
            )}
          />
        )}
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `suggestion-${activeIndex}` : undefined}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (e.target.value.trim().length < 2) {
              setOpen(false);
              setSuggestions([]);
            }
          }}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          autoFocus={autoFocus}
          placeholder="Search anime, movies, characters..."
          aria-label="Search anime, movies, characters"
          autoComplete="off"
          className={cn(
            "focus-ring w-full rounded-full border border-border-line bg-surface pr-4 text-text-primary placeholder:text-text-muted transition-colors focus:border-green-bright/70 focus:shadow-[0_0_0_4px_rgba(34,197,94,0.12)]",
            sizeClass,
            open && suggestions.length > 0 ? "rounded-b-none border-b-0 rounded-t-2xl" : ""
          )}
        />
      </form>

      {/* Suggestions Dropdown */}
      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          aria-label="Search suggestions"
          className="absolute left-0 right-0 z-50 max-h-80 overflow-y-auto rounded-b-2xl border border-t-0 border-border-line bg-surface shadow-xl"
        >
          {suggestions.map((item, idx) => {
            const isActive = idx === activeIndex;
            return (
              <li
                key={item.slug}
                id={`suggestion-${idx}`}
                role="option"
                aria-selected={isActive}
              >
                <button
                  type="button"
                  onPointerDown={(e) => {
                    // pointerdown fires before blur so we prevent blur first
                    e.preventDefault();
                    navigateTo(item.slug);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
                    isActive
                      ? "bg-green-primary/10 text-white"
                      : "text-text-secondary hover:bg-surface-elevated hover:text-white"
                  )}
                >
                  {/* Poster thumbnail */}
                  <div className="relative h-10 w-7 shrink-0 overflow-hidden rounded border border-border-line bg-surface-elevated">
                    {item.poster.startsWith("http") ? (
                      <Image
                        src={item.poster}
                        alt={item.title}
                        fill
                        sizes="28px"
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[8px] font-bold text-green-bright">
                        {item.title.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-primary">{item.title}</p>
                    <p className="text-xs text-text-muted">
                      {item.year} · {item.type}
                      {item.score < 0.85 && (
                        <span className="ml-1.5 text-green-bright/60">~similar</span>
                      )}
                    </p>
                  </div>

                  {/* Trending icon for top suggestions */}
                  {idx < 3 && item.score > 0.8 && (
                    <TrendingUp className="h-3.5 w-3.5 shrink-0 text-green-bright/50" />
                  )}
                </button>
              </li>
            );
          })}

          {/* Search all results footer */}
          <li>
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                setOpen(false);
                router.push(`/search?q=${encodeURIComponent(value.trim())}`);
              }}
              className="flex w-full items-center gap-2 border-t border-border-line px-4 py-2.5 text-sm text-text-muted transition-colors hover:text-green-light"
            >
              <Search className="h-3.5 w-3.5" />
              Search all results for &quot;{value}&quot;
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
