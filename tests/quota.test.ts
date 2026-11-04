import { afterEach, describe, expect, test, vi } from 'vitest';

import { signSession, SESSION_COOKIE } from '@/server/auth/session';

async function fresh() {
  vi.resetModules();
  return import('@/server/quota');
}
const req = (cookie?: string, auth?: string) =>
  new Request('http://localhost/api/v1/ask', { headers: { ...(cookie ? { cookie } : {}), ...(auth ? { authorization: auth } : {}) } });

afterEach(() => { for (const k of ['DEMO_DAILY_ASK', 'DEMO_DAILY_IMAGE', 'DEMO_PERSON_ASK', 'LUMINA_API_KEYS']) delete process.env[k]; });

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

  test('each visitor has their own share; one visitor cannot use up the day', async () => {
    const q = await fresh();
    process.env.DEMO_PERSON_ASK = '2';
    process.env.DEMO_DAILY_ASK = '3';
    expect([q.spendQuota('ask', 'a'), q.spendQuota('ask', 'a'), q.spendQuota('ask', 'a')]).toEqual(['ok', 'ok', 'person']);
    expect(q.spendQuota('ask', 'b')).toBe('ok');
    expect(q.spendQuota('ask', 'c')).toBe('all');
    expect(q.quotaStatus().used.ask).toBe(3);
    expect(q.quotaLimit('ask')).toBe(3);
    expect(q.personLimit('image')).toBe(5);
  });

  test('visitor address from App Service headers', async () => {
    const q = await fresh();
    const h = (headers: Record<string, string>) => new Request('http://x/', { headers });
    expect(q.visitorOf(h({ 'x-client-ip': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(q.visitorOf(h({ 'x-forwarded-for': '203.0.113.7:51234, 10.0.0.1' }))).toBe('203.0.113.7');
    expect(q.visitorOf(h({ 'x-forwarded-for': '[2001:db8::1]:443' }))).toBe('2001:db8::1');
    expect(q.visitorOf(h({}))).toBe('local');
  });

  test('a visitor over their share gets a personal message', async () => {
    const q = await fresh();
    process.env.DEMO_PERSON_ASK = '0';
    const r = await q.demoQuota(new Request('http://x/', { headers: { 'x-client-ip': '203.0.113.9' } }), 'ask');
    expect(r?.status).toBe(429);
    expect((await r!.json()).error.message).toMatch(/your|You have used/);
  });
});
