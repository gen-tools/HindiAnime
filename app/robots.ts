import type { MetadataRoute } from "next";
import { CANONICAL_SITE_ORIGIN } from "@/lib/seo";

const SITE_URL = CANONICAL_SITE_ORIGIN;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        // Allow Googlebot and all crawlers to index public content
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/api/stream-proxy",
          "/api/animesalt-proxy",
          "/api/suggestions",
          "/language/marathi",
          "/language/korean",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
