/**
 * SAM 3.1 segmentation polygons: the GeoJSON loader test.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createTestDb, type Db } from '@/server/db/client';
import { loadRealCoverPolygons } from '@/server/db/real-cover-polygons';

describe('SAM segmentation polygons load', () => {
  let db: Db;
  beforeAll(async () => { db = await createTestDb(); }, 120_000);
  afterAll(async () => { await db.close(); });

  test('loads cover polygons and serves them per station with counts', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sam-cover-'));
    const poly = (lon: number, lat: number, d: number) => ({
      type: 'Polygon',
      coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]],
    });
    writeFileSync(path.join(dir, 'sam_cover_polygons.geojson'), JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { station_id: 'chatswood', class: 'building', area_m2: 120 }, geometry: poly(151.19, -33.8, 0.001) },
        { type: 'Feature', properties: { station_id: 'chatswood', class: 'building', area_m2: 80 }, geometry: poly(151.191, -33.801, 0.001) },
        { type: 'Feature', properties: { station_id: 'chatswood', class: 'tree_canopy', area_m2: 45 }, geometry: poly(151.192, -33.802, 0.001) },
        { type: 'Feature', properties: { station_id: 'nowhere', class: 'building', area_m2: 50 }, geometry: poly(151.2, -33.81, 0.001) },
        { type: 'Feature', properties: { station_id: 'chatswood', class: 'spaceship', area_m2: 50 }, geometry: poly(151.2, -33.81, 0.001) },
      ],
    }));
    expect(await loadRealCoverPolygons(db, dir)).toEqual({ polygons: 3, stations: 1 });
    const rows = await db.readOnly<{ station_id: string; class: string; area_m2: number; dataset_id: string; geojson: string; as_of: string }>(
      'select station_id, class, area_m2, dataset_id, geojson, as_of from v_sam_cover_polygons where station_id = $1 order by area_m2 desc',
      ['chatswood'],
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ station_id: 'chatswood', class: 'building', area_m2: 120, dataset_id: 'sam_cover_polygons' });
    expect(JSON.parse(rows[0]!.geojson).type).toBe('MultiPolygon');
    expect(rows[0]!.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const counts = await db.readOnly<{ class: string; n: number }>(
      'select class, count(*)::int as n from v_sam_cover_polygons where station_id = $1 group by class order by class',
      ['chatswood'],
    );
    expect(counts).toEqual([{ class: 'building', n: 2 }, { class: 'tree_canopy', n: 1 }]);
  });
});
