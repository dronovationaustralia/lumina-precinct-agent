/**
 * Voice questions: Muse Voice Transcribe turns a recorded question into text.
 *
 * The request shape (multipart POST with a JSON "request" part plus the audio file)
 * is the one proven in `spikes/03-voice-transcribe.ts`. Keyword biasing uses every
 * station name so "Parramatta" and "St Leonards" survive transcription.
 */
import { STATIONS } from '@/lib/stations';

/** Largest upload the endpoint accepts. */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
/** Longest clip the endpoint accepts, checked against the model's reported duration. */
export const MAX_AUDIO_MS = 60_000;

export function transcribeModel(): string {
  return process.env.MUSE_TRANSCRIBE_MODEL ?? 'muse-voice-transcribe-1.0';
}

function metaBaseUrl(): string {
  return process.env.META_BASE_URL ?? 'https://api.meta.ai/v1';
}

/** Station names plus the words our questions keep using, for keyword biasing. */
// Kept short: the Day 1 test that worked used 10 keywords; the full list of 185 station names
// is a likely cause of "Malformed request". The selected station is added per request.
export const TRANSCRIBE_KEYWORDS: readonly string[] = [
  ...STATIONS.filter((s) => s.featured).map((s) => s.name),
  'Sydney',
  'metro',
];

export function keywordsFor(station?: string | null): string[] {
  const extra = station && STATIONS.some((s) => s.name === station) && !TRANSCRIBE_KEYWORDS.includes(station) ? [station] : [];
  return [...TRANSCRIBE_KEYWORDS, ...extra];
}

const ACCEPTED_MIME = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/vnd.wave',
  'audio/mp4',
  'audio/x-m4a',
]);
const ACCEPTED_EXT = new Set(['.webm', '.ogg', '.oga', '.wav', '.mp4', '.m4a']);

export type AudioValidation =
  | { ok: true; file: Blob }
  | { ok: false; code: string; message: string };

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

/** Pure input check for the `audio` form field, so it can be unit-tested without the network. */
export function validateAudio(file: unknown): AudioValidation {
  if (file === null || file === undefined || typeof file !== 'object' || !(file instanceof Blob)) {
    return { ok: false, code: 'missing_audio', message: 'No audio file was uploaded (form field "audio").' };
  }
  if (file.size === 0) {
    return { ok: false, code: 'missing_audio', message: 'The uploaded audio file is empty.' };
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return { ok: false, code: 'audio_too_large', message: 'The audio file is over 10 MB.' };
  }
  // Some browsers record with an empty MIME type, so the extension is a fallback, not a veto.
  const mime = (file.type ?? '').split(';')[0]!.trim().toLowerCase();
  const name = file instanceof File ? file.name : '';
  const accepted = ACCEPTED_MIME.has(mime) || (name !== '' && ACCEPTED_EXT.has(extensionOf(name)));
  if (!accepted) {
    return { ok: false, code: 'unsupported_audio_type', message: 'Audio must be webm, ogg, wav or mp4.' };
  }
  return { ok: true, file };
}

function audioEncoding(filename: string, mime: string): string {
  const ext = extensionOf(filename);
  if (ext === '.ogg' || ext === '.oga' || mime.startsWith('audio/ogg')) return 'OGG';
  if (ext === '.webm' || mime.startsWith('audio/webm')) return 'WEBM';
  if (ext === '.mp4' || ext === '.m4a' || mime.startsWith('audio/mp4') || mime.startsWith('audio/x-m4a')) return 'MP4';
  return 'WAV';
}

type TranscribeResponse = {
  transcript?: string;
  audioDurationMs?: number;
};

/**
 * Transcribe one clip. Returns the text, the model latency, and the clip length the
 * model reports (used to enforce the 60 s cap without an audio decoder on the server).
 */
export async function transcribe(audio: Blob, filename: string, station?: string | null): Promise<{ text: string; ms: number; durationMs: number | null }> {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error('MODEL_API_KEY is not set, so voice transcription is unavailable.');
  const model = transcribeModel();
  const request = {
    model,
    mode: 'PUSH_TO_TALK',
    audioEncoding: audioEncoding(filename, audio.type ?? ''),
    keywords: keywordsFor(station),
    languageBias: ['english'],
  };
  const form = new FormData();
  form.append('request', new Blob([JSON.stringify(request)], { type: 'application/json' }));
  form.append('audio', audio, filename);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const t0 = performance.now();
    let res: Response;
    try {
      res = await fetch(`${metaBaseUrl()}/asr/transcribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: controller.signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw new Error('Transcription timed out after 30 s.');
      throw new Error(`Transcription request failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    const ms = Math.round(performance.now() - t0);
    const text = await res.text();
    if (!res.ok) throw new Error(`Transcription failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
    const parsed = JSON.parse(text) as TranscribeResponse;
    return { text: parsed.transcript ?? '', ms, durationMs: parsed.audioDurationMs ?? null };
  } finally {
    clearTimeout(timer);
  }
}
