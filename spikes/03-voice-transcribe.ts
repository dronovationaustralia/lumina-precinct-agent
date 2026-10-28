/**
 * Spike 3: Muse Voice Transcribe on a short recorded question.
 *
 * Questions this answers:
 *  - Exact request shape for POST /v1/asr/transcribe (multipart: a JSON "request" part
 *    plus an "audio" part; Bearer auth header).
 *  - Does keyword biasing get Sydney station names right (Parramatta, St Leonards...)?
 *  - Latency for a 5-10 s clip, to decide whether /api/v1/transcribe can be one request
 *    or needs the realtime WebSocket.
 *
 * Record yourself asking one of the demo questions, then convert to mono 24 kHz WAV:
 *   ffmpeg -i question.m4a -ac 1 -ar 24000 -sample_fmt s16 spikes/audio/question.wav
 *
 * Usage:
 *   npm run spike:voice                          # uses spikes/audio/question.wav
 *   npm run spike:voice -- path/to/other.wav
 *   npm run spike:voice -- --mock
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { META_BASE_URL, MOCK, MODELS, RESULTS_DIR, ROOT, apiKey, positionalArgs } from './lib/env.js';

const MAX_BYTES = 32 * 1024 * 1024; // documented upload cap; audio is also capped at 10 minutes
const KEYWORDS = [
  'Parramatta', 'Westmead', 'Harris Park', 'Granville', 'Auburn',
  'Wynyard', 'Milsons Point', 'North Sydney', 'St Leonards', 'Chatswood',
];
const EXPECTED = process.env.SPIKE_EXPECTED_TRANSCRIPT ??
  'How do prices near Parramatta station compare with 2 to 5 km away?';

type TranscribeResponse = {
  sessionId?: string;
  transcript?: string;
  audioDurationMs?: number;
  turns?: { text?: string; speaker?: string; startMs?: number; endMs?: number }[];
};

async function transcribe(file: string, keywords: string[] | undefined) {
  const bytes = await readFile(file);
  if (bytes.length > MAX_BYTES) throw new Error(`${file} is over 32 MB`);
  const request = {
    model: MODELS.transcribe,
    mode: 'PUSH_TO_TALK',
    audioEncoding: 'WAV',
    ...(keywords ? { keywords } : {}),
    languageBias: ['english'],
  };
  const form = new FormData();
  // The parameters travel as a JSON part named "request", not as plain form fields.
  form.append('request', new Blob([JSON.stringify(request)], { type: 'application/json' }));
  form.append('audio', new Blob([bytes], { type: 'audio/wav' }), path.basename(file));

  const t0 = performance.now();
  const res = await fetch(`${META_BASE_URL}/asr/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  const latency = Math.round(performance.now() - t0);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return { latency_ms: latency, response: JSON.parse(text) as TranscribeResponse };
}

/** Word error rate against the expected sentence (lowercase, punctuation stripped). */
function wer(ref: string, hyp: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const r = norm(ref), h = norm(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0]![j] = j;
  for (let i = 1; i <= r.length; i++)
    for (let j = 1; j <= h.length; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (r[i - 1] === h[j - 1] ? 0 : 1));
  return r.length ? Math.round((d[r.length]![h.length]! / r.length) * 100) / 100 : 0;
}

async function main() {
  const file = path.resolve(positionalArgs()[0] ?? path.join(ROOT, 'spikes', 'audio', 'question.wav'));
  const runs = [];
  for (const [label, kw] of [['no_keywords', undefined], ['station_keywords', KEYWORDS]] as const) {
    try {
      const { latency_ms, response } = await transcribe(file, kw ? [...kw] : undefined);
      const transcript = response.transcript ?? '';
      const row = {
        label, latency_ms, transcript,
        audio_duration_ms: response.audioDurationMs ?? null,
        turns: response.turns?.length ?? 0,
        wer_vs_expected: wer(EXPECTED, transcript),
        station_names_found: KEYWORDS.filter((k) => transcript.toLowerCase().includes(k.toLowerCase())),
      };
      console.log(`[${label}] ${latency_ms} ms  WER ${row.wer_vs_expected}\n  "${transcript}"`);
      runs.push(row);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.log(`[${label}] ERROR ${error}`);
      runs.push({ label, error });
    }
  }
  await mkdir(RESULTS_DIR, { recursive: true });
  const out = path.join(RESULTS_DIR, `03-voice-transcribe${MOCK ? '.mock' : ''}.json`);
  await writeFile(out, JSON.stringify({ run_at: new Date().toISOString(), model: MODELS.transcribe, file: path.relative(ROOT, file), expected: EXPECTED, runs }, null, 2));
  console.log(`\nWrote ${path.relative(process.cwd(), out)}`);
  if (runs.some((r) => 'error' in r)) process.exitCode = 1;
}

await main();
