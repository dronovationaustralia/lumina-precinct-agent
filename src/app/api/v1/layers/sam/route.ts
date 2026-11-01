/**
 * GET /api/v1/layers/sam?station=<id>: what SAM 3.1 segmented around a station — every
 * class's polygons (building, tree canopy, car park, construction site) as GeoJSON, with
 * per-class counts and the capture date.
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
  const rows = await db.readOnly<{ id: number; class: string; area_m2: number; dataset_id: string; geojson: string; as_of: string }>(
    'select id, class, area_m2, dataset_id, geojson, as_of from v_sam_cover_polygons where station_id = $1 order by area_m2 desc',
    [station.data],
    { timeoutMs: 15_000 },
  );
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.class] = (counts[r.class] ?? 0) + 1;
  const [ds] = await db.readOnly<{ name: string; licence: string }>('select name, licence from v_datasets where dataset_id = $1', [rows[0]?.dataset_id ?? '']);
  return json(
    {
      type: 'FeatureCollection',
      meta: {
        station: station.data,
        source: ds?.name ?? null,
        licence: ds?.licence ?? null,
        capture_date: rows[0]?.as_of ?? null,
        counts,
        count: rows.length,
      },
      features: rows.map((r) => ({
        type: 'Feature',
        properties: { class: r.class, area_m2: Math.round(Number(r.area_m2)) },
        geometry: JSON.parse(r.geojson),
      })),
    },
    { headers: { 'Cache-Control': 'private, max-age=86400' } },
  );
}
