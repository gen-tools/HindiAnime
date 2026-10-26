"use client";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Volume1,
  Maximize,
  Minimize,
  RotateCcw,
  RotateCw,
  Settings,
  Languages,
  Check,
  Tv,
  Sparkles,
  Sliders
} from 'lucide-react';

export interface HindiAnimePlayerProps {
  src: string;
  poster?: string;
  animeTitle?: string;
  season?: string | number;
  episode?: string | number;
  logoUrl?: string;
  autoPlay?: boolean;
  className?: string;
  onEnded?: () => void;
  onError?: (error: string) => void;
}

interface AudioTrack {
  id: number;
  name: string;
  lang: string;
}

interface QualityLevel {
  id: number;
  height: number;
  bitrate: number;
  label: string;
}

export const HindiAnimePlayer: React.FC<HindiAnimePlayerProps> = ({
  src,
  poster,
  animeTitle = 'Hindi Anime Stream',
  season,
  episode,
  logoUrl = '/hindi-anime-logo-transparent.png',
  autoPlay = true,
  className = '',
  onEnded,
  onError,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [lastAction, setLastAction] = useState<'play' | 'pause' | null>(null);

  // Tracks & Qualities
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [currentAudioTrack, setCurrentAudioTrack] = useState<number>(-1);
  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([]);
  const [currentQuality, setCurrentQuality] = useState<number>(-1); // -1 = Auto
  const [activeResolution, setActiveResolution] = useState<string>('Auto');

  // Menus
  const [activeMenu, setActiveMenu] = useState<'none' | 'audio' | 'quality' | 'speed'>('none');
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<number>(0);
  const [playerError, setPlayerError] = useState<string | null>(null);

  // Format seconds to mm:ss or hh:mm:ss
  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '00:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Activity timer to hide controls
  const handleUserActivity = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    // Only auto-hide if playing and no menu is open
    if (isPlaying && activeMenu === 'none') {
      controlsTimeoutRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 2500);
    }
  }, [isPlaying, activeMenu]);

  // Initialize HLS Stream
  useEffect(() => {
    setPlayerError(null);
    setAudioTracks([]);
    setQualityLevels([]);
    setCurrentQuality(-1);
    setCurrentAudioTrack(-1);
    setActiveResolution('Auto');
    setIsBuffering(true);

    const video = videoRef.current;
    if (!video || !src) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        debug: false,
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsBuffering(false);
        if (autoPlay) {
          video.play().catch(() => {
            // Autoplay with sound blocked, fallback to mute & play
            video.muted = true;
            setIsMuted(true);
            video.play().catch(() => {});
          });
        }

        // 1. Extract Quality Levels
        if (hls.levels && hls.levels.length > 0) {
          const levels: QualityLevel[] = hls.levels.map((lvl, idx) => ({
            id: idx,
            height: lvl.height,
            bitrate: lvl.bitrate,
            label: lvl.height ? `${lvl.height}p` : `${Math.round(lvl.bitrate / 1000)}k`,
          }));
          // Sort high to low
          setQualityLevels(levels);
        }

        // 2. Extract Audio Tracks and apply rule: HINDI FIRST DEFAULT!
        const rawTracks = hls.audioTracks;
        if (rawTracks && rawTracks.length > 0) {
          const tracks: AudioTrack[] = rawTracks.map((t, idx) => ({
            id: idx,
            name: t.name || t.lang || `Audio ${idx + 1}`,
            lang: (t.lang || '').toLowerCase(),
          }));
          setAudioTracks(tracks);

          // Priority rule: Check for Hindi first
          const hindiIndex = tracks.findIndex(
            (t) =>
              t.name.toLowerCase().includes('hindi') ||
              t.lang.includes('hin') ||
              t.lang === 'hi'
          );

          if (hindiIndex !== -1) {
            hls.audioTrack = hindiIndex;
            setCurrentAudioTrack(hindiIndex);
          } else {
            setCurrentAudioTrack(hls.audioTrack);
          }
        }
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
        if (data.audioTracks && data.audioTracks.length > 0) {
          const tracks: AudioTrack[] = data.audioTracks.map((t, idx) => ({
            id: idx,
            name: t.name || t.lang || `Audio ${idx + 1}`,
            lang: (t.lang || '').toLowerCase(),
          }));
          setAudioTracks(tracks);

          // Priority rule: Check for Hindi first
          const hindiIndex = tracks.findIndex(
            (t) =>
              t.name.toLowerCase().includes('hindi') ||
              t.lang.includes('hin') ||
              t.lang === 'hi'
          );

          if (hindiIndex !== -1) {
            hls.audioTrack = hindiIndex;
            setCurrentAudioTrack(hindiIndex);
          } else {
            setCurrentAudioTrack(hls.audioTrack);
          }
        }
      });

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
        setCurrentAudioTrack(data.id);
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        if (hls.levels && hls.levels[data.level]) {
          const h = hls.levels[data.level].height;
          setActiveResolution(h ? `${h}p` : 'Auto');
        }
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
              const msg = `Playback error: ${data.details}`;
              setPlayerError(msg);
              if (onError) onError(msg);
              hls.destroy();
              break;
          }
        }
      });

      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Safari iOS/macOS HLS
      video.src = src;
      if (autoPlay) {
        video.play().catch(() => {});
      }
    } else {
      setPlayerError('HLS is not supported in this browser.');
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src, autoPlay]);

  // Video event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => {
      setIsPlaying(true);
      setLastAction('play');
      setTimeout(() => setLastAction(null), 600);
      handleUserActivity();
    };

    const onPause = () => {
      setIsPlaying(false);
      setLastAction('pause');
      setTimeout(() => setLastAction(null), 600);
      setControlsVisible(true);
    };

    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      if (video.buffered && video.buffered.length > 0 && video.duration > 0) {
        try {
          const bufferedEnd = video.buffered.end(video.buffered.length - 1);
          setBufferedPercent((bufferedEnd / video.duration) * 100);
        } catch {
          // ignore
        }
      }
    };

    const onLoadedMetadata = () => {
      setDuration(video.duration || 0);
    };

    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    const onCanPlay = () => setIsBuffering(false);
    const onVideoEnded = () => {
      setIsPlaying(false);
      setControlsVisible(true);
      if (onEnded) onEnded();
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('ended', onVideoEnded);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('ended', onVideoEnded);
    };
  }, [handleUserActivity, onEnded]);

  // Fullscreen event listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      const video = videoRef.current;
      if (!video) return;

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekDelta(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekDelta(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          changeVolume(Math.min(1, volume + 0.1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          changeVolume(Math.max(0, volume - 0.1));
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
      }
      handleUserActivity();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [volume, isMuted, isPlaying, handleUserActivity]);

  // Controls actions
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  const seekDelta = (deltaSeconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + deltaSeconds));
  };

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const bar = progressBarRef.current;
    const video = videoRef.current;
    if (!bar || !video || !video.duration) return;

    const rect = bar.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = pos * video.duration;
  };

  const handleProgressBarMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const bar = progressBarRef.current;
    const video = videoRef.current;
    if (!bar || !video || !video.duration) return;

    const rect = bar.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverPosition(pos * 100);
    setHoverTime(pos * video.duration);
  };

  const handleProgressBarMouseLeave = () => {
    setHoverTime(null);
  };

  const changeVolume = (newVol: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = newVol;
    setVolume(newVol);
    if (newVol === 0) {
      video.muted = true;
      setIsMuted(true);
    } else if (isMuted) {
      video.muted = false;
      setIsMuted(false);
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isMuted || volume === 0) {
      const restoreVol = volume === 0 ? 0.7 : volume;
      video.muted = false;
      video.volume = restoreVol;
      setIsMuted(false);
      setVolume(restoreVol);
    } else {
      video.muted = true;
      setIsMuted(true);
    }
  };

  const changePlaybackRate = (rate: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
    setPlaybackRate(rate);
    setActiveMenu('none');
  };

  const changeQuality = (levelIndex: number) => {
    if (!hlsRef.current) return;
    hlsRef.current.currentLevel = levelIndex;
    setCurrentQuality(levelIndex);
    if (levelIndex === -1) {
      setActiveResolution('Auto');
    } else {
      const lvl = qualityLevels.find((q) => q.id === levelIndex);
      setActiveResolution(lvl ? lvl.label : 'Auto');
    }
    setActiveMenu('none');
  };

  const changeAudioTrack = (trackId: number) => {
    if (!hlsRef.current) return;
    hlsRef.current.audioTrack = trackId;
    setCurrentAudioTrack(trackId);
    setActiveMenu('none');
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const togglePiP = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
      }
    } catch {
      // ignore
    }
  };

  const activeAudioLabel = audioTracks.find((t) => t.id === currentAudioTrack)?.name || 'Default';

  return (
    <div
      ref={containerRef}
      onMouseMove={handleUserActivity}
      onMouseLeave={() => {
        if (isPlaying && activeMenu === 'none') setControlsVisible(false);
      }}
      className={`relative w-full aspect-video bg-black overflow-hidden select-none rounded-2xl border border-[#141e17] shadow-2xl group ${
        !controlsVisible && isPlaying ? 'cursor-none' : 'cursor-default'
      } ${className}`}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        poster={poster}
        playsInline
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        className="w-full h-full object-contain cursor-pointer"
      />

      {/* Buffering Spinner */}
      {isBuffering && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20 bg-black/30 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full border-4 border-[#22c55e]/20 border-t-[#22c55e] animate-spin"></div>
            <span className="text-xs font-semibold text-gray-200 tracking-wider uppercase">Loading stream...</span>
          </div>
        </div>
      )}

      {/* Center Play/Pause Animated Splash Indicator */}
      {lastAction && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <div className="w-16 h-16 rounded-full bg-black/60 backdrop-blur-md border border-[#22c55e]/40 flex items-center justify-center text-[#22c55e] animate-ping opacity-75">
            {lastAction === 'play' ? <Play className="w-8 h-8 fill-current ml-1" /> : <Pause className="w-8 h-8 fill-current" />}
          </div>
        </div>
      )}

      {/* Error Banner */}
      {playerError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur p-6 z-30">
          <div className="max-w-md p-4 rounded-xl bg-red-950/80 border border-red-800 text-center flex flex-col items-center gap-3">
            <span className="text-red-400 font-bold text-sm">Playback Error</span>
            <p className="text-xs text-gray-300">{playerError}</p>
            <button
              onClick={() => {
                setPlayerError(null);
                if (hlsRef.current) hlsRef.current.startLoad();
              }}
              className="text-xs px-4 py-1.5 rounded-lg bg-[#22c55e] hover:bg-[#16a34a] text-black font-bold transition"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* TOP OVERLAY BAR: Appears on cursor move                  */}
      {/* Left: Transparent Website Logo + Season & Episode badge  */}
      {/* Right: Anime Title                                      */}
      {/* ======================================================== */}
      <div
        className={`absolute top-0 left-0 right-0 p-3 sm:p-5 bg-gradient-to-b from-black/90 via-black/40 to-transparent flex items-center justify-between z-20 transition-opacity duration-300 pointer-events-auto ${
          controlsVisible || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Left Side: Website Logo (No Background) + Season and Episode */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <img
            src={logoUrl}
            alt="Hindi Anime"
            className="h-6 sm:h-7 w-auto object-contain bg-transparent drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] filter"
          />

          {(season !== undefined || episode !== undefined) && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-[#22c55e]/40 text-[11px] sm:text-xs font-semibold text-white shadow-lg">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse"></span>
              <span className="tracking-wide">
                {season ? `S${String(season).padStart(2, '0')}` : 'S01'}{' '}
                {episode ? `E${String(episode).padStart(2, '0')}` : 'E01'}
              </span>
            </div>
          )}
        </div>

        {/* Right Side: Anime Title */}
        <div className="flex items-center overflow-hidden pl-2">
          <span className="text-xs sm:text-sm font-bold text-white drop-shadow truncate max-w-[200px] sm:max-w-md">
            {animeTitle}
          </span>
        </div>
      </div>

      {/* ======================================================== */}
      {/* BOTTOM CONTROLS OVERLAY                                 */}
      {/* ======================================================== */}
      <div
        className={`absolute bottom-0 left-0 right-0 pt-10 pb-3 px-3 sm:px-5 bg-gradient-to-t from-black/95 via-black/70 to-transparent z-20 flex flex-col gap-2 transition-opacity duration-300 ${
          controlsVisible || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Progress Bar Container with Hover Preview */}
        <div
          ref={progressBarRef}
          onClick={handleProgressBarClick}
          onMouseMove={handleProgressBarMouseMove}
          onMouseLeave={handleProgressBarMouseLeave}
          className="relative group/progress w-full h-2 hover:h-3 py-1 cursor-pointer flex items-center transition-all duration-150"
        >
          {/* Hover Time Bubble */}
          {hoverTime !== null && (
            <div
              className="absolute -top-7 transform -translate-x-1/2 px-2 py-0.5 rounded-md bg-[#0a0f0c] text-white border border-[#22c55e]/40 text-[10px] font-mono shadow-xl pointer-events-none z-30"
              style={{ left: `${hoverPosition}%` }}
            >
              {formatTime(hoverTime)}
            </div>
          )}

          {/* Background Track */}
          <div className="w-full h-1.5 group-hover/progress:h-2 rounded-full bg-white/20 relative overflow-hidden transition-all duration-150">
            {/* Buffered Bar */}
            <div
              className="absolute top-0 bottom-0 left-0 bg-white/30 rounded-full transition-all duration-200"
              style={{ width: `${bufferedPercent}%` }}
            />
            {/* Played Bar */}
            <div
              className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-[#16a34a] to-[#22c55e] rounded-full"
              style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
            />
          </div>

          {/* Scrubber Thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 border-[#22c55e] shadow-[0_0_10px_rgba(34,197,94,0.8)] opacity-0 group-hover/progress:opacity-100 transition-opacity pointer-events-none"
            style={{ left: `calc(${duration ? (currentTime / duration) * 100 : 0}% - 7px)` }}
          />
        </div>

        {/* Lower Row: Playback Buttons, Volume, Time, Menus, Fullscreen */}
        <div className="flex items-center justify-between text-white text-xs">
          {/* Left Controls: Play, Skip, Volume, Time */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white hover:text-[#22c55e] transition"
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
            </button>

            {/* Rewind 10s */}
            <button
              onClick={() => seekDelta(-10)}
              className="p-1.5 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white transition"
              title="Rewind 10s (Left Arrow)"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {/* Forward 10s */}
            <button
              onClick={() => seekDelta(10)}
              className="p-1.5 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white transition"
              title="Forward 10s (Right Arrow)"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            {/* Volume & Mute */}
            <div className="flex items-center group/volume gap-1">
              <button
                onClick={toggleMute}
                className="p-1.5 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white transition"
                title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-red-400" />
                ) : volume < 0.5 ? (
                  <Volume1 className="w-4 h-4" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
              <div className="w-0 opacity-0 pointer-events-none overflow-hidden group-hover/volume:w-16 sm:group-hover/volume:w-20 group-hover/volume:opacity-100 group-hover/volume:pointer-events-auto transition-all duration-200 flex items-center pr-1">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => changeVolume(parseFloat(e.target.value))}
                  className="w-16 sm:w-20 h-1 bg-white/30 rounded-lg appearance-none cursor-pointer accent-[#22c55e]"
                  title="Volume"
                />
              </div>
            </div>

            {/* Time Display */}
            <span className="text-[11px] font-mono text-gray-300 pl-1">
              <strong className="text-white">{formatTime(currentTime)}</strong> / {formatTime(duration)}
            </span>
          </div>

          {/* Right Controls: Audio Tracks, Quality, Speed, PiP, Fullscreen */}
          <div className="flex items-center gap-1 sm:gap-2 relative">
            {/* Audio Track Menu Toggle */}
            {audioTracks.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setActiveMenu(activeMenu === 'audio' ? 'none' : 'audio')}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition ${
                    activeMenu === 'audio'
                      ? 'bg-[#22c55e] text-black font-bold'
                      : 'hover:bg-white/10 text-gray-200'
                  }`}
                  title="Audio Languages"
                >
                  <Languages className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline truncate max-w-[60px]">{activeAudioLabel}</span>
                </button>

                {activeMenu === 'audio' && (
                  <div className="absolute bottom-10 right-0 w-44 bg-[#0a0f0c] border border-[#141e17] rounded-xl p-2 shadow-2xl flex flex-col gap-1 z-30 animate-in fade-in zoom-in-95">
                    <span className="text-[10px] uppercase font-bold text-gray-400 px-2 py-1 border-b border-[#141e17]">
                      Audio Language
                    </span>
                    <div className="max-h-48 overflow-y-auto flex flex-col gap-0.5">
                      {audioTracks.map((track) => (
                        <button
                          key={track.id}
                          onClick={() => changeAudioTrack(track.id)}
                          className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition ${
                            currentAudioTrack === track.id
                              ? 'bg-[#22c55e]/20 text-[#22c55e] font-bold'
                              : 'hover:bg-white/5 text-gray-300'
                          }`}
                        >
                          <span className="truncate">{track.name}</span>
                          {currentAudioTrack === track.id && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Quality Menu Toggle */}
            {qualityLevels.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setActiveMenu(activeMenu === 'quality' ? 'none' : 'quality')}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition ${
                    activeMenu === 'quality'
                      ? 'bg-[#22c55e] text-black font-bold'
                      : 'hover:bg-white/10 text-gray-200'
                  }`}
                  title="Stream Quality"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>{activeResolution}</span>
                </button>

                {activeMenu === 'quality' && (
                  <div className="absolute bottom-10 right-0 w-36 bg-[#0a0f0c] border border-[#141e17] rounded-xl p-2 shadow-2xl flex flex-col gap-1 z-30 animate-in fade-in zoom-in-95">
                    <span className="text-[10px] uppercase font-bold text-gray-400 px-2 py-1 border-b border-[#141e17]">
                      Quality
                    </span>
                    <button
                      onClick={() => changeQuality(-1)}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition ${
                        currentQuality === -1
                          ? 'bg-[#22c55e]/20 text-[#22c55e] font-bold'
                          : 'hover:bg-white/5 text-gray-300'
                      }`}
                    >
                      <span>Auto</span>
                      {currentQuality === -1 && <Check className="w-3.5 h-3.5" />}
                    </button>
                    {qualityLevels.map((lvl) => (
                      <button
                        key={lvl.id}
                        onClick={() => changeQuality(lvl.id)}
                        className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition ${
                          currentQuality === lvl.id
                            ? 'bg-[#22c55e]/20 text-[#22c55e] font-bold'
                            : 'hover:bg-white/5 text-gray-300'
                        }`}
                      >
                        <span>{lvl.label}</span>
                        {currentQuality === lvl.id && <Check className="w-3.5 h-3.5" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Playback Speed Menu */}
            <div className="relative">
              <button
                onClick={() => setActiveMenu(activeMenu === 'speed' ? 'none' : 'speed')}
                className={`p-1.5 rounded-lg text-xs font-semibold transition ${
                  activeMenu === 'speed' ? 'bg-[#22c55e] text-black' : 'hover:bg-white/10 text-gray-300 hover:text-white'
                }`}
                title="Playback Speed"
              >
                {playbackRate}x
              </button>

              {activeMenu === 'speed' && (
                <div className="absolute bottom-10 right-0 w-32 bg-[#0a0f0c] border border-[#141e17] rounded-xl p-2 shadow-2xl flex flex-col gap-1 z-30 animate-in fade-in zoom-in-95">
                  <span className="text-[10px] uppercase font-bold text-gray-400 px-2 py-1 border-b border-[#141e17]">
                    Speed
                  </span>
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                    <button
                      key={rate}
                      onClick={() => changePlaybackRate(rate)}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition ${
                        playbackRate === rate
                          ? 'bg-[#22c55e]/20 text-[#22c55e] font-bold'
                          : 'hover:bg-white/5 text-gray-300'
                      }`}
                    >
                      <span>{rate === 1 ? '1x (Normal)' : `${rate}x`}</span>
                      {playbackRate === rate && <Check className="w-3.5 h-3.5" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Picture-in-Picture */}
            <button
              onClick={togglePiP}
              className="p-1.5 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white transition"
              title="Picture-in-Picture"
            >
              <Tv className="w-4 h-4" />
            </button>

            {/* Fullscreen Toggle */}
            <button
              onClick={toggleFullscreen}
              className="p-1.5 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white transition"
              title={isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HindiAnimePlayer;
