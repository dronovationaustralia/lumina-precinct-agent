/**
 * GET /api/v1/landuse/{station}
 * Ring percentages per land-use class, plus GeoJSON ring outlines. Land-use polygons are
 * added to `features` once the SAM 3.1 batch has run (day 4).
 */
import type { NextRequest } from 'next/server';

import { RINGS, StationId } from '@/lib/contracts';
import { getDb } from '@/server/db/client';
import { errorJson, json, preflight } from '@/server/http';


export function OPTIONS() {
  return preflight();
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ station: string }> }) {
  const { station } = await ctx.params;
  const parsed = StationId.safeParse(station);
  if (!parsed.success) return errorJson(404, 'unknown_station', `station must be one of ${StationId.options.join(', ')}`);
  const db = await getDb();
  const rows = await db.readOnly<{ ring_id: string; class: string; cover_pct: number; capture_date: string; method: string; dataset_id: string }>(
    'select ring_id, class, cover_pct, capture_date, method, dataset_id from v_land_use where station_id = $1 order by ring_id, class',
    [parsed.data],
  );
  const ringGeo = await db.readOnly<{ ring_id: string; geojson: string }>(
    `select r.ring_id, st_asgeojson(st_buffer(st_setsrid(st_makepoint(s.lon, s.lat), 4326)::geography, r.max_m)::geometry, 6) as geojson
     from v_stations s cross join (values ('0-400m', 400), ('0-800m', 800), ('800m-2km', 2000)) as r(ring_id, max_m)
     where s.station_id = $1`,
    [parsed.data],
  );
  const rings: Record<string, Record<string, number>> = {};
  for (const r of rows) (rings[r.ring_id] ??= {})[r.class] = Number(r.cover_pct);
  return json({
    station: parsed.data,
    capture_date: rows[0]?.capture_date ?? null,
    method: rows[0]?.method ?? null,
    demo_data: rows.some((r) => r.dataset_id.startsWith('demo')),
    note: 'Classes can overlap (for example canopy over a car park); cover is per class, not a partition. One capture date.',
    rings,
    geojson: {
      type: 'FeatureCollection',
      features: ringGeo.map((g) => ({
        type: 'Feature',
        properties: { kind: 'ring', ring_id: g.ring_id, label: RINGS[g.ring_id as keyof typeof RINGS]?.label },
        geometry: JSON.parse(g.geojson),
      })),
    },
  });
}
