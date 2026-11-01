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

describe('only the server signs answers', () => {
  test('shareTokenFor signs the cited facts of a server answer', async () => {
    const { shareTokenFor } = await import('@/server/share');
    const answer = {
      lines: ['x'], templates: payload.templates, disclaimer: 'd', facts: [...payload.facts, { ...payload.facts[0]!, id: 'f9' }],
      sources: payload.sources, actions: [], followups: [], chart: null,
      verification: { status: 'verified', checks: [] },
      meta: { request_id: 'r', provider: 'meta', model: 'muse-spark-1.3', demo_data: true, timings_ms: {}, tokens: { input: 0, output: 0 }, tool_calls: [] },
    } as unknown as import('@/lib/contracts').AskResponse;
    const token = shareTokenFor(payload.question, 'chatswood', answer)!;
    const back = verifyShare(token)!;
    expect(back.facts.map((f) => f.id)).toEqual(['f1']);
    expect(back.station).toBe('chatswood');
  });

  test('the share route accepts only a server-signed token', async () => {
    const { POST } = await import('@/app/api/v1/share/route');
    const { signSession, SESSION_COOKIE } = await import('@/server/auth/session');
    const cookie = `${SESSION_COOKIE}=${await signSession({ sub: 'demo', name: 'Demo user', provider: 'demo', persona: 'developer' }, 1)}`;
    const { NextRequest } = await import('next/server');
    const call = (body: unknown) => POST(new NextRequest('http://localhost/api/v1/share', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
    }));
    // A client-built answer with its own figures is refused.
    const forged = await call({ type: 'answer', question: payload.question, templates: payload.templates, facts: payload.facts, sources: payload.sources, status: 'verified', model: payload.model });
    expect(forged.status).toBe(400);
    const tampered = await call({ type: 'answer', token: `${signShare(payload).split('.')[0]}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` });
    expect(tampered.status).toBe(400);
    const ok = await call({ type: 'answer', token: signShare(payload) });
    expect(ok.status).toBe(200);
  });
});
