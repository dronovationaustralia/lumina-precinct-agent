/**
 * GET /api/v1/metrics?station=chatswood&ring=0-800m&property_type=unit
 * Every catalogued metric for one station (station panels). Same definitions as the agent.
 */
import type { NextRequest } from 'next/server';

import { PropertyType, RingId, StationId } from '@/lib/contracts';
import { getDb } from '@/server/db/client';
import { FactStore } from '@/server/facts';
import { METRICS } from '@/server/metrics/catalogue';
import { computeMetric, listDatasets, metricFact, resolveMetricArgs } from '@/server/metrics/query';
import { errorJson, json, preflight } from '@/server/http';


export function OPTIONS() {
  return preflight();
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const station = StationId.safeParse(q.get('station'));
  if (!station.success) return errorJson(400, 'invalid_station', `station must be one of ${StationId.options.join(', ')}`);
  const ring = q.get('ring') ? RingId.safeParse(q.get('ring')) : undefined;
  if (ring && !ring.success) return errorJson(400, 'invalid_ring', `ring must be one of ${RingId.options.join(', ')}`);
  const pt = q.get('property_type') ? PropertyType.safeParse(q.get('property_type')) : undefined;
  if (pt && !pt.success) return errorJson(400, 'invalid_property_type', 'property_type must be house, unit or all');

  const db = await getDb();
  const datasets = await listDatasets(db);
  const store = new FactStore();
  const metrics = [];
  for (const m of METRICS) {
    const r = resolveMetricArgs(m.id, ring?.data, pt?.data);
    if (!r.ok) continue;
    const res = await computeMetric(db, r.metric, station.data, r.ring, r.property_type);
    const f = metricFact(store, res, datasets);
    metrics.push({
      metric: m.id, name: m.name, description: m.description, unit: m.unit, ring: r.ring, property_type: r.property_type,
      value: f.value, display: f.display, suppressed: Boolean(f.suppressed), sales_count: res.row?.sales_count ?? null,
      source: f.source, dataset_id: f.dataset_id, as_of: f.as_of, demo: Boolean(f.demo),
    });
  }
  return json({ station: station.data, metrics, demo_data: metrics.some((m) => m.demo) });
}
