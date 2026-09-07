import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "image.tmdb.org" },
      { protocol: "https", hostname: "img.animesalt.cx" },
      { protocol: "https", hostname: "animesalt.cx" },
      { protocol: "https", hostname: "**.animesalt.cx" },
      { protocol: "https", hostname: "**.tmdb.org" },
      { protocol: "https", hostname: "multishows.top" },
      { protocol: "https", hostname: "**.multishows.top" },
      // WordPress Photon CDN used by animesalt og:image
      { protocol: "https", hostname: "i0.wp.com" },
      { protocol: "https", hostname: "i1.wp.com" },
      { protocol: "https", hostname: "i2.wp.com" },
      { protocol: "https", hostname: "i3.wp.com" },
      // General CDN catchall (covers any img CDN animesalt.cx might use)
      { protocol: "https", hostname: "**.wp.com" },
    ],
    // Disable domain-based blocking for external images entirely
    // (PosterArt already uses unoptimized={true} for all external images)
    dangerouslyAllowSVG: true,
    contentDispositionType: "inline",
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow, noarchive, nosnippet, noimageindex",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://image.tmdb.org https://img.animesalt.cx https://animesalt.cx https://*.animesalt.cx https://*.tmdb.org https://multishows.top https://*.multishows.top https://i0.wp.com https://i1.wp.com https://i2.wp.com https://i3.wp.com https://*.wp.com",
              "font-src 'self' data:",
              "connect-src 'self' https://anime-api-gilt-beta.vercel.app https://animeapi-bmm3kbd5.b4a.run https://animesalt.cx https://multishows.top https://*.workers.dev https://wispy-cherry-6934.shahazaibseo038.workers.dev",
              // Permissive frame-src and media-src so embedded video players and streams function smoothly
              "frame-src 'self' https: http:",
              "media-src 'self' blob: data: https: http:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
