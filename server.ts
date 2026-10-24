import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import dotenv from 'dotenv';
import helmet from 'helmet';
import cors from 'cors';
import {
  BROWSER_UA,
  TOKO_API_URL,
  PROXY_SECRET_HEADER,
  PROXY_SECRET,
  REQUIRE_STREAM_SECRET,
  ANIMESALT_HOMEPAGE_URL,
  HOMEPAGE_FRESH_MS,
  HOMEPAGE_MAX_STALE_MS,
  HOMEPAGE_CHALLENGE_COOLDOWN_MS,
  CATALOG_FRESH_MS,
  CATALOG_TIMEOUT_MS,
  CATALOG_FEED_MAX_BYTES,
  CATALOG_SITEMAP_INDEX_MAX_BYTES,
  CATALOG_SITEMAP_MAX_BYTES,
  CATALOG_MAX_SITEMAPS,
  GENERAL_RESPONSE_MAX_BYTES,
  ANIMESALT_RESPONSE_MAX_BYTES,
  HLS_UPSTREAM_TIMEOUT_MS,
  HLS_MAX_REDIRECTS,
  cache,
  validateProxySecret,
  verifyHlsToken,
  generateHlsToken,
  slugify,
  extractAnimeSlug,
  formatAnimeSaltAsTokoResponse,
  fetchToko,
  fetchAnimeSaltStream,
  fetchWithAllowedRedirects,
  isAllowedGeneralTarget,
  isAllowedAnimeSaltTarget,
  isAllowedHlsTarget,
  isAllowedHlsHostName,
  areHostsInSameCluster,
  isAllowedCatalogTarget,
  isAllowedTokoStreamTarget,
  isBlockedStreamSource,
  countValidCatalogHtmlItems,
  validateAnimeSaltHomepage,
  searchAnimaHd,
  fetchAnimaHdEpisodes,
  fetchAnimaHdStream,
  fetchPlayZenStream,
  resolveGoogleDriveStreamUrl,
  extractGoogleDriveFileId,
  fetchAnimeSaltHomepageData,
  fetchFullUnifiedHomepage,
  fetchStructuredCatalog,
  fetchStructuredSearch,
  fetchAnimeDetail,
  fetchAnimeEpisodes,
  fetchNormalizedPlaybackSources,
} from './src/server/proxyService.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const IS_PROD = process.env.NODE_ENV === 'production';

// ── AUTH_TOKEN: read from environment only — never log or expose in responses ──
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';

const configuredAllowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const DEFAULT_ALLOWED_ORIGINS = [
  'https://hindi-anime.com',
  'https://hindianime-seven.vercel.app',
  'http://localhost:3000',
  'https://localhost:3000',
  'http://localhost:3001',
  'https://localhost:3001',
  ...configuredAllowedOrigins,
];

// Helper to determine if an Origin is allowed for CORS
function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // Server-to-server or direct curl
  if (configuredAllowedOrigins.includes('*')) return true;
  if (DEFAULT_ALLOWED_ORIGINS.includes(origin)) return true;
  if (origin.endsWith('.vercel.app')) return true;
  if (origin.startsWith('http://localhost:') || origin.startsWith('https://localhost:')) return true;
  return false;
}

// ── Bearer token middleware — protects all API routes except /api/health ──────
// Token is read from process.env.AUTH_TOKEN; if unset, auth is skipped (dev mode).
// Never log the token value or expose it in any error response.
function requireAuthToken(req: Request, res: Response, next: NextFunction) {
  if (!AUTH_TOKEN) return next(); // auth disabled in dev when env var is absent
  const authHeader = req.headers.authorization || '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!provided || provided !== AUTH_TOKEN) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}

// Main Express app setup
async function startServer() {
  const app = express();
  app.set('trust proxy', true);

  // ── Security: strip infrastructure fingerprints & enforce secure defaults ──
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow cross-origin media streaming
      contentSecurityPolicy: false, // CSP managed by the frontend (Vercel/Next.js)
    })
  );

  // ── CORS: strict origin allowlist, credentials: false (token in header only) ──
  app.use(
    cors({
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
          callback(null, true);
        } else {
          callback(new Error('CORS: origin not allowed'));
        }
      },
      credentials: false,
      methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Accept',
        'Range',
        'X-Requested-With',
        'X-Turnstile-Token',
        'x-turnstile-token',
        'x-hindianime-proxy-secret',
        'Cache-Control',
        'Pragma',
      ],
      exposedHeaders: [
        'Content-Length',
        'Content-Range',
        'Content-Type',
        'X-Catalog-Total-Pages',
        'X-Catalog-Page-Size',
        'X-Catalog-Cache',
        'X-AnimeSalt-Challenge-Cooldown',
      ],
      maxAge: 86400,
    })
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // ── Auth token guard: applied to all /api/* routes except /api/health ────────
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/health') return next();
    return requireAuthToken(req, res, next);
  });
  // Also guard the legacy non-prefixed routes that are equivalent to protected /api endpoints
  app.use(['/stream', '/catalog', '/animesalt-catalog', '/hls-proxy', '/proxy',
           '/animesalt-stream', '/playzen-stream', '/animahd-stream',
           '/animahd-search', '/animahd-episodes', '/gdrive-stream'],
    requireAuthToken
  );

  // ── Route: /api/health ────────────────────────────────────────────────────────
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'AnimeStream Proxy Backend (Node.js)',
      version: '2.0.0',
      uptime: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
      cache: cache.getStats(),
      secretAuthEnabled: Boolean(PROXY_SECRET),
      requireStreamSecret: REQUIRE_STREAM_SECRET,
      timestamp: new Date().toISOString(),
    });
  });

  // ── Route: /api/generate-token (convenience for frontend auth) ────────────────
  app.get('/api/generate-token', (req, res) => {
    const targetUrl = req.query.url as string;
    const referer = (req.query.referer as string) || '';
    const origin = (req.query.origin as string) || '';
    const ttlSeconds = parseInt((req.query.ttl as string) || '86400', 10);

    if (!targetUrl) {
      return res.status(400).json({ error: 'Missing url parameter' });
    }

    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = PROXY_SECRET ? generateHlsToken(targetUrl, referer, origin, exp, PROXY_SECRET) : 'open';

    res.json({
      url: targetUrl,
      exp,
      sig,
      tokenQuery: `exp=${exp}&sig=${sig}`,
    });
  });

  // ── Route: /api/home, /api/homepage & /home (Complete Anime Homepage Feed with Trending & Sections) ──
  app.get(['/api/home', '/api/homepage', '/home'], async (req, res) => {
    try {
      const data = await fetchFullUnifiedHomepage();
      // Vary: Authorization enables Cloudflare free-tier cache sharding per auth token
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
      res.setHeader('Vary', 'Authorization');
      return res.json(data);
    } catch (err: any) {
      console.error('[homepage-route-error]', err);
      return res.status(502).json({
        success: false,
        message: 'Failed to fetch homepage data',
      });
    }
  });

  // ── Route: /api/search & /search (Structured anime search with pagination) ─────
  app.get(['/api/search', '/search'], async (req, res) => {
    const q = (req.query.q as string) || (req.query.keyword as string) || '';
    const page = parseInt((req.query.page as string) || '1', 10) || 1;

    try {
      const results = await fetchStructuredSearch(q, page);
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.setHeader('Vary', 'Authorization');
      return res.json(results);
    } catch (err: any) {
      console.error('[search-route-error]', err);
      return res.status(502).json({
        success: false,
        message: 'Search query failed',
      });
    }
  });

  // ── Route: /api/info, /api/anime-info, /api/movie & /api/anime/:slug (Complete metadata) ───
  app.get(['/api/info', '/api/anime-info', '/api/movie', '/api/anime/:slug'], async (req, res) => {
    const rawId = (req.params.slug as string) || (req.query.id as string) || (req.query.slug as string) || '';
    if (!rawId) {
      return res.status(400).json({ success: false, message: 'Missing anime id or slug parameter' });
    }

    try {
      const data = await fetchAnimeDetail(rawId);
      if (!data) {
        return res.status(404).json({ success: false, message: 'Anime details not found' });
      }
      res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=3600');
      res.setHeader('Vary', 'Authorization');
      return res.json({ success: true, data });
    } catch (err: any) {
      console.error('[anime-detail-route-error]', err);
      return res.status(502).json({
        success: false,
        message: 'Failed to fetch anime metadata',
      });
    }
  });

  // ── Route: /api/episodes & /api/anime/:slug/episodes (Exact season & episodes list) ───
  app.get(['/api/episodes', '/api/anime/:slug/episodes'], async (req, res) => {
    const rawId = (req.params.slug as string) || (req.query.id as string) || (req.query.slug as string) || '';
    const season = parseInt((req.query.season as string) || '1', 10) || 1;
    if (!rawId) {
      return res.status(400).json({ success: false, message: 'Missing anime id or slug parameter' });
    }

    try {
      const results = await fetchAnimeEpisodes(rawId, season);
      res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=3600');
      res.setHeader('Vary', 'Authorization');
      return res.json(results);
    } catch (err: any) {
      console.error('[anime-episodes-route-error]', err);
      return res.status(502).json({
        success: false,
        message: 'Failed to fetch episodes list',
      });
    }
  });

  // ── Route: /stream, /api/stream & /api/stream-proxy (Resolve streaming sources) ────────────────
  app.all(['/stream', '/api/stream', '/api/stream-proxy'], async (req, res) => {
    const authFailure = validateProxySecret(req, REQUIRE_STREAM_SECRET);
    if (authFailure) {
      return res.status(authFailure.status).json({ success: false, message: authFailure.error });
    }

    const rawId = (req.query.id as string) || (req.body?.id as string);
    if (!rawId || typeof rawId !== 'string') {
      return res.status(400).json({ success: false, message: 'Missing or invalid id parameter' });
    }

    // 0. Check if rawId is a direct Google Drive File ID or Google Drive URL (Zero-Scraping Direct Access)
    const directGdriveId = extractGoogleDriveFileId(rawId);
    if (directGdriveId) {
      const gdriveStreams = await fetchAnimaHdStream(directGdriveId, '1', '1');
      const responsePayload = {
        success: true,
        message: 'Direct Google Drive Stream Resolved (Zero Scraping)',
        source: 'GoogleDrive',
        fileId: directGdriveId,
        results: gdriveStreams,
        byLanguage: {
          hi: { sources: gdriveStreams },
        },
      };
      cache.set(`stream:gdrive:${directGdriveId}`, responsePayload, 10 * 60 * 1000);
      res.setHeader('Cache-Control', 'no-store');
      return res.json(responsePayload);
    }

    const extracted = extractAnimeSlug(rawId);
    const season = (req.query.season as string) || (req.body?.season as string) || extracted.season || '1';
    const ep = (req.query.ep as string) || (req.query.episode as string) || (req.body?.ep as string) || extracted.episode || '1';
    const sourceFilter = (((req.query.source || req.body?.source) as string) || 'all').toLowerCase();
    const cleanId = extracted.slug;

    if (!/^\d{1,4}$/.test(season) || !/^\d{1,5}$/.test(ep)) {
      return res.status(400).json({ success: false, message: 'Invalid season or ep parameter' });
    }

    const streamCacheKey = `stream:${cleanId}:s${season}:e${ep}:${sourceFilter}`;
    const cachedStream = cache.get<any>(streamCacheKey);
    if (cachedStream) {
      return res.json(cachedStream.data);
    }

    try {
      // Parallel fetch from AnimeSalt, AnimaHD, and PlayZen based on source filter (Toko deprecated & removed)
      const shouldFetchSalt = sourceFilter === 'all' || sourceFilter === 'animesalt';
      const shouldFetchAnimaHd = sourceFilter === 'all' || sourceFilter === 'animahd';
      const shouldFetchPlayZen = sourceFilter === 'all' || sourceFilter === 'playzen';

      const [animeSaltItems, animaHdItems, rawPlayZen] = await Promise.all([
        shouldFetchSalt ? fetchAnimeSaltStream(cleanId, season, ep) : Promise.resolve([]),
        shouldFetchAnimaHd ? fetchAnimaHdStream(cleanId, season, ep) : Promise.resolve([]),
        shouldFetchPlayZen ? fetchPlayZenStream(cleanId, season, ep) : Promise.resolve([]),
      ]);

      const playZenItems = Array.isArray(rawPlayZen) ? rawPlayZen : ((rawPlayZen as any)?.results || []);

      if (
        (!animeSaltItems || animeSaltItems.length === 0) &&
        (!animaHdItems || animaHdItems.length === 0) &&
        (!playZenItems || playZenItems.length === 0)
      ) {
        return res.status(404).json({ success: false, message: 'No valid streams found', results: [] });
      }

      // Language classifiers
      const isHindi = (s: any) => {
        const a = (s.audioLanguage || '').toLowerCase();
        const l = (s.language || '').toLowerCase();
        const lb = (s.languageLabel || '').toLowerCase();
        return a === 'hi' || l.includes('hindi') || lb.includes('hindi');
      };
      const isJapanese = (s: any) => {
        const a = (s.audioLanguage || '').toLowerCase();
        const l = (s.language || '').toLowerCase();
        const lb = (s.languageLabel || '').toLowerCase();
        return a === 'ja' || l.includes('japanese') || lb.includes('japanese');
      };
      const isTamil = (s: any) => {
        const a = (s.audioLanguage || '').toLowerCase();
        const l = (s.language || '').toLowerCase();
        const lb = (s.languageLabel || '').toLowerCase();
        return a === 'ta' || l.includes('tamil') || lb.includes('tamil');
      };
      const isTelugu = (s: any) => {
        const a = (s.audioLanguage || '').toLowerCase();
        const l = (s.language || '').toLowerCase();
        const lb = (s.languageLabel || '').toLowerCase();
        return a === 'te' || l.includes('telugu') || lb.includes('telugu');
      };
      const isEnglish = (s: any) => {
        const a = (s.audioLanguage || '').toLowerCase();
        const l = (s.language || '').toLowerCase();
        const lb = (s.languageLabel || '').toLowerCase();
        return a === 'en' || l.includes('english') || lb.includes('english');
      };

      const requestOrigin = `${req.protocol}://${req.get('host')}`;

      const buildSaltResult = (s: any, serverNum: number, customLabel?: string) => ({
        ...s,
        server: `Server ${serverNum}`,
        label: customLabel || `Server ${serverNum} · ${s.label || 'Mirror'}`,
      });

      const buildAnimaHdResult = (s: any, serverNum: number, customLabel?: string) => ({
        ...s,
        server: `Server ${serverNum}`,
        label: customLabel || `Server ${serverNum} · ${s.label || 'AnimaHD 1080p HD (Google Drive)'}`,
      });

      const buildPlayZenResult = (s: any, serverNum: number, customLabel?: string) => ({
        ...s,
        server: `Server ${serverNum}`,
        label: customLabel || `Server ${serverNum} · ${s.label || 'PlayZen · ⚡ Direct Stream'}`,
      });

      // ── Slot Assembly Helpers ──────────────────────────────────────────────────
      const list: any[] = [];
      const usedUrls = new Set<string>();

      const addSalt = (s: any, label?: string) => {
        if (!s) return false;
        const key = s.embed || s.url || s.directHlsUrl;
        if (!key || usedUrls.has(key)) return false;
        usedUrls.add(key);
        list.push(buildSaltResult(s, list.length + 1, label));
        return true;
      };

      const addAnimaHd = (s: any, label?: string) => {
        if (!s) return false;
        const key = s.embed || s.url;
        if (!key || usedUrls.has(key)) return false;
        usedUrls.add(key);
        list.push(buildAnimaHdResult(s, list.length + 1, label));
        return true;
      };

      const addPlayZen = (s: any, label?: string) => {
        if (!s) return false;
        const key = s.url || s.embed;
        if (!key || usedUrls.has(key)) return false;
        usedUrls.add(key);
        list.push(buildPlayZenResult(s, list.length + 1, label));
        return true;
      };

      // If user requested PlayZen specifically, return all resolved PlayZen items directly
      if (sourceFilter === 'playzen') {
        const byLanguage: Record<string, { sources: any[] }> = {};
        const enrichedPz = (playZenItems || []).map((item: any, idx: number) => {
          const num = idx + 1;
          const resObj = {
            ...item,
            server: `Server ${num}`,
            label: `Server ${num} · ${item.label || 'PlayZen Stream'}`,
          };
          const lCode = item.audioLanguage || 'hi';
          if (!byLanguage[lCode]) byLanguage[lCode] = { sources: [] };
          byLanguage[lCode].sources.push(resObj);
          return resObj;
        });

        const responsePayload = {
          success: true,
          message: 'Stream Found!! (PlayZen)',
          source: 'PlayZen',
          results: enrichedPz,
          byLanguage,
        };
        cache.set(streamCacheKey, responsePayload, 5 * 60 * 1000);
        res.setHeader('Cache-Control', 'no-store');
        return res.json(responsePayload);
      }

      // If user requested AnimeSalt specifically, return all resolved AnimeSalt items directly
      if (sourceFilter === 'animesalt') {
        const sortedItems = [...(animeSaltItems || [])].sort((a: any, b: any) => {
          if (a.type === 'hls' && b.type !== 'hls') return -1;
          if (a.type !== 'hls' && b.type === 'hls') return 1;
          if (a.audioLanguage === 'hi' && b.audioLanguage !== 'hi') return -1;
          if (a.audioLanguage !== 'hi' && b.audioLanguage === 'hi') return 1;
          return 0;
        });

        const byLanguage: Record<string, { sources: any[] }> = {};

        const enrichedSalt = sortedItems.map((item: any, idx: number) => {
          const num = idx + 1;
          const cleanLabel = (item.label || '').replace(/^AnimeSalt\s*·?\s*/, '').replace(/^Server(?:\s+\d+)?\s*·?\s*/, '');
          const langCode = item.audioLanguage || 'hi';

          if (item.type === 'hls' && item.directHlsUrl) {
            const streamUrl = item.directHlsUrl;
            const referer = item.referer || 'https://ravok.buzz/';
            const origin = item.origin || 'https://ravok.buzz';
            const p = new URLSearchParams({ url: streamUrl, referer, origin });
            if (PROXY_SECRET) {
              const exp = Math.floor(Date.now() / 1000) + 86400;
              p.set('exp', String(exp));
              p.set('sig', generateHlsToken(streamUrl, referer, origin, exp, PROXY_SECRET));
            }
            const hlsProxyUrl = `${requestOrigin}/hls-proxy?${p.toString()}`;
            const resObj = {
              ...item,
              server: `Server ${num}`,
              label: `Server ${num} · ${cleanLabel || 'Hindi Dub HLS ⚡ (Multi-Audio)'}`,
              url: hlsProxyUrl,
              hlsProxyUrl,
            };
            if (!byLanguage[langCode]) byLanguage[langCode] = { sources: [] };
            byLanguage[langCode].sources.push(resObj);
            return resObj;
          }

          const resObj = {
            ...item,
            server: `Server ${num}`,
            label: `Server ${num} · ${cleanLabel || 'AnimeSalt Embed'}`,
          };
          if (!byLanguage[langCode]) byLanguage[langCode] = { sources: [] };
          byLanguage[langCode].sources.push(resObj);
          return resObj;
        });

        const responsePayload = {
          success: true,
          message: 'Stream Found!! (AnimeSalt)',
          source: 'AnimeSalt',
          results: enrichedSalt,
          byLanguage,
        };
        cache.set(streamCacheKey, responsePayload, 3 * 60 * 1000);
        res.setHeader('Cache-Control', 'no-store');
        return res.json(responsePayload);
      }

      // If user requested AnimaHD specifically, return all resolved AnimaHD items directly
      if (sourceFilter === 'animahd') {
        const byLanguage: Record<string, { sources: any[] }> = {};
        const enrichedAh = (animaHdItems || []).map((item: any, idx: number) => {
          const num = idx + 1;
          const resObj = {
            ...item,
            server: `Server ${num}`,
            label: `Server ${num} · ${item.label || 'AnimaHD 1080p HD (Google Drive)'}`,
          };
          if (!byLanguage['hi']) byLanguage['hi'] = { sources: [] };
          byLanguage['hi'].sources.push(resObj);
          return resObj;
        });

        const responsePayload = {
          success: true,
          message: 'Stream Found!! (AnimaHD 1080p HD)',
          source: 'AnimaHD',
          results: enrichedAh,
          byLanguage,
        };
        cache.set(streamCacheKey, responsePayload, 3 * 60 * 1000);
        res.setHeader('Cache-Control', 'no-store');
        return res.json(responsePayload);
      }

      // ── Clean Multi-Source Priority Assembly ──────────────────────────────────
      // Slot 1: Server 1 — Direct Multi-Audio HLS Stream (HindiAnime Player)
      const saltHls = (animeSaltItems || []).find((s: any) => s.type === 'hls' && s.directHlsUrl);

      if (saltHls) {
        const streamUrl = saltHls.directHlsUrl;
        const referer = saltHls.referer || 'https://ravok.buzz/';
        const origin = saltHls.origin || 'https://ravok.buzz';
        const p = new URLSearchParams({ url: streamUrl, referer, origin });
        if (PROXY_SECRET) {
          const exp = Math.floor(Date.now() / 1000) + 86400;
          p.set('exp', String(exp));
          p.set('sig', generateHlsToken(streamUrl, referer, origin, exp, PROXY_SECRET));
        }
        const hlsProxyUrl = `${requestOrigin}/hls-proxy?${p.toString()}`;
        list.push({
          server: 'Server 1',
          label: 'Server 1 · 🇮🇳 Hindi Dub HLS ⚡ (Multi-Audio) [HindiAnime Player]',
          embed: saltHls.embed || streamUrl,
          url: hlsProxyUrl,
          hlsProxyUrl,
          directHlsUrl: streamUrl,
          type: 'hls',
          audioLanguage: 'hi',
          languageLabel: '🇮🇳 Hindi Dub (Multi-Audio)',
          adFree: true,
          headers: { Referer: referer, Origin: origin },
          source: 'HindiAnime-HLS',
        });
        usedUrls.add(streamUrl);
        // Note: Do NOT block saltHls.embed here so MyStream iframe embed can be used in Server 2!
      }

      // Slot 2: Server 2 — AnimeSalt MyStream (ravok.buzz iframe embed)
      const myStream = (animeSaltItems || []).find(
        (s: any) => (s.embed || '').includes('ravok.buzz') && s.type === 'embed' && !usedUrls.has(s.embed || '')
      ) || (animeSaltItems || []).find(
        (s: any) => (s.embed || '').includes('ravok.buzz') && s.type === 'embed'
      );
      if (myStream) {
        addSalt(myStream, `Server ${list.length + 1} · ⚡ MyStream (AnimeSalt Embed)`);
      }

      // Slot 3: Server 3 — Google Drive 1080p Cloud Stream (AnimaHD)
      const ahEmbed = (animaHdItems || []).find((s: any) => s.type === 'embed' && !usedUrls.has(s.embed || ''));
      if (ahEmbed) {
        addAnimaHd(ahEmbed, `Server ${list.length + 1} · 🎬 Google Drive 1080p HD (AnimaHD)`);
      }

      // Slot 4: Server 4 — Abyss Multi-Audio (combining all regional dubs into one server)
      const abyssItems = (animeSaltItems || []).filter(
        (s: any) => (s.embed || '').includes('abyssplayer.com') || (s.label || '').toLowerCase().includes('abyss')
      );
      if (abyssItems.length > 0) {
        const langOrder = ['hi', 'ta', 'te', 'en', 'ja'];
        const sortedAbyss = [...abyssItems].sort((a: any, b: any) => {
          const aLang = (a.audioLanguage || 'hi').toLowerCase();
          const bLang = (b.audioLanguage || 'hi').toLowerCase();
          const aIdx = langOrder.indexOf(aLang);
          const bIdx = langOrder.indexOf(bLang);
          return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
        });

        const languageSources = sortedAbyss.map((s: any) => {
          const code = (s.audioLanguage || 'hi').toLowerCase();
          let label = 'Audio';
          if (code === 'hi') label = 'Hindi';
          else if (code === 'ta') label = 'Tamil';
          else if (code === 'te') label = 'Telugu';
          else if (code === 'en') label = 'English';
          else if (code === 'ja') label = 'Japanese';
          else if (s.languageLabel) label = s.languageLabel;

          return {
            code,
            label,
            embed: s.embed || s.url || '',
          };
        });

        const primaryAbyss = sortedAbyss[0];
        list.push({
          ...primaryAbyss,
          server: `Server ${list.length + 1}`,
          label: `Server ${list.length + 1} · Abyss Multi-Audio`,
          languageSources,
          type: 'embed',
          audioLanguage: primaryAbyss.audioLanguage || 'hi',
        });

        // Mark all abyss embeds as used so they are not duplicated
        for (const ab of sortedAbyss) {
          if (ab.embed) usedUrls.add(ab.embed);
          if (ab.url) usedUrls.add(ab.url);
        }
      }

      // Slot 5+: PlayZen Multi-Quality Direct Stream (720p HD / 480p SD)
      const pzMulti = playZenItems.find((s: any) => s.qualities && s.qualities.length > 0 && !usedUrls.has(s.embed || s.url || '')) ||
                      playZenItems.find((s: any) => !usedUrls.has(s.embed || s.url || ''));
      if (pzMulti) {
        const qStr = pzMulti.qualities?.map((q: any) => q.quality).join(' / ') || '720p HD / 480p SD';
        addPlayZen(pzMulti, `Server ${list.length + 1} · PlayZen · ⚡ Multi-Quality Direct Stream (${qStr})`);
      }

      // Slot 6+: PlayZen Secondary Official Edge Player (if not already added)
      const pzEmbed = playZenItems.find((s: any) => !usedUrls.has(s.embed || '') && (s.embed || '').includes('archive.animeinfinity.me'));
      if (pzEmbed) {
        addPlayZen(pzEmbed, `Server ${list.length + 1} · PlayZen · 🚀 Official Edge Player`);
      }

      // Fill remaining slots up to 9 with remaining PlayZen direct streams
      if (list.length < 9 && playZenItems && playZenItems.length > 0) {
        for (const s of playZenItems) {
          if (list.length >= 9) break;
          addPlayZen(s);
        }
      }

      // Fill remaining slots with remaining AnimaHD streams
      if (list.length < 9 && animaHdItems && animaHdItems.length > 0) {
        for (const s of animaHdItems) {
          if (list.length >= 9) break;
          addAnimaHd(s);
        }
      }

      // Fill remaining slots with remaining AnimeSalt streams
      if (list.length < 9 && animeSaltItems && animeSaltItems.length > 0) {
        for (const s of animeSaltItems) {
          if (list.length >= 9) break;
          addSalt(s);
        }
      }

      // Renumber sequentially Server 1..N
      const finalResults = list.map((item, idx) => {
        const num = idx + 1;
        const cleanLabel = (item.label || '').replace(/^Server(?:\s+\d+)?\s*·?\s*/, '');
        return {
          ...item,
          server: `Server ${num}`,
          label: cleanLabel ? `Server ${num} · ${cleanLabel}` : `Server ${num}`,
        };
      });

      // Construct dynamic byLanguage grouping
      const byLanguage: Record<string, { sources: any[] }> = {};
      finalResults.forEach((s) => {
        const lang = s.audioLanguage || (isHindi(s) ? 'hi' : isJapanese(s) ? 'ja' : isTamil(s) ? 'ta' : isTelugu(s) ? 'te' : isEnglish(s) ? 'en' : 'multi');
        if (!byLanguage[lang]) byLanguage[lang] = { sources: [] };
        byLanguage[lang].sources.push(s);
      });

      const responsePayload = {
        success: true,
        message: 'Stream Found!!',
        results: finalResults,
        byLanguage,
      };

      // Cache successful response for 3 minutes
      cache.set(streamCacheKey, responsePayload, 3 * 60 * 1000);

      res.setHeader('Cache-Control', 'no-store');
      return res.json(responsePayload);
    } catch (err: any) {
      console.error('[stream-resolver-error]', err);
      return res.status(500).json({ success: false, message: 'Stream handler exception', error: String(err) });
    }
  });

  // ── Route: /playzen-stream & /api/playzen/stream ─────────────────────────────
  app.get(['/playzen-stream', '/api/playzen/stream'], async (req, res) => {
    const rawId = (req.query.id as string) || (req.query.slug as string);
    if (!rawId || typeof rawId !== 'string') {
      return res.status(400).json({ success: false, message: 'Missing id or slug parameter' });
    }

    const extracted = extractAnimeSlug(rawId);
    const season = (req.query.season as string) || extracted.season || '1';
    const ep = (req.query.ep as string) || (req.query.episode as string) || extracted.episode || '1';
    const cleanId = extracted.slug;

    const cacheKey = `playzen:route:${cleanId}:s${season}:e${ep}`;
    const cached = cache.get<any>(cacheKey);
    if (cached) return res.json(cached.data);

    try {
      const items = await fetchPlayZenStream(cleanId, season, ep);
      if (!items || items.length === 0) {
        return res.status(404).json({
          success: false,
          source: 'PlayZen',
          message: `No PlayZen streams found for ${cleanId} S${season}E${ep}`,
          results: [],
        });
      }

      // Sort: direct streams first (mp4), then embed
      const sorted = [...items].sort((a: any, b: any) => {
        if (a.type === 'mp4' && b.type !== 'mp4') return -1;
        if (a.type !== 'mp4' && b.type === 'mp4') return 1;
        return 0;
      });

      const enriched = sorted.map((item: any, idx: number) => ({
        ...item,
        server: `Server ${idx + 1}`,
        label: `Server ${idx + 1} · ${(item.label || item.server || 'PlayZen Stream').replace(/^Server\s*\d+\s*·?\s*/, '')}`,
      }));

      const byLanguage: Record<string, { sources: any[] }> = {};
      enriched.forEach((item: any) => {
        const lang = item.audioLanguage || 'hi';
        if (!byLanguage[lang]) byLanguage[lang] = { sources: [] };
        byLanguage[lang].sources.push(item);
      });

      const payload = {
        success: true,
        source: 'PlayZen',
        id: cleanId,
        season,
        ep,
        total: enriched.length,
        results: enriched,
        byLanguage,
      };

      cache.set(cacheKey, payload, 5 * 60 * 1000);
      return res.json(payload);
    } catch (err: any) {
      return res.status(500).json({ success: false, message: 'PlayZen resolver exception', error: String(err) });
    }
  });

  // ── Route: /animesalt-stream & /api/animesalt/stream ───────────────────────────
  app.get(['/animesalt-stream', '/api/animesalt/stream'], async (req, res) => {
    const rawId = (req.query.id as string) || (req.query.slug as string);
    if (!rawId || typeof rawId !== 'string') {
      return res.status(400).json({ success: false, message: 'Missing id or slug parameter' });
    }

    const extracted = extractAnimeSlug(rawId);
    const season = (req.query.season as string) || extracted.season || '1';
    const ep = (req.query.ep as string) || (req.query.episode as string) || extracted.episode || '1';
    const cleanId = extracted.slug;

    const cacheKey = `animesalt:stream:${cleanId}:s${season}:e${ep}`;
    const cached = cache.get<any>(cacheKey);
    if (cached) return res.json(cached.data);

    try {
      const items = await fetchAnimeSaltStream(cleanId, season, ep);
      if (!items || items.length === 0) {
        return res.status(404).json({
          success: false,
          source: 'AnimeSalt',
          message: `No AnimeSalt streams found for ${cleanId} S${season}E${ep}`,
          results: [],
        });
      }

      const sorted = [...items].sort((a: any, b: any) => {
        if (a.type === 'hls' && b.type !== 'hls') return -1;
        if (a.type !== 'hls' && b.type === 'hls') return 1;
        if (a.audioLanguage === 'hi' && b.audioLanguage !== 'hi') return -1;
        if (a.audioLanguage !== 'hi' && b.audioLanguage === 'hi') return 1;
        return 0;
      });

      const requestOrigin = `${req.protocol}://${req.get('host')}`;
      const enriched = sorted.map((item: any, idx: number) => {
        const num = idx + 1;
        const cleanLabel = (item.label || '').replace(/^AnimeSalt\s*·?\s*/, '').replace(/^Server(?:\s+\d+)?\s*·?\s*/, '');
        if (item.type === 'hls' && item.directHlsUrl) {
          const streamUrl = item.directHlsUrl;
          const referer = item.referer || 'https://ravok.buzz/';
          const origin = item.origin || 'https://ravok.buzz';
          const p = new URLSearchParams({ url: streamUrl, referer, origin });
          if (PROXY_SECRET) {
            const exp = Math.floor(Date.now() / 1000) + 86400;
            p.set('exp', String(exp));
            p.set('sig', generateHlsToken(streamUrl, referer, origin, exp, PROXY_SECRET));
          }
          const hlsProxyUrl = `${requestOrigin}/hls-proxy?${p.toString()}`;
          return {
            ...item,
            server: `Server ${num}`,
            label: `Server ${num} · ${cleanLabel || 'Hindi Dub HLS ⚡ (Multi-Audio)'}`,
            url: hlsProxyUrl,
            hlsProxyUrl,
          };
        }
        return {
          ...item,
          server: `Server ${num}`,
          label: `Server ${num} · ${cleanLabel || 'AnimeSalt Embed'}`,
        };
      });

      const payload = {
        success: true,
        source: 'AnimeSalt',
        id: cleanId,
        season,
        ep,
        total: enriched.length,
        results: enriched,
      };

      cache.set(cacheKey, payload, 3 * 60 * 1000);
      return res.json(payload);
    } catch (err: any) {
      return res.status(500).json({ success: false, message: 'AnimeSalt resolver exception', error: String(err) });
    }
  });

  // ── Route: /gdrive-stream (Proxies confirmed Google Drive video files with HTTP Range support) ───
  app.all(['/gdrive-stream', '/api/gdrive-stream'], async (req, res) => {
    const fileId = req.query.id as string;
    if (!fileId || typeof fileId !== 'string') {
      return res.status(400).json({ success: false, message: 'Missing file id' });
    }

    try {
      const { streamUrl, cookies } = await resolveGoogleDriveStreamUrl(fileId);
      const range = req.headers.range;

      const upstreamHeaders: Record<string, string> = {
        'User-Agent': BROWSER_UA,
        Cookie: cookies,
      };
      if (range) {
        upstreamHeaders.Range = range;
      }

      const upstreamRes = await fetch(streamUrl, {
        method: req.method === 'HEAD' ? 'HEAD' : 'GET',
        headers: upstreamHeaders,
      });

      const upstreamCt = upstreamRes.headers.get('content-type') || '';
      const contentDisp = upstreamRes.headers.get('content-disposition') || '';
      const isDownloadReq = req.query.download === '1' || req.query.dl === '1';

      // Determine proper video MIME type based on filename or content
      let mimeType = 'video/mp4';
      if (contentDisp.toLowerCase().includes('.mkv') || upstreamCt.includes('matroska')) {
        mimeType = 'video/x-matroska';
      } else if (contentDisp.toLowerCase().includes('.webm') || upstreamCt.includes('webm')) {
        mimeType = 'video/webm';
      }

      // If client requests explicit file download, use attachment; otherwise inline for streaming
      const disposition = isDownloadReq
        ? (contentDisp || 'attachment; filename="anime-video.mkv"')
        : 'inline';

      res.status(upstreamRes.status);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', disposition);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization, Origin, Accept');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Type, Content-Disposition');

      if (upstreamRes.headers.get('content-range')) {
        res.setHeader('Content-Range', upstreamRes.headers.get('content-range')!);
      }
      if (upstreamRes.headers.get('content-length')) {
        res.setHeader('Content-Length', upstreamRes.headers.get('content-length')!);
      }

      if (req.method === 'HEAD' || !upstreamRes.body) {
        return res.end();
      }

      const nodeStream = Readable.fromWeb(upstreamRes.body as any);
      req.on('close', () => {
        try {
          nodeStream.destroy();
        } catch {}
      });
      nodeStream.pipe(res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Failed to stream Google Drive video', error: String(err) });
      }
    }
  });

  // ── Route: /animahd-search (Search animahd catalog via WordPress REST API) ───
  app.get('/animahd-search', async (req, res) => {
    const q = (req.query.q as string) || '';
    if (!q) return res.json({ success: true, count: 0, results: [] });
    try {
      const results = await searchAnimaHd(q);
      res.json({ success: true, count: results.length, results });
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'AnimaHD search error', error: String(err) });
    }
  });

  // ── Route: /animahd-episodes (Get episode list and Google Drive file IDs) ───
  app.get('/animahd-episodes', async (req, res) => {
    const slug = (req.query.slug as string) || (req.query.id as string) || '';
    if (!slug) return res.status(400).json({ success: false, message: 'Missing slug parameter' });
    try {
      const data = await fetchAnimaHdEpisodes(slug);
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'AnimaHD episodes error', error: String(err) });
    }
  });

  // ── Route: /animahd-stream (Resolve stream for specific episode) ───
  app.get('/animahd-stream', async (req, res) => {
    const rawId = (req.query.id as string) || (req.query.slug as string);
    const directGdriveId = extractGoogleDriveFileId(rawId);
    if (directGdriveId) {
      try {
        const results = await fetchAnimaHdStream(directGdriveId, '1', '1');
        return res.json({ success: true, results });
      } catch (err: any) {
        return res.status(500).json({ success: false, message: 'AnimaHD stream error', error: String(err) });
      }
    }

    const extracted = extractAnimeSlug(rawId);
    const season = (req.query.season as string) || extracted.season || '1';
    const ep = (req.query.ep as string) || (req.query.episode as string) || extracted.episode || '1';
    const cleanId = extracted.slug;

    try {
      const results = await fetchAnimaHdStream(cleanId, season, ep);
      if (results.length === 0) {
        return res.status(404).json({ success: false, message: 'No AnimaHD stream found', results: [] });
      }
      res.json({ success: true, results });
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'AnimaHD stream error', error: String(err) });
    }
  });

  // ── Route: /api/v3/toko/stream (Direct proxy to Toko API with CORS & AnimeSalt fallback) ───
  app.get('/api/v3/toko/stream', async (req, res) => {
    const tokoAuthFailure = validateProxySecret(req, REQUIRE_STREAM_SECRET);
    if (tokoAuthFailure) {
      return res.status(tokoAuthFailure.status).json({ error: tokoAuthFailure.error });
    }

    const queryStr = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const targetUrl = `${TOKO_API_URL}/api/v3/toko/stream?${queryStr}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      clearTimeout(timeout);
      const text = await response.text();

      if (response.ok && !text.includes('<!DOCTYPE html') && !text.includes('DEPLOYMENT_NOT_FOUND') && !text.includes('DEPLOYMENT_DISABLED')) {
        res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
        res.setHeader('Cache-Control', 'public, max-age=180');
        return res.status(response.status).send(text);
      }

      // Upstream unavailable or returned error/HTML — Fallback to AnimeSalt!
      const rawTitle = (req.query['titles[]'] || req.query.titles || req.query.title || req.query.id || '') as string;
      const rawSeason = (req.query.season as string) || '1';
      const rawEp = (req.query.episode as string) || (req.query.ep as string) || '1';
      const titleToUse = Array.isArray(rawTitle) ? rawTitle[0] : rawTitle;
      const { slug: cleanId, season: parsedS, episode: parsedE } = extractAnimeSlug(titleToUse);
      const finalSeason = rawSeason || parsedS || '1';
      const finalEp = rawEp || parsedE || '1';

      if (cleanId) {
        const saltItems = await fetchAnimeSaltStream(cleanId, finalSeason, finalEp);
        if (saltItems && saltItems.length > 0) {
          const requestOrigin = `${req.protocol}://${req.get('host')}`;
          const tokoPayload = formatAnimeSaltAsTokoResponse(saltItems, cleanId, finalSeason, finalEp, requestOrigin, PROXY_SECRET);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'public, max-age=180');
          return res.json(tokoPayload);
        }
      }

      res.setHeader('Content-Type', 'application/json');
      return res.status(response.status).send(text);
    } catch {
      clearTimeout(timeout);

      // Fallback on network timeout/failure
      const rawTitle = (req.query['titles[]'] || req.query.titles || req.query.title || req.query.id || '') as string;
      const rawSeason = (req.query.season as string) || '1';
      const rawEp = (req.query.episode as string) || (req.query.ep as string) || '1';
      const titleToUse = Array.isArray(rawTitle) ? rawTitle[0] : rawTitle;
      const { slug: cleanId, season: parsedS, episode: parsedE } = extractAnimeSlug(titleToUse);
      const finalSeason = rawSeason || parsedS || '1';
      const finalEp = rawEp || parsedE || '1';

      if (cleanId) {
        try {
          const saltItems = await fetchAnimeSaltStream(cleanId, finalSeason, finalEp);
          if (saltItems && saltItems.length > 0) {
            const requestOrigin = `${req.protocol}://${req.get('host')}`;
            const tokoPayload = formatAnimeSaltAsTokoResponse(saltItems, cleanId, finalSeason, finalEp, requestOrigin, PROXY_SECRET);
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'public, max-age=180');
            return res.json(tokoPayload);
          }
        } catch {
          // ignore
        }
      }

      return res.status(502).json({ error: 'Toko upstream fetch failed, and AnimeSalt fallback yielded no streams' });
    }
  });

  // ── Route: /animesalt/* & /api/animesalt/* (Direct HTML/Asset Proxy for AnimeSalt)
  app.get(['/animesalt/*', '/api/animesalt/*'], async (req, res) => {
    const subPath = req.url.replace(/^\/(?:api\/)?animesalt\/?/, '');
    const targetUrl = `https://animesalt.cx/${subPath}`;

    let parsedTarget: URL;
    try {
      parsedTarget = new URL(targetUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid AnimeSalt target' });
    }

    if (!isAllowedAnimeSaltTarget(parsedTarget)) {
      return res.status(403).json({ error: 'AnimeSalt path not allowed' });
    }

    const proxyHeaders: Record<string, string> = {
      'User-Agent': BROWSER_UA,
      Accept: (req.headers.accept as string) || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': (req.headers['accept-language'] as string) || 'en-US,en;q=0.9',
      Referer: 'https://animesalt.cx/',
      Origin: 'https://animesalt.cx',
      'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const upstream = await fetch(parsedTarget.toString(), {
        signal: controller.signal,
        headers: proxyHeaders,
      });
      clearTimeout(timeout);

      const ct = upstream.headers.get('content-type') || 'text/html; charset=UTF-8';
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.status(upstream.status);

      if (upstream.body) {
        const nodeStream = Readable.fromWeb(upstream.body as any);
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (err: any) {
      clearTimeout(timeout);
      return res.status(502).json({ error: 'AnimeSalt fetch failed', detail: String(err) });
    }
  });

  // ── Route: /hls-proxy (Proxies HLS M3U8 playlists & TS video segments) ────────
  app.get('/hls-proxy', async (req, res) => {
    const targetUrl = req.query.url as string;
    const parentUrl = req.query.parent as string | undefined;
    const referer = (req.query.referer as string) || '';
    const origin = (req.query.origin as string) || '';
    const exp = req.query.exp as string | undefined;
    const sig = req.query.sig as string | undefined;

    if (!targetUrl) {
      return res.status(400).json({ error: 'Missing url parameter' });
    }

    let parsedTarget: URL;
    try {
      parsedTarget = new URL(targetUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid URL parameter' });
    }

    if (!isAllowedHlsTarget(parsedTarget)) {
      return res.status(403).json({ error: 'Target URL type or domain not allowed' });
    }

    let rootParentUrl = targetUrl;
    if (parentUrl) {
      let parsedParent: URL;
      try {
        parsedParent = new URL(parentUrl);
      } catch {
        return res.status(400).json({ error: 'Invalid parent URL' });
      }
      if (!isAllowedHlsTarget(parsedParent)) {
        return res.status(403).json({ error: 'Parent URL not allowed' });
      }
      const targetHost = parsedTarget.hostname.toLowerCase();
      const parentHost = parsedParent.hostname.toLowerCase();
      if (!areHostsInSameCluster(targetHost, parentHost)) {
        return res.status(403).json({ error: 'Host not in parent provider cluster' });
      }
      rootParentUrl = parentUrl;
    }

    // Verify media token if secret is configured and strict mode is on or token was supplied
    if (PROXY_SECRET && (REQUIRE_STREAM_SECRET || (sig && exp))) {
      const isValidToken = verifyHlsToken(rootParentUrl, referer, origin, exp, sig, PROXY_SECRET);
      if (!isValidToken) {
        return res.status(403).json({ error: 'Unauthorized or expired media token' });
      }
    }

    const proxyHeaders: Record<string, string> = {
      'User-Agent': BROWSER_UA,
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    };
    if (referer) {
      proxyHeaders['Referer'] = referer;
    } else if (parsedTarget.hostname === 'ravok.buzz' || /^as-cdn\d*\.top$/.test(parsedTarget.hostname)) {
      proxyHeaders['Referer'] = 'https://ravok.buzz/';
    }
    if (origin) {
      proxyHeaders['Origin'] = origin;
    } else if (parsedTarget.hostname === 'ravok.buzz' || /^as-cdn\d*\.top$/.test(parsedTarget.hostname)) {
      proxyHeaders['Origin'] = 'https://ravok.buzz';
    }
    if (req.headers.range) proxyHeaders['Range'] = req.headers.range as string;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HLS_UPSTREAM_TIMEOUT_MS);

    try {
      const { response: upstream, finalUrl, blockedRedirect } = await fetchWithAllowedRedirects(
        parsedTarget,
        proxyHeaders,
        isAllowedHlsTarget,
        controller.signal,
        HLS_MAX_REDIRECTS
      );

      clearTimeout(timeout);

      if (!upstream || !finalUrl) {
        return res.status(403).json({ error: blockedRedirect ? 'Redirect target not allowed' : 'Upstream fetch failed' });
      }

      if (!upstream.ok) {
        return res.status(upstream.status).json({
          error: `Upstream media server returned HTTP ${upstream.status}`,
          status: upstream.status,
        });
      }

      // Copy relevant HTTP response headers
      const ct = upstream.headers.get('content-type');
      if (ct) res.setHeader('Content-Type', ct);
      const cl = upstream.headers.get('content-length');
      if (cl) res.setHeader('Content-Length', cl);
      const cr = upstream.headers.get('content-range');
      if (cr) res.setHeader('Content-Range', cr);
      const acc = upstream.headers.get('accept-ranges');
      if (acc) res.setHeader('Accept-Ranges', acc);
      const lm = upstream.headers.get('last-modified');
      if (lm) res.setHeader('Last-Modified', lm);
      const etag = upstream.headers.get('etag');
      if (etag) res.setHeader('ETag', etag);

      const requestOrigin = `${req.protocol}://${req.get('host')}`;

      // If M3U8 Playlist: rewrite URLs to route through /hls-proxy
      const isM3u8Candidate =
        finalUrl.pathname.toLowerCase().endsWith('.m3u8') ||
        (ct && ct.toLowerCase().includes('mpegurl')) ||
        (ct && ct.toLowerCase().includes('vnd.apple.mpegurl')) ||
        finalUrl.pathname.toLowerCase().includes('/hls/');

      if (isM3u8Candidate) {
        const text = await upstream.text();

        if (!text.trimStart().startsWith('#EXTM3U') && !text.includes('#EXTINF')) {
          return res.status(502).json({
            error: 'Upstream returned invalid M3U8 content',
            snippet: text.slice(0, 200),
          });
        }
        const baseUrl = `${finalUrl.protocol}//${finalUrl.host}${finalUrl.pathname.replace(/\/[^/]*$/, '/')}`;
        const proxyBase = `${requestOrigin}/hls-proxy`;
        const rootParent = parentUrl || targetUrl;
        const targetHost = parsedTarget.hostname.toLowerCase();

        const lines = text.split('\n');
        const rewrittenLines: string[] = [];
        let pendingTagLines: string[] = [];

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            rewrittenLines.push(line);
            continue;
          }

          // Handle URI in tags like #EXT-X-KEY (AES-128 decryption keys)
          if (trimmed.startsWith('#')) {
            if (trimmed.includes('URI=')) {
              const match = trimmed.match(/URI=["']([^"']+)["']/);
              if (match) {
                try {
                  const segUrl = new URL(match[1], baseUrl);
                  const segHost = segUrl.hostname.toLowerCase();
                  if (isAllowedHlsHostName(segHost) && areHostsInSameCluster(segHost, targetHost)) {
                    const params = new URLSearchParams({
                      url: segUrl.toString(),
                      parent: rootParent,
                    });
                    if (exp) params.set('exp', String(exp));
                    if (sig) params.set('sig', sig);
                    if (referer) params.set('referer', referer);
                    if (origin) params.set('origin', origin);
                    rewrittenLines.push(trimmed.replace(match[0], `URI="${proxyBase}?${params.toString()}"`));
                    continue;
                  }
                } catch {
                  // ignore
                }
              }
            }

            if (
              trimmed.startsWith('#EXTINF:') ||
              trimmed.startsWith('#EXT-X-STREAM-INF:') ||
              trimmed.startsWith('#EXT-X-BYTERANGE:')
            ) {
              pendingTagLines.push(line);
              continue;
            }

            if (pendingTagLines.length > 0) {
              rewrittenLines.push(...pendingTagLines);
              pendingTagLines = [];
            }
            rewrittenLines.push(line);
            continue;
          }

          // Non-tag line: video segment or variant playlist
          let segUrl: URL;
          try {
            segUrl = new URL(trimmed, baseUrl);
          } catch {
            pendingTagLines = [];
            continue;
          }

          const segHost = segUrl.hostname.toLowerCase();
          if (!isAllowedHlsHostName(segHost) || !areHostsInSameCluster(segHost, targetHost)) {
            pendingTagLines = [];
            continue;
          }

          if (pendingTagLines.length > 0) {
            rewrittenLines.push(...pendingTagLines);
            pendingTagLines = [];
          }

          const params = new URLSearchParams({
            url: segUrl.toString(),
            parent: rootParent,
          });
          if (exp) params.set('exp', String(exp));
          if (sig) params.set('sig', sig);
          if (referer) params.set('referer', referer);
          if (origin) params.set('origin', origin);

          rewrittenLines.push(`${proxyBase}?${params.toString()}`);
        }

        const rewritten = rewrittenLines.join('\n');
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.removeHeader('Content-Length');
        return res.status(upstream.status).send(rewritten);
      }

      // Media chunks: stream body directly to client with cache headers
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.status(upstream.status);

      if (upstream.body) {
        const nodeStream = Readable.fromWeb(upstream.body as any);
        nodeStream.pipe(res);
        nodeStream.on('error', (err) => {
          console.warn('[hls-proxy-pipe-error]', err);
          res.end();
        });
      } else {
        res.end();
      }
    } catch (err: any) {
      clearTimeout(timeout);
      console.error('[hls-proxy-error]', err);
      return res.status(502).json({ error: 'HLS proxy fetch failed', detail: String(err) });
    }
  });

  // ── Route: /catalog, /animesalt-catalog & /api/catalog ────────────────────────
  app.get(['/catalog', '/animesalt-catalog', '/api/catalog'], async (req, res) => {
    const kind = req.query.kind as string;
    const pageStr = (req.query.page as string) || '1';
    const page = parseInt(pageStr, 10);

    if (kind !== 'series' && kind !== 'movies') {
      return res.status(400).json({ success: false, message: "Invalid kind parameter; must be 'series' or 'movies'" });
    }
    if (!/^[1-9]\d*$/.test(pageStr) || !Number.isSafeInteger(page)) {
      return res.status(400).json({ success: false, message: 'Invalid page number' });
    }

    // Return structured JSON for /api/catalog or when JSON is requested
    const wantsHtml = req.query.format === 'html' || req.path === '/animesalt-catalog';
    if (!wantsHtml) {
      try {
        const structured = await fetchStructuredCatalog(kind, page);
        res.setHeader('Cache-Control', 'public, max-age=600');
        res.setHeader('Vary', 'Authorization');
        return res.json(structured);
      } catch (err: any) {
        console.error('[structured-catalog-error]', err);
        return res.status(502).json({ success: false, message: 'Catalog fetch failed' });
      }
    }

    const cacheKey = `catalog:${kind}:${page}`;
    const cached = cache.get<string>(cacheKey, true, HOMEPAGE_MAX_STALE_MS);
    const now = Date.now();
    const isFresh = cached && now <= cached.expiresAt;

    if (isFresh) {
      res.setHeader('Content-Type', cached.contentType || 'text/html; charset=UTF-8');
      res.setHeader('X-Catalog-Cache', 'fresh');
      if (cached.headers) {
        for (const [k, v] of Object.entries(cached.headers)) res.setHeader(k, v);
      }
      return res.send(cached.data);
    }

    const targetUrl = `https://animesalt.cx/${kind}/page/${page}/`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);

    try {
      const response = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          Referer: 'https://animesalt.cx/',
          Origin: 'https://animesalt.cx',
          'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        if (cached) {
          res.setHeader('Content-Type', cached.contentType || 'text/html; charset=UTF-8');
          res.setHeader('X-Catalog-Cache', 'stale');
          return res.send(cached.data);
        }
        return res.status(response.status).json({ success: false, message: `Upstream catalog error: ${response.status}` });
      }

      const html = await response.text();
      const validItemCount = countValidCatalogHtmlItems(html, kind);
      const isValid = /<html\b/i.test(html) && validItemCount > 0;

      if (!isValid) {
        if (cached) {
          res.setHeader('X-Catalog-Cache', 'stale');
          return res.send(cached.data);
        }
        return res.status(502).json({ success: false, message: 'Invalid catalog response from upstream' });
      }

      const extraHeaders: Record<string, string> = {
        'x-catalog-page-size': String(validItemCount),
      };

      // Store in memory cache
      cache.set(cacheKey, html, CATALOG_FRESH_MS, {
        contentType: 'text/html; charset=UTF-8',
        headers: extraHeaders,
        entryCount: validItemCount,
      });

      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
      res.setHeader('X-Catalog-Cache', 'fresh');
      res.setHeader('x-catalog-page-size', String(validItemCount));
      return res.send(html);
    } catch (err: any) {
      clearTimeout(timeout);
      if (cached) {
        res.setHeader('X-Catalog-Cache', 'stale');
        return res.send(cached.data);
      }
      return res.status(502).json({ success: false, message: 'Catalog upstream fetch failed', error: String(err) });
    }
  });

  // ── Route: / (General CORS Proxy when ?url= is passed) & /proxy ───────────────
  const handleGeneralProxy = async (req: Request, res: Response) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) {
      return res.status(400).json({ error: 'Missing url parameter' });
    }

    let parsedTarget: URL;
    try {
      parsedTarget = new URL(targetUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid target URL' });
    }

    if (!isAllowedGeneralTarget(parsedTarget)) {
      return res.status(403).json({ error: 'Target URL domain not allowed' });
    }

    // Toko stream target requires secret
    if (isAllowedTokoStreamTarget(parsedTarget)) {
      const tokoAuthFailure = validateProxySecret(req, true);
      if (tokoAuthFailure) {
        return res.status(tokoAuthFailure.status).json({ error: tokoAuthFailure.error });
      }
    }

    // Check homepage cache if target is AnimeSalt root
    if (targetUrl === ANIMESALT_HOMEPAGE_URL || targetUrl === 'https://animesalt.cx') {
      const cachedHome = cache.get<string>('animesalt:homepage', true);
      if (cachedHome) {
        res.setHeader('Content-Type', cachedHome.contentType || 'text/html; charset=UTF-8');
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.send(cachedHome.data);
      }
    }

    const isAnimeSaltHost =
      parsedTarget.hostname === 'animesalt.cx' ||
      parsedTarget.hostname === 'www.animesalt.cx' ||
      parsedTarget.hostname.endsWith('.animesalt.cx');

    const proxyHeaders: Record<string, string> = {
      'User-Agent': BROWSER_UA,
      Accept: (req.headers.accept as string) || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': (req.headers['accept-language'] as string) || 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    };

    if (isAnimeSaltHost) {
      proxyHeaders['Referer'] = 'https://animesalt.cx/';
      proxyHeaders['Origin'] = 'https://animesalt.cx';
      proxyHeaders['Sec-Ch-Ua'] = '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
      proxyHeaders['Sec-Ch-Ua-Mobile'] = '?0';
      proxyHeaders['Sec-Ch-Ua-Platform'] = '"Windows"';
      proxyHeaders['Sec-Fetch-Dest'] = 'document';
      proxyHeaders['Sec-Fetch-Mode'] = 'navigate';
      proxyHeaders['Sec-Fetch-Site'] = 'same-origin';
      proxyHeaders['Sec-Fetch-User'] = '?1';
      proxyHeaders['Upgrade-Insecure-Requests'] = '1';
    }

    if (parsedTarget.pathname.includes('admin-ajax.php')) {
      proxyHeaders['X-Requested-With'] = 'XMLHttpRequest';
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      isAllowedTokoStreamTarget(parsedTarget) ? 28000 : 12000
    );

    try {
      const { response: upstream, blockedRedirect } = await fetchWithAllowedRedirects(
        parsedTarget,
        proxyHeaders,
        isAllowedGeneralTarget,
        controller.signal
      );

      clearTimeout(timeout);

      if (!upstream) {
        return res.status(blockedRedirect ? 403 : 502).json({
          error: blockedRedirect ? 'Redirect target not allowed' : 'Proxy request failed',
        });
      }

      const ct = upstream.headers.get('content-type');
      if (ct) res.setHeader('Content-Type', ct);

      // Handle homepage caching
      if (targetUrl === ANIMESALT_HOMEPAGE_URL && upstream.ok && ct?.includes('text/html')) {
        const text = await upstream.text();
        const validation = validateAnimeSaltHomepage(text, upstream.headers);
        if (validation.valid) {
          cache.set('animesalt:homepage', text, HOMEPAGE_FRESH_MS, {
            contentType: ct,
            entryCount: validation.entryCount,
          });
        }
        return res.status(upstream.status).send(text);
      }

      // Stream body
      res.status(upstream.status);
      if (upstream.body) {
        const nodeStream = Readable.fromWeb(upstream.body as any);
        nodeStream.pipe(res);
        nodeStream.on('error', (err) => {
          console.warn('[general-proxy-pipe-error]', err);
          res.end();
        });
      } else {
        res.end();
      }
    } catch (err: any) {
      clearTimeout(timeout);
      console.error('[proxy-fetch-failed]', err);
      return res.status(502).json({ error: 'Proxy fetch failed', detail: String(err) });
    }
  };

  // Dedicated /proxy route
  app.get('/proxy', handleGeneralProxy);

  // General GET / interceptor (if ?url= is passed, it acts as the proxy; otherwise, passes through to Vite frontend)
  app.get('/', (req, res, next) => {
    if (req.query.url) {
      return handleGeneralProxy(req, res);
    }
    next();
  });

  // Catch-all for undefined /api routes
  app.all('/api/*', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.status(404).json({ error: 'Endpoint not found' });
  });

  // Global JSON error handler for backend routes
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('[server-error]', err);
    if (req.path.startsWith('/api') || req.path === '/stream' || req.path === '/hls-proxy' || req.path === '/catalog') {
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
    }
    next(err);
  });

  // ── Vite Dev Middleware or Production Static Files ────────────────────────────
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 AnimeStream Proxy Backend running at http://0.0.0.0:${PORT}`);
    console.log(`📡 Ready to serve Next.js frontend with CORS and bypass blockers!`);
    console.log(`   - Stream Resolver: GET http://0.0.0.0:${PORT}/stream?id=solo-leveling&season=1&ep=1`);
    console.log(`   - HLS Video Proxy: GET http://0.0.0.0:${PORT}/hls-proxy?url=...`);
    console.log(`   - Catalog Crawler: GET http://0.0.0.0:${PORT}/catalog?kind=series&page=1`);
    console.log(`   - General Proxy:   GET http://0.0.0.0:${PORT}/?url=https://animesalt.cx/`);
    console.log(`   - Health Check:    GET http://0.0.0.0:${PORT}/api/health\n`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
