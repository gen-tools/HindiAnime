"use client";

import { Search, Loader2 } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect, useId } from "react";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { cleanAnimeSlug } from "@/lib/api/client";
import type { Anime } from "@/types/anime";
import type { LanguageCode } from "@/types/language";

interface Suggestion {
  slug: string;
  title: string;
  poster: string;
  year: number;
  type: string;
  languages: LanguageCode[];
  score?: number;
}

function normalizeSearchQuery(query: string) {
  return query.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function getSuggestionPosterUrl(poster: string) {
  if (!poster) return "";
  if (poster.startsWith("/") && !poster.startsWith("//")) {
    return `https://image.tmdb.org/t/p/w92${poster}`;
  }
  return poster.replace(
    /(https?:\/\/image\.tmdb\.org\/t\/p\/)w\d+\//i,
    "$1w92/"
  );
}

function abortSearchRequest(controller: AbortController | null, reason: string) {
  if (controller && !controller.signal.aborted) {
    controller.abort(new DOMException(reason, "AbortError"));
  }
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
  const pathname = usePathname();
  const [inputState, setInputState] = useState({ defaultValue, value: defaultValue });
  const value = inputState.defaultValue === defaultValue ? inputState.value : defaultValue;
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [requestFailed, setRequestFailed] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const searchRequestIdRef = useRef(0);
  const listboxId = useId();

  const debouncedValue = useDebounce(value, 600);
  const normalizedQuery = normalizeSearchQuery(value);
  const normalizedDebouncedQuery = normalizeSearchQuery(debouncedValue);
  const hasValidQuery = normalizedQuery.length >= 3;
  const isWaitingForDebounce = hasValidQuery && normalizedQuery !== normalizedDebouncedQuery;
  const isSearching = hasValidQuery && (loading || isWaitingForDebounce);
  const dropdownOpen = open && hasValidQuery;

  useEffect(() => {
    // Close the popup after client-side navigation.
    searchRequestIdRef.current += 1;
    abortSearchRequest(abortRef.current, "Search route changed");
    abortRef.current = null;
    inputRef.current?.blur();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
    setActiveIndex(-1);
    setLoading(false);
  }, [pathname]);

  // Fetch suggestions whenever debounced value changes
  useEffect(() => {
    const q = normalizeSearchQuery(debouncedValue);
    if (q.length < 3) {
      abortRef.current = null;
      return;
    }
    const requestId = ++searchRequestIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const loadSuggestions = async () => {
      try {
        const res = await fetch(`/api/suggestions?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted || searchRequestIdRef.current !== requestId) return;
        if (!res.ok) {
          setRequestFailed(true);
          setHasSearched(true);
          return;
        }
        const data = await res.json() as { results?: Anime[] };
        if (controller.signal.aborted || searchRequestIdRef.current !== requestId) return;
        setSuggestions((data.results ?? []).slice(0, 6).map((item: Anime) => ({
          slug: item.slug,
          title: item.title,
          poster: item.poster,
          year: item.year,
          type: item.type,
          languages: item.languages ?? [],
        })));
        setOpen(true);
        setActiveIndex(-1);
        setHasSearched(true);
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error && typeof error === "object" && "name" in error && error.name === "AbortError")
        ) return;
        if (searchRequestIdRef.current === requestId) {
          setRequestFailed(true);
          setHasSearched(true);
          console.error("[SearchBar] Suggestions request failed:", error);
        }
      } finally {
        if (searchRequestIdRef.current === requestId && abortRef.current === controller) {
          setLoading(false);
          abortRef.current = null;
        }
      }
    };

    void loadSuggestions();
    return () => {
      // A new keystroke invalidates this response by request ID. Letting the
      // fetch settle avoids surfacing browser AbortErrors while typing.
      if (searchRequestIdRef.current === requestId) searchRequestIdRef.current += 1;
      if (abortRef.current === controller) abortRef.current = null;
    };
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
    inputRef.current?.blur();
    const clean = cleanAnimeSlug(slug) || slug;
    router.push(`/anime/${clean}`);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = normalizedQuery;
    if (!trimmed) return;

    // If there's an active suggestion, navigate directly to it
    if (activeIndex >= 0 && suggestions[activeIndex]) {
      navigateTo(suggestions[activeIndex].slug);
      return;
    }

    setOpen(false);
    inputRef.current?.blur();
    const params = new URLSearchParams();
    params.set("q", trimmed);
    router.push(`/search?${params.toString()}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      if (!dropdownOpen || suggestions.length === 0) return;
      e.preventDefault();
      setActiveIndex((i) => i < 0 ? 0 : (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      if (!dropdownOpen || suggestions.length === 0) return;
      e.preventDefault();
      setActiveIndex((i) => i < 0 ? suggestions.length - 1 : (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
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
        {isSearching ? (
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
          aria-expanded={dropdownOpen}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={dropdownOpen && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
          value={value}
          onChange={(e) => {
            searchRequestIdRef.current += 1;
            setLoading(false);
            setInputState({ defaultValue, value: e.target.value });
            const nextQuery = normalizeSearchQuery(e.target.value);
            if (nextQuery.length < 3) {
              setOpen(false);
              setSuggestions([]);
              setHasSearched(false);
              setRequestFailed(false);
            } else {
              setOpen(true);
              setActiveIndex(-1);
              setSuggestions([]);
              setHasSearched(false);
              setRequestFailed(false);
            }
          }}
          onFocus={() => {
            if (hasValidQuery) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          autoFocus={autoFocus}
          placeholder="Search anime, movies, characters..."
          aria-label="Search anime, movies, characters"
          autoComplete="off"
          className={cn(
            "focus-ring w-full rounded-full border border-border-line bg-surface pr-4 text-text-primary placeholder:text-text-muted transition-colors focus:border-green-bright/70 focus:shadow-[0_0_0_4px_rgba(34,197,94,0.12)]",
            sizeClass,
            dropdownOpen ? "rounded-b-none border-b-0 rounded-t-2xl" : ""
          )}
        />
      </form>

      {dropdownOpen && (
        <div className="search-suggestions-enter absolute left-0 right-0 top-full z-[100] mt-2 overflow-hidden rounded-xl border border-emerald-500/20 bg-black/90 shadow-2xl backdrop-blur-xl">
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Search suggestions"
            className="max-h-[min(60vh,22rem)] overflow-y-auto py-1"
          >
            {isSearching ? (
              Array.from({ length: 3 }, (_, idx) => (
                <li key={`search-skeleton-${idx}`} aria-hidden="true" className="flex items-center gap-3 px-3 py-2.5">
                  <span className="h-12 w-9 shrink-0 animate-pulse rounded bg-emerald-950/70" />
                  <span className="min-w-0 flex-1 space-y-2">
                    <span className="block h-3 w-3/5 animate-pulse rounded bg-white/10" />
                    <span className="block h-2.5 w-2/5 animate-pulse rounded bg-white/5" />
                  </span>
                </li>
              ))
            ) : suggestions.map((item, idx) => {
                const isActive = idx === activeIndex;
                const posterUrl = getSuggestionPosterUrl(item.poster);
                const languageBadges = [
                  ["hindi", "Hindi"],
                  ["tamil", "Tamil"],
                  ["telugu", "Telugu"],
                ].filter(([language]) => item.languages.includes(language as LanguageCode));

                return (
                  <li
                    key={item.slug}
                    id={`${listboxId}-option-${idx}`}
                    role="option"
                    aria-selected={isActive}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      navigateTo(item.slug);
                    }}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors",
                      isActive ? "bg-emerald-500/15" : "hover:bg-white/5"
                    )}
                  >
                    <div className="relative h-12 w-9 shrink-0 overflow-hidden rounded-md border border-emerald-500/15 bg-emerald-950/60">
                      {posterUrl.startsWith("http") ? (
                        <Image
                          src={posterUrl}
                          alt={item.title}
                          fill
                          className="object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[9px] font-bold text-emerald-300">
                          {item.title.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{item.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-white/55">
                        <span>{item.type}{item.year ? ` · ${item.year}` : ""}</span>
                        {languageBadges.map(([, label]) => (
                          <span key={label} className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium leading-none text-emerald-200">
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
                  </li>
                );
              })}
          </ul>
          {!isSearching && suggestions.length === 0 && (
            <p className="px-4 py-4 text-sm text-white/60" role="status">
              {requestFailed
                ? "Suggestions could not be loaded."
                : hasSearched
                  ? `No results for '${normalizedQuery}'`
                  : "Searching…"}
            </p>
          )}
          <Link
            href={`/search?q=${encodeURIComponent(normalizedQuery)}`}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 border-t border-emerald-500/15 px-4 py-3 text-left text-sm text-emerald-200/80 transition-colors hover:bg-emerald-500/10 hover:text-emerald-100"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">See all results for &apos;{normalizedQuery}&apos;</span>
          </Link>
        </div>
      )}
    </div>
  );
}
