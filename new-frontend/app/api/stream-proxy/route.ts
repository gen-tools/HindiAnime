import { NextResponse } from "next/server";
import { createHmac } from "crypto";
import { BLOCKED_STREAM_DOMAINS, cleanAnimeSlug, formatDisplayTitle } from "@/lib/api/client";
import { ALLOWED_WORKER_HOSTS, DEFAULT_WORKER_BASE_URL } from "@/lib/api/worker-config";
import { buildAnimeSaltEpisodeCandidates, buildAnimeSaltMovieUrl, isValidAnimeSaltHtml } from "@/lib/animesalt-stream";
import { buildServerWorkerProxyUrl, getServerWorkerHeaders } from "@/lib/api/worker-auth";
import type { StreamItem, TokoSource, TokoStreamResponse } from "@/types/api";

function isCloudflareChallenge(text: string): boolean {
  return (
    text.includes("Just a moment...") ||
    text.includes("cf-chl-widget") ||
    text.includes("id=\"challenge-stage\"") ||
    text.includes("id=\"challenge-form\"") ||
    text.includes("_cf_chl_opt") ||
    text.includes("cf-browser-verification") ||
    text.includes("Attention Required! | Cloudflare") ||
    text.includes("security check")
  );
}

// Stream links are dynamic and short-lived
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Toko streaming aggregator backend */
const TOKO_API_URL = (
  process.env.TOKO_API_URL || "https://anime-api2-3rkec57qu-sheztechy.vercel.app"
).replace(/\/+$/, "");

const TOKO_TIMEOUT_MS = 25_000;
const TOKO_SOURCE_CACHE_TTL_MS = 5_000;
const tokoSourceCache = new Map<
  string,
  { expiresAt: number; value: { rawSources: TokoSource[]; byLanguage?: Record<string, unknown> } }
>();

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  Accept: "application/json",
};

const rawCfProxy = (
  process.env.CF_PROXY_URL ||
  `${DEFAULT_WORKER_BASE_URL}/?url=`
).trim(); // trim trailing newlines/spaces common in .env files

/**
 * Base URL for the Cloudflare Worker endpoint.
 * Accepted hostnames: wispy-cherry-6934.sheztech.workers.dev (legacy)
 * and cloud.hindi-anime.com (new custom domain).
 * Robustly extracted using URL().origin so trailing /?url=, newlines,
 * or slash variants in the env var never produce a malformed proxy URL.
 */
function getCfWorkerBase(): string {
  try {
    const parsed = new URL(rawCfProxy);
    const allowedQuery = parsed.search === "" ||
      (parsed.searchParams.size === 1 && parsed.searchParams.has("url") && parsed.searchParams.get("url") === "");
    if (
      parsed.protocol === "https:" &&
      ALLOWED_WORKER_HOSTS.has(parsed.hostname) &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname === "/" &&
      allowedQuery &&
      !parsed.hash
    ) {
      return parsed.origin;
    }
  } catch { /* fall through */ }
  // Absolute fallback
  return DEFAULT_WORKER_BASE_URL;
}
const CF_WORKER_BASE = getCfWorkerBase();

function buildCfProxyUrl(targetUrl: string): string {
  const proxyUrl = new URL("/", CF_WORKER_BASE);
  proxyUrl.searchParams.set("url", targetUrl);
  return proxyUrl.toString();
}

/**
 * Generate title search variants for Toko.
 * Toko does NOT use the ?season= param for content routing — it uses the title.
 * For Season 2+ we must include season-specific titles so Toko returns the right
 * content (e.g. "Jujutsu Kaisen Season 2" yields JJK S2 episodes, not S1).
 */
function slugToTitleVariants(slug: string, season: string): string[] {
  // Strip any season suffix already in the slug (e.g. attack-on-titan-season-2)
  const cleanSlug = slug
    .replace(/-season-\d+$/i, "")
    .replace(/-s\d+$/i, "")
    .replace(/-\d+(st|nd|rd|th)-season$/i, "");

  const base = formatDisplayTitle(cleanSlug) || formatDisplayTitle(slug);
  if (!base) return [];

  const sNum = parseInt(season, 10) || 1;

  if (sNum <= 1) {
    return [base];
  }

  // Season 2+: Season-specific titles MUST come first so providers match Season 2 instead of Season 1
  const ordinal = sNum === 2 ? "2nd" : sNum === 3 ? "3rd" : `${sNum}th`;
  return [
    `${base} Season ${sNum}`,
    `${base} ${ordinal} Season`,
    `${base} S${sNum}`,
    base,
  ];
}

type TokoPrioritySource = TokoSource & { providerPriority?: number };

function orderTokoSources(sources: TokoSource[]): TokoSource[] {
  const languageTier = (source: TokoSource) => {
    const language = (source.audioLanguage || "").toLowerCase().trim();
    if (language === "hi") return 0;
    if (["ta", "te", "ml", "kn", "bn", "mr"].includes(language)) return 1;
    if (language === "en") return 2;
    if (language === "ja") return 3;
    return 4;
  };
  const typeTier = (source: TokoSource) => {
    if (source.type === "hls" || source.isM3U8) return 0;
    if (source.type === "mp4") return 1;
    return 2;
  };

  // Match the backend's final JSON ordering while SSE sources arrive in provider
  // completion order. This keeps existing role selection and provider priority.
  return [...sources].sort((left, right) => {
    const languageDifference = languageTier(left) - languageTier(right);
    if (languageDifference) return languageDifference;
    const typeDifference = typeTier(left) - typeTier(right);
    if (typeDifference) return typeDifference;
    const leftPriority = (left as TokoPrioritySource).providerPriority ?? 999;
    const rightPriority = (right as TokoPrioritySource).providerPriority ?? 999;
    return leftPriority - rightPriority;
  });
}

function groupTokoSourcesByLanguage(sources: TokoSource[]): Record<string, unknown> {
  const groups: Record<string, { code: string; label: string; flag: string; isDub: boolean; sources: TokoSource[] }> = {};
  for (const source of sources) {
    const code = source.audioLanguage || "und";
    if (!groups[code]) {
      groups[code] = {
        code,
        label: source.language || code.toUpperCase(),
        flag: source.languageLabel?.trim().split(/\s+/)[0] || "🌐",
        isDub: Boolean(source.isDub),
        sources: [],
      };
    }
    groups[code].sources.push(source);
  }
  return groups;
}

async function readTokoResponse(
  response: Response,
  onSource?: (source: TokoSource) => void
): Promise<{ rawSources: TokoSource[]; byLanguage?: Record<string, unknown>; complete: boolean } | null> {
  const rawSources: TokoSource[] = [];
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  let complete = false;
  let byLanguage: Record<string, unknown> | undefined;

  const processEvent = (frame: string) => {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;

    try {
      const payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
      if (eventName === "source") {
        const source = payload as unknown as TokoSource;
        if (typeof source.url === "string" && source.url.trim()) {
          rawSources.push(source);
          onSource?.(source);
        }
      } else if (eventName === "done") {
        complete = true;
        if (payload.byLanguage && typeof payload.byLanguage === "object") {
          byLanguage = payload.byLanguage as Record<string, unknown>;
        }
      }
    } catch {
      // Ignore single malformed frame
    }
  };

  if (!contentType.includes("text/event-stream")) {
    const text = await response.text();
    if (text.includes("<!DOCTYPE html") || text.toLowerCase().includes("challenge")) return null;
    if (text.includes("event:") || text.includes("data:")) {
      const frames = text.split(/\r?\n\r?\n/);
      for (const frame of frames) processEvent(frame);
      return { rawSources, byLanguage, complete: complete || rawSources.length > 0 };
    }
    try {
      const data = JSON.parse(text) as TokoStreamResponse;
      for (const source of data.sources || []) onSource?.(source);
      return { rawSources: data.sources || [], byLanguage: data.byLanguage, complete: true };
    } catch {
      return null;
    }
  }

  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const frames = pending.split(/\r?\n\r?\n/);
      pending = frames.pop() || "";
      for (const frame of frames) processEvent(frame);
    }
    pending += decoder.decode();
    if (pending.trim()) processEvent(pending);
  } catch {
    // Keep sources already received if the provider sweep or request is aborted.
  }

  if (!complete && rawSources.length === 0) return null;
  return { rawSources, byLanguage, complete: complete || rawSources.length > 0 };
}

function isBlockedSource(s: TokoSource): boolean {
  const provider = `${s.providerName || ""} ${s.providerKey || ""} ${s.source || ""} ${s.server || ""}`.toLowerCase();
  if (
    provider.includes("hindmovie") ||
    provider.includes("mvlink") ||
    provider.includes("animesama") ||
    provider.includes("moviebox") ||
    provider.includes("rubystm") ||
    /p2p[\s._-]*play/i.test(provider) ||
    provider.includes("cloudy") ||
    provider.includes("upns")
  ) return true;

  const urlStr = (s.url || "").toLowerCase();
  if (/\.(mkv|zip|rar|7z|tar|gz|torrent|iso)(\?|$)/i.test(urlStr)) return true;
  if (
    urlStr.includes("cloudy.upns.one") ||
    urlStr.includes("upns.one") ||
    urlStr.includes("rubystm.com") ||
    urlStr.includes("p2pplay.pro")
  ) return true;
  if (BLOCKED_STREAM_DOMAINS.some((d) => urlStr.includes(d) || provider.includes(d))) return true;

  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    if (BLOCKED_STREAM_DOMAINS.some((d) => host.includes(d))) return true;
  } catch {
    return true;
  }
  return false;
}

function isValidStreamUrl(s: string): boolean {
  if (!s || typeof s !== "string") return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Fetch and prioritize stream sources from Toko aggregator.
 * Priority:
 *   1. AnimeSalt Hindi source (Server 1 default)
 *   2. English Dub/Sub
 *   3. Japanese Audio
 *   4. Other languages
 */
async function fetchTokoSources(
  slug: string,
  season: string,
  episodeNumber: string,
  requestSignal?: AbortSignal,
  onSource?: (source: TokoSource) => void
): Promise<{ rawSources: TokoSource[]; byLanguage?: Record<string, unknown> }> {
  const cacheKey = JSON.stringify([slug.toLowerCase(), season, episodeNumber]);
  if (requestSignal?.aborted) return { rawSources: [] };
  const cached = tokoSourceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) tokoSourceCache.delete(cacheKey);

  // Season-aware title variants: Toko uses the title (not ?season=) for content routing
  const titleVariants = slugToTitleVariants(slug, season);
  if (titleVariants.length === 0) return { rawSources: [] };

  const params = new URLSearchParams();
  for (const t of titleVariants) params.append("titles[]", t);
  // Keep season + episode for any Toko backends that DO parse them
  params.set("season", season);
  params.set("episode", episodeNumber);
  // Omit stream=0 to use the backend's existing progressive SSE response.

  const directUrl = `${TOKO_API_URL}/api/v3/toko/stream?${params.toString()}`;
  const proxyUrl = buildCfProxyUrl(directUrl);
  const workerSecret = process.env.CF_PROXY_SHARED_SECRET?.trim();

  let data: { rawSources: TokoSource[]; byLanguage?: Record<string, unknown>; complete: boolean } | null = null;

  const fetchSources = async (url: string, throughWorker = false) => {
    const controller = new AbortController();
    const abortFromRequest = () => controller.abort();
    if (requestSignal?.aborted) controller.abort();
    else requestSignal?.addEventListener("abort", abortFromRequest, { once: true });
    const timer = setTimeout(() => controller.abort(), TOKO_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        headers: throughWorker ? {
          ...DEFAULT_HEADERS,
          ...(workerSecret ? { "x-hindianime-proxy-secret": workerSecret } : {}),
        } : DEFAULT_HEADERS,
      });
      if (!res.ok) {
        if (throughWorker) {
          console.error("[toko-worker] Worker returned a non-OK response; Toko sources were unavailable.", {
            status: res.status,
          });
        }
        return null;
      }
      return await readTokoResponse(res, onSource);
    } finally {
      clearTimeout(timer);
      requestSignal?.removeEventListener("abort", abortFromRequest);
    }
  };

  // Vercel egress is not a reliable path to Toko; use the existing Worker
  // immediately there instead of waiting on a request that is likely to fail.
  if (process.env.VERCEL !== "1") {
    try {
      data = await fetchSources(directUrl);
    } catch {
      // direct fetch error, fall back to worker proxy
    }
  }

  // 2. Try proxy fetch if direct fetch failed or returned no sources
  if (!data || data.rawSources.length === 0) {
    if (!workerSecret) {
      console.error("[stream-proxy] Worker Toko fallback skipped: server proxy secret is not configured");
    } else {
      try {
        data = await fetchSources(proxyUrl, true);
      } catch (err) {
        console.error("[stream-proxy] Worker Toko fallback error:", err);
      }
    }
  }

  // 3. Fallback: try stream=0 via Worker proxy if still empty
  if (!data || data.rawSources.length === 0) {
    if (workerSecret) {
      try {
        const stream0Url = `${directUrl}&stream=0`;
        const proxyStream0Url = buildCfProxyUrl(stream0Url);
        data = await fetchSources(proxyStream0Url, true);
      } catch {
        // stream=0 fallback error
      }
    }
  }


  const rawSources = orderTokoSources(data?.rawSources || []);
  const result = { rawSources, byLanguage: data?.byLanguage || groupTokoSourcesByLanguage(rawSources) };
  if (rawSources.length > 0 && data?.complete) {
    // Toko links are short-lived. Reuse only briefly and only for this exact
    // anime/season/episode; never cache empty or failed responses.
    if (tokoSourceCache.size >= 100) {
      const now = Date.now();
      for (const [key, entry] of tokoSourceCache) {
        if (entry.expiresAt <= now) tokoSourceCache.delete(key);
      }
      if (tokoSourceCache.size >= 100) tokoSourceCache.delete(tokoSourceCache.keys().next().value!);
    }
    tokoSourceCache.set(cacheKey, { expiresAt: Date.now() + TOKO_SOURCE_CACHE_TTL_MS, value: result });
  }
  return result;
}

function isHindi(s: { audioLanguage?: string; language?: string; languageLabel?: string }): boolean {
  const a = (s.audioLanguage || "").toLowerCase();
  const l = (s.language || "").toLowerCase();
  const lb = (s.languageLabel || "").toLowerCase();
  return a === "hi" || l.includes("hindi") || lb.includes("hindi");
}

function isJapanese(s: { audioLanguage?: string; language?: string; languageLabel?: string }): boolean {
  const a = (s.audioLanguage || "").toLowerCase();
  const l = (s.language || "").toLowerCase();
  const lb = (s.languageLabel || "").toLowerCase();
  return a === "ja" || l.includes("japanese") || lb.includes("japanese");
}

function isTamil(s: { audioLanguage?: string; language?: string; languageLabel?: string }): boolean {
  const a = (s.audioLanguage || "").toLowerCase();
  const l = (s.language || "").toLowerCase();
  const lb = (s.languageLabel || "").toLowerCase();
  return a === "ta" || l.includes("tamil") || lb.includes("tamil");
}

function isTelugu(s: { audioLanguage?: string; language?: string; languageLabel?: string }): boolean {
  const a = (s.audioLanguage || "").toLowerCase();
  const l = (s.language || "").toLowerCase();
  const lb = (s.languageLabel || "").toLowerCase();
  return a === "te" || l.includes("telugu") || lb.includes("telugu");
}

function isEnglish(s: { audioLanguage?: string; language?: string; languageLabel?: string }): boolean {
  const a = (s.audioLanguage || "").toLowerCase();
  const l = (s.language || "").toLowerCase();
  const lb = (s.languageLabel || "").toLowerCase();
  return a === "en" || l.includes("english") || lb.includes("english");
}

function isVidmolySource(s: TokoSource): boolean {
  return /vidmoly|vmnow\.online/i.test(
    `${s.providerKey || ""} ${s.providerName || ""} ${s.source || ""} ${s.url || ""}`
  );
}

function isHlsSource(s: TokoSource): boolean {
  return s.type === "hls" || Boolean(s.isM3U8) || /\.m3u8(?:[?#]|$)/i.test(s.url || "");
}

function isDirect(s: TokoSource): boolean {
  // Vidmoly playlist links are unreliable through our HLS proxy. Use their
  // actual iframe URL from Referer when Toko provides one.
  if (isVidmolySource(s)) return false;
  return isHlsSource(s) || s.type === "mp4";
}

function isUnverifiedMegaPlayEmbed(s: TokoSource): boolean {
  // MegaPlay embed URLs don't carry a matched anime title, so the app cannot
  // verify what they will play. Avoid attaching an unverified iframe to a
  // different anime's watch page. Direct streams keep their existing handling.
  return s.type === "embed" && /megaplay\.buzz/i.test(s.url || "");
}

function buildSignedHlsUrl(streamUrl: string, referer?: string, origin?: string): string {
  const secret = process.env.CF_PROXY_SHARED_SECRET?.trim();
  const exp = String(Math.floor(Date.now() / 1000) + 7200);
  const p = new URLSearchParams({ url: streamUrl, exp });
  if (referer) p.set("referer", referer);
  if (origin)  p.set("origin",  origin);
  if (secret) {
    const payload = `${streamUrl}:${exp}`;
    const sig = createHmac("sha256", secret).update(payload).digest("hex");
    p.set("sig", sig);
  }
  return `/api/hls-proxy?${p.toString()}`;
}

function buildTokoItem(s: TokoSource): StreamItem {
  const isDirectStream = isDirect(s);
  const flag = isHindi(s) ? "🇮🇳" : isJapanese(s) ? "🇯🇵" : isEnglish(s) ? "🇬🇧" : "🌐";
  const langName = isHindi(s) ? "Hindi Dub" : isJapanese(s) ? "Japanese" : (s.language || "Multi");
  const streamUrl = (s.url || "")
    .replace(/\\+u0026/gi, "&")
    .replace(/&amp;/gi, "&")
    .trim();

  const hdrs = (s.headers as Record<string, string>) || {};
  const referer = hdrs.Referer || hdrs.referer || "";
  const origin  = hdrs.Origin  || hdrs.origin  || "";

  let hlsProxyUrl: string | undefined;
  if (isDirectStream) {
    hlsProxyUrl = buildSignedHlsUrl(streamUrl, referer, origin);
  }

  // Playable embed fallback if direct stream fails:
  // For toonstream-vidmoly, referer is the actual working embed URL (https://vidmoly.net/embed-...html)
  const embedFallback = (referer && referer.startsWith("http") && !referer.includes(".m3u8"))
    ? referer
    : streamUrl;

  return {
    server: "",
    label: "",
    embed: isDirectStream || (isHlsSource(s) && embedFallback !== streamUrl) ? embedFallback : streamUrl,
    url: isDirectStream ? (hlsProxyUrl || streamUrl) : undefined,
    hlsProxyUrl,
    type: isDirectStream ? (s.type === "mp4" ? "mp4" : "hls") : "embed",
    audioLanguage: s.audioLanguage || (isHindi(s) ? "hi" : isJapanese(s) ? "ja" : isTamil(s) ? "ta" : isTelugu(s) ? "te" : isEnglish(s) ? "en" : "und"),
    languageLabel: s.languageLabel || `${flag} ${langName}`,
    adFree: isDirectStream,
    headers: s.headers,
  };
}

async function resolveRavokHls(hash: string): Promise<string | null> {
  if (!/^[a-zA-Z0-9]{8,80}$/.test(hash || "")) return null;
  try {
    const body = new URLSearchParams({ hash, r: "https://animesalt.cx/" });
    const res = await fetch(
      "https://ravok.buzz/player/index.php?data=" + encodeURIComponent(hash) + "&do=getVideo",
      {
        method: "POST",
        headers: {
          ...DEFAULT_HEADERS,
          Referer: "https://ravok.buzz/video/" + hash,
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const source = (data?.videoSource || data?.securedLink) as string | undefined;
    if (typeof source !== "string") return null;
    const parsed = new URL(source);
    if (parsed.protocol !== "https:") return null;
    return source;
  } catch {
    return null;
  }
}

function findAnimaHdFileId(html: string, season: string, ep: string): string | null {
  const regex = /<a[^>]*class=["'][^"']*app-ep-row-item[^"']*["'][^>]*data-season=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  const episodes: Array<{ fileId: string; seasonNum: number; epNum: number }> = [];
  while ((match = regex.exec(html)) !== null) {
    const file = match[2].match(/data-fileid=["']([a-zA-Z0-9_-]{20,100})["']/i);
    if (!file) continue;
    const titleMatch = match[2].match(/<div[^>]*font-size:\s*14px[^>]*>([\s\S]*?)<\/div>/i);
    const title = (titleMatch?.[1] || "").replace(/<[^>]+>/g, " ").trim();
    const seasonMatch = match[1].match(/\d+/);
    let seasonNum = seasonMatch ? Number(seasonMatch[0]) : 1;
    let epNum = episodes.length + 1;
    const both = title.match(/S(\d+)E(\d+)/i);
    const onlyEp = title.match(/(?:ep|episode)[-.\s]*(\d+)/i);
    if (both) { seasonNum = Number(both[1]); epNum = Number(both[2]); }
    else if (onlyEp) epNum = Number(onlyEp[1]);
    episodes.push({ fileId: file[1], seasonNum, epNum });
  }
  const epTarget = episodes.find((item) => item.seasonNum === Number(season) && item.epNum === Number(ep));
  return epTarget?.fileId || null;
}

async function fetchGoogleDriveSource(slug: string, season: string, ep: string): Promise<StreamItem | null> {
  const cleanSlug = slug.replace(/-season-\d+$/i, "").replace(/-s\d+$/i, "");
  let fileId: string | null = null;
  try {
    const res = await fetch("https://animahd.com/" + encodeURIComponent(cleanSlug) + "/", {
      headers: { ...DEFAULT_HEADERS, Accept: "text/html", Referer: "https://animahd.com/" },
    });
    if (res.ok) {
      const html = await res.text();
      fileId = findAnimaHdFileId(html, season, ep);
    }
  } catch { /* try WP search */ }

  if (!fileId) {
    try {
      const query = "https://animahd.com/wp-json/wp/v2/posts?search=" +
        encodeURIComponent(cleanSlug.replace(/-/g, " ")) + "&_embed&per_page=8";
      const res = await fetch(query, { headers: { ...DEFAULT_HEADERS, Accept: "application/json" } });
      if (res.ok) {
        const posts = (await res.json()) as Array<{ slug?: string; title?: { rendered?: string }; link?: string }>;
        if (Array.isArray(posts) && posts.length) {
          const words = cleanSlug.split("-").filter((word) => word.length > 2);
          const best = posts.map((post) => {
            const normalized = (String(post.slug || "") + " " + String(post.title?.rendered || ""))
              .toLowerCase().replace(/[^a-z0-9]+/g, " ");
            const tokens = new Set(normalized.split(/\s+/).filter(Boolean));
            return { post, score: words.length ? words.filter((word) => tokens.has(word)).length / words.length : 0 };
          }).sort((a, b) => b.score - a.score)[0];
          if (best && best.score >= 0.6 && typeof best.post.link === "string") {
            const pageRes = await fetch(best.post.link, {
              headers: { ...DEFAULT_HEADERS, Accept: "text/html", Referer: "https://animahd.com/" },
            });
            if (pageRes.ok) {
              const html = await pageRes.text();
              fileId = findAnimaHdFileId(html, season, ep);
            }
          }
        }
      }
    } catch { /* no Drive result */ }
  }

  if (!fileId) return null;
  const embed = "https://drive.google.com/file/d/" + encodeURIComponent(fileId) + "/preview";
  return {
    server: "Server 2",
    slot: "server-2",
    source: "GoogleDrive",
    sourceProvider: "GoogleDrive",
    label: "Server 2 · Google Drive",
    embed,
    url: embed,
    type: "embed",
    audioLanguage: "hi",
    languageLabel: "Hindi Dub",
    adFree: true,
  };
}

async function fetchPlayZenSource(slug: string, season: string, ep: string): Promise<StreamItem | null> {
  const cleanSlug = slug.replace(/-season-\d+$/i, "").replace(/-s\d+$/i, "");
  const targets = [
    "https://animeflash.live/episode/" + cleanSlug + "/" + season + "x" + ep,
    "https://animeflash.live/episode/" + cleanSlug + "-" + season + "x" + ep,
  ];
  if (season === "1" && ep === "1") targets.push("https://animeflash.live/movie/" + cleanSlug);

  const workerSecret = process.env.CF_PROXY_SHARED_SECRET?.trim();

  for (const target of targets) {
    // Try via Cloudflare Worker first (avoids Vercel IP blocks), then direct
    const fetchCandidates: Array<{ url: string; throughWorker: boolean }> = [
      { url: buildCfProxyUrl(target), throughWorker: true },
      { url: target, throughWorker: false },
    ];

    for (const { url, throughWorker } of fetchCandidates) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            ...DEFAULT_HEADERS,
            Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
            Referer: "https://animeflash.live/",
            ...(throughWorker && workerSecret ? { "x-hindianime-proxy-secret": workerSecret } : {}),
          },
        });
        if (!res.ok) continue;
        const text = await res.text();

        // Extract PlayZen token cleanly without RSC chunk metadata
        let playzenToken: string | null = null;
        const rscMatch = text.match(/:T([0-9a-fA-F]+),https?:\/\/archive\.animeinfinity\.me\/player\/([^\r\n"']+)/);
        if (rscMatch) {
          const totalLen = parseInt(rscMatch[1], 16);
          const prefixLen = "https://archive.animeinfinity.me/player/".length;
          const tokenLen = totalLen - prefixLen;
          if (tokenLen > 0 && rscMatch[2].length >= tokenLen) {
            playzenToken = rscMatch[2].slice(0, tokenLen);
          }
        }
        if (!playzenToken) {
          const quotedMatch = text.match(/https?:\/\/archive\.animeinfinity\.me\/player\/([A-Za-z0-9+/_=%-]+?)["'\s\\]/);
          if (quotedMatch) playzenToken = quotedMatch[1];
        }
        if (!playzenToken) {
          const chunkMatch = text.match(/https?:\/\/archive\.animeinfinity\.me\/player\/([A-Za-z0-9+/_=%-]+?)(?:[0-9a-f]{1,4}:[T\[]|["'\s\\]|$)/i);
          if (chunkMatch) playzenToken = chunkMatch[1];
        }
        if (!playzenToken) continue;

        const embed = "https://archive.animeinfinity.me/player/" + playzenToken.replace(/\\/g, "");
        return {
          server: "Server 3",
          slot: "server-3",
          source: "PlayZen",
          sourceProvider: "PlayZen",
          label: "Server 3 · PlayZen",
          embed,
          url: embed,
          type: "embed",
          audioLanguage: "hi",
          languageLabel: "Hindi Dub",
          adFree: true,
        };
      } catch {
        // try next candidate
      } finally {
        clearTimeout(timer);
      }
    }
  }
  return null;
}

function assembleServers(
  rawSources: TokoSource[],
  animeSaltItems: StreamItem[],
  animeSlug: string,
  gdriveSource?: StreamItem | null,
  playzenSource?: StreamItem | null
): StreamItem[] {
  const list: StreamItem[] = [];
  const usedUrls = new Set<string>();
  const safeRawSources = rawSources.filter((source) => !isUnverifiedMegaPlayEmbed(source));

  function add(item: StreamItem | null | undefined, label: string, slot?: string) {
    if (!item) return;
    const key = item.type !== "embed" ? (item.url || item.embed || "") : (item.embed || item.url || "");
    if (!key) return;
    if (usedUrls.has(key)) return;
    usedUrls.add(key);
    const server = label.match(/^Server\s+\d+/)?.[0] || `Server ${list.length + 1}`;
    list.push({ ...item, server, label, slot: slot || item.slot });
  }

  // ── Slot 1: MyStream Embed (default; no ads, navigation restricted) ───────
  // HLS (Hindi Anime direct stream) is disabled until VPS hosting is ready.
  // To re-enable HLS as Server 1, uncomment the HLS block below and move
  // MyStream back to Slot 2.
  const mystream = animeSaltItems.find(
    (s) => s.type === "embed" && !s.languageSources?.length && isHindi(s) && (s.embed.includes("ravok.buzz") || (s.label || "").toLowerCase().includes("mystream")) && !usedUrls.has(s.embed)
  ) || animeSaltItems.find(
    (s) => s.type === "embed" && !s.languageSources?.length && (s.embed.includes("ravok.buzz") || (s.label || "").toLowerCase().includes("mystream")) && !usedUrls.has(s.embed)
  ) || safeRawSources.find((s) => !isBlockedSource(s) && !isDirect(s) && (s.url || "").includes("ravok.buzz"));

  if (mystream) {
    if ("embed" in mystream) {
      add({ ...(mystream as StreamItem), adFree: true, restrictNavigation: true }, "Server 1 · MyStream", "server-1");
    } else {
      add({ ...buildTokoItem(mystream as TokoSource), adFree: true, restrictNavigation: true }, "Server 1 · MyStream", "server-1");
    }
  }

  // ── HLS disabled — re-enable when VPS hosting is available ───────────────
  // const hlsSource = animeSaltItems.find((s) => s.type === "hls" && Boolean(s.directHlsUrl || s.url)) ||
  //   safeRawSources.find((s) => !isBlockedSource(s) && isDirect(s) && isHindi(s));
  // if (hlsSource) {
  //   if ("url" in hlsSource && (hlsSource as StreamItem).directHlsUrl) {
  //     add(hlsSource as StreamItem, "Server 2 · Hindi Anime HLS", "server-2");
  //   } else {
  //     add(buildTokoItem(hlsSource as TokoSource), "Server 2 · Hindi Anime HLS", "server-2");
  //   }
  // }

  // ── Slot 2: Google Drive ─────────────────────────────────────────────────
  if (gdriveSource) {
    add(gdriveSource, "Server 2 · Google Drive", "server-2");
  }

  // ── Slot 3: PlayZen ──────────────────────────────────────────────────────
  if (playzenSource) {
    add(playzenSource, "Server 3 · PlayZen", "server-3");
  }

  // ── Remaining Fallback Mirrors (Abyss, Toko, etc.) ───────────────────────
  const abyssMultiLanguage = animeSaltItems.find((item) => (item.languageSources?.length || 0) > 0);
  if (abyssMultiLanguage) {
    add(abyssMultiLanguage, `Server ${list.length + 1} · 🌐 Abyss Multi-Audio`);
  }

  for (const s of animeSaltItems) {
    if (list.length >= 7) break;
    if (!s.languageSources?.length && !usedUrls.has(s.embed)) {
      add(s, `Server ${list.length + 1} · ${s.languageLabel || s.label || "Alternative"}`);
    }
  }

  for (const s of safeRawSources) {
    if (list.length >= 7) break;
    if (!isBlockedSource(s) && !usedUrls.has(s.url || "")) {
      add(buildTokoItem(s), `Server ${list.length + 1} · ${s.languageLabel || s.language || "Alternative"}`);
    }
  }

  return list;
}

/**
 * Parse streaming embed sources from AnimeSalt HTML, fetched either by the
 * existing Worker request (GET) or by the browser through that same Worker (POST).
 * Extracts AbyssPlayer multi-language embeds (Hindi, Japanese, English, etc.)
 * and direct video iframes (MyStream / ravok.buzz).
 */
async function fetchAnimeSaltSources(
  slug: string,
  season: string,
  episode: string,
  browserResult?: { targetUrl: string; html: string; isMovie?: boolean } | null,
  isMovieRequest = false
): Promise<StreamItem[]> {
  const sNum = parseInt(season, 10);
  const epNum = parseInt(episode, 10);
  const baseSlug = cleanAnimeSlug(slug);
  const episodeCandidates = [
    `https://animesalt.cx/episode/${baseSlug}-${sNum}x${epNum}/`,
    `https://animesalt.cx/episode/${slug}-${sNum}x${epNum}/`,
    `https://animesalt.cx/episode/${baseSlug}-${epNum}/`,
  ];
  const movieCandidates = [
    `https://animesalt.cx/movies/${slug}/`,
    `https://animesalt.cx/movies/${baseSlug}/`,
  ];
  const movieLookup = isMovieRequest || browserResult?.isMovie === true;
  const candidates = movieLookup ? movieCandidates : episodeCandidates;
  const validMovieUrl = browserResult?.isMovie && candidates.some((c) => c.includes("/movies/") && browserResult.targetUrl === c);
  if (browserResult && !validMovieUrl && !candidates.includes(browserResult.targetUrl)) return [];

  // Retrieve AnimeSalt through the general Worker proxy. Use direct fallback
  // only for network/server failures; a 4xx on a candidate moves to the next candidate.
  for (const targetUrl of new Set(candidates)) {
    const proxyUrl = buildCfProxyUrl(targetUrl);
    // Try CF proxy first on production so Cloudflare IP protection on animesalt.cx is bypassed
    const fetchUrls: Array<string | null> = browserResult ? [null] : [proxyUrl];

    for (const urlToFetch of fetchUrls) {
      const attemptType = browserResult ? "Browser Worker" : "Worker";
      const target = new URL(targetUrl);
      const targetHostPath = `${target.hostname}${target.pathname}`;
      let httpStatus: number | null = null;
      let contentType: string | null = null;
      let responseBodyLength: number | null = null;
      let passedResponseChecks = false;
      let parserResultCount = 0;
      let caughtError: string | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;

      try {
        let html: string;
        if (urlToFetch === null) {
          if (!browserResult?.html) continue;
          html = browserResult.html;
          passedResponseChecks = html.length >= 1000 && !html.includes("404 Not Found") && !isCloudflareChallenge(html);
          if (!passedResponseChecks) continue;
        } else {
          const controller = new AbortController();
          // The Worker allows up to 10 seconds for upstream AnimeSalt fetches.
          // Leave enough time for the Worker response to return to Vercel too.
          timer = setTimeout(() => controller.abort(), 12_000);
          const res = await fetch(urlToFetch, {
            signal: controller.signal,
            cache: "no-store",
            headers: {
              ...DEFAULT_HEADERS,
              Accept: "text/html",
              ...(attemptType === "Worker" ? { Origin: "https://hindianime-seven.vercel.app" } : {}),
            },
          });
          httpStatus = res.status;
          contentType = res.headers.get("content-type");
          html = await res.text();
          responseBodyLength = html.length;
          if (res.status >= 400 && res.status < 500) break;
          if (isCloudflareChallenge(html)) break;
          passedResponseChecks = res.ok && html.length >= 1000 && !html.includes("404 Not Found") && !isCloudflareChallenge(html);
          if (!passedResponseChecks) continue;
        }

        const items: StreamItem[] = [];
        const usedUrls = new Set<string>();

        // 1. Look for Plyr base64 JSON (Abyssplayer by language)
        const plyrMatch = html.match(/player\.php\?data=([A-Za-z0-9%_-]+)/);
        if (plyrMatch) {
          try {
            const rawB64 = decodeURIComponent(plyrMatch[1]);
            const decoded = Buffer.from(rawB64, "base64").toString("utf8");
            const parsed = JSON.parse(decoded) as Array<{ language?: string; link?: string }>;
            if (Array.isArray(parsed)) {
              const languageSources: NonNullable<StreamItem["languageSources"]> = [];
              for (const p of parsed) {
                if (p.link && !usedUrls.has(p.link) && !BLOCKED_STREAM_DOMAINS.some((d) => p.link!.includes(d))) {
                  usedUrls.add(p.link);
                  const lang = p.language || "Multi";
                  const isHi = /hindi/i.test(lang);
                  const isJa = /japanese/i.test(lang);
                  const isTamil = /tamil/i.test(lang);
                  const isTelugu = /telugu/i.test(lang);
                  const isEnglish = /english/i.test(lang);
                  const code = isHi ? "hi" : isJa ? "ja" : isTamil ? "ta" : isTelugu ? "te" : isEnglish ? "en" : lang.toLowerCase();
                  languageSources.push({ code, label: lang, embed: p.link });
                }
              }
              if (languageSources.length > 0) {
                const defaultSource = languageSources.find((source) => source.code === "hi") || languageSources[0];
                items.push({
                  server: "AnimeSalt Abyss",
                  sourceProvider: "AnimeSalt",
                  label: "AnimeSalt · Abyss Multi-Audio",
                  embed: defaultSource.embed,
                  type: "embed",
                  audioLanguage: defaultSource.code,
                  languageLabel: defaultSource.label,
                  languageSources,
                  adFree: false,
                });
              }
            }
          } catch (err) {
            caughtError = err instanceof Error ? err.message : String(err);
          }
        }

        // 2. Look for iframe embeds (e.g. ravok.buzz / mystream)
        const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/gi;
        let m: RegExpExecArray | null;
        while ((m = iframeRegex.exec(html)) !== null) {
          const src = m[1];
          if (src && !usedUrls.has(src) && !src.includes("player.php") && !BLOCKED_STREAM_DOMAINS.some((d) => src.includes(d))) {
            usedUrls.add(src);
            const isRavok = src.includes("ravok.buzz");
            items.push({
              server: isRavok ? "AnimeSalt MyStream" : "AnimeSalt Embed",
              sourceProvider: "AnimeSalt",
              label: isRavok ? "AnimeSalt · 🇮🇳 MyStream" : "AnimeSalt · Embed",
              embed: src,
              type: "embed",
              audioLanguage: "hi",
              languageLabel: "🇮🇳 Hindi",
              adFree: false,
            });
          }
        }

        // HLS (direct stream) is disabled until VPS hosting is available.
        // MyStream embed is used as Server 1 instead.
        // const ravokMatch = html.match(/https?:\/\/ravok\.buzz\/(?:video|embed|e)\/([a-zA-Z0-9]+)/i);
        // const ravokHash = ravokMatch?.[1];
        // if (ravokHash) {
        //   const directHlsUrl = await resolveRavokHls(ravokHash);
        //   if (directHlsUrl) { ... }
        // }

        const myStream = items.find((item) => item.embed.includes("ravok.buzz"));
        const unavailableMyStream = myStream
          ? await isKnownUnavailableMyStream(myStream.embed)
          : false;
        const validatedItems = unavailableMyStream
          ? items.filter((item) => item !== myStream)
          : items;

        parserResultCount = validatedItems.length;
        if (validatedItems.length > 0) {
          return validatedItems;
        }
      } catch (err) {
        caughtError = err instanceof Error ? err.message : String(err);
        // try next fetchUrl or candidate
      } finally {
        if (timer) clearTimeout(timer);
        console.info("[AnimeSalt attempt]", {
          attemptType,
          targetHostPath,
          httpStatus,
          contentType,
          responseBodyLength,
          passedResponseChecks,
          parserResultCount,
          caughtError,
        });
      }
    }
  }
  return [];
}

async function buildStreamResponse(
  cleanId: string,
  season: string,
  ep: string,
  browserResult?: { targetUrl: string; html: string; isMovie?: boolean } | null,
  isMovieRequest = false
) {
  const [tokoData, animeSaltItems, gdriveSource, playzenSource] = await Promise.all([
    fetchTokoSources(cleanId, season, ep).catch(() => ({ rawSources: [] as TokoSource[], byLanguage: undefined })),
    (browserResult === undefined
      ? fetchAnimeSaltSources(cleanId, season, ep, undefined, isMovieRequest)
      : browserResult === null
        ? Promise.resolve([] as StreamItem[])
        : fetchAnimeSaltSources(cleanId, season, ep, browserResult, isMovieRequest)
    ).catch(() => [] as StreamItem[]),
    fetchGoogleDriveSource(cleanId, season, ep).catch(() => null),
    fetchPlayZenSource(cleanId, season, ep).catch(() => null),
  ]);

  const finalResults = assembleServers(
    tokoData.rawSources,
    animeSaltItems,
    cleanId,
    gdriveSource,
    playzenSource
  );

  if (finalResults.length > 0) {
    return NextResponse.json(
      {
        success: true,
        message: "Stream Found!!",
        version: "v2-cf-animesalt",
        saltCount: animeSaltItems.length,
        results: finalResults,
        byLanguage: tokoData.byLanguage,
      },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  }

  return NextResponse.json(
    { success: false, message: "No valid streams found", results: [], saltCount: 0 },
    {
      status: 404,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    }
  );
}

async function isKnownUnavailableMyStream(embedUrl: string): Promise<boolean> {
  try {
    if (new URL(embedUrl).hostname.toLowerCase() !== "ravok.buzz") return false;
  } catch {
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(buildServerWorkerProxyUrl(embedUrl), {
      signal: controller.signal,
      cache: "no-store",
      headers: getServerWorkerHeaders({ ...DEFAULT_HEADERS, Accept: "text/html" }),
    });
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
      return false;
    }

    const html = await response.text();
    return (
      html.length <= 64 * 1024 &&
      /<title[^>]*>\s*error\s*<\/title>/i.test(html) &&
      /\bvideo not found\b/i.test(html)
    );
  } catch {
    // A failed health check is inconclusive; leave source handling unchanged.
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function isAuthorizedFrontendRequest(request: Request): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") {
    return false;
  }

  const host = request.headers.get("host")?.toLowerCase() || "";
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  const isTrustedHost = (h: string) =>
    h === host ||
    h === "localhost:3000" ||
    h.includes("localhost") ||
    h.endsWith(".hindi-anime.com") ||
    h === "hindi-anime.com";

  if (origin) {
    try {
      const u = new URL(origin);
      if (!isTrustedHost(u.host.toLowerCase())) return false;
    } catch {
      return false;
    }
  }

  if (referer) {
    try {
      const u = new URL(referer);
      if (!isTrustedHost(u.host.toLowerCase())) return false;
    } catch {
      return false;
    }
  }

  return true;
}

export async function GET(request: Request) {
  if (!isAuthorizedFrontendRequest(request)) {
    return NextResponse.json(
      { success: false, message: "Unauthorized: Request rejected." },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const season = searchParams.get("season") || "1";
  const ep = searchParams.get("ep") || "1";
  const isMovieRequest = searchParams.get("movie") === "1";

  if (!id) {
    return NextResponse.json(
      { success: false, message: "Missing required parameter: id" },
      { status: 400 }
    );
  }

  let decodedId = id;
  try {
    if (id.includes("%")) {
      decodedId = decodeURIComponent(id);
    }
  } catch {
    // ignore
  }

  const cleanId = cleanAnimeSlug(decodedId) || decodedId;

  return buildStreamResponse(cleanId, season, ep, undefined, isMovieRequest);
}

export async function POST(request: Request) {
  if (!isAuthorizedFrontendRequest(request)) {
    return NextResponse.json(
      { success: false, message: "Unauthorized: Request rejected." },
      { status: 403 }
    );
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 512 * 1024) {
    return NextResponse.json({ success: false, message: "AnimeSalt response is too large" }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body" }, { status: 400 });
  }
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ success: false, message: "Invalid request body" }, { status: 400 });
  }

  const body = payload as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ success: false, message: "Missing required parameter: id" }, { status: 400 });
  }
  const season = String(body.season ?? "1");
  const ep = String(body.ep ?? "1");
  const cleanId = cleanAnimeSlug(id) || id;

  let browserResult: { targetUrl: string; html: string; isMovie?: boolean } | null = null;
  if (body.animeSaltHtml !== undefined && body.animeSaltHtml !== null) {
    const targetUrl = typeof body.animeSaltTargetUrl === "string" ? body.animeSaltTargetUrl : "";
    const html = typeof body.animeSaltHtml === "string" ? body.animeSaltHtml : "";
    const isMovie = body.isMovie === true;
    const byteLength = new TextEncoder().encode(html).byteLength;
    if (
      !(isMovie
        ? targetUrl === buildAnimeSaltMovieUrl(cleanId)
        : buildAnimeSaltEpisodeCandidates(cleanId, season, ep).includes(targetUrl)) ||
      byteLength > 512 * 1024 ||
      !isValidAnimeSaltHtml(html)
    ) {
      return NextResponse.json({ success: false, message: "Invalid AnimeSalt response" }, { status: 400 });
    }
    browserResult = { targetUrl, html, isMovie };
  }

  const animeSaltPromise = browserResult
    ? fetchAnimeSaltSources(cleanId, season, ep, browserResult)
    : Promise.resolve([] as StreamItem[]);
  const encoder = new TextEncoder();

  const bodyStream = new ReadableStream<Uint8Array>({
    start(controller) {
      let animeSaltItems: StreamItem[] | null = null;
      let gdriveSource: StreamItem | null = null;
      let playzenSource: StreamItem | null = null;
      let tokoRaw: TokoSource[] = [];
      let lastSnapshot = "";
      const emit = (value: Record<string, unknown>) => {
        if (request.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        } catch {
          // The client may have navigated away while Toko was still resolving.
        }
      };

      const emitSnapshot = (complete: boolean, byLanguage?: Record<string, unknown>) => {
        if (!animeSaltItems) return;
        const results = assembleServers(orderTokoSources(tokoRaw), animeSaltItems, cleanId, gdriveSource, playzenSource);
        const signature = results.map((item) => `${item.server}\0${item.label}\0${item.embed}`).join("\x01");
        if (!complete && signature === lastSnapshot) return;
        lastSnapshot = signature;
        if (results.length > 0 || complete) {
          emit({
            ...(complete
              ? {
                  success: results.length > 0,
                  message: results.length > 0 ? "Stream Found!!" : "No valid streams found",
                  version: "v2-cf-animesalt",
                }
              : {}),
            results,
            saltCount: animeSaltItems.length,
            ...(byLanguage ? { byLanguage } : {}),
            complete,
          });
        }
      };

      void Promise.all([
        fetchGoogleDriveSource(cleanId, season, ep).then((s) => { gdriveSource = s; emitSnapshot(false); }).catch(() => {}),
        fetchPlayZenSource(cleanId, season, ep).then((s) => { playzenSource = s; emitSnapshot(false); }).catch(() => {}),
      ]);

      const tokoPromise = fetchTokoSources(cleanId, season, ep, request.signal, (source) => {
        tokoRaw.push(source);
        emitSnapshot(false);
      });

      void (async () => {
        animeSaltItems = await animeSaltPromise;
        emitSnapshot(false);

        const { rawSources, byLanguage } = await tokoPromise;
        tokoRaw = rawSources;
        emitSnapshot(true, byLanguage);
        controller.close();
      })().catch((error) => controller.error(error));
    },
  });

  return new Response(bodyStream, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Content-Type": "application/x-ndjson; charset=utf-8",
    },
  });
}
