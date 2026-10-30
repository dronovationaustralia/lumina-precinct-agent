/**
 * Load SAM 3.1 aerial land cover (data/derived/sam_cover.csv from `npm run sam:batch`) in place of
 * the demo cover for the stations it covers.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { STATION_IDS } from '@/lib/contracts';

import type { Db } from './client';
import { DERIVED_DIR } from './real-sales';

export const SAM_DATASET = 'sam_land_cover';
const CLASSES = new Set(['building', 'tree_canopy', 'car_park', 'construction_site']);
const RINGS = new Set(['0-400m', '0-800m']);

export function realCoverAvailable(dir = DERIVED_DIR): boolean {
  return existsSync(path.join(dir, 'sam_cover.csv'));
}

export async function loadRealCover(db: Db, dir = DERIVED_DIR): Promise<{ stations: number }> {
  const ids = new Set(STATION_IDS);
  const rows = readFileSync(path.join(dir, 'sam_cover.csv'), 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(','))
    .filter(([s, r, c, p, , , , d]) => ids.has(s!) && RINGS.has(r!) && CLASSES.has(c!) && Number.isFinite(Number(p)) && /^\d{4}-\d{2}-\d{2}$/.test(d ?? ''));
  if (!rows.length) return { stations: 0 };
  const stations = [...new Set(rows.map((r) => r[0]!))];
  const fetched = rows[0]![7]!;
  await db.exec(`delete from land_use_ring where dataset_id = '${SAM_DATASET}'; delete from datasets where id = '${SAM_DATASET}';`);
  await db.admin(
    `insert into datasets (id, name, description, source_url, licence, as_of, coverage, is_demo) values ($1,$2,$3,$4,$5,$6,$7,false)`,
    [
      SAM_DATASET, 'Aerial land cover (SAM 3.1 on NSW imagery)',
      'Meta SAM 3.1 segmentation of NSW Spatial Services aerial imagery into building, tree canopy, car park and construction site; percent of ring area per class (classes can overlap).',
      'https://www.spatial.nsw.gov.au/', 'Imagery: NSW Spatial Services (CC BY 4.0). Segmentation: Meta SAM 3.1', fetched,
      `${stations.length} stations, within 800 m`,
    ],
  );
  // Replace demo cover for the stations SAM has measured (both rings) and drop the demo 800 m-2 km ring there.
  await db.admin(`delete from land_use_ring where station_id = any($1::text[])`, [stations]);
  for (const [s, r, c, p] of rows) {
    await db.admin(
      `insert into land_use_ring (dataset_id, station_id, ring_id, class, cover_pct, capture_date, method) values ($1,$2,$3,$4,$5,$6,'sam-3.1')`,
      [SAM_DATASET, s, r, c, Math.min(100, Math.max(0, Number(p))), fetched],
    );
  }
  const left = await db.admin<{ n: number }>(`select count(*)::int as n from land_use_ring where dataset_id = 'demo_land_use'`);
  if (!left[0]?.n) await db.exec(`delete from datasets where id = 'demo_land_use';`);
  return { stations: stations.length };
}
