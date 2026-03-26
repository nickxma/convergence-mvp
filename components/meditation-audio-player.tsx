'use client';

/**
 * MeditationAudioPlayer
 *
 * Activates when GET /api/meditations/:id/audio returns status='available'.
 * Until then shows a muted Listen button with tooltip "Audio narration coming soon".
 *
 * Features (when ready):
 *   - Per-section playback tied to sectionIdx prop
 *   - Play/pause, seek bar, speed control (0.75×/1×/1.25×/1.5×)
 *   - Volume slider, download button
 *   - Syncs with the visual section timer: sectionIdx changes switch audio source
 *   - Mobile: compact single-row layout that persists in the fixed footer area
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AudioSection {
  section: string; // 'intro' | 'section-0' | 'section-N' | 'closing'
  status: string;
  url: string | null;
}

type FetchStatus = 'loading' | 'unavailable' | 'generating' | 'available';

const SPEEDS = [0.75, 1, 1.25, 1.5] as const;
type Speed = (typeof SPEEDS)[number];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getSectionUrl(sections: AudioSection[], idx: number): string | null {
  return sections.find((s) => s.section === `section-${idx}`)?.url ?? null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ListenButtonDisabled({ label }: { label: string }) {
  return (
    <div
      className="flex-shrink-0 border-t px-5 py-3"
      style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
    >
      <div className="max-w-2xl mx-auto flex items-center gap-3">
        <button
          disabled
          title="Audio narration coming soon"
          aria-label="Audio narration coming soon"
          className="flex items-center gap-2 text-xs px-4 py-2 rounded-full border cursor-not-allowed select-none"
          style={{
            borderColor: 'var(--border)',
            color: 'var(--text-muted)',
            opacity: 0.45,
          }}
        >
          <svg
            aria-hidden="true"
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 9a8.25 8.25 0 0 1 16.5 0v5.25c0 1.035-.84 1.875-1.875 1.875H18a1.5 1.5 0 0 1-1.5-1.5v-4.5a1.5 1.5 0 0 1 1.5-1.5h.375M6 15.75v-4.5A1.5 1.5 0 0 1 7.5 9.75h.375"
            />
          </svg>
          Listen
        </button>
        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
          {label}
        </span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MeditationAudioPlayer({
  meditationId,
  sectionIdx,
}: {
  meditationId: string | null;
  sectionIdx: number;
}) {
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>('loading');
  const [audioSections, setAudioSections] = useState<AudioSection[]>([]);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<Speed>(1);
  const [volume, setVolume] = useState(1);
  const [showVolume, setShowVolume] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingRef = useRef(false); // stable ref for async callbacks

  // ── Fetch audio status ──────────────────────────────────────────────────────

  const fetchAudioStatus = useCallback(async () => {
    if (!meditationId) return;
    try {
      const res = await fetch(`/api/meditations/${meditationId}/audio`);
      if (!res.ok) {
        setFetchStatus('unavailable');
        return;
      }
      const data = await res.json();
      if (data.status === 'available' && Array.isArray(data.sections)) {
        setAudioSections(data.sections);
        setFetchStatus('available');
      } else if (data.status === 'generating') {
        setFetchStatus('generating');
      } else {
        setFetchStatus('unavailable');
      }
    } catch {
      setFetchStatus('unavailable');
    }
  }, [meditationId]);

  // Initial fetch + poll every 30s while not yet available
  useEffect(() => {
    if (!meditationId) return;
    setFetchStatus('loading');
    fetchAudioStatus();

    const interval = setInterval(() => {
      if (fetchStatus !== 'available') fetchAudioStatus();
    }, 30_000);

    return () => clearInterval(interval);
  }, [meditationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Switch audio source when section changes ────────────────────────────────

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || fetchStatus !== 'available') return;

    const url = getSectionUrl(audioSections, sectionIdx);
    if (!url) return;

    const wasPlaying = playingRef.current;
    audio.pause();
    audio.src = url;
    audio.load();
    setCurrentTime(0);
    setDuration(0);

    if (wasPlaying) {
      audio.play().catch(() => {
        setPlaying(false);
        playingRef.current = false;
      });
    }
  }, [sectionIdx, audioSections, fetchStatus]);

  // ── Sync speed + volume to audio element ───────────────────────────────────

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = speed;
    audio.volume = volume;
  }, [speed, volume]);

  // ── Cleanup on unmount ──────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  // ── Event handlers ──────────────────────────────────────────────────────────

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;

    if (playingRef.current) {
      audio.pause();
    } else {
      // Load source if not yet set (first play)
      if (!audio.src || audio.src === window.location.href) {
        const url = getSectionUrl(audioSections, sectionIdx);
        if (!url) return;
        audio.src = url;
        audio.load();
      }
      audio.play().catch(() => {
        setPlaying(false);
        playingRef.current = false;
      });
    }
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    const t = parseFloat(e.target.value);
    audio.currentTime = t;
    setCurrentTime(t);
  }

  function cycleSpeed() {
    setSpeed((prev) => {
      const nextIdx = (SPEEDS.indexOf(prev) + 1) % SPEEDS.length;
      return SPEEDS[nextIdx];
    });
  }

  function handleDownload() {
    const url = getSectionUrl(audioSections, sectionIdx);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `meditation-section-${sectionIdx + 1}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  // Not yet loaded — render nothing to avoid layout shift
  if (fetchStatus === 'loading') return null;

  // Audio not yet generated
  if (fetchStatus === 'unavailable') {
    return <ListenButtonDisabled label="Audio narration coming soon" />;
  }

  // Audio is generating
  if (fetchStatus === 'generating') {
    return <ListenButtonDisabled label="Generating audio narration…" />;
  }

  // ── Full player ─────────────────────────────────────────────────────────────

  const currentUrl = getSectionUrl(audioSections, sectionIdx);

  return (
    <div
      className="flex-shrink-0 border-t px-4 py-2.5"
      style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
    >
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          setDuration(isFinite(d) ? d : 0);
        }}
        onEnded={() => {
          setPlaying(false);
          playingRef.current = false;
          setCurrentTime(0);
        }}
        onPlay={() => {
          setPlaying(true);
          playingRef.current = true;
        }}
        onPause={() => {
          setPlaying(false);
          playingRef.current = false;
        }}
        preload="metadata"
        style={{ display: 'none' }}
      />

      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-2.5">

          {/* ── Play / Pause ── */}
          <button
            onClick={togglePlay}
            aria-label={playing ? 'Pause narration' : 'Play narration'}
            className="flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 transition-opacity active:opacity-70"
            style={{ background: 'var(--sage)', color: '#fff' }}
          >
            {playing ? (
              <svg aria-hidden="true" className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path
                  fillRule="evenodd"
                  d="M6.75 5.25a.75.75 0 0 1 .75-.75H9a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H7.5a.75.75 0 0 1-.75-.75V5.25Zm7.5 0A.75.75 0 0 1 15 4.5h1.5a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H15a.75.75 0 0 1-.75-.75V5.25Z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg aria-hidden="true" className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path
                  fillRule="evenodd"
                  d="M4.5 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.347c1.295.712 1.295 2.573 0 3.286L7.28 19.99c-1.25.687-2.779-.217-2.779-1.643V5.653Z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </button>

          {/* ── Time + Seek bar ── */}
          <div className="flex flex-1 items-center gap-2 min-w-0">
            <span
              className="text-xs tabular-nums flex-shrink-0 hidden sm:inline"
              style={{ color: 'var(--text-muted)' }}
            >
              {fmtTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 1}
              step={0.5}
              value={currentTime}
              onChange={handleSeek}
              className="flex-1 min-w-0 cursor-pointer"
              style={{ accentColor: 'var(--sage)', height: '4px' }}
              aria-label="Seek"
            />
            <span
              className="text-xs tabular-nums flex-shrink-0 hidden sm:inline"
              style={{ color: 'var(--text-muted)' }}
            >
              {fmtTime(duration)}
            </span>
          </div>

          {/* ── Speed control ── */}
          <button
            onClick={cycleSpeed}
            aria-label={`Playback speed: ${speed}×. Click to cycle.`}
            className="text-xs px-2 py-1 rounded border flex-shrink-0 transition-colors hidden sm:flex items-center"
            style={{
              borderColor: speed !== 1 ? 'var(--sage)' : 'var(--border)',
              color: speed !== 1 ? 'var(--sage)' : 'var(--text-muted)',
              minWidth: '36px',
              justifyContent: 'center',
            }}
          >
            {speed}×
          </button>

          {/* ── Volume ── */}
          <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => setShowVolume((v) => !v)}
              aria-label={volume === 0 ? 'Unmute' : 'Toggle volume'}
              className="flex items-center justify-center w-7 h-7"
              style={{ color: 'var(--text-muted)' }}
            >
              {volume === 0 ? (
                <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75 19.5 12m0 0 2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6 4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
                </svg>
              ) : (
                <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
                </svg>
              )}
            </button>
            {showVolume && (
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-20 cursor-pointer"
                style={{ accentColor: 'var(--sage)', height: '4px' }}
                aria-label="Volume"
              />
            )}
          </div>

          {/* ── Download ── */}
          {currentUrl && (
            <button
              onClick={handleDownload}
              title="Download audio"
              aria-label="Download section audio"
              className="flex items-center justify-center w-7 h-7 flex-shrink-0"
              style={{ color: 'var(--text-muted)' }}
            >
              <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
            </button>
          )}

          {/* ── Mobile: speed (compact) ── */}
          <button
            onClick={cycleSpeed}
            aria-label={`Playback speed: ${speed}×. Click to cycle.`}
            className="text-xs px-2 py-1 rounded border flex-shrink-0 flex items-center sm:hidden"
            style={{
              borderColor: speed !== 1 ? 'var(--sage)' : 'var(--border)',
              color: speed !== 1 ? 'var(--sage)' : 'var(--text-muted)',
            }}
          >
            {speed}×
          </button>
        </div>
      </div>
    </div>
  );
}
