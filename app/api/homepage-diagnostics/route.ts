import { NextResponse } from "next/server";
import {
  parseHomepageSourceHtml,
  scrapeDirectHomepageFeed,
  DEFAULT_SCRAPER_HEADERS,
} from "@/lib/api/client";
import { getServerWorkerHeaders } from "@/lib/api/worker-auth";
import {
  ALLOWED_WORKER_HOSTS,
  DEFAULT_WORKER_BASE_URL,
} from "@/lib/api/worker-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const diag: Record<string, any> = {
    env_CF_PROXY_URL: process.env.CF_PROXY_URL || null,
    env_NEXT_PUBLIC_CF_PROXY_URL: process.env.NEXT_PUBLIC_CF_PROXY_URL || null,
    has_CF_PROXY_SHARED_SECRET: Boolean(process.env.CF_PROXY_SHARED_SECRET),
  };

  const testEndpoint = async (name: string, url: string, useAuth: boolean) => {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const headers = useAuth
        ? getServerWorkerHeaders(DEFAULT_SCRAPER_HEADERS)
        : DEFAULT_SCRAPER_HEADERS;
      const res = await fetch(url, {
        headers,
        signal: controller.signal,
        cache: "no-store",
      });
      const text = await res.text();
      return {
        status: res.status,
        headers: {
          cfCache: res.headers.get("cf-cache-status"),
          cfMitigated: res.headers.get("cf-mitigated"),
          cfRay: res.headers.get("cf-ray"),
          server: res.headers.get("server"),
          contentType: res.headers.get("content-type"),
        },
        length: text.length,
        elapsed: Date.now() - started,
        hasFreshDrops: text.includes("fresh_drops") || text.includes("fresh-drops"),
        preview: text.slice(0, 500),
      };
    } catch (e: any) {
      return {
        error: e?.name || "Error",
        message: e?.message,
        elapsed: Date.now() - started,
      };
    } finally {
      clearTimeout(timer);
    }
  };

  diag.dataHomepageClean = await (async () => {
    try {
      const res = await fetch("https://cloud.hindi-anime.com/data/homepage", {
        headers: { "Accept": "application/json" },
        cache: "no-store",
      });
      const text = await res.text();
      return { status: res.status, length: text.length, preview: text.slice(0, 300) };
    } catch (e: any) {
      return { error: e.message };
    }
  })();

  diag.dataHomepageWithSecret = await (async () => {
    try {
      const res = await fetch("https://cloud.hindi-anime.com/data/homepage", {
        headers: getServerWorkerHeaders({ "Accept": "application/json", "Referer": "https://hindi-anime.com/" }),
        cache: "no-store",
      });
      const text = await res.text();
      return { status: res.status, length: text.length, preview: text.slice(0, 300) };
    } catch (e: any) {
      return { error: e.message };
    }
  })();
  diag.directAnimeSalt = await testEndpoint(
    "directAnimeSalt",
    "https://animesalt.cx/",
    false
  );
  diag.workerDirectHealth = await testEndpoint(
    "workerDirectHealth",
    "https://cloud.hindi-anime.com/",
    false
  );
  diag.httpbinTest = await testEndpoint(
    "httpbin",
    "https://cloud.hindi-anime.com/?url=https://httpbin.org/get",
    false
  );
  diag.customDomainWithHeaders = await testEndpoint(
    "customDomainWithHeaders",
    "https://cloud.hindi-anime.com/?url=https://animesalt.cx/",
    false
  );
  diag.customDomainWithAuth = await testEndpoint(
    "customDomainWithAuth",
    "https://cloud.hindi-anime.com/?url=https://animesalt.cx/",
    true
  );
  diag.workersDevWithHeaders = await testEndpoint(
    "workersDevWithHeaders",
    "https://wispy-cherry-6934.sheztech.workers.dev/?url=https://animesalt.cx/",
    false
  );

  try {
    const feed = await scrapeDirectHomepageFeed(true);
    diag.scrapeResult = {
      success: Boolean(feed),
      sections: feed?.data?.results
        ? {
            freshDrops: feed.data.results.fresh_drops?.length ?? 0,
            mostWatchedSeries: feed.data.results.mostWatched_Series?.length ?? 0,
            mostWatchedFilms: feed.data.results.mostWatched_Films?.length ?? 0,
            onAirSeries: feed.data.results.on_air_series?.length ?? 0,
            latestAnimeMovies: feed.data.results.latest_animeMovies?.length ?? 0,
          }
        : null,
    };
  } catch (err: any) {
    diag.scrapeError = { name: err?.name, message: err?.message };
  }

  return NextResponse.json(diag, {
    status: 200,
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}
