/**
 * Shareable answer links: stateless and signed. The deployed app has read-only
 * database access, so there is nowhere to store shared answers; instead the content
 * travels in the URL, compressed, with an HMAC-SHA256 signature (AUTH_SECRET) so
 * nobody can forge figures in a shared link.
 *
 * token = base64url(deflate(JSON)) + "." + base64url(HMAC-SHA256)
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

import type { Fact, Source } from '@/lib/contracts';

export type SharedAnswer = {
  v: 1;
  question: string;
  station?: string;
  templates: string[];
  facts: Fact[];
  sources: Source[];
  status: 'verified' | 'verified_after_retry' | 'fallback';
  model: { provider: string; model: string };
  created_at: string;
};

/** Max deflated payload: keeps URLs short enough for browsers and crawlers. */
export const MAX_SHARE_BYTES = 6 * 1024;
/** Max token length: base64url of 6 KB plus the signature, with headroom. */
const MAX_TOKEN_CHARS = 9000;

const DEV_SECRET = 'lumina-local-development-secret-not-for-production';

function secret(): Buffer {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET (32+ characters) must be set in production');
    return Buffer.from(DEV_SECRET);
  }
  return Buffer.from(s);
}

export function signShare(payload: SharedAnswer): string {
  const raw = deflateSync(strToU8(JSON.stringify(payload)), { level: 9 });
  if (raw.length > MAX_SHARE_BYTES) throw new Error(`shared answer too large (${raw.length} bytes compressed, max ${MAX_SHARE_BYTES})`);
  const body = Buffer.from(raw).toString('base64url');
  const sig = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Returns the payload, or null when the token is oversized, malformed or forged. */
export function verifyShare(token: string): SharedAnswer | null {
  try {
    if (!token || token.length > MAX_TOKEN_CHARS) return null;
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const body = token.slice(0, dot);
    const sig = Buffer.from(token.slice(dot + 1), 'base64url');
    const want = createHmac('sha256', secret()).update(body).digest();
    if (sig.length !== want.length || !timingSafeEqual(sig, want)) return null;
    const raw = Buffer.from(body, 'base64url');
    if (raw.length > MAX_SHARE_BYTES) return null;
    const payload = JSON.parse(strFromU8(inflateSync(new Uint8Array(raw)))) as SharedAnswer;
    if (payload?.v !== 1 || typeof payload.question !== 'string' || !Array.isArray(payload.templates) || !Array.isArray(payload.facts)) return null;
    return payload;
  } catch {
    return null;
  }
}
