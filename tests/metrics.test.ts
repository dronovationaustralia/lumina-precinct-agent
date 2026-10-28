/**
 * Metrics catalogue vs a hand check: the same figures computed directly from raw rows
 * (as an admin) must match what the governed path returns.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createTestDb, type Db } from '@/server/db/client';
import { METRIC_BY_ID } from '@/server/metrics/catalogue';
import { computeMetric } from '@/server/metrics/query';

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.close();
});

async function handMedian(station: string, minM: number, maxM: number, type: string, monthsBack: [number, number]) {
  const rows = await db.admin<{ price: string }>(
    `with b as (select max(contract_date) as as_of from sales)
     select s.price from sales s join sale_station ss on ss.sale_id = s.id, b
     where ss.station_id = $1 and ss.distance_m >= $2 and ss.distance_m < $3 and s.property_type = $4
       and s.contract_date > b.as_of - ($5 || ' months')::interval and s.contract_date <= b.as_of - ($6 || ' months')::interval
     order by s.price`,
    [station, minM, maxM, type, String(monthsBack[0]), String(monthsBack[1])],
  );
  const p = rows.map((r) => Number(r.price));
  if (p.length < 10) return { n: p.length, median: null };
  const mid = (p.length - 1) / 2;
  return { n: p.length, median: (p[Math.floor(mid)]! + p[Math.ceil(mid)]!) / 2 };
}

describe('metrics catalogue (demo data)', () => {
  test.each(['chatswood', 'parramatta'])('median unit price within 800 m matches a hand check: %s', async (station) => {
    const hand = await handMedian(station, 0, 800, 'unit', [12, 0]);
    const res = await computeMetric(db, METRIC_BY_ID.get('median_price')!, station, '0-800m', 'unit');
    expect(res.row?.sales_count).toBe(hand.n);
    expect(res.row?.value).toBeCloseTo(hand.median!, 0);
  });

  test('price momentum equals last-12 over prior-12 medians', async () => {
    const last = await handMedian('chatswood', 0, 800, 'unit', [12, 0]);
    const prior = await handMedian('chatswood', 0, 800, 'unit', [24, 12]);
    const res = await computeMetric(db, METRIC_BY_ID.get('price_change_12m')!, 'chatswood', '0-800m', 'unit');
    expect(res.row?.value).toBeCloseTo((last.median! / prior.median! - 1) * 100, 6);
  });

  test('transit premium for units is the ratio of near and far medians', async () => {
    const near = await handMedian('parramatta', 0, 800, 'unit', [12, 0]);
    const far = await handMedian('parramatta', 2000, 5000, 'unit', [12, 0]);
    const res = await computeMetric(db, METRIC_BY_ID.get('transit_premium')!, 'parramatta', '0-800m', 'unit');
    expect(res.row?.value).toBeCloseTo(near.median! / far.median!, 6);
  });

  test('suppresses figures built from fewer than 10 sales', async () => {
    const hand = await handMedian('chatswood', 0, 400, 'house', [12, 0]);
    expect(hand.n).toBeLessThan(10);
    const res = await computeMetric(db, METRIC_BY_ID.get('median_price')!, 'chatswood', '0-400m', 'house');
    expect(res.row?.suppressed).toBe(true);
    expect(res.row?.value).toBeNull();
  });

  test('the agent role cannot read row-level tables or write', async () => {
    await expect(db.readOnly('select * from sales limit 1')).rejects.toThrow(/permission denied/);
    await expect(db.readOnly('select * from sale_station limit 1')).rejects.toThrow(/permission denied/);
    await expect(db.readOnly("insert into datasets values ('x','x','x',null,'x','2026-01-01','x',true)")).rejects.toThrow();
    expect((await db.readOnly('select count(*)::int as n from v_stations'))[0]).toEqual({ n: 10 });
  });
});
