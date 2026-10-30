/**
 * GET /api/v1/layers/sales-hex?type=unit|house: last-12-month sales binned into ~520 m hexagons,
 * as GeoJSON. Aggregates only; medians from fewer than 10 sales are withheld.
 */
import { connection, type NextRequest } from 'next/server';

import { getDb } from '@/server/db/client';
import { hexPolygon, HEX_SIZE_M } from '@/server/hex';
import { errorJson, json, preflight } from '@/server/http';

export function OPTIONS() {
  return preflight();
}

type HexRow = { q: number; r: number; sales_count: number; median_price: number | null; suppressed: boolean; dataset_id: string; as_of: string };

export async function GET(request: NextRequest) {
  await connection();
  const type = request.nextUrl.searchParams.get('type') ?? 'unit';
  if (type !== 'unit' && type !== 'house') return errorJson(400, 'bad_type', 'type must be unit or house');
  const db = await getDb();
  const rows = await db.readOnly<HexRow>(
    'select q, r, sales_count, median_price, suppressed, dataset_id, as_of from v_sales_hex where property_type = $1',
    [type],
    { timeoutMs: 10_000 },
  );
  const [ds] = await db.readOnly<{ is_demo: boolean; name: string }>('select is_demo, name from v_datasets where dataset_id = $1', [rows[0]?.dataset_id ?? '']);
  const medians = rows.flatMap((r) => (r.median_price === null ? [] : [Number(r.median_price)])).sort((a, b) => a - b);
  const q = (p: number) => medians[Math.min(medians.length - 1, Math.floor(p * medians.length))] ?? 0;
  return json(
    {
      type: 'FeatureCollection',
      meta: {
        property_type: type,
        hex_size_m: HEX_SIZE_M,
        period: 'last 12 months',
        as_of: rows[0]?.as_of ?? null,
        source: ds?.name ?? null,
        demo_data: Boolean(ds?.is_demo),
        min_sales: 10,
        // Quantile breaks for a sequential colour ramp.
        breaks: [0.2, 0.4, 0.6, 0.8].map(q),
      },
      features: rows.map((r) => ({
        type: 'Feature',
        properties: { sales: r.sales_count, median: r.median_price === null ? null : Math.round(Number(r.median_price)), suppressed: r.suppressed },
        geometry: { type: 'Polygon', coordinates: [hexPolygon(r.q, r.r)] },
      })),
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
}
