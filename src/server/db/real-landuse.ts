/**
 * Load NSW Landuse 2017 polygons (data/derived/landuse.ndjson from `npm run ingest:landuse`) and
 * compute each station ring's land-use mix (share of ring area by category, rings to 2 km).
 */
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { LAND_USE_CATEGORIES, LAND_USE_SOURCE } from '@/lib/landuse';

import type { Db } from './client';
import { DERIVED_DIR } from './real-sales';

export function realLandUseAvailable(dir = DERIVED_DIR): boolean {
  return existsSync(path.join(dir, 'landuse.ndjson'));
}

export async function loadRealLandUse(db: Db, dir = DERIVED_DIR, log: (m: string) => void = () => {}): Promise<{ polygons: number }> {
  const valid = new Set(Object.keys(LAND_USE_CATEGORIES));
  await db.exec(`delete from land_use_mix; delete from land_use_polygons; delete from datasets where id = '${LAND_USE_SOURCE.dataset_id}';`);
  await db.admin(
    `insert into datasets (id, name, description, source_url, licence, as_of, coverage, is_demo) values ($1,$2,$3,$4,$5,$6,$7,false)`,
    [
      LAND_USE_SOURCE.dataset_id, LAND_USE_SOURCE.name,
      'Official land-use mapping (ALUM classification), grouped into ten categories. Mapped 2013 to 2017; describes use at that time.',
      LAND_USE_SOURCE.url, LAND_USE_SOURCE.licence, LAND_USE_SOURCE.as_of, 'Within 2.1 km of every Sydney train and metro station',
    ],
  );
  let batch: unknown[][] = [];
  let n = 0;
  let logged = 0;
  const flush = async () => {
    if (!batch.length) return;
    // Parameterised: geometry arrives as GeoJSON text, never interpolated.
    const values = batch.map((_, i) => `($${i * 4 + 1}::bigint, '${LAND_USE_SOURCE.dataset_id}', $${i * 4 + 2}, $${i * 4 + 3}, st_setsrid(st_makevalid(st_geomfromgeojson($${i * 4 + 4})), 4326))`);
    await db.admin(
      `insert into land_use_polygons (id, dataset_id, category, tertiary, geom, geom_m)
       select id, ds, category, tertiary, g, st_transform(g, 7856) from (values ${values.join(',')}) as v(id, ds, category, tertiary, g)
       on conflict (id) do nothing`,
      batch.flat(),
    );
    n += batch.length;
    batch = [];
  };
  for await (const line of createInterface({ input: createReadStream(path.join(dir, 'landuse.ndjson')), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as { i: number; c: string; t: string; g: unknown };
    if (!Number.isFinite(r.i) || !valid.has(r.c)) continue;
    batch.push([r.i, r.c, r.t.slice(0, 120), JSON.stringify(r.g)]);
    if (batch.length >= 500) await flush();
    if (n - logged >= 10_000) { logged = n; log(`  land-use polygons ${n.toLocaleString()}`); }
  }
  await flush();
  log(`  land-use polygons ${n.toLocaleString()}; computing ring shares`);
  await db.exec(`
    insert into land_use_mix (dataset_id, station_id, ring_id, category, share_pct)
    with st as (select id, st_transform(geom::geometry, 7856) as g from stations),
    rg as (
      select st.id as station_id, r.id as ring_id,
             case when r.min_m = 0 then st_buffer(st.g, r.max_m, 32)
                  else st_difference(st_buffer(st.g, r.max_m, 32), st_buffer(st.g, r.min_m, 32)) end as ring
      from st cross join rings r where r.max_m <= 2000
    ),
    parts as (
      select rg.station_id, rg.ring_id, p.category, st_area(rg.ring) as ring_area,
             st_area(st_intersection(p.geom_m, rg.ring)) as a
      from rg join land_use_polygons p on p.geom_m && rg.ring and st_intersects(p.geom_m, rg.ring)
    )
    select '${LAND_USE_SOURCE.dataset_id}', station_id, ring_id, category, least(100, round((100 * sum(a) / max(ring_area))::numeric, 2))
    from parts group by station_id, ring_id, category having sum(a) > 0;
  `);
  return { polygons: n };
}
