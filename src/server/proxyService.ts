import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import type { Request, Response } from 'express';

// ── Configuration & Constants ──────────────────────────────────────────────────
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export const TOKO_API_URL = (process.env.TOKO_API_URL || 'https://anime-api2-nine.vercel.app').replace(/\/+$/, '');
export const PROXY_SECRET_HEADER = 'x-hindianime-proxy-secret';
export const PROXY_SECRET = process.env.HINDIANIME_PROXY_SECRET || process.env.PROXY_SECRET || '';
export const REQUIRE_STREAM_SECRET = process.env.REQUIRE_STREAM_SECRET === 'true';

export const ANIMESALT_HOMEPAGE_URL = 'https://animesalt.cx/';
export const HOMEPAGE_FRESH_MS = 5 * 60 * 1000;
export const HOMEPAGE_MAX_STALE_MS = 24 * 60 * 60 * 1000;
export const HOMEPAGE_CHALLENGE_COOLDOWN_MS = 5 * 60 * 1000;
export const HOMEPAGE_MAX_BYTES = 2 * 1024 * 1024;

export const CATALOG_FRESH_MS = 10 * 60 * 1000;
export const CATALOG_TIMEOUT_MS = 10000;
export const CATALOG_FEED_MAX_BYTES = 2 * 1024 * 1024;
export const CATALOG_SITEMAP_INDEX_MAX_BYTES = 512 * 1024;
export const CATALOG_SITEMAP_MAX_BYTES = 4 * 1024 * 1024;
export const CATALOG_MAX_SITEMAPS = 6;

export const GENERAL_RESPONSE_MAX_BYTES = 16 * 1024 * 1024;
export const ANIMESALT_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
export const HLS_UPSTREAM_TIMEOUT_MS = 30000;
export const HLS_MAX_REDIRECTS = 5;

// In-memory cache for high-traffic endpoints & stale fallbacks
interface CacheEntry<T> {
  data: T;
  contentType?: string;
  headers?: Record<string, string>;
  storedAt: number;
  expiresAt: number;
  entryCount?: number;
}

class MemoryCache {
  private store = new Map<string, CacheEntry<any>>();
  private statsRecord = { hits: 0, misses: 0, sets: 0 };

  set<T>(key: string, data: T, ttlMs: number, extra?: { contentType?: string; headers?: Record<string, string>; entryCount?: number }): void {
    const now = Date.now();
    this.store.set(key, {
      data,
      contentType: extra?.contentType,
      headers: extra?.headers,
      storedAt: now,
      expiresAt: now + ttlMs,
      entryCount: extra?.entryCount,
    });
    this.statsRecord.sets++;
    // Memory limit safety: clean old items if store grows above 2000
    if (this.store.size > 2000) {
      this.evictExpired();
    }
  }

  get<T>(key: string, allowStale = false, maxStaleMs = HOMEPAGE_MAX_STALE_MS): CacheEntry<T> | null {
    const entry = this.store.get(key);
    if (!entry) {
      this.statsRecord.misses++;
      return null;
    }
    const now = Date.now();
    const age = now - entry.storedAt;
    if (now <= entry.expiresAt) {
      this.statsRecord.hits++;
      return entry;
    }
    if (allowStale && age <= maxStaleMs) {
      this.statsRecord.hits++;
      return entry;
    }
    this.store.delete(key);
    this.statsRecord.misses++;
    return null;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  evictExpired(): void {
    const now = Date.now();
    for (const [k, v] of this.store.entries()) {
      if (now > v.expiresAt + HOMEPAGE_MAX_STALE_MS) {
        this.store.delete(k);
      }
    }
  }

  getStats() {
    return {
      size: this.store.size,
      hits: this.statsRecord.hits,
      misses: this.statsRecord.misses,
      sets: this.statsRecord.sets,
      ratio: this.statsRecord.hits + this.statsRecord.misses > 0
        ? ((this.statsRecord.hits / (this.statsRecord.hits + this.statsRecord.misses)) * 100).toFixed(1) + '%'
        : '0%',
    };
  }
}

export const cache = new MemoryCache();

// Cooldown tracking for AnimeSalt anti-scraping challenges
let homepageCooldownUntil = 0;
let homepageCooldownState: 'probe' | 'challenge' | null = null;
const targetCooldowns = new Map<string, number>();

// ── Security & Host Allowlists ─────────────────────────────────────────────────
export const ALLOWED_GENERAL_HOSTS = new Set([
  'animesalt.cx',
  'www.animesalt.cx',
  'img.animesalt.cx',
  'as-cdn.top',
  'as-cdn23.top',
  'as-cdn24.top',
  'as-cdn25.top',
  'as-cdn26.top',
  'as-cdn27.top',
  'as-cdn28.top',
  'as-cdn29.top',
  'as-cdn30.top',
  'as-cdn31.top',
  'api-delta-taupe-46.vercel.app',
  'anime-api2-nine.vercel.app',
  'ravok.buzz',
  'player.abyssplayer.com',
  'abyssplayer.com',
  'cybervynx.com',
  'www.cybervynx.com',
  'animahd.com',
  'www.animahd.com',
  'drive.google.com',
  'drive.usercontent.google.com',
  'imgsrv.crunchyroll.com',
  'animeflash.live',
  'www.animeflash.live',
  'player.animeinfinity.me',
  'archive.animeinfinity.me',
  'animeinfinity.me',
]);

export const ALLOWED_CDN_HOSTS = new Set([
  'as-cdn.top',
  'as-cdn23.top',
  'as-cdn24.top',
  'as-cdn25.top',
  'as-cdn26.top',
  'as-cdn27.top',
  'as-cdn28.top',
  'as-cdn29.top',
  'as-cdn30.top',
  'as-cdn31.top',
]);

export const ALLOWED_HLS_BASE_DOMAINS = new Set([
  'vmpx.online',
  'vmget.online',
  'vmeas.cloud',
  'vmnow.online',
  'fastream.to',
  'vidmoly.to',
  'vidmoly.net',
  'vidmoly.me',
  'hakunaymatata.com',
  'hakuna.my',
  'sibnet.ru',
  'video.sibnet.ru',
  'filesforever.in',
  'filesforever.org',
  'abyssplayer.com',
  'vidzy.org',
  'vidzy.online',
  'ravok.buzz',
  'sendvid.com',
  'videos2.sendvid.com',
  'megaplay.buzz',
  '4anime.com.ro',
  'as-cdn.top',
  'as-cdn23.top',
  'as-cdn24.top',
  'as-cdn25.top',
  'as-cdn26.top',
  'as-cdn27.top',
  'as-cdn28.top',
  'as-cdn29.top',
  'as-cdn30.top',
  'as-cdn31.top',
  'player.animeinfinity.me',
  'archive.animeinfinity.me',
  'animeflash.live',
  'animeinfinity.me',
]);

export const PROVIDER_CLUSTER_GROUPS = [
  new Set(['vidmoly.to', 'vidmoly.net', 'vidmoly.me', 'vmpx.online', 'vmget.online', 'vmeas.cloud', 'vmnow.online']),
  new Set(['fastream.to']),
  new Set(['hakunaymatata.com', 'hakuna.my']),
  new Set(['sibnet.ru', 'video.sibnet.ru']),
  new Set(['filesforever.in', 'filesforever.org', 'abyssplayer.com']),
  new Set(['vidzy.org', 'vidzy.online']),
  new Set(['ravok.buzz', 'as-cdn.top']),
  new Set(['sendvid.com', 'videos2.sendvid.com']),
  new Set(['player.animeinfinity.me', 'archive.animeinfinity.me', 'animeflash.live', 'animeinfinity.me']),
];

const ALLOWED_HLS_EXT_REGEX = /\.(m3u8|ts|mp4|m4s|mkv|webm|aac|vtt|key|js|css|woff|png|jpg)(\?.*)?$/i;
const ALLOWED_HLS_PATH_REGEX = /\/(hls|hls2|cdn\/hls|stream|playlist|bt|resource|p)\//i;
const ALLOWED_HLS_BASE_DOMAINS_ARRAY = Array.from(ALLOWED_HLS_BASE_DOMAINS);

export const BLOCKED_STREAM_DOMAINS = [
  'mvlink',
  'linkskit',
  'linkvertise',
  'hindmovie',
  'hshare',
  'shortx',
  'ouo.io',
  'ouo.press',
  'shareus',
  'gofile',
  'dropgalaxy',
  'katfile',
  'turbobit',
  'rapidgator',
  '1fichier',
  'mediafire',
  'mega.nz',
  'mega.co',
  'shorte.st',
  'adf.ly',
  'adfly',
  'shrinkme',
  'earn4link',
  'droplink',
  'clicksfly',
  'gplinks',
  'cuty.io',
  'exe.io',
  'multishows',
  'streamtape',
  'doodstream',
  'dood.watch',
  'dood.la',
  'dood.pm',
  'dood.to',
  'ds2play',
  'voe.sx',
  'voe.network',
  'mixdrop',
  'sendvid',
  'uqload',
  'upstream.to',
  'evoload',
  'clipwatching',
  'waaw.tv',
  'gounlimited',
  'vudeo',
  'rubystm',
  'cloudy.upns.one',
  'upns.one',
  'acek-cdn',
  'dramiyos-cdn',
  'prx-am',
  'animesama',
];

// ── Validation Helpers ─────────────────────────────────────────────────────────

export function isPrivateIpv4(hostname: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const octets = hostname.split('.').map(Number);
  if (octets.some((o) => o < 0 || o > 255)) return true;
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

export function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (
    host === 'localhost' ||
    host === 'localhost.localdomain' ||
    /\.(?:localhost|local|lan|internal|home\.arpa|test|invalid|example)$/.test(host)
  ) {
    return true;
  }
  if (isPrivateIpv4(host)) return true;
  return false;
}

export function isAllowedHlsHostName(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'ravok.buzz' || host.endsWith('.ravok.buzz')) return true;
  if (/^as-cdn\d*\.top$/.test(host) || host.endsWith('.as-cdn.top')) return true;
  if (host === 'player.abyssplayer.com' || host.endsWith('.abyssplayer.com')) return true;

  for (let i = 0; i < ALLOWED_HLS_BASE_DOMAINS_ARRAY.length; i++) {
    const allowed = ALLOWED_HLS_BASE_DOMAINS_ARRAY[i];
    if (host === allowed || host.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

export function areHostsInSameCluster(hostA: string, hostB: string): boolean {
  if (hostA === hostB) return true;

  const isRavokClusterA = hostA === 'ravok.buzz' || hostA.endsWith('.ravok.buzz') || /^as-cdn\d*\.top$/.test(hostA);
  const isRavokClusterB = hostB === 'ravok.buzz' || hostB.endsWith('.ravok.buzz') || /^as-cdn\d*\.top$/.test(hostB);
  if (isRavokClusterA && isRavokClusterB) return true;

  for (const cluster of PROVIDER_CLUSTER_GROUPS) {
    const inClusterA = cluster.has(hostA) || Array.from(cluster).some((d) => hostA.endsWith(`.${d}`));
    const inClusterB = cluster.has(hostB) || Array.from(cluster).some((d) => hostB.endsWith(`.${d}`));
    if (inClusterA && inClusterB) return true;
  }
  return false;
}

export function isAllowedHlsTarget(target: URL): boolean {
  if (
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    target.port ||
    isPrivateOrLocalHost(target.hostname)
  ) {
    return false;
  }

  const hostname = target.hostname.toLowerCase();
  const isAllowedHost = isAllowedHlsHostName(hostname);
  const pathname = target.pathname.toLowerCase();
  const isAllowedPath = ALLOWED_HLS_EXT_REGEX.test(pathname) || ALLOWED_HLS_PATH_REGEX.test(pathname);

  return isAllowedHost && isAllowedPath;
}

export function isPositiveInteger(value: string | undefined | null, maxDigits = 12): boolean {
  if (!value || typeof value !== 'string') return false;
  return value.length <= maxDigits && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}

export function isSafeAnimeSaltSlug(value: string): boolean {
  try {
    const decoded = decodeURIComponent(value);
    return /^[\p{L}\p{N}._-]+$/u.test(decoded);
  } catch {
    return false;
  }
}

export function isAllowedAnimeSaltTarget(url: URL): boolean {
  const rawPath = url.pathname;
  const path = rawPath.endsWith('/') ? rawPath : `${rawPath}/`;
  const parts = rawPath.split('/').filter(Boolean);

  if (rawPath === '/' || rawPath === '') return true;
  if (/^\/page\/[1-9]\d*\/$/.test(path)) return true;

  if (parts[0] === 'series' || parts[0] === 'movies') {
    if (parts.length === 1) return true;
    if (parts.length === 2) return isSafeAnimeSaltSlug(parts[1]);
    if (parts.length === 3 && parts[1] === 'page' && isPositiveInteger(parts[2])) return true;
    if (parts.length === 2 && (parts[1] === 'feed' || parts[1].includes('sitemap'))) return true;
    return true;
  }

  if (parts[0] === 'episode' || parts[0] === 'anime') {
    return parts.length >= 2 && isSafeAnimeSaltSlug(parts[1]);
  }
  if (parts[0] === 'category') return true;
  if (rawPath.endsWith('.xml') || rawPath.includes('feed') || rawPath.includes('sitemap')) return true;
  if (parts[0] === 'wp-content' || parts[0] === 'wp-includes') return true;
  if (rawPath === '/wp-admin/admin-ajax.php') return true;

  return false;
}

export function isAllowedRavokTarget(url: URL): boolean {
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.search !== '') {
    return false;
  }
  return /^\/(?:embed|e)\/[a-zA-Z0-9_-]{3,80}$/.test(url.pathname);
}

export function isAllowedTokoStreamTarget(url: URL): boolean {
  if (url.pathname !== '/api/v3/toko/stream' || url.hash) return false;
  const allowedKeys = new Set(['titles[]', 'season', 'episode', 'stream']);
  for (const k of url.searchParams.keys()) {
    if (!allowedKeys.has(k)) return false;
  }
  const titles = url.searchParams.getAll('titles[]');
  const seasons = url.searchParams.getAll('season');
  const episodes = url.searchParams.getAll('episode');
  return (
    titles.length >= 1 &&
    titles.length <= 4 &&
    titles.every((t) => t.trim().length > 0 && t.length <= 160 && !/[\u0000-\u001f]/.test(t)) &&
    seasons.length === 1 &&
    isPositiveInteger(seasons[0], 4) &&
    episodes.length === 1 &&
    isPositiveInteger(episodes[0], 5)
  );
}

export function isAllowedCatalogTarget(url: URL, kind: string): boolean {
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !['animesalt.cx', 'www.animesalt.cx'].includes(url.hostname.toLowerCase())
  ) {
    return false;
  }
  if (url.pathname === `/${kind}/` || new RegExp(`^/${kind}/page/[1-9]\\d*/$`).test(url.pathname)) {
    return !url.search;
  }
  if (url.pathname === `/${kind}/feed/`) {
    const pages = url.searchParams.getAll('paged');
    return pages.length === 0 || (pages.length === 1 && isPositiveInteger(pages[0]));
  }
  return (
    !url.search &&
    (url.pathname === '/sitemap_index.xml' || new RegExp(`^/${kind}-sitemap[1-9]\\d*\\.xml$`).test(url.pathname))
  );
}

export function isAllowedGeneralTarget(url: URL): boolean {
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !ALLOWED_GENERAL_HOSTS.has(url.hostname.toLowerCase())
  ) {
    return false;
  }

  const host = url.hostname.toLowerCase();
  if (host === 'animesalt.cx' || host === 'www.animesalt.cx' || host === 'img.animesalt.cx') {
    return isAllowedAnimeSaltTarget(url);
  }
  if (ALLOWED_CDN_HOSTS.has(host)) return true;
  if (host === 'api-delta-taupe-46.vercel.app' || host === 'anime-api2-nine.vercel.app') return isAllowedTokoStreamTarget(url);
  if (host === 'ravok.buzz') return isAllowedRavokTarget(url);
  if (host === 'player.abyssplayer.com' || host === 'abyssplayer.com') return true;
  if (host === 'cybervynx.com' || host === 'www.cybervynx.com') return true;

  return false;
}

export function isBlockedStreamSource(s: any): boolean {
  const provider = (s.providerName || s.source || s.server || '').toLowerCase();
  if (provider.includes('hindmovie') || provider.includes('mvlink') || provider.includes('animesama')) return true;

  const urlStr = (s.url || '').toLowerCase();
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

// ── Auth & HMAC Media Tokens ──────────────────────────────────────────────────

export function secretsMatch(received: string, expected: string): boolean {
  if (received.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function validateProxySecret(req: Request, required = false): { error: string; status: number } | null {
  const supplied =
    (req.headers[PROXY_SECRET_HEADER] as string | undefined) ||
    (req.headers['x-proxy-secret'] as string | undefined) ||
    (req.query.secret as string | undefined) ||
    (req.query.key as string | undefined);

  // If secret is supplied, validate it
  if (supplied) {
    if (!PROXY_SECRET) return null;
    if (!secretsMatch(supplied, PROXY_SECRET)) {
      return { error: 'Forbidden: invalid proxy secret', status: 403 };
    }
    return null;
  }

  // Same-host dashboard requests are always permitted
  const host = req.get('host');
  const referer = req.get('referer');
  const origin = req.get('origin');
  if (host && ((referer && referer.includes(host)) || (origin && origin.includes(host)))) {
    return null;
  }

  // Only block if strictly required and configured via REQUIRE_STREAM_SECRET=true
  if (required && REQUIRE_STREAM_SECRET && PROXY_SECRET) {
    return { error: 'Unauthorized: missing proxy secret', status: 401 };
  }

  return null;
}

export function generateHlsToken(targetUrl: string, referer: string = '', origin: string = '', exp: number, secret: string): string {
  const payload = `${targetUrl}:${referer}:${origin}:${exp}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyHlsToken(
  targetUrl: string,
  referer: string = '',
  origin: string = '',
  exp: string | number | null | undefined,
  sig: string | null | undefined,
  secret: string
): boolean {
  if (!secret) return true; // If secret not configured in env, allow open proxy
  if (!targetUrl || !exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isSafeInteger(expNum) || expNum <= 0) return false;
  if (Math.floor(Date.now() / 1000) > expNum) return false;

  const expectedSig = generateHlsToken(targetUrl, referer, origin, expNum, secret);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'));
  } catch {
    return false;
  }
}

// ── Slug & Title Helpers for Toko & AnimeSalt ─────────────────────────────────

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Robust extractor for Anime IDs, Slugs, Season and Episode numbers.
 * Handles full URLs (https://animesalt.cx/episode/solo-leveling-1x1/),
 * paths (episode/solo-leveling-1x1), direct slugs (solo-leveling-1x1, solo-leveling-s1-ep1),
 * or plain anime names (solo-leveling).
 */
export function extractAnimeSlug(input: string): {
  slug: string;
  season?: string;
  episode?: string;
  fullEpisodeSlug?: string;
} {
  let s = (input || '').trim();
  // Strip query string and hash
  s = s.split('?')[0].split('#')[0];
  // Strip protocol & host if full URL passed
  s = s.replace(/^https?:\/\/[^/]+/i, '');
  // Strip leading /episode/, /series/, /v/, /watch/
  s = s.replace(/^\/?(?:episode|series|v|watch)\//i, '');
  // Strip trailing slashes
  s = s.replace(/\/+$/, '');

  let season: string | undefined;
  let episode: string | undefined;

  // Check for S1E1 or 1x1 or season-1-episode-1
  const sEpMatch = s.match(/(?:-|\b)s?(\d+)[xe](\d+)\b/i);
  if (sEpMatch) {
    season = sEpMatch[1];
    episode = sEpMatch[2];
  } else {
    const epMatch = s.match(/(?:-|\b)(?:ep|episode)-?(\d+)\b/i) || s.match(/-(\d+)$/);
    if (epMatch) {
      episode = epMatch[1];
    }
  }

  // Base slug without season/ep markers
  const baseSlug = s
    .replace(/(?:-|\b)s?\d+[xe]\d+\b/gi, '')
    .replace(/(?:-|\b)(?:season|s)-?\d+/gi, '')
    .replace(/(?:-|\b)(?:episode|ep)-?\d+/gi, '')
    .replace(/-\d+(?:st|nd|rd|th)-season/gi, '')
    .replace(/-(?:hindi|dub|sub|telugu|tamil|malayalam)+$/gi, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  const cleanSlug = s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return {
    slug: baseSlug || cleanSlug,
    fullEpisodeSlug: cleanSlug,
    season,
    episode,
  };
}

export function slugToSeasonTitles(slug: string, season: string): string[] {
  const cleanSlug = slug
    .replace(/-season-\d+$/i, '')
    .replace(/-s\d+$/i, '')
    .replace(/-\d+(st|nd|rd|th)-season$/i, '');

  const base = cleanSlug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

  const sNum = parseInt(season, 10) || 1;
  if (sNum <= 1) return [base];

  const ordinal = sNum === 2 ? '2nd' : sNum === 3 ? '3rd' : `${sNum}th`;
  return [`${base} Season ${sNum}`, `${base} ${ordinal} Season`, `${base} S${sNum}`, base];
}

// ── Ravok HLS Resolver (with memory cache & fast timeout) ──────────────────────

export async function resolveRavokHls(videoIdOrUrl: string): Promise<string | null> {
  const hash = videoIdOrUrl
    .replace(/^.*\/video\//, '')
    .replace(/^.*\/e\//, '')
    .replace(/^.*\/embed\//, '')
    .split('?')[0]
    .trim();

  if (!hash || hash.length < 5) return null;

  const cacheKey = `ravok:hls:${hash}`;
  const cached = cache.get<string>(cacheKey);
  if (cached) return cached.data;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const body = new URLSearchParams({
      hash: hash,
      r: 'https://animesalt.cx/',
    });
    const res = await fetch(`https://ravok.buzz/player/index.php?data=${hash}&do=getVideo`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'User-Agent': BROWSER_UA,
        Referer: `https://ravok.buzz/video/${hash}`,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const hlsUrl = data?.videoSource || data?.securedLink || null;
    if (hlsUrl && typeof hlsUrl === 'string') {
      cache.set(cacheKey, hlsUrl, 10 * 60 * 1000); // 10 min cache
      return hlsUrl;
    }
    return null;
  } catch (err) {
    console.warn('[resolve-ravok-hls-error]', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── AnimeSalt Episode HTML Parser ─────────────────────────────────────────────

export async function parseAnimeSaltEpisodeHtml(html: string): Promise<any[]> {
  if (!html || html.length < 200 || html.includes('404 Not Found')) return [];

  const items: any[] = [];
  const usedUrls = new Set<string>();

  // 1. Primary: Extract Ravok MyStream video links
  // Match src="..." and data-src="..." on iframes as well as raw URLs in HTML
  const ravokHashes = new Set<string>();
  const ravokMatches = [
    ...html.matchAll(/https:\/\/ravok\.buzz\/(?:video|e|embed)\/([a-zA-Z0-9]+)/gi),
    ...html.matchAll(/<iframe[^>]*\b(?:src|data-src)=["']([^"']*ravok\.buzz\/video\/([a-zA-Z0-9]+)[^"']*)["'][^>]*>/gi),
  ];

  for (const m of ravokMatches) {
    const h = m[2] || m[1];
    if (h && h.length >= 8) ravokHashes.add(h);
  }

  for (const hash of ravokHashes) {
    const embedUrl = `https://ravok.buzz/video/${hash}`;
    if (!usedUrls.has(embedUrl)) {
      usedUrls.add(embedUrl);

      // Extract direct HLS stream (multi-audio: Hindi, Japanese, English, Telugu, Tamil)
      const hlsUrl = await resolveRavokHls(hash);
      if (hlsUrl) {
        items.push({
          server: 'AnimeSalt MyStream HLS',
          label: 'AnimeSalt · 🇮🇳 Hindi Dub HLS ⚡ (Multi-Audio)',
          embed: embedUrl,
          url: hlsUrl,
          directHlsUrl: hlsUrl,
          referer: embedUrl,
          origin: 'https://ravok.buzz',
          type: 'hls',
          isDirect: true,
          audioLanguage: 'hi',
          languageLabel: '🇮🇳 Hindi Dub (Multi-Audio: Hindi, Telugu, Tamil, Japanese, English)',
          adFree: true,
          headers: {
            Referer: embedUrl,
            Origin: 'https://ravok.buzz',
          },
        });
      }

      // Also provide the embed player option
      items.push({
        server: 'AnimeSalt MyStream',
        label: 'AnimeSalt · 🇮🇳 MyStream (Ad-Free Player)',
        embed: embedUrl,
        type: 'embed',
        audioLanguage: 'hi',
        languageLabel: '🇮🇳 Hindi',
        adFree: false,
      });
    }
  }

  // 2. Secondary: Plyr base64 JSON (Abyssplayer multi-language mirrors)
  const plyrMatch = html.match(/player\.php\?data=([A-Za-z0-9%_-]+)/);
  if (plyrMatch) {
    try {
      const rawB64 = decodeURIComponent(plyrMatch[1]);
      const decoded = Buffer.from(rawB64, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded);
      if (Array.isArray(parsed)) {
        for (const p of parsed) {
          if (p.link && !usedUrls.has(p.link) && !BLOCKED_STREAM_DOMAINS.some((d) => p.link.includes(d))) {
            usedUrls.add(p.link);
            const lang = p.language || 'Multi';
            const isHi = /hindi/i.test(lang);
            const isJa = /japanese/i.test(lang);
            const isTa = /tamil/i.test(lang);
            const isTe = /telugu/i.test(lang);
            const isEn = /english/i.test(lang);
            items.push({
              server: `AnimeSalt ${lang}`,
              label: `AnimeSalt · ${isHi ? '🇮🇳 Hindi' : isJa ? '🇯🇵 Japanese' : isTa ? '🌐 Tamil' : isTe ? '🌐 Telugu' : isEn ? '🇬🇧 English' : '🌐 ' + lang} (Abyss Mirror)`,
              embed: p.link,
              type: 'embed',
              audioLanguage: isHi ? 'hi' : isJa ? 'ja' : isTa ? 'ta' : isTe ? 'te' : isEn ? 'en' : 'en',
              languageLabel: lang,
              adFree: false,
            });
          }
        }
      }
    } catch {
      // ignore parsing error
    }
  }

  // 3. Other iframes (e.g., cybervynx, streamtape)
  const iframeRegex = /<iframe[^>]*\b(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
  let im: RegExpExecArray | null;
  while ((im = iframeRegex.exec(html)) !== null) {
    const src = im[1];
    if (
      src &&
      !usedUrls.has(src) &&
      !src.includes('player.php') &&
      !src.includes('ravok.buzz') &&
      !BLOCKED_STREAM_DOMAINS.some((d) => src.includes(d))
    ) {
      usedUrls.add(src);
      items.push({
        server: 'AnimeSalt Mirror',
        label: 'AnimeSalt · Web Mirror',
        embed: src,
        type: 'embed',
        audioLanguage: 'hi',
        languageLabel: 'Hindi / Multi',
        adFree: false,
      });
    }
  }

  // Guarantee: Direct HLS streams come FIRST!
  items.sort((a, b) => {
    if (a.type === 'hls' && b.type !== 'hls') return -1;
    if (a.type !== 'hls' && b.type === 'hls') return 1;
    if (a.audioLanguage === 'hi' && b.audioLanguage !== 'hi') return -1;
    if (a.audioLanguage !== 'hi' && b.audioLanguage === 'hi') return 1;
    return 0;
  });

  return items;
}

// ── AnimeSalt Scraper & Parser ────────────────────────────────────────────────

export async function fetchAnimeSaltStream(id: string, season: string, ep: string): Promise<any[]> {
  const extracted = extractAnimeSlug(id);
  const sNum = parseInt(extracted.season || season, 10) || 1;
  const epNum = parseInt(extracted.episode || ep, 10) || 1;
  const baseSlug = extracted.slug;
  const cleanId = extracted.fullEpisodeSlug || baseSlug;

  const cacheKey = `animesalt:scraped:${baseSlug}:s${sNum}:e${epNum}`;
  const cached = cache.get<any[]>(cacheKey);
  if (cached) return cached.data;

  const candidateSet = new Set<string>();

  // If user or API passed full slug like "solo-leveling-1x1" or "naruto-1"
  if (cleanId.includes(`${sNum}x${epNum}`) || cleanId.endsWith(`-${epNum}`) || cleanId.includes(`episode-${epNum}`)) {
    candidateSet.add(`https://animesalt.cx/episode/${cleanId}/`);
  }

  // Standard episode URL formats used on AnimeSalt
  candidateSet.add(`https://animesalt.cx/episode/${baseSlug}-${sNum}x${epNum}/`);
  candidateSet.add(`https://animesalt.cx/episode/${cleanId}-${sNum}x${epNum}/`);
  candidateSet.add(`https://animesalt.cx/episode/${baseSlug}-${epNum}/`);
  candidateSet.add(`https://animesalt.cx/episode/${baseSlug}-season-${sNum}-episode-${epNum}/`);
  candidateSet.add(`https://animesalt.cx/episode/${baseSlug}-s${sNum}-ep${epNum}/`);
  candidateSet.add(`https://animesalt.cx/episode/${baseSlug}-hindi-dub-${sNum}x${epNum}/`);
  candidateSet.add(`https://animesalt.cx/episode/${baseSlug}-hindi-${sNum}x${epNum}/`);
  candidateSet.add(`https://animesalt.cx/episode/${baseSlug}-dub-${sNum}x${epNum}/`);
  candidateSet.add(`https://animesalt.cx/episode/${cleanId}/`);
  candidateSet.add(`https://animesalt.cx/episode/${baseSlug}/`);

  const candidates = Array.from(candidateSet);

  // Try direct episode candidates in parallel chunks of 3 for low latency
  for (let i = 0; i < candidates.length; i += 3) {
    const chunk = candidates.slice(i, i + 3);
    const results = await Promise.all(
      chunk.map(async (targetUrl) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        try {
          const res = await fetch(targetUrl, {
            signal: controller.signal,
            headers: {
              'User-Agent': BROWSER_UA,
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              Referer: 'https://animesalt.cx/',
              Origin: 'https://animesalt.cx',
              'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
              'Sec-Fetch-Dest': 'document',
              'Sec-Fetch-Mode': 'navigate',
              'Sec-Fetch-Site': 'same-origin',
            },
          });

          if (!res.ok) return null;
          const html = await res.text();
          if (html.length > 500 && !html.includes('404 Not Found')) {
            const items = await parseAnimeSaltEpisodeHtml(html);
            if (items.length > 0) return items;
          }
        } catch {
          // ignore
        } finally {
          clearTimeout(timer);
        }
        return null;
      })
    );

    const found = results.find((r) => r && r.length > 0);
    if (found && found.length > 0) {
      cache.set(cacheKey, found, 5 * 60 * 1000);
      return found;
    }
  }

  // Fallback: search AnimeSalt if direct candidates 404
  const words = baseSlug.split('-').filter(Boolean);
  const searchTerms = [words.slice(0, 2).join('+'), words.slice(0, 3).join('+')];

  for (const term of searchTerms) {
    if (!term || term.length < 2) continue;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const searchRes = await fetch(`https://animesalt.cx/?s=${term}`, {
        signal: controller.signal,
        headers: {
          'User-Agent': BROWSER_UA,
          Referer: 'https://animesalt.cx/',
          Origin: 'https://animesalt.cx',
        },
      });

      if (searchRes.ok) {
        const sHtml = await searchRes.text();
        const matches = [...sHtml.matchAll(/href=["']https:\/\/animesalt\.cx\/series\/([^"'/]+)\/?["']/gi)].map((m) => m[1]);
        if (matches.length > 0) {
          const foundSlug = matches[0];
          const fallbackCandidates = [
            `https://animesalt.cx/episode/${foundSlug}-${sNum}x${epNum}/`,
            `https://animesalt.cx/episode/${foundSlug}-${epNum}/`,
          ];
          for (const fbUrl of fallbackCandidates) {
            const fbRes = await fetch(fbUrl, {
              headers: {
                'User-Agent': BROWSER_UA,
                Referer: 'https://animesalt.cx/',
                Origin: 'https://animesalt.cx',
              },
            });
            if (fbRes.ok) {
              const fbHtml = await fbRes.text();
              const items = await parseAnimeSaltEpisodeHtml(fbHtml);
              if (items.length > 0) {
                cache.set(cacheKey, items, 5 * 60 * 1000);
                return items;
              }
            }
          }
        }
      }
    } catch {
      // ignore
    } finally {
      clearTimeout(timer);
    }
  }

  // Negative cache prevents repeated batches of upstream requests for episodes
  // that the source does not carry. Keep it short so newly added streams appear.
  cache.set(cacheKey, [], 2 * 60 * 1000);
  return [];
}

/**
 * Formats AnimeSalt streams to match Toko API JSON format
 * allowing full compatibility with existing Toko client apps.
 */
export function formatAnimeSaltAsTokoResponse(
  saltItems: any[],
  cleanId: string,
  season: string,
  ep: string,
  requestOrigin: string,
  proxySecret?: string
) {
  const sources: any[] = [];
  const byLanguage: Record<string, { sources: any[] }> = {};

  for (const item of saltItems) {
    let streamUrl = item.url || item.embed;
    const isDirect = item.type === 'hls' || Boolean(item.directHlsUrl);

    if (isDirect && item.directHlsUrl) {
      const p = new URLSearchParams({ url: item.directHlsUrl });
      if (item.referer) p.set('referer', item.referer);
      if (item.origin) p.set('origin', item.origin);
      if (proxySecret) {
        const exp = Math.floor(Date.now() / 1000) + 86400;
        p.set('exp', String(exp));
        p.set('sig', generateHlsToken(item.directHlsUrl, item.referer || '', item.origin || '', exp, proxySecret));
      }
      streamUrl = `${requestOrigin}/hls-proxy?${p.toString()}`;
    }

    const langCode = item.audioLanguage || 'hi';
    const sourceObj = {
      url: streamUrl,
      type: isDirect ? 'hls' : 'embed',
      isM3U8: isDirect,
      server: item.server || 'AnimeSalt',
      language: item.languageLabel || 'Hindi Dub',
      audioLanguage: langCode,
      languageLabel: item.languageLabel || '🇮🇳 Hindi Dub',
      quality: isDirect ? '1080p Multi' : 'HD',
      headers: item.headers || { Referer: 'https://animesalt.cx/' },
    };

    sources.push(sourceObj);
    if (!byLanguage[langCode]) byLanguage[langCode] = { sources: [] };
    byLanguage[langCode].sources.push(sourceObj);
  }

  return {
    success: true,
    message: 'Stream Found!! (AnimeSalt Fallback)',
    id: cleanId,
    season,
    episode: ep,
    sources,
    byLanguage,
  };
}

// ── Toko API Fetcher ──────────────────────────────────────────────────────────

export async function fetchToko(cleanId: string, season: string, ep: string) {
  const titleVariants = slugToSeasonTitles(cleanId, season);
  const params = new URLSearchParams();
  for (const t of titleVariants) params.append('titles[]', t);
  params.set('season', season);
  params.set('episode', ep);
  params.set('stream', '0');

  const tokoUrl = `${TOKO_API_URL}/api/v3/toko/stream?${params.toString()}`;

  const cacheKey = `toko:${cleanId}:s${season}:e${ep}`;
  const cached = cache.get<any>(cacheKey);
  if (cached) return cached.data;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(tokoUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
      },
    });

    if (res.ok) {
      const text = await res.text();
      if (!text.includes('<!DOCTYPE html') && !text.includes('challenge')) {
        const parsed = JSON.parse(text);
        cache.set(cacheKey, parsed, 3 * 60 * 1000); // cache for 3 mins
        return parsed;
      }
    }
  } catch {
    // ignore
  } finally {
    clearTimeout(timer);
  }
  return null;
}

// ── Redirect-Safe Fetch Helper ────────────────────────────────────────────────

export async function fetchWithAllowedRedirects(
  targetUrl: URL,
  headers: Record<string, string>,
  isAllowedTarget: (url: URL) => boolean,
  signal?: AbortSignal,
  maxRedirects = 5
): Promise<{ response: globalThis.Response | null; finalUrl?: URL; blockedRedirect: boolean }> {
  let currentUrl = new URL(targetUrl.toString());
  const redirectStatuses = new Set([301, 302, 303, 307, 308]);

  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    if (!isAllowedTarget(currentUrl)) {
      return { response: null, blockedRedirect: redirects > 0 };
    }

    const response = await fetch(currentUrl.toString(), {
      method: 'GET',
      headers,
      signal,
      redirect: 'manual',
    });

    const location = response.headers.get('location');
    if (!redirectStatuses.has(response.status) || !location) {
      return { response, finalUrl: currentUrl, blockedRedirect: false };
    }

    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      return { response: null, blockedRedirect: true };
    }

    if (!isAllowedTarget(nextUrl) || redirects === maxRedirects) {
      return { response: null, blockedRedirect: true };
    }
    currentUrl = nextUrl;
  }

  return { response: null, blockedRedirect: true };
}

// ── Catalog Helpers ────────────────────────────────────────────────────────────

export function countValidCatalogHtmlItems(html: string, kind: string): number {
  const articles = html.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/gi);
  let validCount = 0;

  for (const [, attributes, content] of articles) {
    if (!/\bclass=["'][^"']*\bpost\b[^"']*["']/i.test(attributes)) continue;
    const anchor = [...content.matchAll(/<a\b([^>]*)>/gi)].find(([, a]) =>
      /\bclass=["'][^"']*\blnk-blk\b[^"']*["']/i.test(a)
    );
    const hrefMatch = anchor ? anchor[1].match(/\bhref=["']([^"']+)["']/i) : null;
    const href = hrefMatch ? hrefMatch[1].replace(/&amp;/gi, '&') : '';
    const titleMarkup =
      content.match(/<h2\b[^>]*\bentry-title\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ||
      (anchor ? anchor[1].match(/\btitle=["']([^"']+)["']/i)?.[1] : '');
    const title = (titleMarkup || '').replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/gi, ' ').trim();

    try {
      const detail = new URL(href, 'https://animesalt.cx');
      const segments = detail.pathname.split('/').filter(Boolean);
      if (
        title &&
        detail.protocol === 'https:' &&
        ['animesalt.cx', 'www.animesalt.cx'].includes(detail.hostname) &&
        segments.length >= 2 &&
        segments[0] === kind
      ) {
        validCount++;
      }
    } catch {
      // ignore
    }
  }

  // Fallback: if articles exist and valid HTML, count total post articles
  if (validCount === 0) {
    const postCount = [...html.matchAll(/<article\b[^>]*\bclass=["'][^"']*\bpost\b[^"']*["']/gi)].length;
    if (postCount > 0) return postCount;
  }

  return validCount;
}

// ── Homepage Validation & Caching ──────────────────────────────────────────────

export function validateAnimeSaltHomepage(html: string, headers: globalThis.Headers) {
  const challenge =
    headers.get('cf-mitigated')?.toLowerCase() === 'challenge' ||
    /<title>\s*just a moment/i.test(html) ||
    /(?:id=["']challenge-form["']|__cf_chl_(?:tk|opt)|cf-chl-widget)/i.test(html) ||
    /sorry, you have been blocked|access denied/i.test(html);
  if (challenge) return { valid: false, entryCount: 0, reason: 'challenge-or-denial' };
  if (!/<html\b/i.test(html)) return { valid: false, entryCount: 0, reason: 'missing-html-document' };

  const articles = html.matchAll(/<article\b[^>]*class=["'][^"']*\bpost\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi);
  let count = 0;
  for (const [, a] of articles) {
    if (a.includes('href=') && a.includes('img')) count++;
  }
  return {
    valid: count >= 2,
    entryCount: count,
    reason: count >= 2 ? null : 'no-recognized-homepage-entries',
  };
}

export function isTransientHomepageStatus(status: number): boolean {
  return status === 403 || status === 408 || status === 425 || status === 429 || status >= 500;
}

// ── AnimaHD (animahd.com) Scraper & Google Drive Stream Resolver ─────────────

export interface AnimaHdSearchResult {
  id: number;
  title: string;
  slug: string;
  url: string;
  thumb: string;
  score: string;
  season: string;
  year: string;
  genres: string[];
  langBadge?: string;
}

export interface AnimaHdEpisode {
  fileId: string;
  season: string;
  seasonNum: number;
  epNum: number;
  title: string;
  size: string;
  duration: string;
  thumbnail: string;
}

/**
 * Searches the animahd.com database via its open WordPress REST API.
 */
export async function searchAnimaHd(query: string): Promise<AnimaHdSearchResult[]> {
  const cacheKey = `animahd:search:${query.toLowerCase().trim()}`;
  const cached = cache.get<AnimaHdSearchResult[]>(cacheKey);
  if (cached) return cached.data;

  try {
    const res = await fetch(`https://animahd.com/wp-json/wp/v2/posts?search=${encodeURIComponent(query)}&_embed&per_page=12`, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'application/json',
      },
    });

    if (!res.ok) return [];
    const posts: any[] = await res.json();
    if (!Array.isArray(posts)) return [];

    const results: AnimaHdSearchResult[] = posts.map((p) => {
      let thumb = p._mal_cached_thumb || '';
      if (!thumb && p._embedded && p._embedded['wp:featuredmedia']?.[0]) {
        const media = p._embedded['wp:featuredmedia'][0];
        thumb = media.media_details?.sizes?.medium?.source_url || media.source_url || '';
      }

      const genreStr = p._mal_cached_genres || '';
      const genres = genreStr ? genreStr.split(',').map((g: string) => g.trim()) : [];

      return {
        id: p.id,
        title: (p.title?.rendered || '').replace(/&#8211;/g, '-').replace(/&#8217;/g, "'").trim(),
        slug: p.slug,
        url: p.link || `https://animahd.com/${p.slug}/`,
        thumb,
        score: p._mal_cached_score && p._mal_cached_score !== 'N/A' ? p._mal_cached_score : '',
        season: p._mal_cached_season || 'S1',
        year: p._mal_cached_year || '',
        genres,
        langBadge: p._animesuki_lang_badge || 'Multi Audio [Hindi]',
      };
    });

    cache.set(cacheKey, results, 10 * 60 * 1000);
    return results;
  } catch {
    return [];
  }
}

/**
 * Scrapes episode list and Google Drive file IDs from an AnimaHD post.
 */
export async function fetchAnimaHdEpisodes(slugOrUrl: string): Promise<{
  title: string;
  heroImg?: string;
  synopsis?: string;
  episodes: AnimaHdEpisode[];
}> {
  const extracted = extractAnimeSlug(slugOrUrl);
  const slug = extracted.slug;
  const cacheKey = `animahd:episodes:${slug}`;
  const cached = cache.get<any>(cacheKey);
  if (cached) return cached.data;

  try {
    const targetUrl = slugOrUrl.startsWith('http') ? slugOrUrl : `https://animahd.com/${slug}/`;
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: 'https://animahd.com/',
      },
    });

    if (!res.ok) return { title: '', episodes: [] };
    const html = await res.text();

    const titleMatch = html.match(/<h1[^>]*class=['"][^'"]*ff-title[^'"]*['"][^>]*>([\s\S]*?)<\/h1>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : slug;

    const synopsisMatch = html.match(/<div[^>]*class=['"][^'"]*ff-synopsis[^'"]*['"][^>]*>([\s\S]*?)<\/div>/i);
    const synopsis = synopsisMatch ? synopsisMatch[1].trim() : '';

    const heroMatch = html.match(/ff-hero-bg['"][^>]*style=['"][^'"]*url\(["']?([^"')]+)["']?\)/i);
    const heroImg = heroMatch ? heroMatch[1] : '';

    const episodes: AnimaHdEpisode[] = [];
    const itemRegex = /<a[^>]*class=['"][^'"]*app-ep-row-item[^'"]*['"][^>]*data-season=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi;
    let im: RegExpExecArray | null;

    while ((im = itemRegex.exec(html)) !== null) {
      const seasonText = im[1];
      const block = im[2];

      const fileIdMatch = block.match(/data-fileid=['"]([^'"]+)['"]/);
      if (!fileIdMatch) continue;
      const fileId = fileIdMatch[1];

      const nameMatch = block.match(/<div style='font-size: 14px;[^>]*>([\s\S]*?)<\/div>/i);
      const epTitle = nameMatch ? nameMatch[1].trim() : '';

      const sizeMatch = block.match(/<span class='ep-size'>([^<]+)<\/span>/i);
      const size = sizeMatch ? sizeMatch[1].trim() : '';

      const durMatch = block.match(/<div class='ep-duration-badge'[^>]*>([^<]+)<\/div>/i);
      const duration = durMatch ? durMatch[1].trim() : '';

      const thumbMatch = block.match(/<img[^>]*src=['"]([^'"]+)['"]/i);
      let thumbnail = thumbMatch ? thumbMatch[1] : '';
      if (thumbnail.includes('sec_route=1') && thumbnail.includes('p=')) {
        try {
          const pVal = new URL(thumbnail).searchParams.get('p');
          if (pVal) thumbnail = Buffer.from(pVal, 'base64').toString('utf-8');
        } catch {
          // keep original
        }
      }

      // Parse season and episode numbers from title (e.g. S01E03)
      let seasonNum = 1;
      let epNum = 1;
      const sNumMatch = seasonText.match(/(\d+)/);
      if (sNumMatch) seasonNum = parseInt(sNumMatch[1], 10);

      const seMatch = epTitle.match(/S(\d+)E(\d+)/i) || epTitle.match(/(?:ep|episode)[-.\s]*(\d+)/i);
      if (seMatch) {
        if (seMatch[2]) {
          seasonNum = parseInt(seMatch[1], 10);
          epNum = parseInt(seMatch[2], 10);
        } else {
          epNum = parseInt(seMatch[1], 10);
        }
      } else {
        epNum = episodes.length + 1;
      }

      episodes.push({
        fileId,
        season: seasonText,
        seasonNum,
        epNum,
        title: epTitle,
        size,
        duration,
        thumbnail,
      });
    }

    const payload = { title, heroImg, synopsis, episodes };
    cache.set(cacheKey, payload, 10 * 60 * 1000);
    return payload;
  } catch {
    return { title: '', episodes: [] };
  }
}

/**
 * Robust extractor for Google Drive file IDs from raw IDs, file URLs, open URLs, and preview URLs.
 */
export function extractGoogleDriveFileId(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  // Match standard URL patterns: /file/d/{id}, id={id}, open?id={id}, /d/{id}
  const urlMatch = trimmed.match(/(?:file\/d\/|id=|\/d\/)([a-zA-Z0-9_-]{25,50})/);
  if (urlMatch) return urlMatch[1];

  // If it's a URL or contains slashes or spaces or query params, it's not a raw ID
  if (trimmed.includes('/') || trimmed.includes(' ') || trimmed.includes('?')) return null;

  // Slugs are all-lowercase hyphenated words (e.g. "that-time-i-got-reincarnated-as-a-slime", "solo-leveling")
  // They should never be treated as raw Google Drive IDs
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed) && !/[A-Z]/.test(trimmed)) {
    return null;
  }

  // Real Google Drive IDs are 25-50 chars and have high entropy:
  // Must have letters and (digits or uppercase letters)
  const hasLetters = /[a-zA-Z]/.test(trimmed);
  const hasDigits = /[0-9]/.test(trimmed);
  const hasUppercase = /[A-Z]/.test(trimmed);

  if (/^[a-zA-Z0-9_-]{25,50}$/.test(trimmed)) {
    if (hasLetters && (hasDigits || hasUppercase)) {
      return trimmed;
    }
  }

  return null;
}

/**
 * Resolves a specific episode stream from AnimaHD by slug, season, and episode number,
 * or directly resolves from a Google Drive File ID / URL without any web scraping.
 */
export async function fetchAnimaHdStream(slugOrId: string, season: string, ep: string): Promise<any[]> {
  // If user or API passed a direct Google Drive File ID or URL, resolve directly without scraping!
  const directGdriveId = extractGoogleDriveFileId(slugOrId);
  if (directGdriveId) {
    return [
      {
        server: 'Google Drive Direct Player',
        label: 'Google Drive · ⚡ Direct 1080p Cloud Player (Official Embed)',
        embed: `https://drive.google.com/file/d/${directGdriveId}/preview`,
        url: `/gdrive-stream?id=${encodeURIComponent(directGdriveId)}`,
        fileId: directGdriveId,
        type: 'embed',
        audioLanguage: 'hi',
        languageLabel: '🇮🇳 Multi-Audio / 1080p HD',
        adFree: true,
        source: 'GoogleDrive',
      },
      {
        server: 'Google Drive Binary Stream',
        label: 'Google Drive · 🎬 Direct Stream / Cloud Player (.mp4/.mkv)',
        url: `/gdrive-stream?id=${encodeURIComponent(directGdriveId)}`,
        directStreamUrl: `/gdrive-stream?id=${encodeURIComponent(directGdriveId)}`,
        embed: `https://drive.google.com/file/d/${directGdriveId}/preview`,
        fileId: directGdriveId,
        type: 'embed',
        streamType: 'direct_stream',
        audioLanguage: 'hi',
        languageLabel: 'Direct Stream (.mp4/.mkv)',
        adFree: true,
        source: 'GoogleDrive',
      },
    ];
  }

  const extracted = extractAnimeSlug(slugOrId);
  const sNum = parseInt(extracted.season || season, 10) || 1;
  const epNum = parseInt(extracted.episode || ep, 10) || 1;
  const baseSlug = extracted.slug;

  const cacheKey = `animahd:stream:${baseSlug}:s${sNum}:e${epNum}`;
  const cached = cache.get<any[]>(cacheKey);
  if (cached) return cached.data;

  // Search or fetch anime post
  let animeData = await fetchAnimaHdEpisodes(baseSlug);
  let resolvedAnimaHdSlug = baseSlug;
  const hasExactEpisode = (data: Awaited<ReturnType<typeof fetchAnimaHdEpisodes>>) =>
    data.episodes.some((episode) => episode.seasonNum === sNum && episode.epNum === epNum);
  if (!hasExactEpisode(animeData)) {
    const searchResults = await searchAnimaHd(baseSlug.replace(/-/g, ' '));
    const ignoredTitleWords = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'as']);
    const targetWords = baseSlug.split('-').filter((word) => word.length > 2 && !ignoredTitleWords.has(word));
    const titleScore = (candidate: AnimaHdSearchResult) => {
      const candidateWords = new Set(
        `${candidate.slug} ${slugify(candidate.title)}`
          .split(/[^a-z0-9]+/)
          .filter(Boolean)
      );
      const commonWords = targetWords.filter((word) => candidateWords.has(word)).length;
      return targetWords.length > 0 ? commonWords / targetWords.length : 0;
    };
    const bestMatch = searchResults
      .map((candidate) => ({ candidate, score: titleScore(candidate) }))
      .sort((a, b) => b.score - a.score)[0];
    // Search APIs return loosely related titles too. Only use a result that
    // clearly matches the requested anime instead of borrowing another show’s
    // Google Drive episode IDs.
    if (bestMatch && bestMatch.score >= 0.6) {
      resolvedAnimaHdSlug = bestMatch.candidate.slug;
      const candidateData = await fetchAnimaHdEpisodes(bestMatch.candidate.url || bestMatch.candidate.slug);
      if (hasExactEpisode(candidateData)) animeData = candidateData;
    }
  }

  if (animeData.episodes.length === 0) {
    cache.set(cacheKey, [], 2 * 60 * 1000);
    return [];
  }

  // Never substitute a different season/episode: that can expose another
  // episode's video under the requested URL. AnimaHD records exact season and
  // episode coordinates, so only an exact match is safe to return.
  const matched = animeData.episodes.find((e) => e.seasonNum === sNum && e.epNum === epNum);

  if (!matched || !matched.fileId) {
    cache.set(cacheKey, [], 2 * 60 * 1000);
    return [];
  }

  const previewEmbed = `https://drive.google.com/file/d/${matched.fileId}/preview`;
  const streamUrl = `/gdrive-stream?id=${encodeURIComponent(matched.fileId)}`;

  const results = [
    {
      server: 'AnimaHD 1080p (Google Drive Player)',
      label: `AnimaHD · ⚡ Direct 1080p Cloud Player [${matched.title || `S${sNum}E${epNum}`}]`,
      embed: previewEmbed,
      url: streamUrl,
      directStreamUrl: streamUrl,
      fileId: matched.fileId,
      type: 'embed',
      audioLanguage: 'hi',
      languageLabel: '🇮🇳 Hindi Dub (Multi-Audio 1080p HD)',
      adFree: true,
      fileSize: matched.size,
      duration: matched.duration,
      source: 'AnimaHD',
      providerSlug: resolvedAnimaHdSlug,
    },
    {
      server: 'AnimaHD Stream URL (Direct File)',
      label: `AnimaHD · 🎬 Direct File Stream [${matched.title || `S${sNum}E${epNum}`}]`,
      embed: previewEmbed,
      url: streamUrl,
      directStreamUrl: streamUrl,
      fileId: matched.fileId,
      type: 'embed',
      streamType: 'direct_stream',
      audioLanguage: 'hi',
      languageLabel: 'Direct Stream (.mp4/.mkv)',
      adFree: true,
      fileSize: matched.size,
      duration: matched.duration,
      source: 'AnimaHD',
      providerSlug: resolvedAnimaHdSlug,
    },
  ];

  cache.set(cacheKey, results, 5 * 60 * 1000);
  return results;
}

/**
 * Resolves a Google Drive file ID into an authenticated, confirmed direct download stream URL.
 */
export async function resolveGoogleDriveStreamUrl(fileId: string): Promise<{
  streamUrl: string;
  cookies: string;
  fileId: string;
}> {
  const cacheKey = `gdrive:resolve:${fileId}`;
  const cached = cache.get<{ streamUrl: string; cookies: string; fileId: string }>(cacheKey);
  if (cached) return cached.data;

  const gdriveUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
  const res1 = await fetch(gdriveUrl, {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
  });

  const cookies = res1.headers.get('set-cookie') || '';
  const html = await res1.text();

  const uuidMatch = html.match(/name=['"]uuid['"]\s+value=['"]([^'"]+)['"]/);
  const uuid = uuidMatch ? uuidMatch[1] : '';

  const confirmMatch = html.match(/name=['"]confirm['"]\s+value=['"]([^'"]+)['"]/);
  const confirm = confirmMatch ? confirmMatch[1] : 't';

  let streamUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=${confirm}`;
  if (uuid) {
    streamUrl += `&uuid=${encodeURIComponent(uuid)}`;
  }

  const result = { streamUrl, cookies, fileId };
  // Cache for 10 minutes so all HTTP Range requests are fast and reliable
  cache.set(cacheKey, result, 10 * 60 * 1000);
  return result;
}

export interface PlayZenStreamQuality {
  quality: string;
  label: string;
  url: string;
  fileId?: string;
  filename?: string;
}

export interface PlayZenStreamResult {
  server: string;
  label: string;
  embed: string;
  url?: string;
  directStreamUrl?: string;
  hlsProxyUrl?: string;
  fileId?: string;
  quality?: string;
  qualities?: PlayZenStreamQuality[];
  type: string;
  audioLanguage: string;
  languageLabel: string;
  adFree: boolean;
  source: string;
  downloadUrl?: string;
}

/**
 * Resolves PlayZen streams from AnimeFlash / AnimeInfinity.
 * Extracts direct edge MKV streams (1080p, 720p, 480p) and official player embed.
 */
export async function fetchPlayZenStream(
  slugOrId: string,
  season: string | number = '1',
  ep: string | number = '1',
  slugAliases: string[] = []
): Promise<PlayZenStreamResult[]> {
  const extracted = extractAnimeSlug(String(slugOrId));
  const slug = extracted.slug;
  const sNum = String(season || extracted.season || '1');
  const epNum = String(ep || extracted.episode || '1');

  const aliases = [...new Set(slugAliases.map((value) => slugify(value)).filter((value) => value && value !== slug))];
  const cacheKey = `playzen:stream:${slug}:s${sNum}:e${epNum}:a${aliases.sort().join(',')}`;
  const cached = cache.get<PlayZenStreamResult[]>(cacheKey);
  if (cached) return cached.data;

  const candidateSlugs = [slug, ...aliases];
  if (slug.includes('-kimetsu-no-yaiba')) {
    candidateSlugs.push(slug.replace(/-kimetsu-no-yaiba.*/, ''));
  }
  if (slug.startsWith('kimetsu-no-yaiba-')) {
    candidateSlugs.push(slug.replace(/^kimetsu-no-yaiba-/, ''));
  }

  const results: PlayZenStreamResult[] = [];
  const targetUrls: string[] = [];

  for (const s of candidateSlugs) {
    targetUrls.push(`https://animeflash.live/episode/${s}/${sNum}x${epNum}`);
    targetUrls.push(`https://animeflash.live/episode/${s}-${sNum}x${epNum}`);
    if (sNum === '1' && epNum === '1') {
      targetUrls.push(`https://animeflash.live/movie/${s}`);
    }
  }

  let episodeHtml = '';
  let usedTargetUrl = '';

  for (const url of targetUrls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      if (res.ok) {
        episodeHtml = await res.text();
        usedTargetUrl = url;
        break;
      }
    } catch {
      // try next URL
    }
  }

  if (!episodeHtml) {
    cache.set(cacheKey, [], 2 * 60 * 1000);
    return [];
  }

  // 1. Look for archive.animeinfinity.me/player/<TOKEN>
  let playerUrl = '';

  // Method A: Check Next.js Flight RSC chunk format ":T<hexLength>,https://archive.animeinfinity.me/player/..."
  const rscMatch = episodeHtml.match(/:T([0-9a-fA-F]+),(https?:\/\/archive\.animeinfinity\.me\/player\/[^\r\n]+)/);
  if (rscMatch) {
    const hexLen = parseInt(rscMatch[1], 16);
    if (!isNaN(hexLen) && hexLen > 0 && hexLen < 5000) {
      playerUrl = rscMatch[2].slice(0, hexLen);
    }
  }

  // Method B: Standard regex match with delimiter and Flight chunk ID cleanup
  if (!playerUrl) {
    const tokenMatch = episodeHtml.match(/https?:\/\/archive\.animeinfinity\.me\/player\/([A-Za-z0-9+/=_\-%]+)/i);
    if (tokenMatch) {
      let rawToken = tokenMatch[1].replace(/\\/g, '').trim();
      // Remove any trailing Flight chunk headers (e.g. 3a:, 7a:, etc.)
      const chunkHeaderIdx = rawToken.search(/[0-9a-fA-F]+:/);
      if (chunkHeaderIdx !== -1) {
        rawToken = rawToken.slice(0, chunkHeaderIdx);
      }
      // Clean up base64 padding if present
      const eqIdx = rawToken.indexOf('==');
      if (eqIdx !== -1) {
        rawToken = rawToken.slice(0, eqIdx + 2);
      } else {
        const singleEq = rawToken.indexOf('=');
        if (singleEq !== -1) {
          rawToken = rawToken.slice(0, singleEq + 1);
        }
      }
      playerUrl = `https://archive.animeinfinity.me/player/${rawToken}`;
    }
  }

  // Check for Ravok MyStream fallback on the same page
  const ravokMatch = episodeHtml.match(/https:\/\/ravok\.buzz\/video\/[a-zA-Z0-9]+/i);
  const ravokUrl = ravokMatch ? ravokMatch[0] : '';

  let playerHtml = '';
  if (playerUrl) {
    try {
      const pRes = await fetch(playerUrl, {
        headers: {
          'User-Agent': BROWSER_UA,
          Referer: usedTargetUrl || 'https://animeflash.live/',
        },
      });
      if (pRes.ok) {
        playerHtml = await pRes.text();
      }
    } catch {
      // Fallback
    }
  }

  const combinedHtml = (playerHtml || '') + ' ' + episodeHtml;

  // Extract all MKV/MP4 stream URLs from player.animeinfinity.me
  const mkvRegex = /https:\/\/player\.animeinfinity\.me\/([a-zA-Z0-9_\-]+)\/([^\s"'<>\\]+\.(?:mkv|mp4|webm))/gi;
  const streamMatches = new Map<string, { fileId: string; filename: string; fullUrl: string }>();

  let m: RegExpExecArray | null;
  while ((m = mkvRegex.exec(combinedHtml)) !== null) {
    const fullUrl = m[0].replace(/\\/g, '');
    const fileId = m[1];
    const filename = decodeURIComponent(m[2]);
    if (!streamMatches.has(fullUrl)) {
      streamMatches.set(fullUrl, { fileId, filename, fullUrl });
    }
  }

  // Also extract any direct download link
  const dlMatch = combinedHtml.match(/https:\/\/archive\.animeinfinity\.me\/infinidl\/[A-Za-z0-9+/=_\-%]+/i);
  const downloadUrl = dlMatch ? dlMatch[0] : undefined;

  // Sort streams: 1080p, then 720p, then 480p, then other
  const sortedStreams = Array.from(streamMatches.values()).sort((a, b) => {
    const rank = (fn: string) => {
      if (fn.includes('1080p')) return 3;
      if (fn.includes('720p')) return 2;
      if (fn.includes('480p')) return 1;
      return 0;
    };
    return rank(b.filename) - rank(a.filename);
  });

  // Construct PlayZen Result Items (Combines all direct stream qualities in one unified server)
  if (sortedStreams.length > 0) {
    const qualities: PlayZenStreamQuality[] = sortedStreams.map((st) => {
      let q = 'HD';
      if (st.filename.includes('1080p')) q = '1080p FHD';
      else if (st.filename.includes('720p')) q = '720p HD';
      else if (st.filename.includes('480p')) q = '480p SD';
      return {
        quality: q,
        label: q,
        url: st.fullUrl,
        fileId: st.fileId,
        filename: st.filename,
      };
    });

    const highest = qualities[0];
    const availableQualitiesStr = qualities.map((q) => q.quality).join(' / ');

    results.push({
      server: 'PlayZen Edge Direct',
      label: `PlayZen · ⚡ Multi-Quality Direct Stream (${availableQualitiesStr})`,
      embed: playerUrl || usedTargetUrl,
      url: highest.url,
      directStreamUrl: highest.url,
      fileId: highest.fileId,
      quality: highest.quality,
      qualities,
      type: 'embed',
      audioLanguage: 'hi',
      languageLabel: '🇮🇳 Multi Audio (Hindi Dub)',
      adFree: true,
      source: 'PlayZen',
      downloadUrl,
    });
  } else if (playerUrl) {
    // Add official PlayZen embed player only if direct streams were not already found
    results.push({
      server: 'PlayZen Official Player',
      label: 'PlayZen · 🚀 Official Edge Player (AnimeInfinity Embed)',
      embed: playerUrl,
      type: 'embed',
      audioLanguage: 'hi',
      languageLabel: '🇮🇳 Multi Audio (Hindi Dub)',
      adFree: true,
      source: 'PlayZen',
      downloadUrl,
    });
  }

  // If Ravok was found on animeflash.live as a secondary server
  if (ravokUrl) {
    results.push({
      server: 'AnimeFlash MyStream',
      label: 'AnimeFlash · 🇮🇳 MyStream (Ravok Embed)',
      embed: ravokUrl,
      type: 'embed',
      audioLanguage: 'hi',
      languageLabel: '🇮🇳 Hindi Dub',
      adFree: false,
      source: 'AnimeFlash',
    });
  }

  if (results.length > 0) {
    cache.set(cacheKey, results, 15 * 60 * 1000);
  } else {
    cache.set(cacheKey, [], 2 * 60 * 1000);
  }

  return results;
}

export interface AnimeCardItem {
  id?: string;
  rank?: number;
  title: string;
  slug: string;
  url: string;
  image: string;
  type: 'series' | 'movie';
  languages?: string[];
  isDubbed?: boolean;
  score?: string;
  episodes?: string;
  season?: number;
  episodeNumber?: number;
}

export interface AnimeSaltHomepageData {
  success: boolean;
  spotlight: AnimeCardItem[];
  trendingSeries: AnimeCardItem[];
  trendingMovies: AnimeCardItem[];
  freshDrops: AnimeCardItem[];
  onAirSeries: AnimeCardItem[];
  newArrivals: AnimeCardItem[];
  latestMovies: AnimeCardItem[];
  categories: Array<{ name: string; slug: string }>;
  updatedAt: string;
}

interface AnimeSaltCanonicalItem {
  slug: string;
  title: string;
  type: 'series' | 'movie';
}

const ANIMESALT_CANONICAL_INDEX_KEY = 'animesalt:canonical_index';
const ANIMESALT_CANONICAL_TTL_MS = 6 * 60 * 60 * 1000;
const TITLE_STOP_WORDS = new Set(['a', 'an', 'and', 'as', 'of', 'the', 'to', 'with', 'no']);

function titleTokens(value: string): string[] {
  return slugify(value)
    .split('-')
    .filter((token) => token.length > 1 && !TITLE_STOP_WORDS.has(token));
}

function animeSaltTitleScore(requested: string, candidate: AnimeSaltCanonicalItem): number {
  const requestedTokens = new Set(titleTokens(requested));
  const candidateTokens = new Set([...titleTokens(candidate.slug), ...titleTokens(candidate.title)]);
  if (requestedTokens.size < 3 || candidateTokens.size === 0) return 0;
  let shared = 0;
  for (const token of requestedTokens) if (candidateTokens.has(token)) shared++;
  return (2 * shared) / (requestedTokens.size + candidateTokens.size);
}

function rememberAnimeSaltItems(items: Array<{
  slug?: string;
  anime_id?: string;
  title?: string;
  type?: string;
}>): AnimeSaltCanonicalItem[] {
  const indexed = cache.get<Record<string, AnimeSaltCanonicalItem>>(ANIMESALT_CANONICAL_INDEX_KEY)?.data || {};
  const added: AnimeSaltCanonicalItem[] = [];
  for (const item of items) {
    const slug = slugify(item.slug || item.anime_id || '');
    if (!slug) continue;
    const record: AnimeSaltCanonicalItem = {
      slug,
      title: (item.title || slug.replace(/-/g, ' ')).trim(),
      type: item.type === 'movie' || item.type === 'Movie' ? 'movie' : 'series',
    };
    indexed[slug] = record;
    added.push(record);
  }
  if (added.length > 0) cache.set(ANIMESALT_CANONICAL_INDEX_KEY, indexed, ANIMESALT_CANONICAL_TTL_MS);
  return added;
}

/**
 * Resolves stale/provider-specific slugs to AnimeSalt's series or movie slug.
 * Search candidates are accepted only when the title token overlap is strong;
 * otherwise the input is kept intact instead of selecting an unrelated anime.
 */
export async function resolveAnimeSaltCanonicalSlug(rawSlug: string): Promise<string> {
  const requested = slugify(extractAnimeSlug(rawSlug).slug || rawSlug);
  if (!requested) return '';

  const aliasKey = `animesalt:canonical_alias:${requested}`;
  const aliasCache = cache.get<{ slug: string; matched: boolean }>(aliasKey);
  if (aliasCache) return aliasCache.data.matched ? aliasCache.data.slug : requested;

  const index = cache.get<Record<string, AnimeSaltCanonicalItem>>(ANIMESALT_CANONICAL_INDEX_KEY)?.data || {};
  const exact = index[requested];
  if (exact) {
    cache.set(aliasKey, { slug: exact.slug, matched: true }, ANIMESALT_CANONICAL_TTL_MS);
    return exact.slug;
  }

  const indexedMatches = Object.values(index)
    .map((item) => ({ item, score: animeSaltTitleScore(requested, item) }))
    .sort((a, b) => b.score - a.score || a.item.slug.length - b.item.slug.length);
  if (indexedMatches[0]?.score >= 0.78 &&
      (!indexedMatches[1] || indexedMatches[0].score - indexedMatches[1].score >= 0.04)) {
    const canonical = indexedMatches[0].item.slug;
    cache.set(aliasKey, { slug: canonical, matched: true }, ANIMESALT_CANONICAL_TTL_MS);
    return canonical;
  }

  const tokens = titleTokens(requested);
  const searchLengths = [...new Set([
    tokens.length,
    tokens.length - 1,
    tokens.length - 2,
    tokens.length - 3,
  ])].filter((length) => length >= 3);
  let candidates = [...Object.values(index)];

  for (const length of searchLengths) {
    const query = tokens.slice(0, length).join(' ');
    if (!query) continue;
    try {
      const search = await fetchStructuredSearch(query, 1);
      const found = rememberAnimeSaltItems(search.results.results);
      candidates = [...candidates, ...found];
      const ranked = candidates
        .map((item) => ({ item, score: animeSaltTitleScore(requested, item) }))
        .sort((a, b) => b.score - a.score || a.item.slug.length - b.item.slug.length);
      const best = ranked[0];
      if (best && best.score >= 0.78 &&
          (!ranked[1] || best.score - ranked[1].score >= 0.04)) {
        cache.set(aliasKey, { slug: best.item.slug, matched: true }, ANIMESALT_CANONICAL_TTL_MS);
        return best.item.slug;
      }
    } catch {
      // A failed AnimeSalt search is not permission to substitute other data.
    }
  }

  cache.set(aliasKey, { slug: requested, matched: false }, 2 * 60 * 1000);
  return requested;
}

/**
 * Fetches and parses the live AnimeSalt homepage into structured sections:
 * spotlight, trending series, trending movies, fresh drops, on-air, and new arrivals.
 */
export async function fetchAnimeSaltHomepageData(): Promise<AnimeSaltHomepageData> {
  const cacheKey = 'animesalt:parsed_homepage_data';
  const cached = cache.get<AnimeSaltHomepageData>(cacheKey);
  if (cached) return cached.data;

  try {
    const res = await fetch('https://animesalt.cx/', {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!res.ok) {
      throw new Error(`Upstream AnimeSalt HTTP ${res.status}`);
    }

    const html = await res.text();

    function parseChart(sectionHtml: string, defaultType: 'series' | 'movie'): AnimeCardItem[] {
      const items: AnimeCardItem[] = [];
      const chartRegex = /<div class="chart-item">[\s\S]*?<div class="chart-number">(\d+)<\/div>[\s\S]*?<a href="([^"]+)"[\s\S]*?(?:data-src|src)="([^"]+)"[\s\S]*?alt="([^"]*)"[\s\S]*?<div class="chart-title">([\s\S]*?)<\/div>/gi;
      let m: RegExpExecArray | null;
      while ((m = chartRegex.exec(sectionHtml)) !== null) {
        const rank = parseInt(m[1], 10);
        const url = m[2];
        let img = m[3];
        if (img.startsWith('//')) img = 'https:' + img;
        const title = m[5].replace(/<[^>]+>/g, '').trim() || m[4].replace(/^Image\s*/i, '').trim();
        const slugMatch = url.match(/\/(?:series|movies)\/([^/]+)/);
        const slug = slugMatch ? slugMatch[1] : '';
        const type = url.includes('/movies/') ? 'movie' : defaultType;
        items.push({
          rank,
          title,
          slug,
          url,
          image: img,
          type,
          languages: ['Hindi', 'Japanese', 'English'],
          isDubbed: true,
        });
      }
      return items;
    }

    function parseSectionSlides(sectionHtml: string, defaultType: 'series' | 'movie'): AnimeCardItem[] {
      const items: AnimeCardItem[] = [];
      const slideRegex = /<li[^>]*class="([^"]*)"[^>]*>[\s\S]*?<img[^>]*(?:data-src|src)="([^"]+)"[^>]*alt="([^"]*)"[\s\S]*?<a href="([^"]+)"/gi;
      let m: RegExpExecArray | null;
      while ((m = slideRegex.exec(sectionHtml)) !== null) {
        const cls = m[1];
        let img = m[2];
        if (img.startsWith('//')) img = 'https:' + img;
        const title = m[3].replace(/^Image\s*/i, '').trim();
        const url = m[4];
        const slugMatch = url.match(/\/(?:series|movies)\/([^/]+)/);
        const slug = slugMatch ? slugMatch[1] : '';
        const type = url.includes('/movies/') ? 'movie' : defaultType;

        const languages: string[] = [];
        if (cls.includes('category-hindi')) languages.push('Hindi');
        if (cls.includes('category-japanese')) languages.push('Japanese');
        if (cls.includes('category-english')) languages.push('English');
        if (cls.includes('category-tamil')) languages.push('Tamil');
        if (cls.includes('category-telugu')) languages.push('Telugu');

        items.push({
          title,
          slug,
          url,
          image: img,
          type,
          languages: languages.length > 0 ? languages : ['Hindi', 'Japanese'],
          isDubbed: languages.length > 0,
        });
      }
      return items;
    }

    function parseFreshDrops(sectionHtml: string): AnimeCardItem[] {
      const items: AnimeCardItem[] = [];
      const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
      let m: RegExpExecArray | null;
      while ((m = articleRegex.exec(sectionHtml)) !== null) {
        const art = m[1];
        if (art.includes('${item.')) continue;
        const title = art.match(/<h2[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h2>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() ||
                      art.match(/alt="([^"]*)"/i)?.[1]?.replace(/^Image\s*/i, '').trim() || '';
        let img = art.match(/(?:data-src|src)="([^"]+)"/i)?.[1] || '';
        if (img.startsWith('//')) img = 'https:' + img;
        const url = art.match(/href="([^"]+)"/i)?.[1] || '';
        const slugMatch = url.match(/\/(?:series|movies)\/([^/]+)/);
        const slug = slugMatch ? slugMatch[1] : '';
        const type = url.includes('/movies/') ? 'movie' : 'series';

        // Extract real episode & season from badges e.g. <span class="year">EP:11</span> and <span class="post-ql">Season 1</span>
        const epRaw = art.match(/<span[^>]*class=["']year["'][^>]*>([^<]+)<\/span>/i)?.[1] ||
                      art.match(/(?:EP:?|Episode)\s*(\d+)/i)?.[1] || '';
        const epDigits = epRaw.match(/\d+/);
        const episodeNumber = epDigits ? parseInt(epDigits[0], 10) : 1;

        const seasonRaw = art.match(/<span[^>]*class=["']post-ql["'][^>]*>([^<]+)<\/span>/i)?.[1] ||
                          art.match(/Season\s*(\d+)/i)?.[1] || '';
        const seasonDigits = seasonRaw.match(/\d+/);
        const season = seasonDigits ? parseInt(seasonDigits[0], 10) : 1;

        if (title && slug) {
          items.push({
            title,
            slug,
            url,
            image: img,
            type,
            languages: ['Hindi', 'Japanese', 'English'],
            isDubbed: true,
            episodes: String(episodeNumber),
            episodeNumber,
            season,
          });
        }
      }
      return items;
    }

    const pSeriesIdx = html.indexOf('Most-Watched Series');
    const pMoviesIdx = html.indexOf('Most-Watched Films');
    const freshIdx = html.indexOf('Fresh Drops');
    const onAirIdx = html.indexOf('On-Air Series');
    const newArrivalsIdx = html.indexOf('New Anime Arrivals');
    const cartoonSeriesIdx = html.indexOf('Just In: Cartoon Series');
    const latestMoviesIdx = html.indexOf('Latest Anime Movies');
    const cartoonFilmsIdx = html.indexOf('Fresh Cartoon Films');

    const trendingSeries = pSeriesIdx !== -1 && pMoviesIdx !== -1
      ? parseChart(html.slice(pSeriesIdx, pMoviesIdx), 'series')
      : [];

    const trendingMovies = pMoviesIdx !== -1 && freshIdx !== -1
      ? parseChart(html.slice(pMoviesIdx, freshIdx), 'movie')
      : [];

    const freshDrops = freshIdx !== -1 && onAirIdx !== -1
      ? parseFreshDrops(html.slice(freshIdx, onAirIdx))
      : [];

    const onAirSeries = onAirIdx !== -1 && newArrivalsIdx !== -1
      ? parseSectionSlides(html.slice(onAirIdx, newArrivalsIdx), 'series')
      : [];

    const newArrivals = newArrivalsIdx !== -1 && cartoonSeriesIdx !== -1
      ? parseSectionSlides(html.slice(newArrivalsIdx, cartoonSeriesIdx), 'series')
      : [];

    const latestMovies = latestMoviesIdx !== -1 && cartoonFilmsIdx !== -1
      ? parseSectionSlides(html.slice(latestMoviesIdx, cartoonFilmsIdx), 'movie')
      : [];

    // Spotlight curated from top trending items
    const spotlight = [
      ...trendingSeries.slice(0, 5),
      ...trendingMovies.slice(0, 3),
    ];

    const categories = [
      { name: 'Action', slug: 'action' },
      { name: 'Adventure', slug: 'adventure' },
      { name: 'Comedy', slug: 'comedy' },
      { name: 'Drama', slug: 'drama' },
      { name: 'Fantasy', slug: 'fantasy' },
      { name: 'Hindi Dubbed', slug: 'hindi' },
      { name: 'Isekai', slug: 'isekai' },
      { name: 'Romance', slug: 'romance' },
      { name: 'Sci-Fi', slug: 'sci-fi' },
      { name: 'Supernatural', slug: 'supernatural' },
    ];

    const data: AnimeSaltHomepageData = {
      success: true,
      spotlight,
      trendingSeries,
      trendingMovies,
      freshDrops,
      onAirSeries,
      newArrivals,
      latestMovies,
      categories,
      updatedAt: new Date().toISOString(),
    };

    rememberAnimeSaltItems([
      ...spotlight,
      ...trendingSeries,
      ...trendingMovies,
      ...freshDrops,
      ...onAirSeries,
      ...newArrivals,
      ...latestMovies,
    ]);
    cache.set(cacheKey, data, 10 * 60 * 1000);
    return data;
  } catch (err) {
    console.warn('[fetchAnimeSaltHomepageData-warn] AnimeSalt homepage unavailable:', err instanceof Error ? err.message : String(err));
    return await getFallbackAnimeSaltHomepageData();
  }
}

async function getFallbackAnimeSaltHomepageData(): Promise<AnimeSaltHomepageData> {
  const stale = cache.get<AnimeSaltHomepageData>(`animesalt:parsed_homepage_data`, true, HOMEPAGE_MAX_STALE_MS);
  if (stale) return stale.data;

  // Never fabricate homepage rows from another catalog. Empty sections make
  // upstream failure explicit and prevent links to titles AnimeSalt does not host.
  return {
    success: false,
    spotlight: [],
    trendingSeries: [],
    trendingMovies: [],
    freshDrops: [],
    onAirSeries: [],
    newArrivals: [],
    latestMovies: [],
    categories: [],
    updatedAt: new Date().toISOString(),
  };
}
export interface CatalogItem {
  title: string;
  anime_id: string;
  poster: string | null;
}

export interface CatalogPageResponse {
  success: boolean;
  message?: string;
  results: {
    currentPage: number;
    totalPages: number;
    results: CatalogItem[];
  };
}

/**
 * Fetches structured catalog items for series or movies from AnimeSalt with total page counts.
 */
export async function fetchStructuredCatalog(
  kind: 'series' | 'movies',
  page: number = 1
): Promise<CatalogPageResponse> {
  const cacheKey = `catalog:json:${kind}:${page}`;
  const cached = cache.get<CatalogPageResponse>(cacheKey);
  if (cached) return cached.data;

  const targetUrl =
    page <= 1
      ? `https://animesalt.cx/${kind}/`
      : `https://animesalt.cx/${kind}/page/${page}/`;

  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: 'https://animesalt.cx/',
      },
    });

    if (!res.ok) {
      throw new Error(`Upstream AnimeSalt HTTP ${res.status}`);
    }

    const html = await res.text();
    const articleRegex = /<article[^>]*class=["']post[^"']*["']>([\s\S]*?)<\/article>/gi;
    let match: RegExpExecArray | null;
    const items: CatalogItem[] = [];

    while ((match = articleRegex.exec(html)) !== null) {
      const art = match[1];
      const linkMatch = art.match(/href=["'](https:\/\/animesalt\.cx\/(?:series|movies)\/([^"'/]+)\/?)["']/i);
      const titleMatch =
        art.match(/<h2[^>]*class=["']entry-title["'][^>]*>([\s\S]*?)<\/h2>/i) ||
        art.match(/alt=["']([^"']*)["']/i);
      let poster =
        art.match(/data-src=["']([^"']+)["']/i)?.[1] ||
        art.match(/src=["']([^"']+)["']/i)?.[1] ||
        null;
      if (poster && poster.startsWith('//')) poster = 'https:' + poster;

      if (linkMatch && linkMatch[2]) {
        const slug = linkMatch[2];
        const rawTitle = titleMatch
          ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/^Image\s*/i, '').trim()
          : slug;
        items.push({
          title: rawTitle,
          anime_id: slug,
          poster,
        });
      }
    }

    // Determine total pages from pagination links
    let totalPages = page;
    const navMatch = html.match(/class=["'][^"']*(?:pagination|nav-links|page-numbers)[^"']*["'][\s\S]*?<\/div>/i);
    if (navMatch) {
      const pageNumbers = [...navMatch[0].matchAll(/page\/(\d+)\/?/gi)].map((m) => parseInt(m[1], 10));
      const inlineNumbers = [...navMatch[0].matchAll(/class=["']page-link[^"']*["'][^>]*>(\d+)<\/a>/gi)].map((m) =>
        parseInt(m[1], 10)
      );
      const allDetected = [...pageNumbers, ...inlineNumbers].filter((n) => Number.isFinite(n) && n > 0);
      if (allDetected.length > 0) {
        totalPages = Math.max(page, ...allDetected);
      }
    }

    const payload: CatalogPageResponse = {
      success: true,
      results: {
        currentPage: page,
        totalPages: totalPages || page,
        results: items,
      },
    };

    rememberAnimeSaltItems(items);
    cache.set(cacheKey, payload, 15 * 60 * 1000);
    return payload;
  } catch (err) {
    console.error(`[fetchStructuredCatalog-error] ${kind} p${page}:`, err);
    throw err;
  }
}

/**
 * Searches AnimeSalt catalog by keyword and returns structured pagination results.
 */
export async function fetchStructuredSearch(
  query: string,
  page: number = 1
): Promise<CatalogPageResponse> {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery) {
    return {
      success: true,
      results: { currentPage: page, totalPages: 1, results: [] },
    };
  }

  const cacheKey = `search:json:${cleanQuery.toLowerCase()}:${page}`;
  const cached = cache.get<CatalogPageResponse>(cacheKey);
  if (cached) return cached.data;

  const targetUrl =
    page <= 1
      ? `https://animesalt.cx/?s=${encodeURIComponent(cleanQuery)}`
      : `https://animesalt.cx/page/${page}/?s=${encodeURIComponent(cleanQuery)}`;

  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: 'https://animesalt.cx/',
      },
    });

    if (!res.ok) {
      throw new Error(`Upstream AnimeSalt search HTTP ${res.status}`);
    }

    const html = await res.text();
    const articleRegex = /<article[^>]*class=["']post[^"']*["']>([\s\S]*?)<\/article>/gi;
    let match: RegExpExecArray | null;
    const items: CatalogItem[] = [];

    while ((match = articleRegex.exec(html)) !== null) {
      const art = match[1];
      const linkMatch = art.match(/href=["'](https:\/\/animesalt\.cx\/(?:series|movies)\/([^"'/]+)\/?)["']/i);
      const titleMatch =
        art.match(/<h2[^>]*class=["']entry-title["'][^>]*>([\s\S]*?)<\/h2>/i) ||
        art.match(/alt=["']([^"']*)["']/i);
      let poster =
        art.match(/data-src=["']([^"']+)["']/i)?.[1] ||
        art.match(/src=["']([^"']+)["']/i)?.[1] ||
        null;
      if (poster && poster.startsWith('//')) poster = 'https:' + poster;

      if (linkMatch && linkMatch[2]) {
        const slug = linkMatch[2];
        const rawTitle = titleMatch
          ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/^Image\s*/i, '').trim()
          : slug;
        items.push({
          title: rawTitle,
          anime_id: slug,
          poster,
        });
      }
    }

    // Determine total pages
    let totalPages = page;
    const navMatch = html.match(/class=["'][^"']*(?:pagination|nav-links|page-numbers)[^"']*["'][\s\S]*?<\/div>/i);
    if (navMatch) {
      const pageNumbers = [...navMatch[0].matchAll(/page\/(\d+)\/?/gi)].map((m) => parseInt(m[1], 10));
      const allDetected = pageNumbers.filter((n) => Number.isFinite(n) && n > 0);
      if (allDetected.length > 0) {
        totalPages = Math.max(page, ...allDetected);
      }
    }

    const payload: CatalogPageResponse = {
      success: true,
      results: {
        currentPage: page,
        totalPages: totalPages || page,
        results: items,
      },
    };

    rememberAnimeSaltItems(items);
    cache.set(cacheKey, payload, 10 * 60 * 1000);
    return payload;
  } catch (err) {
    console.error(`[fetchStructuredSearch-error] "${cleanQuery}" p${page}:`, err);
    throw err;
  }
}

/**
 * Queries AniList GraphQL API for rich official metadata (synopsis, artwork, format, genres, score).
 */
export async function fetchAniListMetadata(queryOrSlug: string): Promise<any | null> {
  const cleanSearch = queryOrSlug
    .replace(/[【】\[\]]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleanSearch) return null;

  const cacheKey = `anilist:${cleanSearch.toLowerCase()}`;
  const cached = cache.get<any>(cacheKey);
  if (cached) return cached.data;

  const gql = `query ($search: String) {
    Media(search: $search, type: ANIME) {
      id
      title { romaji english native }
      description(asHtml: false)
      coverImage { extraLarge large }
      bannerImage
      genres
      averageScore
      seasonYear
      episodes
      format
      status
    }
  }`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': BROWSER_UA,
      },
      body: JSON.stringify({ query: gql, variables: { search: cleanSearch } }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const media = json?.data?.Media;
    if (media) {
      cache.set(cacheKey, media, 24 * 60 * 60 * 1000);
      return media;
    }
    return null;
  } catch {
    return null;
  }
}

export interface AnimeDetailData {
  title: string;
  alternativeTitle?: string;
  anime_id: string;
  poster: string;
  backdrop?: string;
  overview: string;
  genres: string[];
  year: string;
  rating: string;
  seasons: string;
  episodes: string;
  language: string;
  type: 'TV' | 'Movie' | 'OVA' | 'ONA' | 'Special';
  status: 'Ongoing' | 'Completed' | 'Upcoming';
  format?: string;
  postId?: string;
  seasonsList?: number[];
  s1Episodes?: Array<{ title: string; season: string; episode?: string; image: string }>;
}

/**
 * Fetches complete anime metadata by canonical slug from AnimeSalt + AniList enrichment.
 */
export async function fetchAnimeDetail(rawSlug: string): Promise<AnimeDetailData | null> {
  const cleanSlug = await resolveAnimeSaltCanonicalSlug(rawSlug);
  if (!cleanSlug) return null;

  const cacheKey = `anime:detail:${cleanSlug}`;
  const cached = cache.get<AnimeDetailData>(cacheKey);
  if (cached) return cached.data;

  let html: string | null = null;
  let isMovie = false;

  // Try series URL and movie URL concurrently
  const seriesUrl = `https://animesalt.cx/series/${encodeURIComponent(cleanSlug)}/`;
  const movieUrl = `https://animesalt.cx/movies/${encodeURIComponent(cleanSlug)}/`;

  try {
    const [sRes, mRes] = await Promise.all([
      fetch(seriesUrl, { headers: { 'User-Agent': BROWSER_UA } }).catch(() => null),
      fetch(movieUrl, { headers: { 'User-Agent': BROWSER_UA } }).catch(() => null),
    ]);

    if (sRes && sRes.ok) {
      const candidate = await sRes.text();
      if (!candidate.includes('404 Not Found') && candidate.includes('class="post-')) {
        html = candidate;
        isMovie = false;
      }
    }

    if (!html && mRes && mRes.ok) {
      const candidate = await mRes.text();
      if (!candidate.includes('404 Not Found') && candidate.includes('class="post-')) {
        html = candidate;
        isMovie = true;
      }
    }

  } catch (err) {
    console.warn(`[fetchAnimeDetail-scrape-warn] ${cleanSlug}:`, err);
  }

  // Do not let AniList manufacture a title absent from AnimeSalt.
  if (!html) return null;

  // Also query AniList concurrently for rich overview, tags, rating, and alternate titles
  const aniData = await fetchAniListMetadata(cleanSlug);

  // Parse AnimeSalt HTML if available
  let title = aniData?.title?.english || aniData?.title?.romaji || '';
  let overview = '';
  let poster = aniData?.coverImage?.extraLarge || aniData?.coverImage?.large || '';
  let backdrop = aniData?.bannerImage || poster || '';
  let genres: string[] = aniData?.genres || [];
  let postId = '';
  const seasonsList: number[] = [];
  const s1Episodes: Array<{ title: string; season: string; episode?: string; image: string }> = [];

  if (html) {
    // Title
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const titleTagMatch = html.match(/<title>([^<]+)<\/title>/i);
    const rawTitle = h1Match
      ? h1Match[1].replace(/<[^>]+>/g, '').trim()
      : titleTagMatch
      ? titleTagMatch[1].replace(/\s*-\s*Anime\s*Salt.*$/i, '').trim()
      : '';
    if (rawTitle && !rawTitle.toLowerCase().includes('404')) {
      title = rawTitle.replace(/^[【\[\s]+|[】\]\s]+$/g, '').trim();
    }

    // Synopsis / Overview
    const descMatch =
      html.match(/id=["']overview-text["'][^>]*>([\s\S]*?)<\/div>/i) ||
      html.match(/<div[^>]*class=["'][^"']*(?:description|entry-content|synopsis)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (descMatch) {
      const cleanDesc = descMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (cleanDesc.length > 20 && !cleanDesc.toLowerCase().startsWith('language:')) {
        overview = cleanDesc;
      }
    }

    // Poster
    const scriptVarImg = html.match(/(?:let|var)\s+image\s*=\s*["']((?:https:)?\/\/[^"']+)["']/i);
    if (scriptVarImg) {
      let p = scriptVarImg[1];
      if (p.startsWith('//')) p = 'https:' + p;
      if (!p.startsWith('data:') && !p.includes('logo')) poster = p.replace(/\/w(?:185|342|200|300)\//, '/w500/');
    }
    if (!poster) {
      const heroImg = html.match(/<img[^>]+style=["'][^"']*14rem[^"']*["'][^>]+data-src=["']((?:https:)?\/\/[^"']+)["']/i) ||
                      html.match(/<img[^>]+alt=["']Image\s+[^"']{3,80}["'][^>]+data-src=["']((?:https:)?\/\/[^"']+)["']/i);
      if (heroImg) {
        let p = heroImg[1];
        if (p.startsWith('//')) p = 'https:' + p;
        poster = p;
      }
    }

    // Backdrop
    const backdropMatch =
      html.match(/<img[^>]+class=["'][^"']*TPostBg[^"']*["'][^>]+data-src=["']([^"']+)["']/i) ||
      html.match(/data-src=["']((?:https:)?\/\/image\.tmdb\.org\/t\/p\/(?:w1280|original)\/[^"']+)["']/i);
    if (backdropMatch) {
      let b = backdropMatch[1];
      if (b.startsWith('//')) b = 'https:' + b;
      backdrop = b;
    }

    // Genres
    const genreMatches = [...html.matchAll(/\/category\/genre\/([a-zA-Z0-9_-]+)/gi)];
    const nonGenreTags = new Set(['animation', 'subbed', 'dubbed', 'hindi', 'english']);
    const scrapedGenres = [...new Set(genreMatches.map((m) => m[1].toLowerCase().trim()))].filter(
      (g) => g && !nonGenreTags.has(g) && !g.startsWith('page')
    );
    if (scrapedGenres.length > 0) {
      genres = [...new Set([...genres, ...scrapedGenres.map((g) => g.charAt(0).toUpperCase() + g.slice(1))])];
    }

    // Seasons & Post ID
    const btnRegex = /<a[^>]*class=["'][^"']*season-btn[^"']*["'][^>]*>/gi;
    let btnTag: RegExpExecArray | null;
    while ((btnTag = btnRegex.exec(html)) !== null) {
      const tag = btnTag[0];
      const sMatch = tag.match(/data-season=["'](\d+)["']/);
      const pMatch = tag.match(/data-post=["'](\d+)["']/);
      if (sMatch) {
        const sNum = parseInt(sMatch[1], 10);
        if (pMatch && !postId) postId = pMatch[1];
        if (!seasonsList.includes(sNum)) seasonsList.push(sNum);
      }
    }
    if (!postId) {
      const pIdMatch = html.match(/data-post=["'](\d+)["']/i) || html.match(/id=["']post-(\d+)["']/i);
      if (pIdMatch) postId = pIdMatch[1];
    }
    seasonsList.sort((a, b) => a - b);
    if (seasonsList.length === 0) seasonsList.push(1);

    // Parse Season 1 episodes from detail page
    const articleRegex = /<article[^>]*class=["'][^"']*episodes[^"']*["']>([\s\S]*?)<\/article>/gi;
    let artMatch: RegExpExecArray | null;
    let epIdx = 0;
    while ((artMatch = articleRegex.exec(html)) !== null) {
      const art = artMatch[1];
      let epThumb = art.match(/data-src=["']([^"']+)["']/)?.[1] || art.match(/src=["']([^"']+)["']/)?.[1] || poster;
      if (epThumb && epThumb.startsWith('//')) epThumb = 'https:' + epThumb;
      const numMatch = art.match(/<span[^>]*class=["']num-epi["'][^>]*>([^<]+)<\/span>/i);
      const epNum = numMatch ? numMatch[1].trim() : String(epIdx + 1);
      const titleMatch = art.match(/<h2[^>]*class=["']entry-title["'][^>]*>([^<]+)<\/h2>/i);
      const epTitle = titleMatch ? titleMatch[1].trim() : `Episode ${epNum}`;
      s1Episodes.push({
        title: epTitle,
        season: '1',
        episode: epNum,
        image: epThumb,
      });
      epIdx++;
    }
  }

  if (!title && !overview && !poster) {
    return null;
  }

  const finalType: 'TV' | 'Movie' = isMovie || aniData?.format === 'MOVIE' ? 'Movie' : 'TV';
  const finalRating = aniData?.averageScore ? (aniData.averageScore / 10).toFixed(1) : '8.5';
  const finalYear = aniData?.seasonYear ? String(aniData.seasonYear) : new Date().getFullYear().toString();
  const totalEpCount = aniData?.episodes
    ? String(aniData.episodes)
    : s1Episodes.length > 0
    ? String(s1Episodes.length)
    : '12';

  const detail: AnimeDetailData = {
    title: title || cleanSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    alternativeTitle: aniData?.title?.native || aniData?.title?.romaji,
    anime_id: cleanSlug,
    poster: poster || 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500',
    backdrop: backdrop || poster,
    overview: overview || 'No overview available for this title.',
    genres: genres.length > 0 ? genres : ['Action', 'Fantasy'],
    year: finalYear,
    rating: finalRating,
    seasons: String(seasonsList.length || 1),
    episodes: totalEpCount,
    language: 'Hindi, English, Japanese',
    type: finalType,
    status: aniData?.status === 'FINISHED' ? 'Completed' : 'Ongoing',
    format: aniData?.format || finalType,
    postId,
    seasonsList,
    s1Episodes,
  };

  cache.set(cacheKey, detail, 6 * 60 * 60 * 1000);
  return detail;
}

export interface EpisodeItemResult {
  id: string;
  animeSlug: string;
  animeTitle: string;
  animePoster: string;
  season: number;
  number: number;
  title: string;
  thumbnail: string;
  durationMinutes: number;
  languages: string[];
  releasedAt: string;
}

export interface EpisodesResponseData {
  success: boolean;
  message?: string;
  results: {
    totalSeasons: string;
    seasons: Array<{ season: string; text: string }>;
    episodes: EpisodeItemResult[];
  };
}

/**
 * Fetches episodes for a specific anime season from AnimeSalt with fallback estimation.
 */
export async function fetchAnimeEpisodes(
  rawSlug: string,
  season: number = 1
): Promise<EpisodesResponseData> {
  const cleanSlug = await resolveAnimeSaltCanonicalSlug(rawSlug);
  const seasonNum = Number.isSafeInteger(season) && season > 0 ? season : 1;

  const detail = await fetchAnimeDetail(cleanSlug);
  const canonicalSlug = detail?.anime_id || cleanSlug;

  const cacheKey = `anime:episodes:${canonicalSlug}:s${seasonNum}`;
  const cached = cache.get<EpisodesResponseData>(cacheKey);
  if (cached) return cached.data;

  const resolvedSlug = canonicalSlug;
  const animeTitle = detail?.title || resolvedSlug.replace(/-/g, ' ');
  const animePoster = detail?.poster || '';
  const seasonsList = detail?.seasonsList && detail.seasonsList.length > 0 ? detail.seasonsList : [1];

  let rawEpisodes: Array<{ title: string; season: string; episode?: string; image: string }> = [];

  if (seasonNum === 1 && detail?.s1Episodes && detail.s1Episodes.length > 0) {
    rawEpisodes = detail.s1Episodes;
  } else if (detail?.postId) {
    // Season > 1: query admin-ajax.php
    try {
      const ajaxUrl = `https://animesalt.cx/wp-admin/admin-ajax.php?action=action_select_season&season=${seasonNum}&post=${detail.postId}`;
      const res = await fetch(ajaxUrl, { headers: { 'User-Agent': BROWSER_UA } });
      if (res.ok) {
        const html = await res.text();
        const articleRegex = /<article[^>]*class=["'][^"']*episodes[^"']*["']>([\s\S]*?)<\/article>/gi;
        let match: RegExpExecArray | null;
        let epIdx = 0;
        while ((match = articleRegex.exec(html)) !== null) {
          const art = match[1];
          let epThumb = art.match(/data-src=["']([^"']+)["']/)?.[1] || art.match(/src=["']([^"']+)["']/)?.[1] || animePoster;
          if (epThumb && epThumb.startsWith('//')) epThumb = 'https:' + epThumb;
          const numMatch = art.match(/<span[^>]*class=["']num-epi["'][^>]*>([^<]+)<\/span>/i);
          const epNum = numMatch ? numMatch[1].trim() : String(epIdx + 1);
          const titleMatch = art.match(/<h2[^>]*class=["']entry-title["'][^>]*>([^<]+)<\/h2>/i);
          const epTitle = titleMatch ? titleMatch[1].trim() : `Episode ${epNum}`;
          rawEpisodes.push({
            title: epTitle,
            season: String(seasonNum),
            episode: epNum,
            image: epThumb,
          });
          epIdx++;
        }
      }
    } catch (err) {
      console.warn(`[fetchAnimeEpisodes-ajax-warn] ${cleanSlug} s${seasonNum}:`, err);
    }
  }

  const episodes: EpisodeItemResult[] = rawEpisodes.map((item, idx) => {
    const epNumber = parseInt(item.episode || String(idx + 1), 10) || idx + 1;
    return {
      id: `ep-${seasonNum}-${epNumber}`,
      animeSlug: resolvedSlug,
      animeTitle,
      animePoster,
      season: seasonNum,
      number: epNumber,
      title: item.title || `Episode ${epNumber}`,
      thumbnail: item.image || animePoster,
      durationMinutes: 24,
      languages: ['Hindi', 'English', 'Japanese'],
      releasedAt: '',
    };
  });

  const payload: EpisodesResponseData = {
    success: true,
    results: {
      totalSeasons: String(seasonsList.length),
      seasons: seasonsList.map((s) => ({ season: String(s), text: `Season ${s}` })),
      episodes,
    },
  };

  cache.set(cacheKey, payload, 30 * 60 * 1000);
  return payload;
}

/**
 * Builds the full unified homepage response matching both modern Next.js HomepageData
 * and legacy HomepageApiResponse structures.
 */
export async function fetchFullUnifiedHomepage(): Promise<any> {
  const cacheKey = 'homepage:unified_full';
  const cached = cache.get<any>(cacheKey);
  if (cached) return cached.data;

  const rawSalt = await fetchAnimeSaltHomepageData();

  function mapCardToAnime(card: AnimeCardItem, defaultType: 'TV' | 'Movie' = 'TV', rank?: number): any {
    return {
      id: card.slug,
      slug: card.slug,
      title: card.title,
      synopsis: '',
      poster: card.image,
      backdrop: card.image,
      rating: parseFloat(card.score || '8.5') || 8.5,
      year: 2024,
      type: card.type === 'movie' ? 'Movie' : defaultType,
      status: 'Ongoing',
      durationMinutes: card.type === 'movie' ? 110 : 24,
      episodeCount: parseInt(card.episodes || '12', 10) || 12,
      genres: ['Action', 'Fantasy'],
      languages: card.languages && card.languages.length > 0 ? card.languages : ['Hindi', 'Japanese', 'English'],
      seasons: 1,
      studio: 'Animation Studio',
      popularityRank: rank,
      trendingRank: rank,
      updatedAt: new Date().toISOString(),
    };
  }

  function mapCardToEpisode(card: AnimeCardItem): any {
    const epNum = card.episodeNumber || (card.episodes ? parseInt(card.episodes, 10) : 1) || 1;
    const seasonNum = card.season || 1;
    return {
      id: `ep-${seasonNum}-${epNum}`,
      animeSlug: card.slug,
      animeTitle: card.title,
      animePoster: card.image,
      season: seasonNum,
      number: epNum,
      title: 'Latest Episode',
      thumbnail: card.image,
      durationMinutes: 24,
      languages: ['Hindi', 'Japanese', 'English'],
      releasedAt: '',
      isNew: true,
    };
  }

  const trendingItems = [
    ...rawSalt.trendingSeries.map((c, i) => mapCardToAnime(c, 'TV', i + 1)),
    ...rawSalt.trendingMovies.map((c, i) => mapCardToAnime(c, 'Movie', i + 1)),
  ];

  const popularItems = rawSalt.trendingSeries.map((c, i) => mapCardToAnime(c, 'TV', i + 1));
  const movieItems = [
    ...rawSalt.trendingMovies.map((c) => mapCardToAnime(c, 'Movie')),
    ...rawSalt.latestMovies.map((c) => mapCardToAnime(c, 'Movie')),
  ];
  const seriesItems = [
    ...rawSalt.onAirSeries.map((c) => mapCardToAnime(c, 'TV')),
    ...rawSalt.newArrivals.map((c) => mapCardToAnime(c, 'TV')),
  ];
  const latestEpisodes = rawSalt.freshDrops.map(mapCardToEpisode);
  const heroItems = trendingItems.slice(0, 6);
  const upcomingItems = seriesItems.slice(0, 6);

  // Legacy/Compatibility sections
  const fresh_drops = rawSalt.freshDrops.map((item) => ({
    anime_id: item.url || `https://animesalt.cx/series/${item.slug}/`,
    title: item.title,
    poster: item.image,
    season: String(item.season || 1),
    episode: String(item.episodeNumber || item.episodes || 1),
  }));

  const latest_animeMovies = rawSalt.latestMovies.map((item) => ({
    anime_id: item.url || `https://animesalt.cx/movies/${item.slug}/`,
    title: item.title,
    poster: item.image,
  }));

  const mostWatched_Films = rawSalt.trendingMovies.map((item, i) => ({
    rank: String(i + 1),
    anime_id: item.url || `https://animesalt.cx/movies/${item.slug}/`,
    title: item.title,
    poster: item.image,
  }));

  const mostWatched_Series = rawSalt.trendingSeries.map((item, i) => ({
    rank: String(i + 1),
    anime_id: item.url || `https://animesalt.cx/series/${item.slug}/`,
    title: item.title,
    poster: item.image,
  }));

  const on_air_series = rawSalt.onAirSeries.map((item) => ({
    anime_id: item.url || `https://animesalt.cx/series/${item.slug}/`,
    title: item.title,
    poster: item.image,
  }));

  const unified = {
    success: true,
    heroItems,
    latestEpisodes,
    trendingItems,
    popularItems,
    movieItems,
    seriesItems,
    upcomingItems,
    data: {
      success: true,
      results: {
        fresh_drops,
        latest_animeMovies,
        mostWatched_Films,
        mostWatched_Series,
        on_air_series,
      },
    },
    // Raw categories and sections
    spotlight: rawSalt.spotlight,
    trendingSeries: rawSalt.trendingSeries,
    trendingMovies: rawSalt.trendingMovies,
    freshDrops: rawSalt.freshDrops,
    onAirSeries: rawSalt.onAirSeries,
    newArrivals: rawSalt.newArrivals,
    latestMovies: rawSalt.latestMovies,
    categories: rawSalt.categories,
    updatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, unified, 5 * 60 * 1000);
  return unified;
}

/**
 * Normalizes all streaming sources into structured servers:
 * - Server 1: HLS Stream (Hindi Dub default, multi-audio tracks, proxied via /hls-proxy, ad-free)
 * - Server 2: Google Drive stream (proxied via /gdrive-stream, ad-free)
 * - Server 3+: Embed Streams (AnimeSalt, Toko, PlayZen)
 */
export async function fetchNormalizedPlaybackSources(
  rawSlug: string,
  season: string = '1',
  ep: string = '1',
  requestOrigin: string,
  proxySecret?: string
): Promise<any> {
  const extracted = extractAnimeSlug(rawSlug);
  const cleanId = extracted.slug;
  const sNum = season || extracted.season || '1';
  const epNum = ep || extracted.episode || '1';

  const cacheKey = `stream:normalized:${cleanId}:s${sNum}:e${epNum}`;
  const cached = cache.get<any>(cacheKey);
  if (cached) return cached.data;

  // Concurrently fetch AnimeSalt streams, PlayZen streams, and AnimaHD / GDrive streams
  const [saltItems, playzenItems, animahdItems] = await Promise.all([
    fetchAnimeSaltStream(cleanId, sNum, epNum).catch(() => []),
    fetchPlayZenStream(cleanId, sNum, epNum).catch(() => []),
    fetchAnimaHdStream(cleanId, sNum, epNum).catch(() => []),
  ]);

  const allRaw = [...saltItems, ...playzenItems, ...animahdItems];
  const list: any[] = [];
  const usedUrls = new Set<string>();

  // 1. Server 1: HLS Direct Stream (highest priority)
  const hlsCandidates = allRaw.filter((item) => item.type === 'hls' && item.directHlsUrl);
  // Sort Hindi Dub first
  hlsCandidates.sort((a, b) => {
    if (a.audioLanguage === 'hi' && b.audioLanguage !== 'hi') return -1;
    if (a.audioLanguage !== 'hi' && b.audioLanguage === 'hi') return 1;
    return 0;
  });

  let server1: any = null;
  if (hlsCandidates.length > 0) {
    const best = hlsCandidates[0];
    const streamUrl = best.directHlsUrl;
    const referer = best.referer || 'https://ravok.buzz/';
    const origin = best.origin || 'https://ravok.buzz';
    const params = new URLSearchParams({ url: streamUrl, referer, origin });
    if (proxySecret) {
      const exp = Math.floor(Date.now() / 1000) + 86400;
      params.set('exp', String(exp));
      params.set('sig', generateHlsToken(streamUrl, referer, origin, exp, proxySecret));
    }
    const hlsProxyUrl = `${requestOrigin}/hls-proxy?${params.toString()}`;

    server1 = {
      server: 'Server 1',
      slot: 'server-1',
      kind: 'hls',
      type: 'hls',
      sourceProvider: best.sourceProvider || 'AnimeSalt',
      label: 'Server 1 · Hindi Dub HLS ⚡ (Multi-Audio)',
      audioLanguage: best.audioLanguage || 'hi',
      languageLabel: 'Hindi Dub',
      url: hlsProxyUrl,
      hlsProxyUrl,
      directHlsUrl: streamUrl,
      adFree: true,
      headers: { Referer: referer, Origin: origin },
    };
    list.push(server1);
    usedUrls.add(streamUrl);
  }

  // 2. Server 2: Google Drive Stream
  const gdriveCandidates = allRaw.filter((item) => item.type === 'gdrive' || item.sourceProvider === 'AnimaHD' || (item.url && item.url.includes('drive.google.com')));
  let server2: any = null;
  if (gdriveCandidates.length > 0) {
    const best = gdriveCandidates[0];
    server2 = {
      server: 'Server 2',
      slot: 'server-2',
      kind: 'google-drive',
      type: 'mp4',
      sourceProvider: 'GoogleDrive',
      label: 'Server 2 · Fast Drive Direct (1080p)',
      audioLanguage: 'hi',
      languageLabel: 'Hindi Dub',
      url: best.url,
      adFree: true,
    };
    list.push(server2);
    usedUrls.add(best.url);
  }

  // 3. Server 3+: Embed & Direct Players
  let serverSlotNum = list.length + 1;
  for (const item of allRaw) {
    const urlKey = item.url || item.embed || item.directHlsUrl || '';
    if (!urlKey || usedUrls.has(urlKey)) continue;
    usedUrls.add(urlKey);

    const isHls = item.type === 'hls';
    let streamUrl = item.url || item.embed;
    if (isHls && item.directHlsUrl) {
      const p = new URLSearchParams({
        url: item.directHlsUrl,
        referer: item.referer || 'https://ravok.buzz/',
        origin: item.origin || 'https://ravok.buzz',
      });
      streamUrl = `${requestOrigin}/hls-proxy?${p.toString()}`;
    }

    const slotLabel = `Server ${serverSlotNum}`;
    const cleanLabel = (item.label || item.server || 'Embed Stream')
      .replace(/^Server\s*\d+\s*·?\s*/, '')
      .replace(/^AnimeSalt\s*·?\s*/, '');

    list.push({
      ...item,
      server: slotLabel,
      slot: `server-${serverSlotNum}`,
      kind: item.type === 'hls' ? 'hls' : item.type === 'mp4' ? 'google-drive' : 'embed',
      label: `${slotLabel} · ${cleanLabel}`,
      url: streamUrl,
    });
    serverSlotNum++;
  }

  // Group by language
  const byLanguage: Record<string, { code: string; label: string; sources: any[] }> = {};
  list.forEach((item) => {
    const lang = item.audioLanguage || 'hi';
    const label = lang === 'hi' ? 'Hindi Dub' : lang === 'ja' ? 'Japanese Sub' : 'English Dub';
    if (!byLanguage[lang]) {
      byLanguage[lang] = { code: lang, label, sources: [] };
    }
    byLanguage[lang].sources.push(item);
  });

  const payload = {
    success: list.length > 0,
    message: list.length > 0 ? 'Stream Found!!' : 'No streams found',
    id: cleanId,
    season: sNum,
    ep: epNum,
    total: list.length,
    results: list,
    sources: list,
    byLanguage,
    serverSlots: {
      server1: server1 || list[0] || null,
      server2: server2 || list[1] || null,
      server3: list[2] || null,
    },
  };

  cache.set(cacheKey, payload, 3 * 60 * 1000);
  return payload;
}



