import { NextResponse } from "next/server";
import { BLOCKED_STREAM_DOMAINS, cleanAnimeSlug, formatDisplayTitle } from "@/lib/api/client";
import { buildAnimeSaltEpisodeCandidates, isValidAnimeSaltHtml } from "@/lib/animesalt-stream";
import type { StreamItem, TokoSource, TokoStreamResponse } from "@/types/api";

// Stream links are dynamic and short-lived
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Toko streaming aggregator backend */
const TOKO_API_URL = (
  process.env.TOKO_API_URL || "https://api-delta-taupe-46.vercel.app"
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
  process.env.NEXT_PUBLIC_CF_PROXY_URL ||
  "https://wispy-cherry-6934.shahazaibseo038.workers.dev/?url="
).trim(); // trim trailing newlines/spaces common in .env files

const CF_PROXY_URL = rawCfProxy.includes("?url=")
  ? rawCfProxy
  : `${rawCfProxy.replace(/\/+$/, "")}/?url=`;

/**
 * Base URL for the CF worker (e.g. "https://...workers.dev").
 * Robustly extracted using URL().origin so trailing /?url=, newlines,
 * or slash variants in the env var never produce a malformed proxy URL.
 */
function getCfWorkerBase(): string {
  try {
    // The env var may be the full proxy URL like:
    //   https://wispy-cherry-6934.shahazaibseo038.workers.dev/?url=
    // or just the base:
    //   https://wispy-cherry-6934.shahazaibseo038.workers.dev
    const parsed = new URL(rawCfProxy.split("?")[0].replace(/\/+$/, ""));
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    // Absolute fallback
    return "https://wispy-cherry-6934.shahazaibseo038.workers.dev";
  }
}
const CF_WORKER_BASE = getCfWorkerBase();

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

  if (!contentType.includes("text/event-stream")) {
    const text = await response.text();
    if (text.includes("<!DOCTYPE html") || text.toLowerCase().includes("challenge")) return null;
    const data = JSON.parse(text) as TokoStreamResponse;
    for (const source of data.sources || []) onSource?.(source);
    return { rawSources: data.sources || [], byLanguage: data.byLanguage, complete: true };
  }

  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
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
  };

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
  return { rawSources, byLanguage, complete };
}

function isBlockedSource(s: TokoSource): boolean {
  const provider = (s.providerName || s.source || s.server || "").toLowerCase();
  if (provider.includes("hindmovie") || provider.includes("mvlink") || provider.includes("animesama")) return true;

  const urlStr = (s.url || "").toLowerCase();
  if (/\.(mkv|zip|rar|7z|tar|gz|torrent|iso)(\?|$)/i.test(urlStr)) return true;
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
 *   1. Hindi Dub (Direct HLS/MP4 first -> Server 1 default)
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
  const proxyUrl = `${CF_PROXY_URL}${encodeURIComponent(directUrl)}`;

  let data: { rawSources: TokoSource[]; byLanguage?: Record<string, unknown>; complete: boolean } | null = null;

  const fetchSources = async (url: string) => {
    const controller = new AbortController();
    const abortFromRequest = () => controller.abort();
    if (requestSignal?.aborted) controller.abort();
    else requestSignal?.addEventListener("abort", abortFromRequest, { once: true });
    const timer = setTimeout(() => controller.abort(), TOKO_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        headers: DEFAULT_HEADERS,
      });
      if (!res.ok) return null;
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

  // 2. Try proxy fetch if direct fetch failed
  if (!data && !requestSignal?.aborted) {
    try {
      data = await fetchSources(proxyUrl);
    } catch {
      // proxy error
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

function isDirect(s: TokoSource): boolean {
  return s.type === "hls" || s.type === "mp4" || Boolean(s.isM3U8);
}

function buildTokoItem(s: TokoSource): StreamItem {
  const isDirectStream = isDirect(s);
  const flag = isHindi(s) ? "🇮🇳" : isJapanese(s) ? "🇯🇵" : isEnglish(s) ? "🇬🇧" : "🌐";
  const langName = isHindi(s) ? "Hindi Dub" : isJapanese(s) ? "Japanese" : (s.language || "Multi");
  const streamUrl = (s.url || "")
    .replace(/\\+u0026/gi, "&")
    .replace(/&amp;/gi, "&")
    .trim();

  let hlsProxyUrl: string | undefined;
  if (isDirectStream) {
    const hdrs = (s.headers as Record<string, string>) || {};
    const referer = hdrs.Referer || hdrs.referer || "";
    const origin  = hdrs.Origin  || hdrs.origin  || "";
    const params = new URLSearchParams({ url: streamUrl });
    if (referer) params.set("referer", referer);
    if (origin)  params.set("origin",  origin);
    hlsProxyUrl = `${CF_WORKER_BASE}/hls-proxy?${params.toString()}`;
  }

  return {
    server: "",
    label: "",
    embed: streamUrl,
    url: isDirectStream ? (hlsProxyUrl || streamUrl) : undefined,
    hlsProxyUrl,
    type: isDirectStream ? (s.type === "mp4" ? "mp4" : "hls") : "embed",
    audioLanguage: s.audioLanguage || (flag === "🇮🇳" ? "hi" : flag === "🇬🇧" ? "en" : "ja"),
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
    const key = item.embed || item.url || "";
    if (!key) return;
    if (usedUrls.has(key)) return;
    usedUrls.add(key);
    const server = label.match(/^Server\s+\d+/)?.[0] || "";
    list.push({ ...item, server, label });
  }

  // ── Slot 1: Hindi Dub direct HLS (Toko) ──────────────────────────────────
  const s1 = rawSources.find((s) => !isBlockedSource(s) && isHindi(s) && isDirect(s));
  if (s1) add(buildTokoItem(s1), "Server 1 · 🇮🇳 Hindi Dub HLS ⚡");

  // ── Slot 2: AnimeSalt MyStream (ravok.buzz) ───────────────────────────────
  const saltMyStream = animeSaltItems.find(
    (s) => !isBlockedSource({ url: s.embed } as TokoSource) &&
      (s.embed.includes("ravok.buzz") || (s.label || "").toLowerCase().includes("mystream"))
  );
  if (saltMyStream) {
    add(saltMyStream, "Server 2 · 🇮🇳 MyStream");
  }

  // ── Slot 3: Toko Hindi Dub embed #1 (cloudy.upns.one / abyssplayer) ───────
  const s3 = rawSources.find(
    (s) => !isBlockedSource(s) && isHindi(s) && !isDirect(s) && !usedUrls.has(s.url || "")
  );
  if (s3) add(buildTokoItem(s3), "Server 3 · 🇮🇳 Hindi Dub (Toko)");

  // ── Slot 4: Toko Hindi Dub embed #2 ─────────────────────────────────────
  const s4 = rawSources.find(
    (s) => !isBlockedSource(s) && isHindi(s) && !isDirect(s) && !usedUrls.has(s.url || "")
  );
  if (s4) {
    add(buildTokoItem(s4), "Server 4 · 🇮🇳 Hindi Dub (Toko Alt)");
  }

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

  // ── Slot 8: Japanese HLS ⚡ (Toko direct) ─────────────────────────────────
  const s8 = rawSources.find(
    (s) => !isBlockedSource(s) && isJapanese(s) && isDirect(s) && !usedUrls.has(s.url || "")
  );
  if (s8) add(buildTokoItem(s8), "Server 8 · 🇯🇵 Japanese HLS ⚡");

  // ── Slot 9: AnimeSalt Japanese (Abyss) ────────────────────────────────────
  const s9Salt = animeSaltItems.find((s) => isJapanese(s) && !usedUrls.has(s.embed));
  if (s9Salt) {
    add(s9Salt, "Server 9 · 🇯🇵 Japanese (Abyss)");
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
  browserResult?: { targetUrl: string; html: string } | null
): Promise<StreamItem[]> {
  const candidates = buildAnimeSaltEpisodeCandidates(slug, season, episode);
  if (browserResult && !candidates.includes(browserResult.targetUrl)) return [];

  // Retrieve AnimeSalt through the general Worker proxy.
  for (const targetUrl of browserResult ? [browserResult.targetUrl] : candidates) {
    const proxyUrl = `${CF_PROXY_URL}${encodeURIComponent(targetUrl)}&diag1=1`;
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

      try {
        let html: string;
        let responseOk = true;
        if (browserResult) {
          httpStatus = 200;
          contentType = "text/html";
          html = browserResult.html;
        } else {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 6000);
          const res = await fetch(urlToFetch!, {
            signal: controller.signal,
            cache: "no-store",
            headers: {
              ...DEFAULT_HEADERS,
              Accept: "text/html",
              Origin: "https://hindianime-seven.vercel.app",
            },
          });
          clearTimeout(timer);
          httpStatus = res.status;
          responseOk = res.ok;
          contentType = res.headers.get("content-type");
          html = await res.text();
        }
        responseBodyLength = html.length;
        passedResponseChecks = responseOk && isValidAnimeSaltHtml(html);
        if (!passedResponseChecks) continue;

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
              for (const p of parsed) {
                if (p.link && !usedUrls.has(p.link) && !BLOCKED_STREAM_DOMAINS.some((d) => p.link!.includes(d))) {
                  usedUrls.add(p.link);
                  const lang = p.language || "Multi";
                  const isHi = /hindi/i.test(lang);
                  const isJa = /japanese/i.test(lang);
                  items.push({
                    server: `AnimeSalt ${lang}`,
                    label: `AnimeSalt · ${isHi ? "🇮🇳 Hindi" : isJa ? "🇯🇵 Japanese" : "🌐 " + lang} (Abyss)`,
                    embed: p.link,
                    type: "embed",
                    audioLanguage: isHi ? "hi" : isJa ? "ja" : "en",
                    languageLabel: lang,
                    adFree: false,
                  });
                }
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
              label: isRavok ? "AnimeSalt · 🇮🇳 MyStream" : "AnimeSalt · Embed",
              embed: src,
              type: "embed",
              audioLanguage: "hi",
              languageLabel: "🇮🇳 Hindi",
              adFree: false,
            });
          }
        }

        parserResultCount = items.length;
        if (items.length > 0) {
          return items;
        }
      } catch (err) {
        caughtError = err instanceof Error ? err.message : String(err);
        // try next fetchUrl or candidate
      } finally {
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
  browserResult?: { targetUrl: string; html: string } | null
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

  let browserResult: { targetUrl: string; html: string } | null = null;
  if (body.animeSaltHtml !== undefined && body.animeSaltHtml !== null) {
    const targetUrl = typeof body.animeSaltTargetUrl === "string" ? body.animeSaltTargetUrl : "";
    const html = typeof body.animeSaltHtml === "string" ? body.animeSaltHtml : "";
    const byteLength = new TextEncoder().encode(html).byteLength;
    if (
      !buildAnimeSaltEpisodeCandidates(cleanId, season, ep).includes(targetUrl) ||
      byteLength > 512 * 1024 ||
      !isValidAnimeSaltHtml(html)
    ) {
      return NextResponse.json({ success: false, message: "Invalid AnimeSalt response" }, { status: 400 });
    }
    browserResult = { targetUrl, html };
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
