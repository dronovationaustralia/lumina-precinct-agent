import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createTestDb, type Db } from '@/server/db/client';
import { loadRealCover } from '@/server/db/real-cover';

describe('SAM 3.1 aerial cover load', () => {
  let db: Db;
  beforeAll(async () => { db = await createTestDb(); }, 120_000);
  afterAll(async () => { await db.close(); });

  test('replaces demo cover for measured stations and keeps it labelled elsewhere', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sam-'));
    writeFileSync(path.join(dir, 'sam_cover.csv'), [
      'station_id,ring_id,class,cover_pct,res_m,chips,method,fetched',
      'chatswood,0-800m,building,38.4,1,4,sam-3.1,2026-10-31',
      'chatswood,0-800m,tree_canopy,19.2,1,4,sam-3.1,2026-10-31',
      'chatswood,0-400m,car_park,6.5,1,4,sam-3.1,2026-10-31',
      'nowhere,0-800m,building,10,1,4,sam-3.1,2026-10-31',
    ].join('\n'));
    expect(await loadRealCover(db, dir)).toEqual({ stations: 1 });
    const rows = await db.readOnly<{ ring_id: string; class: string; cover_pct: number; dataset_id: string }>(
      "select ring_id, class, cover_pct, dataset_id from v_land_use where station_id = 'chatswood' order by ring_id, class");
    expect(rows).toEqual([
      { ring_id: '0-400m', class: 'car_park', cover_pct: 6.5, dataset_id: 'sam_land_cover' },
      { ring_id: '0-800m', class: 'building', cover_pct: 38.4, dataset_id: 'sam_land_cover' },
      { ring_id: '0-800m', class: 'tree_canopy', cover_pct: 19.2, dataset_id: 'sam_land_cover' },
    ]);
    const demo = await db.readOnly<{ n: number }>("select count(*)::int as n from v_land_use where station_id = 'parramatta' and dataset_id = 'demo_land_use'");
    expect(demo[0]!.n).toBeGreaterThan(0);
  });
});
