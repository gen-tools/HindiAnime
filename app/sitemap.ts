import type { MetadataRoute } from "next";
import { staticCatalog } from "@/lib/static-catalog";
import { genres } from "@/lib/mock/genres";
import { languages } from "@/lib/mock/languages";
import { CANONICAL_SITE_ORIGIN } from "@/lib/seo";

const BASE_URL = CANONICAL_SITE_ORIGIN;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/series`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/movies`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/latest`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/popular`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/schedule`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/genre`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/language`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/about`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/contact`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/dmca`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/privacy`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/terms`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];

  const animeRoutes: MetadataRoute.Sitemap = staticCatalog
    .filter((item) => !item.isMock && Boolean(item.slug))
    .map((item) => {
      const updatedAt = item.updatedAt ? new Date(item.updatedAt) : null;
      return {
        url: `${BASE_URL}/anime/${encodeURIComponent(item.slug)}`,
        lastModified:
          updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : now,
        changeFrequency: "weekly",
        priority: 0.8,
      };
    });

  const genreRoutes: MetadataRoute.Sitemap = genres.map((g) => ({
    url: `${BASE_URL}/genre/${g.slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  // Only include the 3 supported dubbed-language pages
  const SUPPORTED_LANGUAGE_CODES = ["hindi", "tamil", "telugu"];
  const languageRoutes: MetadataRoute.Sitemap = languages
    .filter((l) => SUPPORTED_LANGUAGE_CODES.includes(l.code))
    .map((l) => ({
      url: `${BASE_URL}/language/${l.code}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    }));

  return [...staticRoutes, ...animeRoutes, ...genreRoutes, ...languageRoutes];
}
