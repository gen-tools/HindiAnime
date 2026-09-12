"use client";

import { useEffect, useState, useTransition } from "react";
import { Bookmark, Check } from "lucide-react";
import { isFavorite, toggleFavorite } from "@/lib/storage/userDataService";
import { cn } from "@/lib/utils";

interface FavoriteButtonProps {
  anime: {
    animeSlug: string;
    title: string;
    poster: string;
    rating?: number;
    type?: string;
    genres?: string[];
    languages?: string[];
  };
  variant?: "default" | "compact";
  className?: string;
}

export function FavoriteButton({ anime, variant = "default", className }: FavoriteButtonProps) {
  const [favorited, setFavorited] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    setMounted(true);
    isFavorite(anime.animeSlug).then(setFavorited);

    const handleStorageUpdate = () => {
      isFavorite(anime.animeSlug).then(setFavorited);
    };

    window.addEventListener("hindianime:userdata-changed", handleStorageUpdate);
    return () => {
      window.removeEventListener("hindianime:userdata-changed", handleStorageUpdate);
    };
  }, [anime.animeSlug]);

  const handleToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const nextState = await toggleFavorite(anime);
    startTransition(() => {
      setFavorited(nextState);
    });
  };

  if (!mounted) {
    // SSR / initial hydration skeleton
    return (
      <button
        type="button"
        disabled
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-xl border border-border-line bg-surface px-4 py-2.5 text-sm font-semibold text-text-muted opacity-60",
          variant === "compact" && "px-3 py-1.5 text-xs",
          className
        )}
      >
        <Bookmark className="h-4 w-4" />
        <span>Add to List</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={favorited ? "Remove from My List" : "Add to My List"}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl border transition-all duration-200 active:scale-95",
        favorited
          ? "border-green-primary/50 bg-green-primary/15 text-green-light hover:bg-green-primary/25"
          : "border-border-line bg-surface text-text-secondary hover:border-white/20 hover:text-white hover:bg-surface-elevated",
        variant === "default" ? "px-4 py-2.5 text-sm font-semibold shadow-sm" : "px-3 py-1.5 text-xs font-medium",
        className
      )}
    >
      {favorited ? (
        <>
          <Check className="h-4 w-4 text-green-bright" />
          <span>In My List</span>
        </>
      ) : (
        <>
          <Bookmark className="h-4 w-4" />
          <span>Add to List</span>
        </>
      )}
    </button>
  );
}
