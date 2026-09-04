import type { MetadataRoute } from "next";
import { anime } from "@/lib/mock/anime";
import { genres } from "@/lib/mock/genres";
import { languages } from "@/lib/mock/languages";

const BASE_URL = "https://hindianime.example.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = [
    "",
    "/search",
    "/latest",
    "/popular",
    "/movies",
    "/genre",
    "/language",
    "/schedule",
    "/about",
    "/contact",
    "/privacy",
    "/terms",
  ].map((route) => ({
    url: `${BASE_URL}${route}`,
    lastModified: new Date(),
  }));

  const animeRoutes = anime.map((a) => ({
    url: `${BASE_URL}/anime/${a.slug}`,
    lastModified: new Date(a.updatedAt),
  }));

  const genreRoutes = genres.map((g) => ({
    url: `${BASE_URL}/genre/${g.slug}`,
    lastModified: new Date(),
  }));

  const languageRoutes = languages.map((l) => ({
    url: `${BASE_URL}/language/${l.code}`,
    lastModified: new Date(),
  }));

  return [...staticRoutes, ...animeRoutes, ...genreRoutes, ...languageRoutes];
}
