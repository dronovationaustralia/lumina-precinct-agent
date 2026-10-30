/**
 * GET /api/v1/layers/landuse?station=<id>: NSW Landuse 2017 polygons within 2 km of a station,
 * clipped to that circle and simplified, as GeoJSON with a `category` on each feature.
 */
import { connection, type NextRequest } from 'next/server';

import { StationId } from '@/lib/contracts';
import { LAND_USE_SOURCE } from '@/lib/landuse';
import { getDb } from '@/server/db/client';
import { errorJson, json, preflight } from '@/server/http';

export function OPTIONS() {
  return preflight();
}

export async function GET(request: NextRequest) {
  await connection();
  const station = StationId.safeParse(request.nextUrl.searchParams.get('station'));
  if (!station.success) return errorJson(400, 'invalid_station', 'station must be a Sydney Trains or Metro station id (see /api/v1/stations)');
  const db = await getDb();
  const rows = await db.readOnly<{ id: string; category: string; tertiary: string; geojson: string }>(
    `with c as (
       select st_buffer(st_setsrid(st_makepoint(lon, lat), 4326)::geography, 2000)::geometry as g from v_stations where station_id = $1
     )
     select p.id::text, p.category, p.tertiary,
            st_asgeojson(st_simplifypreservetopology(st_intersection(p.geom, c.g), 0.00002), 6) as geojson
     from v_land_use_polygons p, c where p.geom && c.g and st_intersects(p.geom, c.g)`,
    [station.data],
    { timeoutMs: 15_000 },
  );
  return json(
    {
      type: 'FeatureCollection',
      meta: { station: station.data, source: LAND_USE_SOURCE.name, licence: LAND_USE_SOURCE.licence, mapped: '2013 to 2017', count: rows.length },
      features: rows.map((r) => ({ type: 'Feature', properties: { category: r.category, tertiary: r.tertiary }, geometry: JSON.parse(r.geojson) })),
    },
    { headers: { 'Cache-Control': 'private, max-age=3600' } },
  );
}
