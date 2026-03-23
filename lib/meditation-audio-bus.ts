/**
 * meditation-audio-bus.ts
 *
 * In-memory SSE fan-out bus for meditation audio generation status.
 *
 * The cron worker publishes an `audio_ready` event when a full-script
 * MP3 is uploaded and the meditation record is updated. The SSE route
 * at GET /api/meditations/:id/audio?stream=1 subscribes and pushes
 * the event to the waiting browser.
 *
 * Lifetime: entries auto-clean 5 minutes after the last subscriber
 * disconnects — audio generation typically takes under 2 minutes.
 */

import { EventEmitter } from 'events';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AudioReadyPayload {
  meditationId: string;
  audioUrl: string;
  audioDurationSeconds: number;
}

export interface AudioErrorPayload {
  meditationId: string;
  message: string;
}

export type MeditationAudioEventType = 'audio_ready' | 'audio_error';

export interface MeditationAudioEvent {
  type: MeditationAudioEventType;
  ts: string;
  data: AudioReadyPayload | AudioErrorPayload;
}

// ── Internal state ────────────────────────────────────────────────────────────

interface BusEntry {
  emitter: EventEmitter;
  subscribers: number;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

const bus = new Map<string, BusEntry>();
const CLEANUP_GRACE_MS = 5 * 60_000; // 5 min

function getOrCreate(meditationId: string): BusEntry {
  let entry = bus.get(meditationId);
  if (!entry) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(20);
    entry = { emitter, subscribers: 0, cleanupTimer: null };
    bus.set(meditationId, entry);
  }
  if (entry.cleanupTimer !== null) {
    clearTimeout(entry.cleanupTimer);
    entry.cleanupTimer = null;
  }
  return entry;
}

function scheduleCleanup(meditationId: string) {
  const entry = bus.get(meditationId);
  if (!entry) return;
  entry.cleanupTimer = setTimeout(() => {
    bus.delete(meditationId);
  }, CLEANUP_GRACE_MS);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Subscribe to audio events for a meditation.
 * Returns an unsubscribe function — call when SSE connection closes.
 */
export function subscribeAudio(
  meditationId: string,
  handler: (event: MeditationAudioEvent) => void,
): () => void {
  const entry = getOrCreate(meditationId);
  entry.subscribers++;
  entry.emitter.on('event', handler);

  return () => {
    entry.emitter.off('event', handler);
    entry.subscribers--;
    if (entry.subscribers <= 0) {
      scheduleCleanup(meditationId);
    }
  };
}

/**
 * Publish an audio event to all SSE subscribers for a meditation.
 */
export function publishAudioEvent(
  meditationId: string,
  event: MeditationAudioEvent,
): void {
  const entry = bus.get(meditationId);
  if (!entry) return;
  entry.emitter.emit('event', event);
}

export function makeAudioEvent(
  type: MeditationAudioEventType,
  data: AudioReadyPayload | AudioErrorPayload,
): MeditationAudioEvent {
  return { type, ts: new Date().toISOString(), data };
}
