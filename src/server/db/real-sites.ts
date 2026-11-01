/**
 * Load SAM 3.1 opportunity sites (data/derived/sam_sites.geojson from `npm run sam:sites`):
 * car parks and construction sites within 800 m of stations, as polygons.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { STATION_IDS } from '@/lib/contracts';

import type { Db } from './client';
import { DERIVED_DIR } from './real-sales';

export const SAM_SITES_DATASET = 'sam_sites';
const CLASSES = new Set(['car_park', 'construction_site']);

type SiteFeature = {
  properties: { station_id: string; class: string; area_m2: number; distance_m: number };
  geometry: { type: string; coordinates: unknown };
};

export function realSitesAvailable(dir = DERIVED_DIR): boolean {
  return existsSync(path.join(dir, 'sam_sites.geojson'));
}

function validRing(coordinates: unknown): boolean {
  if (!Array.isArray(coordinates) || !Array.isArray(coordinates[0])) return false;
  const ring = coordinates[0] as unknown[];
  return ring.length >= 4 && ring.every((p) => Array.isArray(p) && Number.isFinite((p as unknown[])[0]) && Number.isFinite((p as unknown[])[1]));
}

export async function loadRealSites(db: Db, dir = DERIVED_DIR): Promise<{ sites: number; stations: number }> {
  const ids = new Set(STATION_IDS);
  const fc = JSON.parse(readFileSync(path.join(dir, 'sam_sites.geojson'), 'utf8')) as { features: SiteFeature[] };
  const rows = (fc.features ?? []).filter(
    (f) =>
      ids.has(f.properties?.station_id) &&
      CLASSES.has(f.properties?.class) &&
      Number.isFinite(f.properties?.area_m2) &&
      f.properties.area_m2 > 0 &&
      Number.isFinite(f.properties?.distance_m) &&
      f.properties.distance_m >= 0 &&
      f.geometry?.type === 'Polygon' &&
      validRing(f.geometry.coordinates),
  );
  await db.exec(`delete from sam_sites; delete from datasets where id = '${SAM_SITES_DATASET}';`);
  if (!rows.length) return { sites: 0, stations: 0 };
  const stations = [...new Set(rows.map((r) => r.properties.station_id))];
  await db.admin(
    `insert into datasets (id, name, description, source_url, licence, as_of, coverage, is_demo) values ($1,$2,$3,$4,$5,$6,$7,false)`,
    [
      SAM_SITES_DATASET, 'Opportunity sites (SAM 3.1 on NSW imagery)',
      'Car parks and construction sites found by Meta SAM 3.1 segmentation of NSW Spatial Services aerial imagery within 800 m of stations, traced into polygons. Candidate sites for investigation only: zoning and ownership are not checked.',
      'https://www.spatial.nsw.gov.au/', 'Imagery: NSW Spatial Services (CC BY 4.0). Segmentation: Meta SAM 3.1',
      new Date().toISOString().slice(0, 10),
      `${stations.length} stations, within 800 m`,
    ],
  );
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const values = batch.map((_, j) => `('${SAM_SITES_DATASET}', $${j * 5 + 1}, $${j * 5 + 2}, $${j * 5 + 3}, $${j * 5 + 4}, st_multi(st_collectionextract(st_makevalid(st_setsrid(st_geomfromgeojson($${j * 5 + 5}), 4326)), 3)))`);
    await db.admin(
      `insert into sam_sites (dataset_id, station_id, class, area_m2, distance_m, geom) values ${values.join(',')}`,
      batch.flatMap((r) => [r.properties.station_id, r.properties.class, r.properties.area_m2, r.properties.distance_m, JSON.stringify(r.geometry)]),
    );
  }
  return { sites: rows.length, stations: stations.length };
}
