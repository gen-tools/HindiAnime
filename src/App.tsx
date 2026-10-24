import React, { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';
import {
  Play,
  CheckCircle2,
  AlertCircle,
  Server,
  Copy,
  ExternalLink,
  ShieldCheck,
  Terminal,
  Cpu,
  Database,
  RefreshCw,
  Globe,
  Code2,
  Film,
  Zap,
  ChevronRight,
  Sparkles,
  Layers,
  ArrowRight,
  Maximize2,
  Download
} from 'lucide-react';
import HindiAnimePlayer from './components/HindiAnimePlayer';

interface StreamResult {
  server: string;
  label: string;
  embed: string;
  url?: string;
  hlsProxyUrl?: string;
  directStreamUrl?: string;
  fileId?: string;
  fileSize?: string;
  duration?: string;
  source?: string;
  streamType?: string;
  type: string;
  audioLanguage?: string;
  languageLabel?: string;
  adFree?: boolean;
}

interface StreamResponse {
  success: boolean;
  message: string;
  results: StreamResult[];
  byLanguage?: Record<string, any>;
}

interface HealthResponse {
  status: string;
  service: string;
  version: string;
  uptime: number;
  memory?: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
  };
  cache?: {
    size: number;
    hits: number;
    misses: number;
    sets: number;
    ratio: string;
  };
  secretAuthEnabled: boolean;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'stream' | 'animesalt' | 'animahd' | 'catalog' | 'cors' | 'nextjs' | 'deploy'>('stream');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);

  // Stream tester state
  const [animeId, setAnimeId] = useState('solo-leveling');
  const [season, setSeason] = useState('1');
  const [episode, setEpisode] = useState('1');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'animesalt' | 'toko' | 'animahd'>('all');
  const [streamLoading, setStreamLoading] = useState(false);
  const [streamData, setStreamData] = useState<StreamResponse | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [selectedServer, setSelectedServer] = useState<StreamResult | null>(null);

  // Dedicated AnimeSalt Explorer state
  const [saltSlug, setSaltSlug] = useState('solo-leveling-1x1');
  const [saltStreamLoading, setSaltStreamLoading] = useState(false);
  const [saltStreamResult, setSaltStreamResult] = useState<any>(null);
  const [saltStreamError, setSaltStreamError] = useState<string | null>(null);
  const [saltHtmlLoading, setSaltHtmlLoading] = useState(false);
  const [saltHtmlResult, setSaltHtmlResult] = useState<{ status: number; snippet: string; length: number } | null>(null);
  const [saltHtmlError, setSaltHtmlError] = useState<string | null>(null);

  // AnimaHD Explorer & Reverse Engineering Report state
  const [animaSearchQuery, setAnimaSearchQuery] = useState('slime');
  const [animaSearching, setAnimaSearching] = useState(false);
  const [animaSearchResults, setAnimaSearchResults] = useState<any[]>([]);
  const [animaSelectedSlug, setAnimaSelectedSlug] = useState('that-time-i-got-reincarnated-as-a-slime');
  const [animaEpisodesLoading, setAnimaEpisodesLoading] = useState(false);
  const [animaEpisodesData, setAnimaEpisodesData] = useState<any | null>(null);
  const [animaEpisodeError, setAnimaEpisodeError] = useState<string | null>(null);
  const [directGdriveInput, setDirectGdriveInput] = useState('1-3GTx0knzb1eSV0-KGfK3YOVu-6pzhDH');

  // Catalog tester state
  const [catalogKind, setCatalogKind] = useState<'series' | 'movies'>('series');
  const [catalogPage, setCatalogPage] = useState('1');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogResult, setCatalogResult] = useState<{ status: number; textSnippet: string; headers: Record<string, string> } | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // General CORS tester state
  const [corsUrl, setCorsUrl] = useState('https://animesalt.cx/');
  const [corsLoading, setCorsLoading] = useState(false);
  const [corsResult, setCorsResult] = useState<{ status: number; contentType: string; snippet: string } | null>(null);
  const [corsError, setCorsError] = useState<string | null>(null);

  // Copy toast state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Video player ref & tracks
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [audioTracks, setAudioTracks] = useState<Array<{ id: number; name: string; lang?: string }>>([]);
  const [currentAudioTrack, setCurrentAudioTrack] = useState<number>(0);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [customSecret, setCustomSecret] = useState('');
  const [showSecretField, setShowSecretField] = useState(false);

  const fetchHealth = async () => {
    setLoadingHealth(true);
    try {
      const res = await fetch('/api/health');
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        const data = await res.json();
        setHealth(data);
      }
    } catch (e) {
      console.warn('fetchHealth check:', e);
    } finally {
      setLoadingHealth(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  // HLS Video player initialization when selected server changes
  useEffect(() => {
    setPlayerError(null);
    setAudioTracks([]);

    if (!selectedServer || !videoRef.current) return;

    const streamUrl = selectedServer.url || selectedServer.hlsProxyUrl;
    if (!streamUrl || selectedServer.type === 'embed') {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      return;
    }

    // Direct MP4 stream playback in HTML5 video without HLS manifest
    if (selectedServer.type === 'mp4') {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      videoRef.current.src = streamUrl;
      videoRef.current.play().catch(() => {});
      return;
    }

    if (Hls.isSupported()) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }
      const hls = new Hls({
        debug: false,
        enableWorker: true,
        lowLatencyMode: true,
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(videoRef.current);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        videoRef.current?.play().catch(() => {});
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
        if (data.audioTracks && data.audioTracks.length > 0) {
          setAudioTracks(data.audioTracks.map((t, idx) => ({ id: idx, name: t.name || t.lang || `Track ${idx + 1}`, lang: t.lang })));
          setCurrentAudioTrack(hls.audioTrack);
        }
      });

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
        setCurrentAudioTrack(data.id);
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              setPlayerError(`HLS stream playback error: ${data.details}`);
              hls.destroy();
              break;
          }
        }
      });

      hlsRef.current = hls;
    } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
      videoRef.current.src = streamUrl;
      videoRef.current.play().catch(() => {});
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [selectedServer]);

  const handleTestStream = async () => {
    setStreamLoading(true);
    setStreamError(null);
    setStreamData(null);
    setSelectedServer(null);

    try {
      const params = new URLSearchParams({
        id: animeId.trim(),
        season: season.trim(),
        ep: episode.trim(),
      });
      if (sourceFilter !== 'all') {
        params.set('source', sourceFilter);
      }
      const headers: Record<string, string> = {};
      if (customSecret.trim()) {
        headers['x-hindianime-proxy-secret'] = customSecret.trim();
      }
      const res = await fetch(`/stream?${params.toString()}`, { headers });
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        setStreamError(`Upstream returned non-JSON response (${res.status}): ${text.slice(0, 150)}`);
        return;
      }

      if (!res.ok || !data.success) {
        setStreamError(data.message || `Request failed with status ${res.status}`);
      } else {
        setStreamData(data);
        if (data.results && data.results.length > 0) {
          // Always pick direct HLS stream first for native ad-free playback with multi-audio
          const hlsServer = data.results.find((s: any) => s.type === 'hls');
          setSelectedServer(hlsServer || data.results[0]);
        }
      }
    } catch (err: any) {
      setStreamError(err.message || 'Network error fetching stream');
    } finally {
      setStreamLoading(false);
    }
  };

  const handleTestSaltStream = async () => {
    setSaltStreamLoading(true);
    setSaltStreamError(null);
    setSaltStreamResult(null);

    try {
      const res = await fetch(`/animesalt-stream?id=${encodeURIComponent(saltSlug.trim())}`);
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        setSaltStreamError(`Non-JSON response from /animesalt-stream (${res.status}): ${text.slice(0, 150)}`);
        return;
      }
      if (!res.ok || !data.success) {
        setSaltStreamError(data.message || `Failed with status ${res.status}`);
      } else {
        setSaltStreamResult(data);
        if (data.results && data.results.length > 0) {
          const hlsServer = data.results.find((s: any) => s.type === 'hls');
          setSelectedServer(hlsServer || data.results[0]);
        }
      }
    } catch (err: any) {
      setSaltStreamError(err.message || 'Error fetching AnimeSalt stream');
    } finally {
      setSaltStreamLoading(false);
    }
  };

  const handleTestSaltHtml = async () => {
    setSaltHtmlLoading(true);
    setSaltHtmlError(null);
    setSaltHtmlResult(null);

    try {
      const clean = saltSlug.trim().replace(/^\/+|\/+$/g, '');
      const path = clean.startsWith('episode/') ? clean : `episode/${clean}/`;
      const res = await fetch(`/animesalt/${path}`);
      const text = await res.text();
      setSaltHtmlResult({
        status: res.status,
        length: text.length,
        snippet: text.slice(0, 1500) + (text.length > 1500 ? '\n...[truncated]' : ''),
      });
    } catch (err: any) {
      setSaltHtmlError(err.message || 'Error proxying AnimeSalt HTML');
    } finally {
      setSaltHtmlLoading(false);
    }
  };

  const handleSearchAnimaHd = async () => {
    if (!animaSearchQuery.trim()) return;
    setAnimaSearching(true);
    try {
      const res = await fetch(`/animahd-search?q=${encodeURIComponent(animaSearchQuery.trim())}`);
      const data = await res.json();
      setAnimaSearchResults(data.results || []);
    } catch {
      // ignore
    } finally {
      setAnimaSearching(false);
    }
  };

  const handleFetchAnimaHdEpisodes = async (slug: string) => {
    setAnimaSelectedSlug(slug);
    setAnimaEpisodesLoading(true);
    setAnimaEpisodeError(null);
    try {
      const res = await fetch(`/animahd-episodes?slug=${encodeURIComponent(slug)}`);
      const json = await res.json();
      if (json.success) {
        setAnimaEpisodesData(json.data);
      } else {
        setAnimaEpisodeError(json.message || 'Failed to load episodes');
      }
    } catch (err: any) {
      setAnimaEpisodeError(err.message || 'Network error fetching episodes');
    } finally {
      setAnimaEpisodesLoading(false);
    }
  };

  const handlePlayAnimaHdEpisode = (ep: any) => {
    const serverObj: any = {
      server: `AnimaHD Google Drive`,
      label: `AnimaHD · ${ep.title || 'Episode'} (1080p Cloud Player)`,
      embed: `https://drive.google.com/file/d/${ep.fileId}/preview`,
      url: `/gdrive-stream?id=${encodeURIComponent(ep.fileId)}`,
      directStreamUrl: `/gdrive-stream?id=${encodeURIComponent(ep.fileId)}`,
      fileId: ep.fileId,
      type: 'embed',
      source: 'AnimaHD',
      audioLanguage: 'hi',
      languageLabel: '🇮🇳 Hindi Dub (1080p HD)',
      adFree: true,
      fileSize: ep.size,
    };
    setSelectedServer(serverObj);
    setActiveTab('stream');
  };

  const handlePlayDirectGdrive = (inputVal?: string) => {
    const raw = (inputVal || directGdriveInput || '').trim();
    if (!raw) return;
    const urlMatch = raw.match(/(?:file\/d\/|id=|\/d\/)([a-zA-Z0-9_-]{25,50})/);
    const fileId = urlMatch ? urlMatch[1] : raw;
    const serverObj: any = {
      server: `Google Drive 1080p`,
      label: `Google Drive · ⚡ Direct Cloud Player (Official Drive Embed)`,
      embed: `https://drive.google.com/file/d/${fileId}/preview`,
      url: `/gdrive-stream?id=${encodeURIComponent(fileId)}`,
      directStreamUrl: `/gdrive-stream?id=${encodeURIComponent(fileId)}`,
      fileId,
      type: 'embed',
      source: 'GoogleDrive',
      audioLanguage: 'hi',
      languageLabel: '🇮🇳 Google Drive 1080p HD',
      adFree: true,
    };
    setSelectedServer(serverObj);
    setActiveTab('stream');
  };

  const handleTestCatalog = async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    setCatalogResult(null);

    try {
      const res = await fetch(`/catalog?kind=${catalogKind}&page=${catalogPage}`);
      const text = await res.text();
      const headersObj: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headersObj[k] = v;
      });

      setCatalogResult({
        status: res.status,
        headers: headersObj,
        textSnippet: text.slice(0, 1500) + (text.length > 1500 ? '\n...[truncated]' : ''),
      });
    } catch (err: any) {
      setCatalogError(err.message || 'Error fetching catalog');
    } finally {
      setCatalogLoading(false);
    }
  };

  const handleTestCors = async () => {
    setCorsLoading(true);
    setCorsError(null);
    setCorsResult(null);

    try {
      const res = await fetch(`/?url=${encodeURIComponent(corsUrl.trim())}`);
      const ct = res.headers.get('content-type') || '';
      let snippet = '';
      if (ct.includes('image')) {
        snippet = `[Binary Image Data, Content-Type: ${ct}, Size: ${res.headers.get('content-length')} bytes]`;
      } else {
        const text = await res.text();
        snippet = text.slice(0, 1500) + (text.length > 1500 ? '\n...[truncated]' : '');
      }
      setCorsResult({
        status: res.status,
        contentType: ct,
        snippet,
      });
    } catch (err: any) {
      setCorsError(err.message || 'Error proxying URL');
    } finally {
      setCorsLoading(false);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const currentBackendUrl = typeof window !== 'undefined' ? window.location.origin : 'https://your-backend-proxy.onrender.com';

  return (
    <div className="min-h-screen bg-[#050807] text-[#f5f7f6] flex flex-col font-sans selection:bg-[#22c55e] selection:text-black">
      {/* Top Navbar with Exact Logo & Frontend Font Color */}
      <header className="border-b border-[#141e17] bg-[#050807]/90 backdrop-blur sticky top-0 z-50 px-4 lg:px-8 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src="/hindi-anime-logo.png"
            alt="Hindi Anime"
            className="h-7 sm:h-8 w-auto object-contain"
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-tight text-white">Streaming Proxy & API Engine</span>
              <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-[#131f18] text-[#22c55e] border border-[#1f3526] flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse"></span>
                v2.0.0 Online
              </span>
            </div>
            <p className="text-[11px] text-gray-400">High-performance stream resolver & proxy for hindi-anime.com Next.js frontend</p>
          </div>
        </div>

        {/* System Stats Pill */}
        <div className="hidden md:flex items-center gap-3 text-xs">
          <div className="bg-[#0a0f0c] border border-[#141e17] rounded-xl px-3 py-1.5 flex items-center gap-3 text-gray-300">
            <div className="flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-[#22c55e]" />
              <span>Uptime: <strong className="text-white">{health?.uptime ? `${Math.floor(health.uptime / 60)}m` : '0m'}</strong></span>
            </div>
            <div className="w-px h-3 bg-[#1e2e22]"></div>
            <div className="flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-amber-400" />
              <span>Cache: <strong className="text-white">{health?.cache?.size ?? 0} items</strong></span>
            </div>
            <div className="w-px h-3 bg-[#1e2e22]"></div>
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#22c55e]" />
              <span>CORS: <strong className="text-white">Active</strong></span>
            </div>
          </div>

          <button
            onClick={fetchHealth}
            disabled={loadingHealth}
            className="p-1.5 rounded-xl border border-[#141e17] hover:border-[#22c55e] bg-[#0a0f0c] hover:bg-[#131f18] text-gray-400 hover:text-[#22c55e] transition"
            title="Refresh Health Status"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingHealth ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-8 flex flex-col gap-6">
        {/* Banner Alert: Zero Cloudflare Limits */}
        <div className="rounded-2xl p-4 bg-gradient-to-r from-[#0d1612] via-[#09110d] to-[#050807] border border-[#18281e] flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#22c55e]/10 border border-[#22c55e]/20 text-[#22c55e] shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Full Cloudflare Replacement — No 100k/day Request Limit</h2>
              <p className="text-xs text-gray-300">
                Direct HLS stream parsing, AnimeSalt scraper, M3U8 chunk proxying, in-memory TTL caching, and Vercel CORS support.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('nextjs')}
              className="text-xs px-3.5 py-1.5 rounded-xl bg-[#22c55e] hover:bg-[#16a34a] text-black font-extrabold transition flex items-center gap-1.5 shadow-[0_0_15px_rgba(34,197,94,0.3)]"
            >
              <Code2 className="w-3.5 h-3.5" />
              Next.js Code
            </button>
            <button
              onClick={() => setActiveTab('deploy')}
              className="text-xs px-3.5 py-1.5 rounded-xl bg-[#0a0f0c] hover:bg-[#131f18] text-gray-300 font-medium border border-[#141e17] transition flex items-center gap-1.5"
            >
              <Globe className="w-3.5 h-3.5" />
              Deploy Free
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#141e17] gap-1 overflow-x-auto pb-px">
          {[
            { id: 'stream', label: 'Stream Resolver & Player', icon: Play },
            { id: 'animahd', label: '🎬 AnimaHD Reverse Report & GDrive', icon: Film },
            { id: 'animesalt', label: 'AnimeSalt Direct Streams & HTML', icon: Sparkles },
            { id: 'catalog', label: 'AnimeSalt Catalog', icon: Layers },
            { id: 'cors', label: 'CORS & Media Proxy', icon: Globe },
            { id: 'nextjs', label: 'Next.js Integration Guide', icon: Code2 },
            { id: 'deploy', label: 'Free Deployment Guide', icon: Layers },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition border-b-2 whitespace-nowrap ${
                  isActive
                    ? 'border-[#22c55e] text-[#22c55e] bg-[#22c55e]/10'
                    : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-[#0a0f0c]/50'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* TAB 1: Stream Resolver & Player */}
        {activeTab === 'stream' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Form & Server Slot List */}
            <div className="lg:col-span-5 flex flex-col gap-4">
              <div className="bg-[#0a0f0c] border border-[#141e17] rounded-2xl p-5 shadow-xl flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                    <Zap className="w-4 h-4 text-[#22c55e]" />
                    Test /stream Endpoint
                  </h3>
                  <span className="text-[11px] text-slate-400">9 Server Slots</span>
                </div>

                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Anime ID or Slug</label>
                    <input
                      type="text"
                      value={animeId}
                      onChange={(e) => setAnimeId(e.target.value)}
                      placeholder="e.g. solo-leveling or jujutsu-kaisen"
                      className="w-full bg-[#050807] border border-[#141e17] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-[#22c55e] transition"
                    />
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {['solo-leveling', 'jujutsu-kaisen', 'naruto-shippuden', 'demon-slayer', 'attack-on-titan'].map((slug) => (
                        <button
                          key={slug}
                          onClick={() => setAnimeId(slug)}
                          className="text-[10px] px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                        >
                          {slug}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">Season</label>
                      <input
                        type="number"
                        min="1"
                        value={season}
                        onChange={(e) => setSeason(e.target.value)}
                        className="w-full bg-[#050807] border border-[#141e17] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#22c55e] transition"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">Episode</label>
                      <input
                        type="number"
                        min="1"
                        value={episode}
                        onChange={(e) => setEpisode(e.target.value)}
                        className="w-full bg-[#050807] border border-[#141e17] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#22c55e] transition"
                      />
                    </div>
                  </div>

                  {/* Source Provider Selector */}
                  <div>
                    <label className="text-xs text-slate-400 mb-1.5 flex items-center justify-between">
                      <span>Source Provider</span>
                      <span className="text-[10px] text-emerald-400 font-medium">
                        {sourceFilter === 'all'
                          ? '⚡ Auto-Fallback Active'
                          : sourceFilter === 'animahd'
                          ? '🎬 AnimaHD 1080p Only'
                          : sourceFilter === 'animesalt'
                          ? '🧂 AnimeSalt Only'
                          : '🔌 Toko API Only'}
                      </span>
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-[#050807] rounded-xl border border-[#141e17]">
                      {[
                        { id: 'all', label: '⚡ All (Smart)' },
                        { id: 'animahd', label: '🎬 AnimaHD' },
                        { id: 'animesalt', label: '🧂 AnimeSalt' },
                        { id: 'toko', label: '🔌 Toko API' },
                      ].map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSourceFilter(s.id as any)}
                          className={`py-1.5 rounded-lg text-[11px] font-medium transition ${
                            sourceFilter === s.id
                              ? 'bg-[#22c55e] text-black font-bold shadow-sm'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-[#0a0f0c]'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pt-0.5">
                    <button
                      type="button"
                      onClick={() => setShowSecretField(!showSecretField)}
                      className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center justify-between w-full transition py-1"
                    >
                      <span className="flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-[#22c55e]" />
                        <span>Auth Secret: <strong>{health?.secretAuthEnabled ? 'Configured in Backend' : 'Open Access'}</strong></span>
                      </span>
                      <span className="text-[10px] text-[#22c55e] hover:underline">
                        {showSecretField ? 'Close' : 'Set Custom Secret'}
                      </span>
                    </button>
                    {showSecretField && (
                      <div className="mt-1.5 p-2.5 rounded-xl bg-[#050807] border border-[#141e17] flex flex-col gap-1.5">
                        <label className="text-[10px] text-slate-400 block">
                          Proxy Secret (Sent via <code>x-hindianime-proxy-secret</code> header)
                        </label>
                        <input
                          type="text"
                          value={customSecret}
                          onChange={(e) => setCustomSecret(e.target.value)}
                          placeholder="Leave empty for auto-authorized dashboard mode"
                          className="w-full bg-[#0a0f0c] border border-[#1a291f] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#22c55e] font-mono"
                        />
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleTestStream}
                    disabled={streamLoading || !animeId}
                    className="mt-1 w-full py-2.5 rounded-xl bg-gradient-to-r bg-[#22c55e] hover:bg-[#16a34a] text-white font-medium text-xs shadow-lg shadow-[0_0_20px_rgba(34,197,94,0.3)] transition disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {streamLoading ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Resolving Toko + AnimeSalt Sources...
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current" />
                        Resolve Streams (GET /stream)
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Resolved Server List */}
              {streamError && (
                <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/40 text-xs text-rose-300 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-[#22c55e] shrink-0 mt-0.5" />
                  <div>
                    <strong className="block text-rose-200">Stream Resolution Error</strong>
                    {streamError}
                  </div>
                </div>
              )}

              {streamData && (
                <div className="bg-[#0a0f0c] border border-[#141e17] rounded-2xl p-4 shadow-xl flex flex-col gap-3">
                  <div className="flex items-center justify-between border-b border-[#141e17] pb-2">
                    <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      {streamData.results.length} Available Servers Found
                    </span>
                    <button
                      onClick={() => copyToClipboard(JSON.stringify(streamData, null, 2), 'rawStream')}
                      className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" />
                      {copiedKey === 'rawStream' ? 'Copied!' : 'Copy JSON'}
                    </button>
                  </div>

                  <div className="flex flex-col gap-2 max-h-[380px] overflow-y-auto pr-1">
                    {streamData.results.map((server, idx) => {
                      const isSelected = selectedServer?.server === server.server;
                      return (
                        <button
                          key={idx}
                          onClick={() => setSelectedServer(server)}
                          className={`text-left p-3 rounded-xl border transition flex items-center justify-between text-xs ${
                            isSelected
                              ? 'bg-[#22c55e]/10 border-[#22c55e]/40 text-white'
                              : 'bg-[#050807]/50 border-[#141e17] hover:bg-[#131f18]/50 text-slate-300'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <div className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-[10px] ${
                              isSelected ? 'bg-[#22c55e] text-black font-bold' : 'bg-slate-800 text-slate-400'
                            }`}>
                              {idx + 1}
                            </div>
                            <div>
                              <div className="font-semibold flex items-center gap-1.5">
                                {server.label}
                                {server.type === 'hls' && (
                                  <span className="text-[9px] px-1.5 py-0.2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded">
                                    Direct HLS
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-slate-400 block truncate max-w-[220px]">
                                {server.type === 'embed' ? 'Iframe Embed' : 'Proxied Video Stream'}
                              </span>
                            </div>
                          </div>
                          <ChevronRight className={`w-4 h-4 ${isSelected ? 'text-[#22c55e]' : 'text-slate-600'}`} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Player & Stream Inspector */}
            <div className="lg:col-span-7 flex flex-col gap-4">
              <div className="bg-[#0a0f0c] border border-[#141e17] rounded-2xl p-5 shadow-xl flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Play className="w-4 h-4 text-emerald-400" />
                    <h3 className="font-semibold text-sm text-white">Live Stream Preview</h3>
                  </div>
                  {selectedServer && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-[#1a291f]">
                      {selectedServer.server} ({selectedServer.type})
                    </span>
                  )}
                </div>

                {/* Player Area */}
                <div className="relative aspect-video w-full rounded-2xl bg-black border border-[#141e17] overflow-hidden flex items-center justify-center shadow-2xl">
                  {selectedServer ? (
                    selectedServer.type === 'embed' ? (
                      <div className="relative w-full h-full group">
                        <iframe
                          src={selectedServer.embed}
                          className="w-full h-full border-0"
                          allowFullScreen
                          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                          referrerPolicy="no-referrer-when-downgrade"
                          title="Stream Embed"
                        />
                        {/* Overlay with Website Logo (No Background) + Season and Episode on Left */}
                        <div className="absolute top-0 left-0 right-0 p-3 sm:p-4 bg-gradient-to-b from-black/90 via-black/40 to-transparent flex items-center justify-between pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">
                          {/* Left: Logo + Season/Episode Badge */}
                          <div className="flex items-center gap-2 sm:gap-3 pointer-events-auto">
                            <img
                              src="/hindi-anime-logo-transparent.png"
                              alt="Hindi Anime"
                              className="h-6 sm:h-7 w-auto object-contain bg-transparent drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] filter"
                            />
                            {(season !== undefined || episode !== undefined) && (
                              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-[#22c55e]/40 text-[11px] sm:text-xs font-semibold text-white shadow-lg">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse"></span>
                                <span>
                                  {season ? `S${String(season).padStart(2, '0')}` : 'S01'}{' '}
                                  {episode ? `E${String(episode).padStart(2, '0')}` : 'E01'}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Right: Anime Title */}
                          <div className="flex items-center gap-2 sm:gap-3 pointer-events-auto">
                            <span className="text-xs font-semibold text-white drop-shadow truncate max-w-[200px]">
                              {animeId}
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <HindiAnimePlayer
                        src={selectedServer.hlsProxyUrl || selectedServer.url || selectedServer.embed}
                        animeTitle={animeId}
                        season={season}
                        episode={episode}
                        logoUrl="/hindi-anime-logo-transparent.png"
                        autoPlay={true}
                        className="w-full h-full"
                      />
                    )
                  ) : (
                    <div className="text-center p-6 text-slate-500 flex flex-col items-center gap-2">
                      <Play className="w-10 h-10 stroke-1 opacity-50" />
                      <p className="text-xs">Select a server from the left or click "Resolve Streams" to play</p>
                    </div>
                  )}
                </div>

                {/* Embed Note Banner & Direct HLS Switcher */}
                {selectedServer?.type === 'embed' && (
                  <div className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-3 ${
                    selectedServer.source === 'GoogleDrive' || selectedServer.source === 'AnimaHD'
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200/90'
                      : 'bg-amber-500/10 border-amber-500/20 text-amber-200/90'
                  }`}>
                    <div className="flex items-center gap-2">
                      {selectedServer.source === 'GoogleDrive' || selectedServer.source === 'AnimaHD' ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span>
                            <strong>⚡ Google Drive 1080p Cloud Player Active:</strong> Transcodes Matroska (.mkv with HEVC / multi-audio) smoothly in-browser without third-party ads or popups.
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                          <span>
                            Playing external mirror embed. For an ad-free experience without popups or ad-blocker conflicts, switch to the direct HLS stream.
                          </span>
                        </>
                      )}
                    </div>
                    {streamData?.results?.find((s) => s.type === 'hls') && (
                      <button
                        onClick={() => {
                          const hls = streamData.results.find((s) => s.type === 'hls');
                          if (hls) setSelectedServer(hls);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-[#22c55e] hover:bg-[#16a34a] text-black font-extrabold font-medium text-[11px] shrink-0 transition flex items-center gap-1 shadow"
                      >
                        <Zap className="w-3 h-3" />
                        Switch to Direct HLS
                      </button>
                    )}
                  </div>
                )}

                {/* Audio Track Switcher for Multi-Audio Streams */}
                {selectedServer?.type === 'hls' && audioTracks.length > 1 && (
                  <div className="flex items-center gap-2 bg-[#050807]/80 border border-[#141e17] rounded-xl px-3 py-2 text-xs">
                    <span className="text-slate-400 font-medium shrink-0">Switch Audio Language:</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {audioTracks.map((track) => (
                        <button
                          key={track.id}
                          onClick={() => {
                            if (hlsRef.current) {
                              hlsRef.current.audioTrack = track.id;
                            }
                            setCurrentAudioTrack(track.id);
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
                            currentAudioTrack === track.id
                              ? 'bg-[#22c55e] text-black font-bold shadow-sm'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                          }`}
                        >
                          {track.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {playerError && (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{playerError}</span>
                  </div>
                )}

                {/* Server Details & Copyable URL */}
                {selectedServer && (
                  <div className="flex flex-col gap-3 bg-[#050807]/70 border border-[#141e17] rounded-xl p-3.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 font-medium">Server URL for Next.js Player:</span>
                      <button
                        onClick={() => copyToClipboard(selectedServer.url || selectedServer.embed, 'streamUrl')}
                        className="text-[11px] text-[#22c55e] hover:text-rose-300 flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3" />
                        {copiedKey === 'streamUrl' ? 'Copied to Clipboard!' : 'Copy Stream URL'}
                      </button>
                    </div>
                    <code className="bg-[#0a0f0c] border border-[#141e17] p-2 rounded-lg text-slate-300 font-mono text-[11px] break-all select-all">
                      {selectedServer.url || selectedServer.embed}
                    </code>

                    {selectedServer.hlsProxyUrl && (
                      <div className="flex items-center gap-2 text-[11px] text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 px-2.5 py-1.5 rounded-lg">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>HLS manifest rewritten with reverse proxy URLs so browser plays with no CORS/Referer block.</span>
                      </div>
                    )}

                    {(selectedServer.directStreamUrl || selectedServer.fileId) && (
                      <div className="flex flex-col gap-2 p-3 bg-[#0a0f0c] border border-[#141e17] rounded-xl text-xs mt-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-white flex items-center gap-1.5">
                            <Film className="w-3.5 h-3.5 text-[#22c55e]" />
                            Direct Video Stream & Download (MKV/HEVC)
                          </span>
                          <span className="text-[10px] text-emerald-400 font-mono">
                            {selectedServer.fileSize || '1080p Original'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          Raw stream proxied via <code>/gdrive-stream</code> with full HTTP 206 Range support and inline headers. Use directly in VLC, MPV, Infuse, PotPlayer, or download locally:
                        </p>
                        <div className="flex items-center gap-2 flex-wrap pt-0.5">
                          <a
                            href={`${selectedServer.directStreamUrl || `/gdrive-stream?id=${selectedServer.fileId}`}${
                              (selectedServer.directStreamUrl || '').includes('?') ? '&download=1' : '?download=1'
                            }`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 rounded-lg bg-[#22c55e] hover:bg-[#16a34a] text-black font-extrabold font-medium text-xs flex items-center gap-1.5 transition shadow"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download Episode File (.mkv)
                          </a>
                          <button
                            onClick={() =>
                              copyToClipboard(
                                `${window.location.origin}${selectedServer.directStreamUrl || `/gdrive-stream?id=${selectedServer.fileId}`}`,
                                'gdriveDirect'
                              )
                            }
                            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center gap-1.5 transition border border-[#1a291f]"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            {copiedKey === 'gdriveDirect' ? 'Copied Direct Stream URL!' : 'Copy Direct Stream URL'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Endpoint Reference Box */}
              <div className="bg-[#050807]/90 border border-[#141e17]/70 rounded-2xl p-4 text-xs flex flex-col gap-2">
                <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-slate-400" />
                  Direct cURL / HTTP GET Command
                </span>
                <code className="bg-[#050807] p-2.5 rounded-lg border border-[#141e17] text-slate-300 font-mono text-[11px] overflow-x-auto whitespace-pre">
                  curl -s "{currentBackendUrl}/stream?id={animeId}&season={season}&ep={episode}"
                </code>
              </div>
            </div>
          </div>
        )}

        {/* TAB 1.5: AnimaHD Reverse Engineering Report & GDrive Explorer */}
        {activeTab === 'animahd' && (
          <div className="flex flex-col gap-6">
            {/* Header & Overview */}
            <div className="bg-[#0a0f0c] border border-[#141e17] rounded-2xl p-5 shadow-xl flex flex-col gap-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                    <Film className="w-4 h-4 text-[#22c55e]" />
                    AnimaHD (animahd.com) Technical Reverse Engineering & Stream Extraction Report
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Complete reverse engineering breakdown of how animahd.com structures its backend, media storage, open APIs, and streaming pipeline — with direct Google Drive 1080p stream resolution.
                  </p>
                </div>
                <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium shrink-0">
                  Open REST API & Google Drive Integration Active
                </span>
              </div>

              {/* 4 Architectural Inspection Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
                {/* Card 1: Hosting & Edge */}
                <div className="p-3.5 rounded-xl bg-[#050807]/80 border border-[#141e17] flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-[#22c55e] font-semibold text-xs">
                    <Server className="w-4 h-4" />
                    Hosting & Infrastructure
                  </div>
                  <ul className="text-[11px] text-slate-300 space-y-1.5 font-mono">
                    <li><strong className="text-white">CDN / Edge:</strong> Cloudflare (NRT / Tokyo Ray)</li>
                    <li><strong className="text-white">Backend Origin:</strong> PHP 8.3.31 on Linux</li>
                    <li><strong className="text-white">Caching:</strong> WP Cloudflare Super Page Cache</li>
                    <li><strong className="text-white">DNS / SSL:</strong> Cloudflare Universal Edge SSL</li>
                  </ul>
                </div>

                {/* Card 2: CMS & Catalog API */}
                <div className="p-3.5 rounded-xl bg-[#050807]/80 border border-[#141e17] flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-[#22c55e] font-semibold text-xs">
                    <Code2 className="w-4 h-4" />
                    CMS & Data Architecture
                  </div>
                  <ul className="text-[11px] text-slate-300 space-y-1.5 font-mono">
                    <li><strong className="text-white">Platform:</strong> WordPress (Vodi Theme)</li>
                    <li><strong className="text-white">Catalog API:</strong> Open WP REST API</li>
                    <li><strong className="text-white">Endpoint:</strong> /wp-json/wp/v2/posts</li>
                    <li><strong className="text-white">Metadata:</strong> MyAnimeList cached scores/tags</li>
                  </ul>
                </div>

                {/* Card 3: Video Storage */}
                <div className="p-3.5 rounded-xl bg-[#050807]/80 border border-[#141e17] flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-[#22c55e] font-semibold text-xs">
                    <Layers className="w-4 h-4" />
                    Video Storage & Pipeline
                  </div>
                  <ul className="text-[11px] text-slate-300 space-y-1.5 font-mono">
                    <li><strong className="text-white">Video Host:</strong> Google Drive (.mkv / .mp4)</li>
                    <li><strong className="text-white">Resolution:</strong> 1080p Multi-Audio HD</li>
                    <li><strong className="text-white">Episode Key:</strong> data-fileid in HTML</li>
                    <li><strong className="text-white">Our Resolver:</strong> /gdrive-stream with 206 range</li>
                  </ul>
                </div>

                {/* Card 4: Monetization */}
                <div className="p-3.5 rounded-xl bg-[#050807]/80 border border-[#141e17] flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-[#22c55e] font-semibold text-xs">
                    <Zap className="w-4 h-4" />
                    Monetization & Ads
                  </div>
                  <ul className="text-[11px] text-slate-300 space-y-1.5 font-mono">
                    <li><strong className="text-white">Ad Network:</strong> Monetag (PropellerAds)</li>
                    <li><strong className="text-white">Tag Script:</strong> https://al5sm.com/tag.min.js</li>
                    <li><strong className="text-white">Zone ID:</strong> 11912591 (Popunder / Vignette)</li>
                    <li><strong className="text-white">Security:</strong> Base64 ?sec_route=1 link obfuscation</li>
                  </ul>
                </div>
              </div>

              {/* Upstream Status Alert Note */}
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200/90 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-white block font-semibold mb-0.5">Discovered Upstream Flaw on animahd.com:</strong>
                  AnimaHD's web player redirects viewers to <code>https://watchyourfavoriteanimeepisodes.animahd.online/?id=...</code>, which currently returns <strong>HTTP 404 (Offline)</strong>.
                  Our backend bypasses this entirely: we extract the raw Google Drive <code>fileId</code>, resolve the Google Drive confirmation token & session cookie, and stream the 1080p video directly with byte-range seek support via <code>/gdrive-stream</code>!
                </div>
              </div>
            </div>

            {/* Direct Google Drive Player (Zero Scraping - Instant 1080p Playback) */}
            <div className="bg-[#0a0f0c] border border-[#141e17] rounded-2xl p-5 shadow-xl flex flex-col gap-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                    <Zap className="w-4 h-4 text-emerald-400" />
                    Direct Google Drive Video Player (Zero Scraping Needed)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Bypasses all web scraping entirely. Paste any Google Drive File ID or sharing link (e.g. from AnimaHD, GDrive folders, or your own storage) to stream 1080p video directly via the official Drive Cloud Player.
                  </p>
                </div>
                <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium shrink-0">
                  ⚡ 100% Direct Drive Stream
                </span>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={directGdriveInput}
                    onChange={(e) => setDirectGdriveInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handlePlayDirectGdrive()}
                    placeholder="Enter Google Drive File ID or URL (e.g. 1-3GTx0knzb1eSV0-KGfK3YOVu-6pzhDH or https://drive.google.com/file/d/...)"
                    className="flex-1 bg-[#050807] border border-[#141e17] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono transition"
                  />
                  <button
                    onClick={() => handlePlayDirectGdrive()}
                    disabled={!directGdriveInput.trim()}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-medium text-xs shadow-md shadow-emerald-950/40 transition disabled:opacity-50 flex items-center gap-2 shrink-0"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Play Directly via Google Drive
                  </button>
                </div>

                <div className="flex gap-1.5 flex-wrap items-center">
                  <span className="text-[10px] text-slate-500">Preset Google Drive Anime IDs:</span>
                  {[
                    { label: 'Slime S01E01', id: '1-3GTx0knzb1eSV0-KGfK3YOVu-6pzhDH' },
                    { label: 'Slime S01E02', id: '1-0TuTWI9h878f4eD4g9GbNZHHT4_ZG17' },
                    { label: 'Slime S01E03', id: '1B8UcQT0PJFMLjeSfWbFgyMIbBm_ccMtk' },
                    { label: 'Buddy Daddies E01', id: '10Ew3BlFnGYRg9rfnQays15lHfvGepokg' },
                    { label: 'Elusive Samurai E01', id: '117VGVn8mXka47hq7jvUYsqJdYIJ4akvX' },
                    { label: 'Re:Zero S2 E01', id: '19tDiILwLmIb2wn81IZAUiSYtAgXlm_b1' },
                  ].map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => {
                        setDirectGdriveInput(preset.id);
                        handlePlayDirectGdrive(preset.id);
                      }}
                      className="text-[10px] px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex items-center gap-1 font-mono"
                    >
                      <span className="text-emerald-400">⚡</span>
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Interactive AnimaHD Search & Live Browser */}
            <div className="bg-[#0a0f0c] border border-[#141e17] rounded-2xl p-5 shadow-xl flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                    <Film className="w-4 h-4 text-[#22c55e]" />
                    Query AnimaHD Live Catalog (/animahd-search & /animahd-episodes)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Live query the WordPress REST API on animahd.com, inspect Google Drive file IDs, and stream episodes directly.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={animaSearchQuery}
                    onChange={(e) => setAnimaSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearchAnimaHd()}
                    placeholder="Search title (e.g. slime, buddy daddies, samurai, rezero, blue box)..."
                    className="flex-1 bg-[#050807] border border-[#141e17] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-[#22c55e] font-mono transition"
                  />
                  <button
                    onClick={handleSearchAnimaHd}
                    disabled={animaSearching || !animaSearchQuery.trim()}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r bg-[#22c55e] hover:bg-[#16a34a] text-white font-medium text-xs shadow-md shadow-[0_0_20px_rgba(34,197,94,0.3)] transition disabled:opacity-50 flex items-center gap-2 shrink-0"
                  >
                    {animaSearching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Film className="w-3.5 h-3.5" />}
                    Search AnimaHD
                  </button>
                </div>

                {/* Quick anime pills */}
                <div className="flex gap-1.5 flex-wrap items-center">
                  <span className="text-[10px] text-slate-500">Quick AnimaHD Shows:</span>
                  {[
                    { label: 'Reincarnated as a Slime', slug: 'that-time-i-got-reincarnated-as-a-slime' },
                    { label: 'Buddy Daddies', slug: 'buddy-daddies-season-1-multi-audio-hindi' },
                    { label: 'The Elusive Samurai', slug: 'the-elusive-samurai' },
                    { label: 'Re:Zero Season 2', slug: 'rezero-starting-life-in-another-world-2' },
                    { label: 'Blue Box', slug: 'blue-box' },
                    { label: 'Overgeared', slug: 'overgeared-season-1-multi-audio-hindi' },
                  ].map((show) => (
                    <button
                      key={show.slug}
                      onClick={() => {
                        setAnimaSelectedSlug(show.slug);
                        handleFetchAnimaHdEpisodes(show.slug);
                      }}
                      className="text-[10px] px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex items-center gap-1"
                    >
                      <span>🎬</span>
                      {show.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search Results */}
              {animaSearchResults.length > 0 && (
                <div className="flex flex-col gap-2 pt-2 border-t border-[#141e17]">
                  <span className="text-xs font-semibold text-slate-300">
                    Search Results ({animaSearchResults.length} found on animahd.com):
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                    {animaSearchResults.map((post) => (
                      <div
                        key={post.id}
                        onClick={() => handleFetchAnimaHdEpisodes(post.slug)}
                        className="p-2.5 rounded-xl bg-[#050807]/70 border border-[#141e17] hover:border-[#22c55e]/50 cursor-pointer transition flex gap-3 items-center"
                      >
                        {post.thumb ? (
                          <img
                            src={post.thumb}
                            alt={post.title}
                            className="w-12 h-16 object-cover rounded-lg shrink-0 bg-[#0a0f0c]"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="w-12 h-16 rounded-lg bg-[#0a0f0c] flex items-center justify-center shrink-0 text-slate-600 text-xs">
                            🎬
                          </div>
                        )}
                        <div className="overflow-hidden flex flex-col justify-center gap-0.5">
                          <strong className="text-xs text-white truncate block">{post.title}</strong>
                          <div className="flex items-center gap-1 text-[10px] text-slate-400">
                            {post.score && <span className="text-amber-400">⭐ {post.score}</span>}
                            <span>•</span>
                            <span>{post.season || 'S1'}</span>
                            {post.year && <span>({post.year})</span>}
                          </div>
                          <span className="text-[9px] text-[#22c55e] truncate font-mono">
                            slug: {post.slug}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Episode List & GDrive Stream Launcher */}
            {animaEpisodeError && (
              <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/40 text-xs text-rose-300 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-[#22c55e] shrink-0 mt-0.5" />
                <div>
                  <strong className="block text-rose-200">Episode Resolution Error</strong>
                  {animaEpisodeError}
                </div>
              </div>
            )}

            {animaEpisodesLoading && (
              <div className="p-8 rounded-2xl bg-[#0a0f0c]/50 border border-[#141e17] flex flex-col items-center justify-center gap-2 text-slate-400 text-xs">
                <RefreshCw className="w-5 h-5 animate-spin text-[#22c55e]" />
                <span>Scraping episode list and Google Drive file IDs from AnimaHD...</span>
              </div>
            )}

            {animaEpisodesData && (
              <div className="bg-[#0a0f0c] border border-[#141e17] rounded-2xl p-5 shadow-xl flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-[#141e17] pb-3 flex-wrap gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-white">
                      {animaEpisodesData.title || animaSelectedSlug}
                    </h4>
                    <span className="text-xs text-slate-400">
                      {animaEpisodesData.episodes?.length || 0} Episodes with Direct Google Drive 1080p Streams
                    </span>
                  </div>
                  <button
                    onClick={() => copyToClipboard(JSON.stringify(animaEpisodesData, null, 2), 'animaJson')}
                    className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-[#1a291f] flex items-center gap-1.5 transition"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {copiedKey === 'animaJson' ? 'Copied!' : 'Copy Episode JSON'}
                  </button>
                </div>

                {animaEpisodesData.synopsis && (
                  <p className="text-xs text-slate-400 leading-relaxed bg-[#050807]/50 p-3 rounded-xl border border-[#141e17]/60">
                    {animaEpisodesData.synopsis}
                  </p>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[500px] overflow-y-auto pr-1">
                  {animaEpisodesData.episodes?.map((ep: any, idx: number) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-xl bg-[#050807] border border-[#141e17] hover:border-[#22c55e]/30 flex flex-col justify-between gap-3 transition"
                    >
                      <div className="flex gap-3 items-center">
                        {ep.thumbnail ? (
                          <div className="w-24 aspect-video rounded-lg overflow-hidden bg-[#0a0f0c] shrink-0 relative">
                            <img
                              src={ep.thumbnail}
                              alt={ep.title}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                            {ep.duration && (
                              <span className="absolute bottom-1 right-1 px-1 py-0.2 bg-black/80 text-[9px] rounded font-mono text-white">
                                {ep.duration}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="w-24 aspect-video rounded-lg bg-[#0a0f0c] flex items-center justify-center shrink-0 text-xs text-slate-600">
                            1080p
                          </div>
                        )}
                        <div className="overflow-hidden">
                          <strong className="text-xs text-white block truncate mb-1">
                            {ep.title}
                          </strong>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
                            <span className="text-emerald-400 font-semibold">{ep.size}</span>
                            <span>•</span>
                            <span className="text-[#22c55e]">{ep.season}</span>
                          </div>
                          <span className="text-[9px] text-slate-500 font-mono truncate block mt-0.5">
                            GDrive ID: {ep.fileId}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-2 border-t border-[#141e17]/60 justify-between">
                        <button
                          onClick={() => handlePlayAnimaHdEpisode(ep)}
                          className="text-[11px] px-3 py-1.5 rounded-lg bg-[#22c55e] hover:bg-[#16a34a] text-black font-extrabold font-medium flex items-center gap-1.5 transition shadow"
                        >
                          <Play className="w-3 h-3 fill-current" />
                          Play 1080p Stream (/gdrive-stream)
                        </button>
                        <a
                          href={`https://drive.google.com/file/d/${ep.fileId}/view`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] px-2 py-1 rounded-lg bg-[#0a0f0c] hover:bg-[#131f18] text-slate-300 border border-[#141e17] flex items-center gap-1 transition"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Drive View
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: AnimeSalt Dedicated Streams & HTML Explorer */}
        {activeTab === 'animesalt' && (
          <div className="flex flex-col gap-6">
            <div className="bg-[#0a0f0c] border border-[#141e17] rounded-2xl p-5 shadow-xl flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#22c55e]" />
                    AnimeSalt Direct Stream Resolver & HTML Proxy
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Scrapes and proxies anime streams directly from AnimeSalt (animesalt.cx). Bypasses bot protections, parses AbyssPlayer multi-language embeds, and unlocks direct Multi-Audio HLS (Ravok MyStream).
                  </p>
                </div>
                <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium shrink-0">
                  Direct Integration Active
                </span>
              </div>

              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">AnimeSalt Episode Slug or ID</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={saltSlug}
                      onChange={(e) => setSaltSlug(e.target.value)}
                      placeholder="e.g. solo-leveling-1x1, naruto-1x1, or demon-slayer-1x1"
                      className="flex-1 bg-[#050807] border border-[#141e17] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-[#22c55e] font-mono transition"
                    />
                    <button
                      onClick={async () => {
                        await handleTestSaltStream();
                        setActiveTab('stream');
                      }}
                      disabled={saltStreamLoading || !saltSlug}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r bg-[#22c55e] hover:bg-[#16a34a] text-white font-medium text-xs shadow-md shadow-[0_0_20px_rgba(34,197,94,0.3)] transition disabled:opacity-50 flex items-center gap-2 shrink-0"
                    >
                      {saltStreamLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                      Play Direct Stream
                    </button>
                    <button
                      onClick={handleTestSaltStream}
                      disabled={saltStreamLoading || !saltSlug}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-[#1a291f] font-medium text-xs transition disabled:opacity-50 flex items-center gap-2 shrink-0"
                    >
                      {saltStreamLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Server className="w-3.5 h-3.5" />}
                      View All Mirrors (/animesalt-stream)
                    </button>
                    <button
                      onClick={handleTestSaltHtml}
                      disabled={saltHtmlLoading || !saltSlug}
                      className="px-3.5 py-2 rounded-xl bg-[#0a0f0c] hover:bg-[#131f18] text-slate-300 border border-[#141e17] font-medium text-xs transition disabled:opacity-50 flex items-center gap-2 shrink-0"
                    >
                      {saltHtmlLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
                      Proxy HTML
                    </button>
                  </div>
                  <div className="flex gap-1.5 mt-2 flex-wrap items-center">
                    <span className="text-[10px] text-slate-500">Quick Slugs:</span>
                    {[
                      'solo-leveling-1x1',
                      'naruto-1x1',
                      'demon-slayer-1x1',
                      'jujutsu-kaisen-1x1',
                      'one-piece-1x1',
                      'attack-on-titan-1x1',
                      'death-note-1x1',
                      'chainsaw-man-1x1',
                    ].map((slug) => (
                      <button
                        key={slug}
                        onClick={() => setSaltSlug(slug)}
                        className="text-[10px] px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                      >
                        {slug}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Salt Stream Extraction Results */}
            {saltStreamError && (
              <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/40 text-xs text-rose-300 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-[#22c55e] shrink-0 mt-0.5" />
                <div>
                  <strong className="block text-rose-200">AnimeSalt Stream Error</strong>
                  {saltStreamError}
                </div>
              </div>
            )}

            {saltStreamResult && (
              <div className="bg-[#0a0f0c] border border-[#141e17] rounded-2xl p-5 shadow-xl flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-[#141e17] pb-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-semibold text-white">
                      AnimeSalt Streams ({saltStreamResult.results?.length || 0} mirrors found)
                    </span>
                  </div>
                  <button
                    onClick={() => copyToClipboard(JSON.stringify(saltStreamResult, null, 2), 'saltStreamJson')}
                    className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-[#1a291f] flex items-center gap-1.5 transition"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {copiedKey === 'saltStreamJson' ? 'Copied!' : 'Copy JSON'}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {saltStreamResult.results?.map((item: any, idx: number) => {
                    const isDirect = item.type === 'hls';
                    return (
                      <div
                        key={idx}
                        className={`p-3.5 rounded-xl border flex flex-col justify-between gap-3 ${
                          isDirect
                            ? 'bg-rose-500/5 border-[#22c55e]/30 shadow-md shadow-rose-950/20'
                            : 'bg-[#050807] border-[#141e17]'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                              {item.label}
                            </span>
                            <span
                              className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-medium ${
                                isDirect
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {isDirect ? 'Direct HLS' : 'Embed'}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-400 font-mono block truncate">
                            {item.url || item.embed}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 pt-1 border-t border-[#141e17]/50">
                          <button
                            onClick={() => {
                              setSelectedServer(item);
                              setActiveTab('stream');
                            }}
                            className="text-[11px] px-3 py-1 rounded-lg bg-[#22c55e] hover:bg-[#16a34a] text-black font-extrabold font-medium flex items-center gap-1 transition"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            Play in Preview Player
                          </button>
                          {item.embed && (
                            <a
                              href={item.embed}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1 transition"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Open Link
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Salt Raw HTML Proxy Results */}
            {saltHtmlError && (
              <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/40 text-xs text-rose-300 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-[#22c55e] shrink-0 mt-0.5" />
                <div>
                  <strong className="block text-rose-200">AnimeSalt HTML Proxy Error</strong>
                  {saltHtmlError}
                </div>
              </div>
            )}

            {saltHtmlResult && (
              <div className="bg-[#0a0f0c] border border-[#141e17] rounded-2xl p-5 shadow-xl flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-[#141e17] pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded font-mono bg-emerald-500/20 text-emerald-300 font-bold">
                      HTTP {saltHtmlResult.status}
                    </span>
                    <span className="text-xs text-slate-300">
                      AnimeSalt Episode HTML ({saltHtmlResult.length.toLocaleString()} bytes)
                    </span>
                  </div>
                  <button
                    onClick={() => copyToClipboard(saltHtmlResult.snippet, 'saltHtmlSnippet')}
                    className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-[#1a291f] flex items-center gap-1.5 transition"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {copiedKey === 'saltHtmlSnippet' ? 'Copied!' : 'Copy Snippet'}
                  </button>
                </div>
                <pre className="p-3.5 rounded-xl bg-[#050807] border border-[#141e17] font-mono text-[11px] text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-72">
                  {saltHtmlResult.snippet}
                </pre>
              </div>
            )}

            {/* Quick Reference Box for Next.js Developers */}
            <div className="bg-[#050807]/90 border border-[#141e17]/70 rounded-2xl p-4 text-xs flex flex-col gap-2.5">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-[#22c55e]" />
                AnimeSalt Integration Endpoints for Next.js Frontend
              </span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] font-mono">
                <div className="p-2.5 rounded-xl bg-[#050807] border border-[#141e17] flex flex-col gap-1">
                  <span className="text-[#22c55e] font-bold">GET /animesalt-stream?id={saltSlug}</span>
                  <span className="text-slate-400 font-sans text-[11px]">
                    Returns all extracted AnimeSalt audio streams (Hindi, Tamil, Telugu, English, Japanese) with direct HLS proxy.
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-[#050807] border border-[#141e17] flex flex-col gap-1">
                  <span className="text-amber-400 font-bold">GET /animesalt/episode/{saltSlug}/</span>
                  <span className="text-slate-400 font-sans text-[11px]">
                    Proxies the raw AnimeSalt page with Anti-Bot headers and full CORS for custom scrapers.
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: AnimeSalt Catalog */}
        {activeTab === 'catalog' && (
          <div className="flex flex-col gap-6">
            <div className="bg-[#0a0f0c] border border-[#141e17] rounded-2xl p-5 shadow-xl flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                    <Film className="w-4 h-4 text-amber-400" />
                    AnimeSalt Catalog Crawler (/catalog)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Fetches AnimeSalt catalog with Anti-403 bypass, sitemap pagination parsing, and stale-if-error caching.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Catalog Kind</label>
                  <select
                    value={catalogKind}
                    onChange={(e) => setCatalogKind(e.target.value as any)}
                    className="w-full bg-[#050807] border border-[#141e17] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400 transition"
                  >
                    <option value="series">Series (TV Anime)</option>
                    <option value="movies">Movies</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Page Number</label>
                  <input
                    type="number"
                    min="1"
                    value={catalogPage}
                    onChange={(e) => setCatalogPage(e.target.value)}
                    className="w-full bg-[#050807] border border-[#141e17] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400 transition"
                  />
                </div>

                <button
                  onClick={handleTestCatalog}
                  disabled={catalogLoading}
                  className="py-2 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs shadow-lg shadow-amber-950/40 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {catalogLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                  Fetch Catalog Page
                </button>
              </div>

              {catalogError && (
                <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/40 text-xs text-rose-300">
                  {catalogError}
                </div>
              )}

              {catalogResult && (
                <div className="flex flex-col gap-3 mt-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                      HTTP {catalogResult.status} OK
                    </span>
                    <span className="text-xs text-slate-400">
                      Cache status: <strong>{catalogResult.headers['x-catalog-cache'] || 'fresh'}</strong>
                    </span>
                  </div>

                  <div className="bg-[#050807] border border-[#141e17] rounded-xl p-3 flex flex-col gap-2">
                    <span className="text-[11px] text-slate-400 font-semibold">Response Preview:</span>
                    <pre className="font-mono text-[11px] text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-80">
                      {catalogResult.textSnippet}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: General CORS & Media Proxy */}
        {activeTab === 'cors' && (
          <div className="flex flex-col gap-6">
            <div className="bg-[#0a0f0c] border border-[#141e17] rounded-2xl p-5 shadow-xl flex flex-col gap-4">
              <div>
                <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                  <Globe className="w-4 h-4 text-cyan-400" />
                  General Media & API CORS Proxy (/?url=...)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Sends requests with spoofed browser User-Agent, Referer, and Sec-Ch-Ua headers to bypass 403 blocks.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={corsUrl}
                  onChange={(e) => setCorsUrl(e.target.value)}
                  placeholder="https://animesalt.cx/ or CDN link"
                  className="flex-1 bg-[#050807] border border-[#141e17] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-400 transition"
                />
                <button
                  onClick={handleTestCors}
                  disabled={corsLoading || !corsUrl}
                  className="py-2 px-5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs shadow-lg shadow-cyan-950/40 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {corsLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                  Test Proxy
                </button>
              </div>

              {corsError && (
                <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/40 text-xs text-rose-300">
                  {corsError}
                </div>
              )}

              {corsResult && (
                <div className="flex flex-col gap-3 mt-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                      HTTP {corsResult.status} OK
                    </span>
                    <span className="text-xs text-slate-400">Content-Type: {corsResult.contentType}</span>
                  </div>

                  <div className="bg-[#050807] border border-[#141e17] rounded-xl p-3 flex flex-col gap-2">
                    <pre className="font-mono text-[11px] text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-80">
                      {corsResult.snippet}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: Next.js Integration Guide */}
        {activeTab === 'nextjs' && (
          <div className="flex flex-col gap-6">
            <div className="bg-[#0a0f0c] border border-[#141e17] rounded-2xl p-6 shadow-xl flex flex-col gap-5">
              <div>
                <h3 className="font-semibold text-base text-white flex items-center gap-2">
                  <Code2 className="w-5 h-5 text-[#22c55e]" />
                  Connect Your Vercel Next.js Frontend to This Backend
                </h3>
                <p className="text-xs text-slate-300 mt-1">
                  Because Vercel serverless IPs are blocked by AnimeSalt, your Next.js app sends requests to this proxy backend, which fetches and returns 200 OK cleanly.
                </p>
              </div>

              {/* Step 1: Environment variable */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200">1. In your Next.js project's .env.local:</span>
                  <button
                    onClick={() => copyToClipboard(`NEXT_PUBLIC_STREAM_PROXY_URL=${currentBackendUrl}`, 'envCopy')}
                    className="text-xs text-[#22c55e] hover:text-rose-300 flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" />
                    {copiedKey === 'envCopy' ? 'Copied!' : 'Copy Variable'}
                  </button>
                </div>
                <pre className="bg-[#050807] p-3 rounded-xl border border-[#141e17] font-mono text-xs text-emerald-400">
                  NEXT_PUBLIC_STREAM_PROXY_URL={currentBackendUrl}
                </pre>
              </div>

              {/* Step 2: Next.js Fetcher Code */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200">2. In your Next.js code (lib/streamService.ts):</span>
                  <button
                    onClick={() =>
                      copyToClipboard(
                        `// lib/streamService.ts
const PROXY_URL = process.env.NEXT_PUBLIC_STREAM_PROXY_URL || "${currentBackendUrl}";

export async function getAnimeStreams(id: string, season = 1, episode = 1) {
  const res = await fetch(\`\${PROXY_URL}/stream?id=\${encodeURIComponent(id)}&season=\${season}&ep=\${episode}\`);
  if (!res.ok) throw new Error("Failed to load stream");
  return res.json();
}

export async function getCatalog(kind: "series" | "movies" = "series", page = 1) {
  const res = await fetch(\`\${PROXY_URL}/catalog?kind=\${kind}&page=\${page}\`);
  return res.text();
}
`,
                        'codeSnippet'
                      )
                    }
                    className="text-xs text-[#22c55e] hover:text-rose-300 flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" />
                    {copiedKey === 'codeSnippet' ? 'Copied!' : 'Copy TypeScript Code'}
                  </button>
                </div>
                <pre className="bg-[#050807] p-4 rounded-xl border border-[#141e17] font-mono text-xs text-slate-300 overflow-x-auto whitespace-pre">
{`// lib/streamService.ts
const PROXY_URL = process.env.NEXT_PUBLIC_STREAM_PROXY_URL || "${currentBackendUrl}";

export async function getAnimeStreams(id: string, season = 1, episode = 1) {
  const res = await fetch(\`\${PROXY_URL}/stream?id=\${encodeURIComponent(id)}&season=\${season}&ep=\${episode}\`);
  if (!res.ok) throw new Error("Failed to load stream");
  return res.json();
}

export async function getCatalog(kind: "series" | "movies" = "series", page = 1) {
  const res = await fetch(\`\${PROXY_URL}/catalog?kind=\${kind}&page=\${page}\`);
  return res.text();
}`}
                </pre>
              </div>

              {/* Step 3: Frontend HindiAnimePlayer Component Usage */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200">
                    3. In your Next.js frontend (copy <code>src/components/HindiAnimePlayer.tsx</code> into your Next.js project):
                  </span>
                  <button
                    onClick={() =>
                      copyToClipboard(
                        `// In your Next.js page or component:
import HindiAnimePlayer from "@/components/HindiAnimePlayer";

export default function WatchEpisode({ anime, streamUrl, season, episode }) {
  return (
    <div className="w-full max-w-5xl mx-auto rounded-2xl overflow-hidden shadow-2xl">
      <HindiAnimePlayer
        src={streamUrl}
        animeTitle={anime.title}
        season={season}
        episode={episode}
        logoUrl="/hindi-anime-logo-transparent.png"
        autoPlay={true}
      />
    </div>
  );
}`,
                        'playerCodeSnippet'
                      )
                    }
                    className="text-xs text-[#22c55e] hover:text-rose-300 flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" />
                    {copiedKey === 'playerCodeSnippet' ? 'Copied!' : 'Copy Next.js Player Code'}
                  </button>
                </div>
                <pre className="bg-[#050807] p-4 rounded-xl border border-[#141e17] font-mono text-xs text-slate-300 overflow-x-auto whitespace-pre">
{`// In your Next.js page or watch component:
import HindiAnimePlayer from "@/components/HindiAnimePlayer";

export default function WatchEpisode({ anime, streamUrl, season, episode }) {
  return (
    <div className="w-full max-w-5xl mx-auto rounded-2xl overflow-hidden shadow-2xl">
      <HindiAnimePlayer
        src={streamUrl} // HLS stream URL from GET /stream
        animeTitle={anime.title}
        season={season}
        episode={episode}
        logoUrl="/hindi-anime-logo-transparent.png"
        autoPlay={true}
      />
    </div>
  );
}`}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: Free Deployment Guide */}
        {activeTab === 'deploy' && (
          <div className="flex flex-col gap-6">
            <div className="bg-[#0a0f0c] border border-[#141e17] rounded-2xl p-6 shadow-xl flex flex-col gap-5">
              <div>
                <h3 className="font-semibold text-base text-white flex items-center gap-2">
                  <Layers className="w-5 h-5 text-amber-400" />
                  Free Hosting With Zero 100k/day Request Limits
                </h3>
                <p className="text-xs text-slate-300 mt-1">
                  Cloudflare Workers caps free accounts at 100k requests/day (HLS video segments consume 100s per episode). Here is how to deploy this Node.js Express backend for free with unlimited requests:
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-[#050807]/70 border border-[#141e17] rounded-xl p-4 flex flex-col gap-2.5">
                  <div className="flex items-center gap-2 text-[#22c55e] font-semibold text-xs">
                    <Globe className="w-4 h-4" />
                    Option 1: Render.com (Recommended)
                  </div>
                  <p className="text-[11px] text-slate-400">
                    1. Push this repo to GitHub.
                    <br />2. Create free "Web Service" on render.com.
                    <br />3. Set Build Command: <code className="text-slate-200">npm run build</code>
                    <br />4. Set Start Command: <code className="text-slate-200">npm start</code>
                    <br />5. You get an HTTPS URL with no request caps!
                  </p>
                </div>

                <div className="bg-[#050807]/70 border border-[#141e17] rounded-xl p-4 flex flex-col gap-2.5">
                  <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs">
                    <Zap className="w-4 h-4" />
                    Option 2: Koyeb or Fly.io
                  </div>
                  <p className="text-[11px] text-slate-400">
                    1. Deploy with free Eco instance.
                    <br />2. Zero setup Dockerfile is included in this repository.
                    <br />3. Fast response times with global edge CDN routing.
                  </p>
                </div>

                <div className="bg-[#050807]/70 border border-[#141e17] rounded-xl p-4 flex flex-col gap-2.5">
                  <div className="flex items-center gap-2 text-cyan-400 font-semibold text-xs">
                    <Server className="w-4 h-4" />
                    Option 3: $3.5/mo VPS or Cloud Run
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Run via Docker or PM2 on any Linux VPS (Hetzner, DigitalOcean) with unlimited bandwidth and complete control over dedicated IPs.
                  </p>
                </div>
              </div>

              {/* Dockerfile snippet */}
              <div className="flex flex-col gap-2 mt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200">Dockerfile (Included in workspace):</span>
                  <button
                    onClick={() =>
                      copyToClipboard(
                        `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
`,
                        'dockerCopy'
                      )
                    }
                    className="text-xs text-[#22c55e] hover:text-rose-300 flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" />
                    {copiedKey === 'dockerCopy' ? 'Copied!' : 'Copy Dockerfile'}
                  </button>
                </div>
                <pre className="bg-[#050807] p-4 rounded-xl border border-[#141e17] font-mono text-xs text-slate-300 overflow-x-auto whitespace-pre">
{`FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]`}
                </pre>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-[#050807] px-6 py-4 text-center text-xs text-slate-500">
        AnimeStream Proxy Backend &copy; {new Date().getFullYear()} &middot; Built for Next.js, Vercel & AnimeSalt Streaming
      </footer>
    </div>
  );
}
