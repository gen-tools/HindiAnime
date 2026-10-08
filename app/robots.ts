import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://hindi-anime.com";

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
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
