/**
 * Station screener: ranking every station by a governed metric.
 * The batch query must return the same numbers as the single-station governed path.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { FEATURED_STATIONS, stationName } from '@/lib/stations';
import { runAgent } from '@/server/agent/graph';
import { planCalls } from '@/server/agent/offline';
import type { Db } from '@/server/db/client';
import { createTestDb } from '@/server/db/client';
import { FactStore } from '@/server/facts';
import { METRIC_BY_ID, METRICS } from '@/server/metrics/catalogue';
import { computeMetric, resolveMetricArgs } from '@/server/metrics/query';
import { rankStations } from '@/server/screener';
import { buildTools, type ToolContext } from '@/server/tools';

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe('rankStations', () => {
  test('orders stations by value, highest first by default', async () => {
    const r = await rankStations(db, { metric: 'median_price', property_type: 'unit', ring: '0-800m', order: 'desc', limit: 10 });
    expect(r.rows.length).toBeGreaterThan(1);
    const values = r.rows.map((x) => x.value);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
    for (const row of r.rows) {
      expect(row.station_id).toBeTruthy();
      expect(row.name).toBeTruthy();
      expect(row.display).toBeTruthy();
      expect(row.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test('ascending order returns the same stations lowest first', async () => {
    const desc = await rankStations(db, { metric: 'median_price', property_type: 'unit', ring: '0-800m', order: 'desc', limit: 50 });
    const asc = await rankStations(db, { metric: 'median_price', property_type: 'unit', ring: '0-800m', order: 'asc', limit: 50 });
    const values = asc.rows.map((x) => x.value);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(new Set(asc.rows.map((x) => x.station_id))).toEqual(new Set(desc.rows.map((x) => x.station_id)));
  });

  test('max_median_price keeps only stations below the median', async () => {
    const r = await rankStations(db, {
      metric: 'price_change_12m', property_type: 'unit', ring: '0-800m',
      filters: { max_median_price: 900_000 }, order: 'desc', limit: 50,
    });
    expect(r.rows.length).toBeGreaterThan(0);
    const median = METRIC_BY_ID.get('median_price')!;
    for (const row of r.rows) {
      const m = await computeMetric(db, median, row.station_id, '0-800m', 'unit');
      expect(m.row?.value).not.toBeNull();
      expect(Number(m.row!.value)).toBeLessThan(900_000);
    }
    // And a station known to be above $900k unit median is gone.
    const all = await rankStations(db, { metric: 'median_price', property_type: 'unit', ring: '0-800m', order: 'desc', limit: 50 });
    const dear = all.rows.filter((x) => x.value >= 900_000).map((x) => x.station_id);
    expect(dear.length).toBeGreaterThan(0);
    for (const id of dear) expect(r.rows.map((x) => x.station_id)).not.toContain(id);
  });

  test('min_sales keeps only stations with enough sales', async () => {
    const all = await rankStations(db, { metric: 'median_price', property_type: 'unit', ring: '0-800m', order: 'desc', limit: 200 });
    const counts = all.rows.map((r) => r.n_sales ?? 0);
    const max = Math.max(...counts);
    expect(all.rows.some((r) => (r.n_sales ?? 0) < max)).toBe(true);
    const r = await rankStations(db, {
      metric: 'median_price', property_type: 'unit', ring: '0-800m',
      filters: { min_sales: max }, order: 'desc', limit: 200,
    });
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.length).toBeLessThan(all.rows.length);
    for (const row of r.rows) expect(row.n_sales).toBe(max);
  });

  test('suppressed values are excluded, never estimated', async () => {
    // House medians within 400 m are suppressed at most demo stations (fewer than 10 sales).
    const median = METRIC_BY_ID.get('median_price')!;
    const chat = await computeMetric(db, median, 'chatswood', '0-400m', 'house');
    expect(chat.row?.suppressed).toBe(true);
    const r = await rankStations(db, { metric: 'median_price', property_type: 'house', ring: '0-400m', order: 'desc', limit: 50 });
    expect(r.rows.map((x) => x.station_id)).not.toContain('chatswood');
    for (const row of r.rows) {
      const single = await computeMetric(db, median, row.station_id, '0-400m', 'house');
      expect(single.row?.suppressed).toBe(false);
    }
  });

  test('batch values equal the single-station governed numbers for every metric', async () => {
    for (const def of METRICS) {
      const resolved = resolveMetricArgs(def.id, undefined, undefined);
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) continue;
      const r = await rankStations(db, { metric: def.id, ring: resolved.ring, property_type: resolved.property_type, order: 'desc', limit: 200 });
      const byId = new Map(r.rows.map((x) => [x.station_id, x]));
      for (const s of FEATURED_STATIONS) {
        const single = await computeMetric(db, def, s.id, resolved.ring, resolved.property_type);
        const row = byId.get(s.id);
        if (!single.row || single.row.suppressed || single.row.value === null) {
          expect(row).toBeUndefined();
        } else {
          expect(row?.value).toBeCloseTo(Number(single.row.value), 6);
          expect(row?.n_sales ?? null).toEqual(single.row.sales_count ?? null);
          expect(row?.as_of).toEqual(single.row.as_of);
        }
      }
    }
  });
});

describe('rank_stations tool', () => {
  test('registers one fact per row matching the governed numbers, plus a highlight', async () => {
    const facts = new FactStore();
    const ctx: ToolContext = { db, facts, trace: [], notes: [] };
    const tool = buildTools(ctx).find((t) => t.name === 'rank_stations')!;
    expect(tool).toBeDefined();
    const out = JSON.parse(String(await tool.invoke({ metric: 'price_change_12m', property_type: 'unit', limit: 5 })));
    expect(out.facts).toHaveLength(5);
    expect(out.map_action).toEqual({ type: 'highlight', kind: 'station', ids: out.facts.map((f: { station_id: string }) => f.station_id), style: 'pulse' });
    const def = METRIC_BY_ID.get('price_change_12m')!;
    for (const f of out.facts) {
      const stored = facts.get(f.fact_id);
      expect(stored).toBeDefined();
      const single = await computeMetric(db, def, f.station_id, out.ring, out.property_type);
      expect(stored!.value).toBeCloseTo(Number(single.row!.value!), 6);
      expect(stored!.label).toContain(stationName(f.station_id));
      expect(stored!.metric).toBe('price_change_12m');
    }
    expect(ctx.trace).toHaveLength(1);
    expect(ctx.trace[0]!.fact_ids).toHaveLength(5);
  });

  test('offline planner routes screening questions to rank_stations', () => {
    const calls = planCalls('Which stations under $900k unit median had the strongest unit price growth?');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe('rank_stations');
    expect(calls[0]!.args).toMatchObject({ metric: 'price_change_12m', property_type: 'unit', max_median_price: 900_000 });
    const cheapest = planCalls('Which stations have the lowest unit medians within 800 m?');
    expect(cheapest[0]!.name).toBe('rank_stations');
    expect(cheapest[0]!.args).toMatchObject({ metric: 'median_price', order: 'asc' });
  });

  test('agent answers a screening question with ranked facts and a highlight', async () => {
    const r = await runAgent(db, { question: 'Which stations under $900k unit median had the strongest unit price growth?' }, { provider: 'offline' });
    expect(r.verification.status).toBe('verified');
    expect(r.meta.tool_calls.map((t) => t.tool)).toContain('rank_stations');
    expect(r.actions.some((a) => a.type === 'highlight')).toBe(true);
  }, 120_000);
});
