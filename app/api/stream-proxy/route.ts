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
    provider.includes("cloudy") ||
    provider.includes("upns")
  ) return true;

  const urlStr = (s.url || "").toLowerCase();
  if (/\.(mkv|zip|rar|7z|tar|gz|torrent|iso)(\?|$)/i.test(urlStr)) return true;
  if (
    urlStr.includes("rubystm") ||
    urlStr.includes("cloudy.upns.one") ||
    urlStr.includes("upns.one")
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
    const secret = process.env.CF_PROXY_SHARED_SECRET;
    if (!secret) {
      console.error("[stream-proxy] CF_PROXY_SHARED_SECRET is not configured; refusing to issue unsigned proxy link.");
    } else {
      const exp = Math.floor(Date.now() / 1000) + 7200; // 2 hour window
      const payload = `${streamUrl}:${referer || ""}:${origin || ""}:${exp}`;
      const sig = createHmac("sha256", secret).update(payload).digest("hex");

      const params = new URLSearchParams({
        url: streamUrl,
        exp: String(exp),
        sig,
      });
      if (referer) params.set("referer", referer);
      if (origin)  params.set("origin",  origin);
      hlsProxyUrl = `${CF_WORKER_BASE}/hls-proxy?${params.toString()}`;
    }
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

function assembleServers(
  rawSources: TokoSource[],
  animeSaltItems: StreamItem[]
): StreamItem[] {
  const list: StreamItem[] = [];
  const usedUrls = new Set<string>();

  function add(item: StreamItem | null | undefined, label: string) {
    if (!item) return;
    // For direct streams, distinguish by item.url so embed fallbacks do not collide with pure embed slots
    const key = item.type !== "embed" ? (item.url || item.embed || "") : (item.embed || item.url || "");
    if (!key) return;
    if (usedUrls.has(key)) return;
    usedUrls.add(key);
    const server = label.match(/^Server\s+\d+/)?.[0] || "";
    list.push({ ...item, server, label });
  }

  const abyssMultiLanguage = animeSaltItems.find((item) => (item.languageSources?.length || 0) > 0);
  const isAbyssToko = (source: TokoSource) =>
    /abyssplayer|filesforever/i.test(`${source.url || ""} ${source.providerName || ""} ${source.providerKey || ""}`);
  const tokoAbyssItems = rawSources
    .filter((source) => !isBlockedSource(source) && !isDirect(source) && isAbyssToko(source))
    .map(buildTokoItem);
  const tokoAbyssLanguages = tokoAbyssItems
    .map((item) => {
      const label = item.languageLabel || item.audioLanguage || "Audio";
      const text = `${item.audioLanguage || ""} ${label}`.toLowerCase();
      const code = /hindi|\bhi\b/.test(text) ? "hi"
        : /tamil|\bta\b/.test(text) ? "ta"
        : /telugu|\bte\b/.test(text) ? "te"
        : /japanese|\bja\b/.test(text) ? "ja"
        : /english|\ben\b/.test(text) ? "en"
        : item.audioLanguage && item.audioLanguage !== "und" ? item.audioLanguage : label.toLowerCase();
      return { code, label, embed: item.embed };
    })
    .filter((source, index, all) => all.findIndex((candidate) => candidate.code === source.code) === index);
  const tokoAbyssDefault = tokoAbyssItems.find((item) => item.audioLanguage === "hi") || tokoAbyssItems[0];
  const tokoAbyssDefaultLanguage = tokoAbyssDefault
    ? tokoAbyssLanguages.find((source) => source.embed === tokoAbyssDefault.embed) || tokoAbyssLanguages[0]
    : undefined;
  const tokoAbyssGroup = tokoAbyssDefault && tokoAbyssLanguages.length > 0
    ? {
        ...tokoAbyssDefault,
        embed: tokoAbyssDefaultLanguage?.embed || tokoAbyssDefault.embed,
        audioLanguage: tokoAbyssDefaultLanguage?.code || tokoAbyssDefault.audioLanguage,
        languageLabel: tokoAbyssDefaultLanguage?.label || tokoAbyssDefault.languageLabel,
        label: "Toko · Abyss Multi-Audio",
        languageSources: tokoAbyssLanguages,
      }
    : undefined;
  const abyssPlayer = abyssMultiLanguage || tokoAbyssGroup;
  const hasAbyssPlayer = Boolean(abyssPlayer);

  // ── Slot 1: AnimeSalt Hindi source ───────────────────────────────────────
  const preferredSaltMyStream = animeSaltItems.find(
    (s) => !s.languageSources?.length && isHindi(s) && s.embed.includes("ravok.buzz") && !usedUrls.has(s.embed)
  );
  const preferredSaltHindi = preferredSaltMyStream || animeSaltItems.find(
    (s) => !s.languageSources?.length && isHindi(s) && !usedUrls.has(s.embed)
  );
  // Toko can expose the same MyStream/Ravok player even when the AnimeSalt
  // scraper returned no embeds for this episode. Prefer that source for slot 1.
  const tokoMyStream = rawSources.find((source) =>
    !isBlockedSource(source) && !isDirect(source) && isHindi(source) &&
    /ravok\.buzz(?:\/|$)/i.test(source.url || "")
  );
  if (preferredSaltHindi) {
    add(preferredSaltHindi, preferredSaltHindi.embed.includes("ravok.buzz")
      ? "Server 1 · 🇮🇳 AnimeSalt MyStream"
      : "Server 1 · 🇮🇳 AnimeSalt Hindi");
  } else if (tokoMyStream) {
    add(buildTokoItem(tokoMyStream), "Server 1 · 🇮🇳 MyStream · Toko");
  } else {
    const fallbackHindi = rawSources.find((source) =>
      !isBlockedSource(source) && !isAbyssToko(source) && isHindi(source) && !isDirect(source)
    );
    if (fallbackHindi) add(buildTokoItem(fallbackHindi), "Server 1 · 🇮🇳 Hindi Dub");
  }

  // Keep AnimeSalt's Abyss language variants together in one player entry.
  if (abyssPlayer) {
    add(abyssPlayer, `Server ${list.length + 1} · 🌐 ${abyssMultiLanguage ? "AnimeSalt Abyss" : "Abyss Multi-Audio"}`);
  }

  // Keep the playable Mega Play embed and VidMoly embed in predictable slots.
  const tokoMegaPlay = rawSources.find((source) =>
    !isBlockedSource(source) && !isDirect(source) && /megaplay\.buzz/i.test(source.url || "")
  );
  if (tokoMegaPlay) add(buildTokoItem(tokoMegaPlay), `Server ${list.length + 1} · Mega Play`);

  const tokoVidmolyEmbed = rawSources.find((source) =>
    !isBlockedSource(source) && !isDirect(source) &&
    /vidmoly\.(?:me|net)/i.test(`${source.url || ""} ${source.providerName || ""} ${source.providerKey || ""}`)
  );
  if (tokoVidmolyEmbed) add(buildTokoItem(tokoVidmolyEmbed), `Server ${list.length + 1} · VidMoly`);

  // ── Next slot: RubyVidHub Hindi Dub, when Toko provides it ────────────────
  const isRubyVidHub = (s: TokoSource) => {
    const provider = `${s.providerName || ""} ${s.providerKey || ""} ${s.source || ""}`.toLowerCase();
    let host = "";
    try { host = new URL(s.url).hostname.toLowerCase(); } catch { /* invalid URLs are filtered elsewhere */ }
    return host === "rubyvidhub.com" || host.endsWith(".rubyvidhub.com") || provider.includes("rubyvidhub");
  };
  const rubyVidHub = rawSources.find(
    (s) => !isBlockedSource(s) && isRubyVidHub(s) && !usedUrls.has(s.url || "")
  );
  if (rubyVidHub) add(buildTokoItem(rubyVidHub), `Server ${list.length + 1} · 🇮🇳 RubyVidHub`);
  else {
    const fallbackHindi = animeSaltItems.find((s) => !s.languageSources?.length && isHindi(s) && !usedUrls.has(s.embed));
    if (fallbackHindi && list.length < 2) add(fallbackHindi, `Server ${list.length + 1} · 🇮🇳 AnimeSalt Hindi Alt`);
  }

  const isToonStreamSource = (s: TokoSource) =>
    /toon[\s._-]*stream/i.test(
      `${s.providerName || ""} ${s.providerKey || ""} ${s.source || ""} ${s.server || ""} ${s.url || ""} ${s.headers?.Referer || s.headers?.referer || ""}`
    );

  // ── Slot 3: Remaining AnimeSalt/Toko Hindi source ─────────────────────────
  const saltMyStream = animeSaltItems.find(
    (s) => !s.languageSources?.length && !isBlockedSource({ url: s.embed } as TokoSource) &&
      (s.embed.includes("ravok.buzz") || (s.label || "").toLowerCase().includes("mystream")) &&
      !usedUrls.has(s.embed)
  );
  if (saltMyStream) {
    add(saltMyStream, "Server 2 · 🇮🇳 MyStream");
  } else {
    const nextSaltHindi = animeSaltItems.find((s) => !s.languageSources?.length && isHindi(s) && !usedUrls.has(s.embed));
    if (nextSaltHindi) add(nextSaltHindi, "Server 2 · 🇮🇳 Hindi (Abyss)");
  }

  // Keep Vidmoly out of this slot; it was replaced by RubyVidHub above.
  const isVidmoly = (s: TokoSource) => {
    const provider = `${s.providerName || ""} ${s.providerKey || ""} ${s.source || ""}`.toLowerCase();
    return /vidmoly|vmnow\.online|vmpx\.online|vmeas\.cloud/.test(`${provider} ${s.url || ""}`.toLowerCase());
  };
  const s3 = rawSources.find(
    (s) => !isBlockedSource(s) && !(hasAbyssPlayer && isAbyssToko(s)) && isHindi(s) && !isDirect(s) && !isVidmoly(s) && !isToonStreamSource(s) && !usedUrls.has(s.url || "")
  );
  if (s3) {
    add(buildTokoItem(s3), "Server 3 · 🇮🇳 Hindi Dub");
  } else {
    const saltHindi = animeSaltItems.find((s) => isHindi(s) && !usedUrls.has(s.embed));
    if (saltHindi) add(saltHindi, "Server 3 · 🇮🇳 Hindi (Abyss)");
  }

  // ── Slot 4: Toko Hindi Dub embed #2 (AbyssPlayer / FilesForever) ─────────
  const s4Abyss = rawSources.find(
    (s) => !hasAbyssPlayer && !isBlockedSource(s) && isHindi(s) && !isToonStreamSource(s) && isAbyssToko(s) && !usedUrls.has(s.url || "")
  );
  const s4 = s4Abyss || rawSources.find(
    (s) => !isBlockedSource(s) && !(hasAbyssPlayer && isAbyssToko(s)) && isHindi(s) && !isDirect(s) && !isToonStreamSource(s) && !usedUrls.has(s.url || "")
  );
  if (s4) {
    add(buildTokoItem(s4), "Server 4 · 🇮🇳 Abyss");
  } else {
    const saltHindi = animeSaltItems.find((s) => isHindi(s) && !usedUrls.has(s.embed));
    if (saltHindi) add(saltHindi, "Server 4 · 🇮🇳 Hindi (Abyss Alt)");
  }
  // Retain the original Server 3 URL in deduplication so no other role takes
  // it after the Server 3 substitution.
  if (s3?.url) usedUrls.add(s3.url);

  // ── Slot 5: AnimeSalt Tamil (Abyss) ───────────────────────────────────────
  const s5Salt = animeSaltItems.find((s) => isTamil(s) && !usedUrls.has(s.embed));
  if (s5Salt) {
    add(s5Salt, "Server 5 · 🌐 Tamil (Abyss)");
  }

  // ── Slot 6: AnimeSalt Telugu (Abyss) ─────────────────────────────────────
  const s6Salt = animeSaltItems.find((s) => isTelugu(s) && !usedUrls.has(s.embed));
  if (s6Salt) {
    add(s6Salt, "Server 6 · 🌐 Telugu (Abyss)");
  }

  // ── Slot 7: AnimeSalt English ────────────────────────────────────────────
  const s7Salt = animeSaltItems.find((s) => isEnglish(s) && !usedUrls.has(s.embed));
  if (s7Salt) {
    add(s7Salt, "Server 7 · 🇬🇧 English");
  }

  // Keep Japanese HLS out of the server list and reserve slot 8 for ToonStream.
  for (const source of rawSources) {
    if (isJapanese(source) && isHlsSource(source) && source.url) usedUrls.add(source.url);
  }

  // ── Slot 8: Toko ToonStream embed ─────────────────────────────────────────
  const toonStream = rawSources.find(
    (s) => !isBlockedSource(s) && isToonStreamSource(s) && !isDirect(s) && !usedUrls.has(s.url || "")
  );
  if (toonStream) {
    add(buildTokoItem(toonStream), "Server 8 · 📺 ToonStream");
    if (toonStream.url) usedUrls.add(toonStream.url);
  }

  // ── Slot 9: AnimeSalt Japanese (Abyss) ────────────────────────────────────
  const s9Salt = animeSaltItems.find((s) => isJapanese(s) && !usedUrls.has(s.embed));
  if (s9Salt) {
    add(s9Salt, "Server 9 · 🇯🇵 Japanese (Abyss)");
  }

  // Fill any remaining slots up to 7 with remaining unused animeSalt or Toko sources
  for (const s of animeSaltItems) {
    if (list.length >= 7) break;
    if (!s.languageSources?.length && !usedUrls.has(s.embed)) {
      add(s, `Server ${list.length + 1} · ${s.languageLabel || s.label || "Alternative"}`);
    }
  }
  for (const s of rawSources) {
    if (list.length >= 7) break;
    if (!isBlockedSource(s) && !isToonStreamSource(s) && !(hasAbyssPlayer && isAbyssToko(s)) && !usedUrls.has(s.url || "")) {
      add(buildTokoItem(s), `Server ${list.length + 1} · ${s.languageLabel || s.language || "Alternative"}`);
    }
  }

  return list.slice(0, 7);
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
  browserResult?: { targetUrl: string; html: string; isMovie?: boolean } | null
): Promise<StreamItem[]> {
  const sNum = parseInt(season, 10);
  const epNum = parseInt(episode, 10);
  const baseSlug = cleanAnimeSlug(slug);
  const isPossibleMovie = (sNum === 1 && epNum === 1) || slug.includes("movie");
  const candidates = [
    ...(isPossibleMovie
      ? [
          `https://animesalt.cx/movies/${slug}/`,
          `https://animesalt.cx/movies/${baseSlug}/`,
        ]
      : []),
    `https://animesalt.cx/episode/${baseSlug}-${sNum}x${epNum}/`,
    `https://animesalt.cx/episode/${slug}-${sNum}x${epNum}/`,
    `https://animesalt.cx/episode/${baseSlug}-${epNum}/`,
  ];
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
  browserResult?: { targetUrl: string; html: string; isMovie?: boolean } | null
) {
  const [{ rawSources: tokoRaw, byLanguage }, animeSaltItems] = await Promise.all([
    fetchTokoSources(cleanId, season, ep),
    browserResult === undefined
      ? fetchAnimeSaltSources(cleanId, season, ep)
      : browserResult === null
        ? Promise.resolve([])
        : fetchAnimeSaltSources(cleanId, season, ep, browserResult),
  ]);

  const finalResults = assembleServers(tokoRaw, animeSaltItems);

  if (finalResults.length > 0) {
    return NextResponse.json(
      {
        success: true,
        message: "Stream Found!!",
        version: "v2-cf-animesalt",
        saltCount: animeSaltItems.length,
        results: finalResults,
        byLanguage,
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const season = searchParams.get("season") || "1";
  const ep = searchParams.get("ep") || "1";

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

  return buildStreamResponse(cleanId, season, ep);
}

export async function POST(request: Request) {
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
        const results = assembleServers(orderTokoSources(tokoRaw), animeSaltItems);
        const signature = results.map((item) => `${item.server}\u0000${item.label}\u0000${item.embed}`).join("\u0001");
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
