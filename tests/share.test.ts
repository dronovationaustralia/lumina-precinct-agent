/**
 * Share links: stateless signed tokens (round trip, tamper resistance, size limit)
 * and the public-path matrix for the auth proxy.
 */
import { describe, expect, test } from 'vitest';

import { isPublicPath } from '@/server/auth/session';
import { MAX_SHARE_BYTES, signShare, verifyShare, type SharedAnswer } from '@/server/share';

const payload: SharedAnswer = {
  v: 1,
  question: 'What is the median unit price within 800 m of Chatswood?',
  station: 'chatswood',
  templates: ['The median unit price within 800 m of Chatswood is {f1}.'],
  facts: [
    { id: 'f1', label: 'Median unit price, Chatswood, within 800 m, last 12 months', value: 1100000, unit: 'aud', display: '$1.10m', source: 'Demo data: synthetic property sales', dataset_id: 'demo_sales', as_of: '2026-09-30', metric: 'median_price', station_id: 'chatswood', ring: '0-800m', property_type: 'unit', demo: true },
  ],
  sources: [{ dataset_id: 'demo_sales', name: 'Demo data: synthetic property sales', licence: 'Synthetic, generated in this repo', as_of: '2026-09-30', demo: true }],
  status: 'verified',
  model: { provider: 'meta', model: 'muse-spark-1.3' },
  created_at: '2026-11-02T00:00:00.000Z',
};

describe('share tokens', () => {
  test('sign/verify round trip', () => {
    const token = signShare(payload);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(verifyShare(token)).toEqual(payload);
  });

  test('tampered tokens are rejected', () => {
    const token = signShare(payload);
    const [body, sig] = token.split('.');
    // Flip a character in the payload.
    const tampered = `${body!.slice(0, 10)}${body![10] === 'A' ? 'B' : 'A'}${body!.slice(11)}.${sig}`;
    expect(verifyShare(tampered)).toBeNull();
    // Swap in a signature from another token.
    const other = signShare({ ...payload, question: 'Something else entirely' });
    expect(verifyShare(`${body}.${other.split('.')[1]}`)).toBeNull();
    // Garbage.
    expect(verifyShare('not-a-token')).toBeNull();
    expect(verifyShare('')).toBeNull();
  });

  test('tokens over the size limit are refused', () => {
    expect(MAX_SHARE_BYTES).toBe(6 * 1024);
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const big = Array.from({ length: 4000 }, () => rand().toFixed(10)).join(' ');
    expect(() => signShare({ ...payload, question: big })).toThrow(/too large/);
    expect(verifyShare(`${'y'.repeat(9500)}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)).toBeNull();
  });
});

describe('public paths', () => {
  test('share pages are public, everything else still needs a session', () => {
    for (const p of ['/p/chatswood', '/p/chatswood/opengraph-image', '/a/abc.def', '/a/abc.def/opengraph-image']) {
      expect(isPublicPath(p)).toBe(true);
    }
    for (const p of ['/', '/signin', '/api/v1/ask', '/api/v1/share', '/api/v1/stations', '/api/auth/session', '/p2/chatswood', '/apples']) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
});
