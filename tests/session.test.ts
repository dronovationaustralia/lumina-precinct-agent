import { afterEach, describe, expect, test, vi } from 'vitest';

import { readSession, signSession } from '@/server/auth/session';

afterEach(() => vi.unstubAllEnvs());

describe('AUTH_DEMO_DISABLED', () => {
  test('ends existing demo sessions but keeps Microsoft sessions', async () => {
    const demo = await signSession({ sub: 'demo:1', name: 'Demo user', provider: 'demo', persona: 'developer' });
    const ms = await signSession({ sub: 'ms:1', name: 'David', provider: 'microsoft', persona: 'developer' });
    expect(await readSession(demo)).not.toBeNull();
    vi.stubEnv('AUTH_DEMO_DISABLED', '1');
    expect(await readSession(demo)).toBeNull();
    expect((await readSession(ms))?.provider).toBe('microsoft');
  });
});
