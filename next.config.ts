import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "image.tmdb.org",
      },
      {
        protocol: "https",
        hostname: "img.animesalt.cx",
      },
      {
        protocol: "https",
        hostname: "animesalt.cx",
      },
      {
        protocol: "https",
        hostname: "**.tmdb.org",
      },
      {
        protocol: "https",
        hostname: "multishows.top",
      },
    ],
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
              "img-src 'self' data: blob: https://image.tmdb.org https://img.animesalt.cx https://animesalt.cx https://*.tmdb.org https://multishows.top",
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
