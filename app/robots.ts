import type { MetadataRoute } from "next";
import { CANONICAL_SITE_ORIGIN } from "@/lib/seo";

// Only Hindi, Tamil, and Telugu are supported dubbed languages
const UNSUPPORTED_LANGUAGE_PATHS = [
  "/language/english",
  "/language/japanese",
  "/language/korean",
  "/language/bengali",
  "/language/kannada",
  "/language/malayalam",
  "/language/marathi",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/profile",
          "/you",
          "/_next/",
          ...UNSUPPORTED_LANGUAGE_PATHS,
        ],
      },
      {
        userAgent: "Googlebot",
        allow: "/",
        disallow: [
          "/api/",
          "/profile",
          "/you",
          ...UNSUPPORTED_LANGUAGE_PATHS,
        ],
      },
      {
        userAgent: "Bingbot",
        allow: "/",
        disallow: [
          "/api/",
          "/profile",
          "/you",
          ...UNSUPPORTED_LANGUAGE_PATHS,
        ],
      },
    ],
    sitemap: `${CANONICAL_SITE_ORIGIN}/sitemap.xml`,
    host: CANONICAL_SITE_ORIGIN,
  };
}
