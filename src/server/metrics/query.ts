import type { Fact, PropertyType, RingId } from '@/lib/contracts';
import { stationName } from '@/lib/stations';

import type { Db } from '../db/client';
import type { FactStore } from '../facts';
import { METRIC_BY_ID, type MetricDef, type MetricRow } from './catalogue';

export type DatasetInfo = { dataset_id: string; name: string; licence: string; as_of: string; source_url: string | null; is_demo: boolean; description: string; coverage: string };

let datasetCache: { at: number; rows: DatasetInfo[] } | undefined;

export async function listDatasets(db: Db): Promise<DatasetInfo[]> {
  if (datasetCache && Date.now() - datasetCache.at < 60_000) return datasetCache.rows;
  const rows = await db.readOnly<DatasetInfo>('select * from v_datasets order by dataset_id');
  datasetCache = { at: Date.now(), rows };
  return rows;
}

export function resetDatasetCache() {
  datasetCache = undefined;
}

export type MetricResult = { metric: MetricDef; station: string; ring: RingId; property_type: PropertyType; row: MetricRow | undefined; sql: string };

/** Resolve defaults and validate a metric request. Returns an error string if invalid. */
export function resolveMetricArgs(metricId: string, ring?: RingId, propertyType?: PropertyType):
  { ok: true; metric: MetricDef; ring: RingId; property_type: PropertyType } | { ok: false; error: string } {
  const metric = METRIC_BY_ID.get(metricId);
  if (!metric) return { ok: false, error: `unknown metric ${metricId}` };
  const r = ring && metric.rings.includes(ring) ? ring : metric.default_ring;
  if (ring && !metric.rings.includes(ring) && metric.id !== 'transit_premium') {
    return { ok: false, error: `${metricId} supports rings ${metric.rings.join(', ')} (got ${ring})` };
  }
  const pt = propertyType && metric.property_types.includes(propertyType) ? propertyType : metric.property_types[0]!;
  if (propertyType && !metric.property_types.includes(propertyType) && propertyType !== 'all') {
    return { ok: false, error: `${metricId} supports property types ${metric.property_types.join(', ')} (got ${propertyType})` };
  }
  return { ok: true, metric, ring: r, property_type: pt };
}

export async function computeMetric(db: Db, metric: MetricDef, station: string, ring: RingId, propertyType: PropertyType): Promise<MetricResult> {
  const rows = await db.readOnly<MetricRow>(metric.sql, [station, ring, propertyType]);
  const row = rows[0];
  if (row && row.value !== null) row.value = Number(row.value);
  return { metric, station, ring, property_type: propertyType, row, sql: metric.sql.replace(/\s+/g, ' ').trim() };
}

export function metricFact(store: FactStore, res: MetricResult, datasets: DatasetInfo[]): Fact {
  const ds = datasets.find((d) => d.dataset_id === res.row?.dataset_id);
  const suppressed = res.row ? Boolean(res.row.suppressed) || res.row.value === null : false;
  return store.add({
    label: res.metric.label({ station: res.station, stationName: stationName(res.station), ring: res.ring, property_type: res.property_type }),
    value: suppressed || !res.row ? null : res.row.value,
    unit: res.metric.unit,
    source: ds?.name ?? 'unknown',
    dataset_id: res.row?.dataset_id ?? 'none',
    as_of: res.row?.as_of ?? ds?.as_of ?? '',
    suppressed: suppressed || undefined,
    display: !res.row ? 'no data' : undefined,
    metric: res.metric.id,
    station_id: res.station,
    ring: res.ring,
    property_type: res.property_type,
    demo: ds?.is_demo,
  });
}
