'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AudioPlayerProps {
  audioUrl: string;
  sessionId: string;
  onComplete?: () => void;
  /** Called when user clicks the post-completion CTA */
  onMarkComplete?: () => void;
}

type PlaybackRate = 0.75 | 1 | 1.25 | 1.5;
const PLAYBACK_RATES: PlaybackRate[] = [0.75, 1, 1.25, 1.5];
const SEEK_SECONDS = 10;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function storageKey(sessionId: string): string {
  return `audio-progress:${sessionId}`;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden="true">
      <path d="M8 5.14v14l11-7-11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden="true">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AudioPlayer({ audioUrl, sessionId, onComplete, onMarkComplete }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(1);
  const [isDragging, setIsDragging] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // ── Restore saved progress ────────────────────────────────────────────────

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const saved = sessionStorage.getItem(storageKey(sessionId));
    if (saved) {
      const t = parseFloat(saved);
      if (isFinite(t) && t > 0) {
        audio.currentTime = t;
      }
    }
  }, [sessionId]);

  // ── Persist progress ──────────────────────────────────────────────────────

  useEffect(() => {
    if (currentTime > 0) {
      sessionStorage.setItem(storageKey(sessionId), String(currentTime));
    }
  }, [currentTime, sessionId]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const audio = audioRef.current;
      if (!audio) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (audio.paused) {
          audio.play();
        } else {
          audio.pause();
        }
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        audio.currentTime = Math.min(audio.currentTime + SEEK_SECONDS, audio.duration || 0);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        audio.currentTime = Math.max(audio.currentTime - SEEK_SECONDS, 0);
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // ── Audio event handlers ──────────────────────────────────────────────────

  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (audio && !isDragging) {
      setCurrentTime(audio.currentTime);
    }
  }, [isDragging]);

  const handleLoadedMetadata = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      setDuration(audio.duration);
      setIsLoading(false);
    }
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setShowComplete(true);
    onComplete?.();
    sessionStorage.removeItem(storageKey(sessionId));
  }, [onComplete, sessionId]);

  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);

  const handleCanPlay = useCallback(() => {
    setIsLoading(false);
  }, []);

  // ── Sync playback rate ────────────────────────────────────────────────────

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = playbackRate;
  }, [playbackRate]);

  // ── Play/Pause toggle ─────────────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  }, []);

  // ── Progress bar interaction ──────────────────────────────────────────────

  function getSeekTime(e: React.MouseEvent | MouseEvent): number {
    const bar = progressRef.current;
    if (!bar || !duration) return 0;
    const rect = bar.getBoundingClientRect();
    const x = (e as MouseEvent).clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    return ratio * duration;
  }

  const handleProgressMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    const t = getSeekTime(e);
    setCurrentTime(t);

    function onMove(ev: MouseEvent) {
      const tt = getSeekTime(ev);
      setCurrentTime(tt);
    }
    function onUp(ev: MouseEvent) {
      const tt = getSeekTime(ev);
      setCurrentTime(tt);
      const audio = audioRef.current;
      if (audio) audio.currentTime = tt;
      setIsDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [duration]); // eslint-disable-line react-hooks/exhaustive-deps

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      role="region"
      className="rounded-xl px-4 py-3 mb-6"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
      }}
      aria-label="Audio narration player"
    >
      {/* Hidden native audio element */}
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onPlay={handlePlay}
        onPause={handlePause}
        onCanPlay={handleCanPlay}
      />

      {/* Header label */}
      <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
        Audio narration
      </p>

      {/* Controls row */}
      <div className="flex items-center gap-3">
        {/* Play/Pause */}
        <button
          onClick={togglePlay}
          disabled={isLoading}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors"
          style={{
            background: isLoading ? 'var(--bg-chip)' : 'var(--sage)',
            color: '#fff',
            cursor: isLoading ? 'not-allowed' : 'pointer',
          }}
        >
          {isLoading ? (
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          ) : isPlaying ? (
            <PauseIcon />
          ) : (
            <PlayIcon />
          )}
        </button>

        {/* Progress bar + times */}
        <div className="flex-1 flex flex-col gap-1">
          {/* Progress bar */}
          <div
            ref={progressRef}
            role="slider"
            aria-label="Playback position"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={Math.round(currentTime)}
            tabIndex={0}
            className="relative h-1.5 rounded-full cursor-pointer"
            style={{ background: 'var(--border)' }}
            onMouseDown={handleProgressMouseDown}
            onKeyDown={(e) => {
              const audio = audioRef.current;
              if (!audio) return;
              if (e.key === 'ArrowRight') audio.currentTime = Math.min(audio.currentTime + SEEK_SECONDS, duration);
              if (e.key === 'ArrowLeft') audio.currentTime = Math.max(audio.currentTime - SEEK_SECONDS, 0);
            }}
          >
            {/* Filled track */}
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-none"
              style={{ width: `${progress}%`, background: 'var(--sage)' }}
            />
            {/* Thumb */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 transition-none"
              style={{
                left: `${progress}%`,
                transform: `translateX(-50%) translateY(-50%)`,
                background: 'var(--sage)',
                borderColor: 'var(--bg)',
              }}
            />
          </div>

          {/* Time display */}
          <div className="flex justify-between text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Speed selector */}
        <div className="flex-shrink-0 flex gap-0.5">
          {PLAYBACK_RATES.map((rate) => (
            <button
              key={rate}
              onClick={() => setPlaybackRate(rate)}
              aria-label={`${rate}× speed`}
              aria-pressed={playbackRate === rate}
              className="text-xs font-medium px-1.5 py-0.5 rounded transition-colors"
              style={{
                background: playbackRate === rate ? 'var(--sage-bg)' : 'transparent',
                color: playbackRate === rate ? 'var(--sage-dark)' : 'var(--text-muted)',
                border: playbackRate === rate ? '1px solid var(--sage-ring)' : '1px solid transparent',
              }}
            >
              {rate}×
            </button>
          ))}
        </div>

        {/* Download */}
        <a
          href={audioUrl}
          download
          aria-label="Download audio"
          className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-warm)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          <DownloadIcon />
        </a>
      </div>

      {/* Keyboard hint */}
      <p className="mt-2 text-xs" style={{ color: 'var(--text-faint)' }}>
        Space to play/pause · ←/→ to seek 10s
      </p>

      {/* Post-completion CTA */}
      {showComplete && onMarkComplete && (
        <div
          className="mt-3 pt-3 flex items-center justify-between"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-warm)' }}>
            Narration complete
          </p>
          <button
            onClick={onMarkComplete}
            className="text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{
              background: 'var(--sage)',
              color: '#fff',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sage-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--sage)')}
          >
            Mark session complete
          </button>
        </div>
      )}
    </div>
  );
}
