/**
 * Shared settings for the day-1 spikes.
 *
 * The key is read from `.env.local` (gitignored) or the shell environment.
 * Pass `--mock` to any spike to point it at the local mock server instead
 * (`npm run spike:mock`), which checks the wire format without spending credits.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
for (const file of ['.env.local', '.env']) {
  const full = path.join(root, file);
  if (existsSync(full)) process.loadEnvFile(full);
}

export const MOCK = process.argv.includes('--mock');
export const MOCK_PORT = Number(process.env.MOCK_PORT ?? 8787);

export const META_BASE_URL = MOCK
  ? `http://127.0.0.1:${MOCK_PORT}/v1`
  : (process.env.META_BASE_URL ?? 'https://api.meta.ai/v1');

export const MODELS = {
  spark: process.env.MUSE_SPARK_MODEL ?? 'muse-spark-1.3',
  sam: process.env.SAM_MODEL ?? 'sam-3.1',
  transcribe: process.env.MUSE_TRANSCRIBE_MODEL ?? 'muse-voice-transcribe-1.0',
} as const;

export function apiKey(): string {
  if (MOCK) return 'mock-key';
  const key = process.env.MODEL_API_KEY;
  if (!key) {
    throw new Error(
      'MODEL_API_KEY is not set. Copy .env.example to .env.local and paste your Meta Model API key there.',
    );
  }
  return key;
}

export const ROOT = root;
export const RESULTS_DIR = path.join(root, 'spikes', 'results');

/** Arguments after the script name that are not flags. */
export function positionalArgs(): string[] {
  return process.argv.slice(2).filter((a) => !a.startsWith('--'));
}
