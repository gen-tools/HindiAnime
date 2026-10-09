import type { Metadata } from "next";

/**
 * Production non-www canonical origin for Hindi Anime.
 */
export const CANONICAL_SITE_ORIGIN = "https://hindi-anime.com";

/**
 * Normalizes a pathname to ensure consistent, non-conflicting canonical URLs.
 * - Strips any query parameters or hashes.
 * - Normalizes duplicate slashes.
 * - Ensures a leading slash.
 * - Leaves root as "/".
 */
export function normalizeCanonicalPath(path: string = "/"): string {
  if (!path || path === "/") return "/";

  // Remove search queries and hash fragments if present
  const clean = path.split("?")[0].split("#")[0].trim();

  // Normalize slashes
  const withLeadingSlash = clean.startsWith("/") ? clean : `/${clean}`;
  const collapsed = withLeadingSlash.replace(/\/+/g, "/");

  // Remove trailing slash for subpaths (standardize to clean URLs without trailing slash)
  const trimmed = collapsed.length > 1 && collapsed.endsWith("/")
    ? collapsed.slice(0, -1)
    : collapsed;

  return trimmed || "/";
}

/**
 * Generates an absolute self-referencing canonical URL using the production domain.
 * Example:
 *   getCanonicalUrl("/") -> "https://hindi-anime.com/"
 *   getCanonicalUrl("/anime/naruto") -> "https://hindi-anime.com/anime/naruto"
 */
export function getCanonicalUrl(path: string = "/"): string {
  const normalized = normalizeCanonicalPath(path);
  if (normalized === "/") {
    return `${CANONICAL_SITE_ORIGIN}/`;
  }
  return `${CANONICAL_SITE_ORIGIN}${normalized}`;
}

/**
 * Returns alternates metadata containing the self-referencing canonical URL.
 */
export function canonicalAlternates(path: string) {
  return {
    canonical: getCanonicalUrl(path),
  };
}

/**
 * Centralized helper to attach canonical URL metadata to any public page metadata.
 */
export function createCanonicalMetadata(
  path: string,
  meta: Metadata = {}
): Metadata {
  return {
    ...meta,
    alternates: {
      ...meta.alternates,
      canonical: getCanonicalUrl(path),
    },
  };
}
