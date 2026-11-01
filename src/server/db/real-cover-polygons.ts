/**
 * Load SAM 3.1 segmentation polygons (data/derived/sam_cover_polygons.geojson from
 * `npm run sam:polygons`): every class's masks for each featured station, traced into polygons.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { STATION_IDS } from '@/lib/contracts';

import type { Db } from './client';
import { DERIVED_DIR } from './real-sales';

export const SAM_COVER_POLYGONS_DATASET = 'sam_cover_polygons';
const CLASSES = new Set(['building', 'tree_canopy', 'car_park', 'construction_site']);

type CoverFeature = {
  properties: { station_id: string; class: string; area_m2: number };
  geometry: { type: string; coordinates: unknown };
};

export function realCoverPolygonsAvailable(dir = DERIVED_DIR): boolean {
  return existsSync(path.join(dir, 'sam_cover_polygons.geojson'));
}

function validRing(coordinates: unknown): boolean {
  if (!Array.isArray(coordinates) || !Array.isArray(coordinates[0])) return false;
  const ring = coordinates[0] as unknown[];
  return ring.length >= 4 && ring.every((p) => Array.isArray(p) && Number.isFinite((p as unknown[])[0]) && Number.isFinite((p as unknown[])[1]));
}

export async function loadRealCoverPolygons(db: Db, dir = DERIVED_DIR): Promise<{ polygons: number; stations: number }> {
  const ids = new Set(STATION_IDS);
  const fc = JSON.parse(readFileSync(path.join(dir, 'sam_cover_polygons.geojson'), 'utf8')) as { features: CoverFeature[] };
  const rows = (fc.features ?? []).filter(
    (f) =>
      ids.has(f.properties?.station_id) &&
      CLASSES.has(f.properties?.class) &&
      Number.isFinite(f.properties?.area_m2) &&
      f.properties.area_m2 > 0 &&
      f.geometry?.type === 'Polygon' &&
      validRing(f.geometry.coordinates),
  );
  await db.exec(`delete from sam_cover_polygons; delete from datasets where id = '${SAM_COVER_POLYGONS_DATASET}';`);
  if (!rows.length) return { polygons: 0, stations: 0 };
  const stations = [...new Set(rows.map((r) => r.properties.station_id))];
  await db.admin(
    `insert into datasets (id, name, description, source_url, licence, as_of, coverage, is_demo) values ($1,$2,$3,$4,$5,$6,$7,false)`,
    [
      SAM_COVER_POLYGONS_DATASET, 'SAM 3.1 segmentation polygons (NSW imagery)',
      'Every class segmented by Meta SAM 3.1 on NSW Spatial Services aerial imagery around the featured stations (building, tree canopy, car park, construction site), traced into polygons. Masks can overlap and miss shaded canopy.',
      'https://www.spatial.nsw.gov.au/', 'Imagery: NSW Spatial Services (CC BY 4.0). Segmentation: Meta SAM 3.1',
      new Date().toISOString().slice(0, 10),
      `${stations.length} stations, chip grids (about 2 km across)`,
    ],
  );
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const values = batch.map((_, j) => `('${SAM_COVER_POLYGONS_DATASET}', $${j * 4 + 1}, $${j * 4 + 2}, $${j * 4 + 3}, st_multi(st_collectionextract(st_makevalid(st_setsrid(st_geomfromgeojson($${j * 4 + 4}), 4326)), 3)))`);
    await db.admin(
      `insert into sam_cover_polygons (dataset_id, station_id, class, area_m2, geom) values ${values.join(',')}`,
      batch.flatMap((r) => [r.properties.station_id, r.properties.class, r.properties.area_m2, JSON.stringify(r.geometry)]),
    );
  }
  return { polygons: rows.length, stations: stations.length };
}
