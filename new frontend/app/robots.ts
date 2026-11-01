import type { MetadataRoute } from "next";
import { CANONICAL_SITE_ORIGIN } from "@/lib/seo";

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
        ],
      },
      {
        userAgent: "Googlebot",
        allow: "/",
        disallow: [
          "/api/",
          "/profile",
          "/you",
        ],
      },
      {
        userAgent: "Bingbot",
        allow: "/",
        disallow: [
          "/api/",
          "/profile",
          "/you",
        ],
      },
    ],
    sitemap: `${CANONICAL_SITE_ORIGIN}/sitemap.xml`,
    host: CANONICAL_SITE_ORIGIN,
  };
}
