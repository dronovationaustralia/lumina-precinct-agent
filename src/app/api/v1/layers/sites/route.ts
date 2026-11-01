/**
 * GET /api/v1/layers/sites?station=<id>: SAM 3.1 opportunity sites (car parks and
 * construction sites) within 800 m of a station, as GeoJSON with class, area and distance.
 */
import { connection, type NextRequest } from 'next/server';

import { StationId } from '@/lib/contracts';
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
  const rows = await db.readOnly<{ id: number; class: string; area_m2: number; distance_m: number; dataset_id: string; geojson: string }>(
    'select id, class, area_m2, distance_m, dataset_id, geojson from v_sam_sites where station_id = $1 order by area_m2 desc',
    [station.data],
  );
  const [ds] = await db.readOnly<{ name: string; licence: string }>('select name, licence from v_datasets where dataset_id = $1', [rows[0]?.dataset_id ?? '']);
  return json(
    {
      type: 'FeatureCollection',
      meta: { station: station.data, source: ds?.name ?? null, licence: ds?.licence ?? null, count: rows.length },
      features: rows.map((r) => ({
        type: 'Feature',
        properties: { class: r.class, area_m2: Math.round(Number(r.area_m2)), distance_m: Math.round(Number(r.distance_m)) },
        geometry: JSON.parse(r.geojson),
      })),
    },
    { headers: { 'Cache-Control': 'private, max-age=3600' } },
  );
}
