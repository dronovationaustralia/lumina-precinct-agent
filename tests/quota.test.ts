import { afterEach, describe, expect, test, vi } from 'vitest';

import { signSession, SESSION_COOKIE } from '@/server/auth/session';

async function fresh() {
  vi.resetModules();
  return import('@/server/quota');
}
const req = (cookie?: string, auth?: string) =>
  new Request('http://localhost/api/v1/ask', { headers: { ...(cookie ? { cookie } : {}), ...(auth ? { authorization: auth } : {}) } });

afterEach(() => { delete process.env.DEMO_DAILY_ASK; delete process.env.DEMO_DAILY_IMAGE; delete process.env.LUMINA_API_KEYS; });

describe('demo daily caps', () => {
  test('defaults, settings and 0 to switch off', async () => {
    const q = await fresh();
    expect(q.quotaLimit('ask')).toBe(400);
    process.env.DEMO_DAILY_ASK = '2';
    process.env.DEMO_DAILY_IMAGE = '0';
    expect(q.quotaLimit('ask')).toBe(2);
    expect([q.takeQuota('ask'), q.takeQuota('ask'), q.takeQuota('ask')]).toEqual([true, true, false]);
    expect(q.takeQuota('image')).toBe(false);
    expect(q.quotaStatus().used.ask).toBe(2);
  });

  test('demo and anonymous requests are capped; Microsoft users and API keys are not', async () => {
    const q = await fresh();
    process.env.DEMO_DAILY_ASK = '0';
    process.env.LUMINA_API_KEYS = 'k'.repeat(30);
    const demo = `${SESSION_COOKIE}=${await signSession({ sub: 'demo', name: 'Demo user', provider: 'demo', persona: 'developer' }, 1)}`;
    const ms = `${SESSION_COOKIE}=${await signSession({ sub: 'ms:t:u', name: 'David', provider: 'microsoft', persona: 'developer' }, 1)}`;
    expect((await q.demoQuota(req(demo), 'ask'))?.status).toBe(429);
    expect((await q.demoQuota(req(), 'ask'))?.status).toBe(429);
    expect(await q.demoQuota(req(ms), 'ask')).toBeNull();
    expect(await q.demoQuota(req(undefined, `Bearer ${'k'.repeat(30)}`), 'ask')).toBeNull();
  });
});
