import { NextResponse } from "next/server";
import { BLOCKED_STREAM_DOMAINS, cleanAnimeSlug, formatDisplayTitle } from "@/lib/api/client";
import type { StreamItem, TokoSource, TokoStreamResponse } from "@/types/api";

// Stream links are dynamic and short-lived
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Toko streaming aggregator backend */
const TOKO_API_URL = (
  process.env.TOKO_API_URL || "https://api-delta-taupe-46.vercel.app"
).replace(/\/+$/, "");

const TOKO_TIMEOUT_MS = 12_000;

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

function isBlockedSource(s: TokoSource): boolean {
  const provider = (s.providerName || s.source || s.server || "").toLowerCase();
  if (provider.includes("hindmovie") || provider.includes("mvlink")) return true;

  const urlStr = s.url || "";
  if (/\.(mkv|zip|rar|7z|tar|gz|torrent|iso)(\?|$)/i.test(urlStr)) return true;

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
  episodeNumber: string
): Promise<{ rawSources: TokoSource[]; byLanguage?: Record<string, unknown> }> {
  // Season-aware title variants: Toko uses the title (not ?season=) for content routing
  const titleVariants = slugToTitleVariants(slug, season);
  if (titleVariants.length === 0) return { rawSources: [] };

  const params = new URLSearchParams();
  for (const t of titleVariants) params.append("titles[]", t);
  // Keep season + episode for any Toko backends that DO parse them
  params.set("season", season);
  params.set("episode", episodeNumber);
  params.set("stream", "0");

  const directUrl = `${TOKO_API_URL}/api/v3/toko/stream?${params.toString()}`;
  const proxyUrl = `${CF_PROXY_URL}${encodeURIComponent(directUrl)}`;

  let data: TokoStreamResponse | null = null;

  // 1. Try direct fetch
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TOKO_TIMEOUT_MS);
    const res = await fetch(directUrl, {
      signal: controller.signal,
      cache: "no-store",
      headers: DEFAULT_HEADERS,
    });
    clearTimeout(timer);
    if (res.ok) {
      const text = await res.text();
      if (!text.includes("<!DOCTYPE html") && !text.includes("challenge")) {
        data = JSON.parse(text) as TokoStreamResponse;
      }
    }
  } catch {
    // direct fetch error, fall back to worker proxy
  }

  // 2. Try proxy fetch if direct fetch failed
  if (!data) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TOKO_TIMEOUT_MS);
      const res = await fetch(proxyUrl, {
        signal: controller.signal,
        cache: "no-store",
        headers: DEFAULT_HEADERS,
      });
      clearTimeout(timer);
      if (res.ok) {
        const text = await res.text();
        if (!text.includes("<!DOCTYPE html") && !text.includes("challenge")) {
          data = JSON.parse(text) as TokoStreamResponse;
        }
      }
    } catch {
      // proxy error
    }
  }



  const rawSources: TokoSource[] = data?.sources || [];
  return { rawSources, byLanguage: data?.byLanguage };
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
  const streamUrl = s.url!;

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

function assembleServers(rawSources: TokoSource[], animeSaltItems: StreamItem[]): StreamItem[] {
  const list: StreamItem[] = [];
  const usedUrls = new Set<string>();

  function add(item: StreamItem | null | undefined, label: string) {
    if (!item || !item.embed) return;
    if (usedUrls.has(item.embed)) return;
    usedUrls.add(item.embed);
    list.push({
      ...item,
      server: "",
      label,
    });
  }

  // 1. Server 1 = Toko Hindi Dub direct HLS
  const s1Toko = rawSources.find((s) => !isBlockedSource(s) && isHindi(s) && isDirect(s));
  if (s1Toko) {
    add(buildTokoItem(s1Toko), "Server 1 · 🇮🇳 Hindi Dub HLS");
  }

  // 2. Server 2 = AnimeSalt MyStream (or AnimeSalt Hindi Abyss)
  const saltMyStream = animeSaltItems.find((s) => !isBlockedSource({ url: s.embed } as TokoSource) && (s.embed.includes("ravok.buzz") || (s.label || "").includes("MyStream")));
  const saltHindiAbyss = animeSaltItems.find((s) => !isBlockedSource({ url: s.embed } as TokoSource) && s.audioLanguage === "hi");
  const s2Salt = saltMyStream || saltHindiAbyss;
  if (s2Salt) {
    add(s2Salt, "Server 2 · 🇮🇳 Hindi Dub (MyStream)");
  }

  // 3. Server 3 = Toko Hindi Dub Embed #1
  const s3Toko = rawSources.find((s) => !isBlockedSource(s) && isHindi(s) && !isDirect(s) && !usedUrls.has(s.url || ""));
  if (s3Toko) {
    add(buildTokoItem(s3Toko), "Server 3 · 🇮🇳 Hindi Dub (Toko)");
  }

  // 4. Server 4 = Toko Hindi Dub Embed #2 (or fallback Abyss Hindi)
  const s4Toko = rawSources.find((s) => !isBlockedSource(s) && isHindi(s) && !isDirect(s) && !usedUrls.has(s.url || ""));
  if (s4Toko) {
    add(buildTokoItem(s4Toko), "Server 4 · 🇮🇳 Hindi Dub (Toko Alt)");
  } else if (saltHindiAbyss && !usedUrls.has(saltHindiAbyss.embed)) {
    add(saltHindiAbyss, "Server 4 · 🇮🇳 Hindi Dub (Abyss)");
  }

  // 5. Server 5 = Tamil
  const s5Salt = animeSaltItems.find((s) => isTamil(s) && !usedUrls.has(s.embed));
  const s5Toko = rawSources.find((s) => !isBlockedSource(s) && isTamil(s) && !usedUrls.has(s.url || ""));
  if (s5Salt) {
    add(s5Salt, "Server 5 · 🌐 Tamil");
  } else if (s5Toko) {
    add(buildTokoItem(s5Toko), "Server 5 · 🌐 Tamil");
  }

  // 6. Server 6 = Telugu
  const s6Salt = animeSaltItems.find((s) => isTelugu(s) && !usedUrls.has(s.embed));
  const s6Toko = rawSources.find((s) => !isBlockedSource(s) && isTelugu(s) && !usedUrls.has(s.url || ""));
  if (s6Salt) {
    add(s6Salt, "Server 6 · 🌐 Telugu");
  } else if (s6Toko) {
    add(buildTokoItem(s6Toko), "Server 6 · 🌐 Telugu");
  }

  // 7. Server 7 = English
  const s7Salt = animeSaltItems.find((s) => isEnglish(s) && !usedUrls.has(s.embed));
  const s7Toko = rawSources.find((s) => !isBlockedSource(s) && isEnglish(s) && !usedUrls.has(s.url || ""));
  if (s7Salt) {
    add(s7Salt, "Server 7 · 🇬🇧 English");
  } else if (s7Toko) {
    add(buildTokoItem(s7Toko), "Server 7 · 🇬🇧 English");
  }

  // 8. Server 8 = Japanese HLS #1
  const s8Toko = rawSources.find((s) => !isBlockedSource(s) && isJapanese(s) && isDirect(s) && !usedUrls.has(s.url || ""));
  if (s8Toko) {
    add(buildTokoItem(s8Toko), "Server 8 · 🇯🇵 Japanese HLS");
  }

  // 9. Server 9 = Japanese HLS #2 (Alt)
  const s9Toko = rawSources.find((s) => !isBlockedSource(s) && isJapanese(s) && isDirect(s) && !usedUrls.has(s.url || ""));
  const s9Salt = animeSaltItems.find((s) => isJapanese(s) && !usedUrls.has(s.embed));
  if (s9Toko) {
    add(buildTokoItem(s9Toko), "Server 9 · 🇯🇵 Japanese HLS (Alt)");
  } else if (s9Salt) {
    add(s9Salt, "Server 9 · 🇯🇵 Japanese (Abyss)");
  }

  // Fill remaining slots up to 9 with any remaining valid sources
  if (list.length < 9) {
    for (const s of rawSources) {
      if (list.length >= 9) break;
      if (isBlockedSource(s) || !s.url || usedUrls.has(s.url) || !isValidStreamUrl(s.url)) continue;
      add(buildTokoItem(s), `Server · ${s.languageLabel || s.language || "Mirror"}`);
    }
  }
  if (list.length < 9) {
    for (const s of animeSaltItems) {
      if (list.length >= 9) break;
      if (usedUrls.has(s.embed)) continue;
      add(s, `Server · ${s.label || "Mirror"}`);
    }
  }

  // Clean sequential renumbering: Server 1, Server 2, ..., Server N
  return list.map((item, idx) => {
    const num = idx + 1;
    const cleanLabel = (item.label || "").replace(/^Server(?:\s+\d+)?\s*·?\s*/, "");
    return {
      ...item,
      server: `Server ${num}`,
      label: cleanLabel ? `Server ${num} · ${cleanLabel}` : `Server ${num}`,
    };
  });
}

/**
 * Fetch streaming embed sources directly from AnimeSalt (animesalt.cx).
 * Extracts AbyssPlayer multi-language embeds (Hindi, Japanese, English, etc.)
 * and direct video iframes (MyStream / ravok.buzz).
 */
async function fetchAnimeSaltSources(
  slug: string,
  season: string,
  episode: string
): Promise<StreamItem[]> {
  const sNum = parseInt(season, 10) || 1;
  const epNum = parseInt(episode, 10) || 1;
  const baseSlug = slug
    .replace(/-season-\d+$/i, "")
    .replace(/-s\d+$/i, "")
    .replace(/-\d+(st|nd|rd|th)-season$/i, "");

  const candidates = [
    `https://animesalt.cx/episode/${baseSlug}-${sNum}x${epNum}/`,
    `https://animesalt.cx/episode/${slug}-${sNum}x${epNum}/`,
    `https://animesalt.cx/episode/${baseSlug}-${epNum}/`,
  ];

  for (const targetUrl of candidates) {
    const proxyUrl = `${CF_PROXY_URL}${encodeURIComponent(targetUrl)}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(proxyUrl, {
        signal: controller.signal,
        cache: "no-store",
        headers: DEFAULT_HEADERS,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const html = await res.text();
      if (!html || html.length < 1000 || html.includes("404 Not Found")) continue;

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
        } catch { /* ignore */ }
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

      if (items.length > 0) {
        return items;
      }
    } catch {
      // ignore & try next candidate
    }
  }
  return [];
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

  // Fetch Toko sources and AnimeSalt sources in parallel
  const [{ rawSources: tokoRaw, byLanguage }, animeSaltItems] = await Promise.all([
    fetchTokoSources(cleanId, season, ep),
    fetchAnimeSaltSources(cleanId, season, ep),
  ]);

  const finalResults = assembleServers(tokoRaw, animeSaltItems);

  if (finalResults.length > 0) {
    return NextResponse.json(
      { success: true, message: "Stream Found!!", results: finalResults, byLanguage },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  }

  return NextResponse.json(
    { success: false, message: "No valid streams found", results: [] },
    {
      status: 404,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    }
  );
}
