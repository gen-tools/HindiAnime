# AnimeStream Proxy Backend (Node.js & Express)

A high-performance Node.js / Express proxy backend designed to sit between your **Next.js frontend (hosted on Vercel)** and upstream anime streaming providers (**AnimeSalt**, **Toko API**, **Ravok**, **AbyssPlayer**, **Vidmoly**, **Fastream**, etc.).

---

## 🚀 Why This Backend Replaces Cloudflare Workers

1. **No 100k Requests/Day Cap**: Cloudflare Workers free plan caps you at 100,000 requests/day. Because HLS video playback streams dozens of `.ts` / `.m4s` chunks per minute, just 50-100 active viewers will hit Cloudflare's limit in a few hours. This Node.js backend has **unlimited requests**.
2. **Bypasses Vercel IP Blocks**: AnimeSalt and streaming CDNs block Vercel's datacenter IP ranges. By sending requests through this proxy, requests originate from standard server IPs with realistic Chrome headers (`User-Agent`, `Sec-Ch-Ua`, `Referer`), returning **200 OK**.
3. **M3U8 Manifest Rewriting**: Rewrites internal HLS segment and encryption key URLs (`#EXT-X-KEY:URI=...`) so browsers can fetch protected video chunks without CORS or Referer errors.
4. **In-Memory TTL Caching**: High-performance caching for AnimeSalt catalog pages, sitemaps, and Toko stream resolutions, with stale-if-error resilience.

---

## 📡 API Endpoints

### 1. `GET /stream` (Multi-Source Stream Resolver)
Resolves streams from Toko API and AnimeSalt in parallel, prioritizing Hindi Dub and direct HLS across 9 server slots:

- **Server 1**: 🇮🇳 Hindi Dub HLS ⚡ (Direct playback with HLS proxy)
- **Server 2**: 🇮🇳 AnimeSalt MyStream (ravok.buzz iframe)
- **Server 3**: 🇮🇳 Toko Hindi Dub Embed #1
- **Server 4**: 🇮🇳 Toko Hindi Dub Embed #2
- **Server 5**: 🌐 Tamil (AnimeSalt Abyss or Toko)
- **Server 6**: 🌐 Telugu (AnimeSalt Abyss or Toko)
- **Server 7**: 🇬🇧 English (AnimeSalt Abyss or Toko)
- **Server 8**: 🇯🇵 Japanese HLS ⚡
- **Server 9**: 🇯🇵 Japanese Embed / Abyss

**Query Parameters:**
- `id` (required): Anime slug (e.g. `solo-leveling`, `jujutsu-kaisen`)
- `season` (optional, default: `1`): Season number
- `ep` (optional, default: `1`): Episode number
- `source` (optional, default: `all`): `all` (smart auto-fallback), `animesalt` (AnimeSalt only), or `toko` (Toko only)

**Example Request:**
```bash
# Auto-fallback: resolves from AnimeSalt and Toko
curl -s "https://your-proxy-domain.com/stream?id=solo-leveling&season=1&ep=1"

# Force AnimeSalt only
curl -s "https://your-proxy-domain.com/stream?id=solo-leveling&season=1&ep=1&source=animesalt"
```

---

### 2. `GET /animesalt-stream` (Dedicated AnimeSalt Stream Resolver)
Extracts multi-language AbyssPlayer embeds (Hindi, Tamil, Telugu, English, Japanese) and direct Multi-Audio HLS (Ravok MyStream) directly from AnimeSalt (`animesalt.cx`).

**Query Parameters:**
- `id` or `slug`: Episode slug (e.g. `solo-leveling-1x1`, `naruto-1x1`)

---

### 3. `GET /animesalt/*` & `GET /api/animesalt/*` (Direct AnimeSalt HTML Proxy)
Proxies any AnimeSalt page with browser headers and CORS headers for direct scraping.
Example: `GET /animesalt/episode/solo-leveling-1x1/`

---

### 4. `GET /hls-proxy` (HLS Video Stream & Chunk Proxy)
Proxies `.m3u8` playlists and media segments (`.ts`, `.m4s`, `.mp4`, `.aac`, `.js`), injecting required `Referer` and `Origin` headers and rewriting URLs to bypass 403 blocks.

---

### 5. `GET /catalog` (AnimeSalt Catalog Scraper)
Crawls and returns AnimeSalt TV series or movies with anti-blocking headers and caching.
Aliases: `/animesalt-catalog`, `/api/catalog`

---

### 6. `GET /?url=<encoded>` & `GET /proxy?url=<encoded>` (General CORS Proxy)
Proxies allowlisted hosts (`animesalt.cx`, `as-cdn*.top`, `api-delta-taupe-46.vercel.app`, `ravok.buzz`, `abyssplayer.com`).

---

### 5. `GET /api/health`
Returns system uptime, cache statistics, and memory usage.

---

## 🔌 Connecting to Your Next.js Frontend (Vercel)

### Step 1: Add Environment Variable in Next.js (`.env.local`)
```env
NEXT_PUBLIC_STREAM_PROXY_URL=https://your-proxy-domain.com
```

### Step 2: Use in Next.js Code
```typescript
// lib/streamService.ts
const PROXY_URL = process.env.NEXT_PUBLIC_STREAM_PROXY_URL || "http://localhost:3000";

export async function fetchStreams(animeId: string, season = 1, episode = 1) {
  const url = `${PROXY_URL}/stream?id=${encodeURIComponent(animeId)}&season=${season}&ep=${episode}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Stream lookup failed with status ${res.status}`);
  return res.json();
}
```

---

## 🌐 Free Deployment Options (No 100k Limits)

### Option A: Render.com (Free Web Service)
1. Push this project to a GitHub repository.
2. In Render Dashboard, click **New** > **Web Service**.
3. Connect your repository.
4. Set:
   - **Environment**: `Node`
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
5. Click **Deploy**. Render gives you an HTTPS URL with unlimited requests!

### Option B: Koyeb or Fly.io (Free Eco Tier)
Deploy using the included `Dockerfile` with one command:
```bash
fly launch
```
or connect GitHub to Koyeb.

### Option C: Any Linux VPS ($3.50/mo on Hetzner / DigitalOcean)
```bash
git clone <your-repo>
npm install
npm run build
npm start
```
