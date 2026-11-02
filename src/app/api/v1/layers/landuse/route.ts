/**
 * GET /api/v1/layers/landuse?station=<id>: NSW Landuse 2017 polygons within 2 km of a station,
 * clipped to that circle and simplified, as GeoJSON with a `category` on each feature.
 */
import { connection, type NextRequest } from 'next/server';

import { StationId } from '@/lib/contracts';
import { LAND_USE_SOURCE } from '@/lib/landuse';
import { FEATURED_STATIONS } from '@/lib/stations';
import { getDb } from '@/server/db/client';
import { errorJson, jsonGzip, preflight } from '@/server/http';
import { LayerCache } from '@/server/layer-cache';

export function OPTIONS() {
  return preflight();
}

type Feature = { type: 'Feature'; properties: { category: string; tertiary: string }; geometry: unknown };
const cache = new LayerCache<Feature[]>(80);

/** Clip and simplify once per station; about 2 m tolerance and 1 m coordinates, which the map cannot tell apart. */
function landUseFor(station: string): Promise<Feature[]> {
  return cache.get(station, async () => {
    const db = await getDb();
    const rows = await db.readOnly<{ category: string; tertiary: string; geojson: string }>(
      `with c as (
         select st_buffer(st_setsrid(st_makepoint(lon, lat), 4326)::geography, 2000)::geometry as g from v_stations where station_id = $1
       )
       select p.category, p.tertiary,
              st_asgeojson(st_simplifypreservetopology(st_intersection(p.geom, c.g), 0.00002), 5) as geojson
       from v_land_use_polygons p, c where p.geom && c.g and st_intersects(p.geom, c.g)`,
      [station],
      { timeoutMs: 20_000 },
    );
    return rows.map((r) => ({ type: 'Feature' as const, properties: { category: r.category, tertiary: r.tertiary }, geometry: JSON.parse(r.geojson) }));
  });
}

// Warm the featured stations in the background on the first request, so the demo's stations are instant.
let warmed = false;
function warmFeatured() {
  if (warmed) return;
  warmed = true;
  void (async () => {
    for (const s of FEATURED_STATIONS) await landUseFor(s.id).catch(() => undefined);
  })();
}

export async function GET(request: NextRequest) {
  await connection();
  const station = StationId.safeParse(request.nextUrl.searchParams.get('station'));
  if (!station.success) return errorJson(400, 'invalid_station', 'station must be a Sydney Trains or Metro station id (see /api/v1/stations)');
  const features = await landUseFor(station.data);
  warmFeatured();
  return jsonGzip(request,
    {
      type: 'FeatureCollection',
      meta: { station: station.data, source: LAND_USE_SOURCE.name, licence: LAND_USE_SOURCE.licence, mapped: '2013 to 2017', count: features.length },
      features,
    },
    { headers: { 'Cache-Control': 'private, max-age=21600' } },
  );
}
