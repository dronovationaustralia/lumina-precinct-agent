/**
 * Metrics catalogue: every business metric is defined once, here.
 *
 * Each metric has a description, unit, the SQL that computes it (over governed views
 * only, run through the read-only path), and the rings and property types it accepts.
 * `query_metric`, the station panels and the eval script all use these definitions.
 */
import type { PropertyType, RingId } from '@/lib/contracts';
import { RINGS } from '@/lib/contracts';
import type { Unit } from '../facts';

export type MetricParams = { station: string; ring: RingId; property_type: PropertyType };

export type MetricRow = {
  value: number | null;
  suppressed: boolean;
  sales_count?: number | null;
  dataset_id: string;
  as_of: string;
};

export type MetricDef = {
  id: string;
  name: string;
  description: string;
  unit: Unit;
  /** Rings this metric can be computed for. */
  rings: readonly RingId[];
  /** Property types accepted; the first is the default. */
  property_types: readonly PropertyType[];
  /** Ring used when the caller gives none. */
  default_ring: RingId;
  /** Parameterised SQL over governed views: $1 station, $2 ring, $3 property type. */
  sql: string;
  /** Human label for a fact, e.g. "Median unit price, Chatswood, within 800 m, last 12 months". */
  label: (p: MetricParams & { stationName: string }) => string;
};

const ringLabel = (r: RingId) => RINGS[r].label;
const typeWord = (t: PropertyType) => (t === 'all' ? 'all-property' : t);

const PERIOD_RINGS = ['0-400m', '0-800m', '800m-2km', '2-5km'] as const;
const LAND_RINGS = ['0-400m', '0-800m', '800m-2km'] as const;

function landUse(id: string, cls: string, name: string): MetricDef {
  return {
    id,
    name,
    description: `Share of ground area covered by ${name.toLowerCase()} in the ring, from SAM 3.1 segmentation of aerial imagery (one capture date).`,
    unit: 'pct',
    rings: LAND_RINGS,
    property_types: ['all'],
    default_ring: '0-800m',
    sql: `select cover_pct as value, false as suppressed, null::int as sales_count, dataset_id, capture_date as as_of
          from v_land_use where station_id = $1 and ring_id = $2 and class = '${cls}' and $3::text is not null`,
    label: (p) => `${name} cover, ${p.stationName}, ${ringLabel(p.ring)}`,
  };
}

export const METRICS: readonly MetricDef[] = [
  {
    id: 'median_price',
    name: 'Median price',
    description: 'Median sale price in the ring over the last 12 months. Suppressed below 10 sales.',
    unit: 'aud',
    rings: PERIOD_RINGS,
    property_types: ['unit', 'house', 'all'],
    default_ring: '0-800m',
    sql: `select median_price as value, suppressed, sales_count, dataset_id, as_of
          from v_sales_period where station_id = $1 and ring_id = $2 and property_type = $3 and period = 'last_12m'`,
    label: (p) => `Median ${typeWord(p.property_type)} price, ${p.stationName}, ${ringLabel(p.ring)}, last 12 months`,
  },
  {
    id: 'median_price_per_m2',
    name: 'Median house price per m² of land',
    description: 'Median house price divided by land area, last 12 months. Houses only (no floor area in the data).',
    unit: 'aud_per_m2',
    rings: PERIOD_RINGS,
    property_types: ['house'],
    default_ring: '0-800m',
    sql: `select median_price_per_m2 as value, (median_price_per_m2 is null) as suppressed, sales_count, dataset_id, as_of
          from v_sales_period where station_id = $1 and ring_id = $2 and property_type = $3 and period = 'last_12m'`,
    label: (p) => `Median house price per m² of land, ${p.stationName}, ${ringLabel(p.ring)}, last 12 months`,
  },
  {
    id: 'sales_count',
    name: 'Sales count',
    description: 'Number of sales in the ring over the last 12 months.',
    unit: 'count',
    rings: PERIOD_RINGS,
    property_types: ['all', 'unit', 'house'],
    default_ring: '0-800m',
    sql: `select sales_count::float8 as value, false as suppressed, sales_count, dataset_id, as_of
          from v_sales_period where station_id = $1 and ring_id = $2 and property_type = $3 and period = 'last_12m'`,
    label: (p) => `${p.property_type === 'all' ? 'Sales' : `${p.property_type[0]!.toUpperCase()}${p.property_type.slice(1)} sales`}, ${p.stationName}, ${ringLabel(p.ring)}, last 12 months`,
  },
  {
    id: 'price_change_12m',
    name: 'Price momentum (12 months)',
    description: 'Change in median price, last 12 months vs the 12 months before. Suppressed if either period has fewer than 10 sales.',
    unit: 'pct_change',
    rings: PERIOD_RINGS,
    property_types: ['unit', 'house', 'all'],
    default_ring: '0-800m',
    sql: `select case when l.suppressed or p.suppressed then null else (l.median_price / p.median_price - 1) * 100 end as value,
                 (l.suppressed or p.suppressed) as suppressed, least(l.sales_count, p.sales_count) as sales_count, l.dataset_id, l.as_of
          from v_sales_period l join v_sales_period p
            on p.station_id = l.station_id and p.ring_id = l.ring_id and p.property_type = l.property_type and p.period = 'prior_12m'
          where l.station_id = $1 and l.ring_id = $2 and l.property_type = $3 and l.period = 'last_12m'`,
    label: (p) => `Change in median ${typeWord(p.property_type)} price, ${p.stationName}, ${ringLabel(p.ring)}, last 12 months vs the 12 months before`,
  },
  {
    id: 'transit_premium',
    name: 'Transit premium',
    description:
      'Houses: median price per m² of land within 800 m divided by the median 2 to 5 km away. Units: the same ratio of median prices. Ring is fixed by definition. Above 1 means pricier near the station.',
    unit: 'ratio',
    rings: ['0-800m'],
    property_types: ['house', 'unit'],
    default_ring: '0-800m',
    sql: `select case when $3 = 'house' then n.median_price_per_m2 / nullif(f.median_price_per_m2, 0)
                      else n.median_price / nullif(f.median_price, 0) end as value,
                 (n.suppressed or f.suppressed or (case when $3 = 'house' then n.median_price_per_m2 is null or f.median_price_per_m2 is null else false end)) as suppressed,
                 least(n.sales_count, f.sales_count) as sales_count, n.dataset_id, n.as_of
          from v_sales_period n join v_sales_period f
            on f.station_id = n.station_id and f.property_type = n.property_type and f.period = n.period and f.ring_id = '2-5km'
          where n.station_id = $1 and n.ring_id = $2 and n.property_type = $3 and n.period = 'last_12m'`,
    label: (p) => `Transit premium for ${p.property_type}s, ${p.stationName} (within 800 m vs 2 to 5 km)`,
  },
  {
    id: 'affordable_share',
    name: 'Transit-affordable share',
    description: 'Share of last-12-month sales in the ring at or below the median of all sales of the same type in the dataset.',
    unit: 'pct',
    rings: PERIOD_RINGS,
    property_types: ['unit', 'house'],
    default_ring: '0-800m',
    sql: `select affordable_pct as value, suppressed, sales_count, dataset_id, as_of
          from v_affordable_share where station_id = $1 and ring_id = $2 and property_type = $3`,
    label: (p) => `Share of ${p.property_type} sales at or below the city median, ${p.stationName}, ${ringLabel(p.ring)}`,
  },
  {
    id: 'patronage_12m',
    name: 'Station patronage (12 months)',
    description: 'Entries plus exits at the station over the last 12 months. Station level; ring does not apply.',
    unit: 'trips',
    rings: PERIOD_RINGS,
    property_types: ['all'],
    default_ring: '0-800m',
    sql: `with m as (select * from v_patronage_monthly where station_id = $1),
          b as (select max(month) as last from m)
          select sum(total)::float8 as value, false as suppressed, null::int as sales_count, min(dataset_id) as dataset_id, max(month) as as_of
          from m, b where m.month > to_char(to_date(b.last, 'YYYY-MM') - interval '12 months', 'YYYY-MM') and $2::text is not null and $3::text is not null`,
    label: (p) => `Station entries and exits, ${p.stationName}, last 12 months`,
  },
  {
    id: 'patronage_change_12m',
    name: 'Patronage change (12 months)',
    description: 'Change in entries plus exits, last 12 months vs the 12 before. Station level.',
    unit: 'pct_change',
    rings: PERIOD_RINGS,
    property_types: ['all'],
    default_ring: '0-800m',
    sql: `with m as (select * from v_patronage_monthly where station_id = $1),
          b as (select max(month) as last from m),
          t as (select
                  sum(case when month > to_char(to_date(b.last, 'YYYY-MM') - interval '12 months', 'YYYY-MM') then total end) as last12,
                  sum(case when month <= to_char(to_date(b.last, 'YYYY-MM') - interval '12 months', 'YYYY-MM')
                            and month > to_char(to_date(b.last, 'YYYY-MM') - interval '24 months', 'YYYY-MM') then total end) as prior12,
                  min(dataset_id) as dataset_id, max(month) as as_of
                from m, b)
          select (last12::float8 / nullif(prior12, 0) - 1) * 100 as value, false as suppressed, null::int as sales_count, dataset_id, as_of
          from t where $2::text is not null and $3::text is not null`,
    label: (p) => `Change in station entries and exits, ${p.stationName}, last 12 months vs the 12 months before`,
  },
  landUse('canopy_pct', 'tree_canopy', 'Tree canopy'),
  landUse('carpark_pct', 'car_park', 'Car park'),
  landUse('building_pct', 'building', 'Building'),
  landUse('construction_pct', 'construction_site', 'Construction site'),
];

export const METRIC_IDS = METRICS.map((m) => m.id) as [string, ...string[]];
export const METRIC_BY_ID = new Map(METRICS.map((m) => [m.id, m]));
