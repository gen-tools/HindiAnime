import type { Metadata } from "next";

export const CANONICAL_SITE_ORIGIN = "https://hindi-anime.com";
export const DEFAULT_OG_IMAGE = `${CANONICAL_SITE_ORIGIN}/opengraph-image`;

export function normalizeCanonicalPath(path: string = "/"): string {
  if (!path || path === "/") return "/";
  const clean = path.split("?")[0].split("#")[0].trim();
  const withLeadingSlash = clean.startsWith("/") ? clean : `/${clean}`;
  const collapsed = withLeadingSlash.replace(/\/+/g, "/");
  return collapsed.length > 1 && collapsed.endsWith("/")
    ? collapsed.slice(0, -1)
    : collapsed;
}

export function getCanonicalUrl(path: string = "/"): string {
  const normalized = normalizeCanonicalPath(path);
  return normalized === "/"
    ? `${CANONICAL_SITE_ORIGIN}/`
    : `${CANONICAL_SITE_ORIGIN}${normalized}`;
}

export function createCanonicalMetadata(path: string, meta: Metadata = {}): Metadata {
  const canonicalUrl = getCanonicalUrl(path);
  const title = meta.title || "Hindi Anime | Watch Hindi Dubbed Anime Online";
  const description =
    meta.description ||
    "Watch Hindi dubbed anime online, plus anime in Tamil, Telugu, English and Japanese. Explore popular series, movies, and latest episodes.";

  const existingOg = meta.openGraph || {};
  const existingTwitter = meta.twitter || {};

  return {
    ...meta,
    metadataBase: new URL(CANONICAL_SITE_ORIGIN),
    alternates: {
      ...meta.alternates,
      canonical: canonicalUrl,
    },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      siteName: "Hindi Anime",
      locale: "en_US",
      type: "website",
      images: existingOg.images || [
        {
          url: DEFAULT_OG_IMAGE,
          width: 1200,
          height: 630,
          alt: "Hindi Anime - Watch Hindi Dubbed Anime Online",
        },
      ],
      ...existingOg,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: existingTwitter.images || [DEFAULT_OG_IMAGE],
      ...existingTwitter,
    },
  };
}
