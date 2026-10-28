import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { AskResponse, type Fact } from '@/lib/contracts';
import { runAgent } from '@/server/agent/graph';
import { offlineComposeFromFacts, offlinePlan } from '@/server/agent/offline';
import type { AgentModel } from '@/server/agent/providers';
import { createTestDb, type Db } from '@/server/db/client';

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.close();
});

/** A model that plans like the offline planner but composes from a script of bad/good drafts. */
function scriptedModel(drafts: (string | ((facts: Fact[]) => string))[], opts: { throwOnPlan?: boolean } = {}): AgentModel {
  let i = 0;
  return {
    provider: 'offline',
    model: 'scripted-test',
    async plan(messages: BaseMessage[]) {
      if (opts.throwOnPlan) throw new Error('upstream 503');
      return offlinePlan(messages) as AIMessage;
    },
    async compose(_m, ctx) {
      const d = drafts[Math.min(i++, drafts.length - 1)]!;
      return { text: typeof d === 'string' ? d : d(ctx.facts), usage: { input: 100, output: 20 } };
    },
  };
}

describe('agent graph', () => {
  test('answers a comparison with verified numbers, actions and a chart', async () => {
    const r = await runAgent(db, { question: 'Compare Chatswood and St Leonards on price momentum and car-park cover.' }, { provider: 'offline' });
    expect(AskResponse.safeParse(r).success).toBe(true);
    expect(r.verification.status).toBe('verified');
    expect(r.meta.tool_calls.map((t) => t.tool)).toContain('query_metric');
    expect(r.actions.some((a) => a.type === 'compare')).toBe(true);
    expect(r.chart).not.toBeNull();
    // Every number shown is the display value of a fact.
    const displays = r.facts.map((f) => f.display);
    for (const line of r.lines) {
      const stripped = displays.reduce((acc, d) => acc.split(d).join(''), line).replace(/\b(800 m|2 to 5 km|12 months)\b/g, '');
      expect(stripped).not.toMatch(/\d/);
    }
    expect(r.meta.demo_data).toBe(true);
    expect(r.disclaimer).toMatch(/Demo data/);
  });

  test('retries once when the first draft fails verification', async () => {
    const good = (facts: Fact[]) => JSON.stringify({ lines: [`Median unit price within 800 m of Westmead is {${facts[0]!.id}}.`], actions: [], followups: [], chart: null });
    const r = await runAgent(db, { question: 'Unit prices near Westmead' }, { model: scriptedModel(['{"lines":["Prices are $720k and will rise."]}', good]) });
    expect(r.verification.status).toBe('verified_after_retry');
    expect(r.verification.attempts).toBe(2);
    expect(r.lines[0]).toMatch(/\$\d/);
  });

  test('falls back to a template answer after two failed drafts', async () => {
    const r = await runAgent(db, { question: 'Unit prices near Auburn' }, { model: scriptedModel(['not json', '{"lines":["Buy now at 5%."]}']) });
    expect(r.verification.status).toBe('fallback');
    expect(r.lines.length).toBeGreaterThan(0);
    expect(r.lines.join(' ')).toMatch(/Auburn/);
  });

  test('falls back when the model call fails', async () => {
    const r = await runAgent(db, { question: 'Unit prices near Granville' }, { model: scriptedModel([], { throwOnPlan: true }) });
    expect(r.verification.status).toBe('fallback');
    expect(r.verification.errors.join(' ')).toMatch(/upstream 503/);
  });

  test('stays in scope', async () => {
    const r = await runAgent(db, { question: 'What is the weather in Perth?' }, { provider: 'offline' });
    expect(r.meta.tool_calls).toHaveLength(0);
    expect(r.lines[0]).toMatch(/Chatswood/);
  });

  test('offline composer output always passes the verifier', () => {
    const json = offlineComposeFromFacts('x', []);
    expect(JSON.parse(json).lines.join(' ')).not.toMatch(/\d/);
  });
});
