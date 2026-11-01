/**
 * GET /api/v1/layers/station-metric?metric=&property_type=&ring=: every station's value for one
 * metric, for colouring station dots on the map. Aggregates only; suppressed values are omitted.
 */
import { connection, type NextRequest } from 'next/server';

import { PropertyType, RingId } from '@/lib/contracts';
import { getDb } from '@/server/db/client';
import { formatValue } from '@/server/facts';
import { errorJson, json, preflight, rateLimit } from '@/server/http';
import { resolveMetricArgs } from '@/server/metrics/query';
import { rankStations } from '@/server/screener';

export function OPTIONS() {
  return preflight();
}

export async function GET(request: NextRequest) {
  await connection();
  const limited = rateLimit(request);
  if (limited) return limited;
  const params = request.nextUrl.searchParams;
  const ringRaw = params.get('ring');
  const typeRaw = params.get('property_type');
  const ring = ringRaw === null ? undefined : RingId.safeParse(ringRaw);
  if (ring && !ring.success) return errorJson(400, 'bad_ring', 'ring must be one of 0-400m, 0-800m, 800m-2km, 2-5km');
  const propertyType = typeRaw === null ? undefined : PropertyType.safeParse(typeRaw);
  if (propertyType && !propertyType.success) return errorJson(400, 'bad_property_type', 'property_type must be house, unit or all');
  const resolved = resolveMetricArgs(params.get('metric') ?? '', ring?.success ? ring.data : undefined, propertyType?.success ? propertyType.data : undefined);
  if (!resolved.ok) return errorJson(400, 'bad_metric', resolved.error);
  const db = await getDb();
  const ranked = await rankStations(db, { metric: resolved.metric.id, ring: resolved.ring, property_type: resolved.property_type, order: 'desc', limit: 1000 });
  const values = ranked.rows.map((r) => r.value).sort((a, b) => a - b);
  const q = (p: number) => values[Math.min(values.length - 1, Math.floor(p * values.length))] ?? 0;
  const breaks = [0.2, 0.4, 0.6, 0.8].map(q);
  return json(
    {
      metric: ranked.metric.id,
      name: ranked.metric.name,
      unit: ranked.metric.unit,
      ring: ranked.ring,
      property_type: ranked.property_type,
      as_of: ranked.rows[0]?.as_of ?? null,
      // Quintile breaks for a sequential colour ramp.
      breaks,
      break_labels: breaks.map((b) => formatValue(b, ranked.metric.unit)),
      stations: ranked.rows.map((r) => ({ id: r.station_id, value: r.value, display: r.display, sales: r.n_sales })),
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
}
