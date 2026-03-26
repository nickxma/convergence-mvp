'use client';

import { useEffect, useRef, useState } from 'react';

export type VoiceId = 'calm' | 'energetic' | 'neutral' | 'deep' | 'warm' | 'whisper';

interface VoiceDef {
  id: VoiceId;
  name: string;
  description: string;
}

const VOICES: VoiceDef[] = [
  { id: 'calm',      name: 'Calm',      description: 'Slow & soothing' },
  { id: 'energetic', name: 'Energetic', description: 'Uplifting & warm' },
  { id: 'neutral',   name: 'Neutral',   description: 'Clear & grounded' },
  { id: 'deep',      name: 'Deep',      description: 'Deep & grounding' },
  { id: 'warm',      name: 'Warm',      description: 'Gentle & nurturing' },
  { id: 'whisper',   name: 'Whisper',   description: 'Soft & intimate' },
];

const LOCALSTORAGE_KEY = 'meditation_voice_preference';

interface Props {
  value: VoiceId;
  onChange: (id: VoiceId) => void;
}

export function VoiceCardGrid({ value, onChange }: Props) {
  const [playingId, setPlayingId] = useState<VoiceId | null>(null);
  const [loadingId, setLoadingId] = useState<VoiceId | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Stop audio and clean up on unmount
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  function stopAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId(null);
    setLoadingId(null);
  }

  function handlePlay(voiceId: VoiceId, e: React.MouseEvent) {
    e.stopPropagation();

    // Toggle off if already playing this voice
    if (playingId === voiceId) {
      stopAudio();
      return;
    }

    // Stop any current audio
    stopAudio();

    setLoadingId(voiceId);
    const audio = new Audio(`/api/voices/${voiceId}/preview`);
    audioRef.current = audio;

    audio.addEventListener('canplaythrough', () => {
      setLoadingId(null);
      setPlayingId(voiceId);
    });

    audio.addEventListener('ended', () => {
      setPlayingId(null);
      audioRef.current = null;
    });

    audio.addEventListener('error', () => {
      setLoadingId(null);
      setPlayingId(null);
      audioRef.current = null;
    });

    audio.play().catch(() => {
      setLoadingId(null);
      setPlayingId(null);
      audioRef.current = null;
    });
  }

  function handleSelect(voiceId: VoiceId) {
    onChange(voiceId);
    localStorage.setItem(LOCALSTORAGE_KEY, voiceId);
  }

  return (
    <div>
      <p className="text-xs font-medium mb-2.5" style={{ color: '#7d8c6e' }}>
        Voice
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {VOICES.map((voice) => {
          const selected = value === voice.id;
          const isPlaying = playingId === voice.id;
          const isLoading = loadingId === voice.id;

          return (
            <button
              key={voice.id}
              type="button"
              onClick={() => handleSelect(voice.id)}
              aria-pressed={selected}
              aria-label={`${voice.name}: ${voice.description}`}
              className="relative flex flex-col items-start rounded-xl p-3 text-left transition-all"
              style={{
                background: selected ? '#f0ece3' : '#fff',
                border: selected
                  ? '1.5px solid #7d8c6e'
                  : '1.5px solid #e0d8cc',
                boxShadow: selected ? '0 0 0 3px rgba(125,140,110,0.12)' : 'none',
              }}
            >
              <div className="flex w-full items-center justify-between mb-1">
                <span className="text-xs font-semibold" style={{ color: selected ? '#3d4f38' : '#2c2c2c' }}>
                  {voice.name}
                </span>
                <button
                  type="button"
                  onClick={(e) => handlePlay(voice.id, e)}
                  aria-label={isPlaying ? `Stop ${voice.name} preview` : `Play ${voice.name} preview`}
                  className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-colors"
                  style={{
                    background: isPlaying ? '#7d8c6e' : '#e8e0d5',
                    color: isPlaying ? '#fff' : '#7d8c6e',
                  }}
                >
                  {isLoading ? (
                    <svg
                      aria-hidden="true"
                      className="w-2.5 h-2.5 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path
                        strokeLinecap="round"
                        d="M12 3a9 9 0 0 1 9 9"
                      />
                    </svg>
                  ) : isPlaying ? (
                    <svg aria-hidden="true" className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="5" y="4" width="4" height="16" rx="1" />
                      <rect x="15" y="4" width="4" height="16" rx="1" />
                    </svg>
                  ) : (
                    <svg aria-hidden="true" className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5.14v14l11-7-11-7z" />
                    </svg>
                  )}
                </button>
              </div>
              <span className="text-xs leading-tight" style={{ color: '#9c9080' }}>
                {voice.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Read the persisted voice preference from localStorage (or return default). */
export function getPersistedVoice(defaultVoice: VoiceId = 'calm'): VoiceId {
  if (typeof window === 'undefined') return defaultVoice;
  const stored = localStorage.getItem(LOCALSTORAGE_KEY) as VoiceId | null;
  const valid: VoiceId[] = ['calm', 'energetic', 'neutral', 'deep', 'warm', 'whisper'];
  return stored && valid.includes(stored) ? stored : defaultVoice;
}
