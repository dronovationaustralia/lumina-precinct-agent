/**
 * Station screener: rank every station by one governed metric.
 *
 * Each metric's batch query mirrors its single-station SQL in the metrics catalogue
 * (same views, same predicates); `tests/screener.test.ts` checks the two agree for
 * every metric. One query per metric over all stations, not one query per station.
 * Suppressed values are excluded, never estimated.
 */
import type { PropertyType, RingId } from '@/lib/contracts';
import { stationName } from '@/lib/stations';

import type { Db } from './db/client';
import { formatValue } from './facts';
import type { MetricDef, MetricRow } from './metrics/catalogue';
import { resolveMetricArgs } from './metrics/query';

export type RankFilters = {
  /** Keep only stations whose median price (same ring and property type) is below this, in dollars. */
  max_median_price?: number;
  /** Keep only stations with at least this many sales behind the ranked figure. */
  min_sales?: number;
};

export type RankOptions = {
  metric: string;
  property_type?: PropertyType;
  ring?: RingId;
  filters?: RankFilters;
  order: 'desc' | 'asc';
  limit: number;
};

export type RankRow = {
  station_id: string;
  name: string;
  value: number;
  display: string;
  n_sales: number | null;
  as_of: string;
  dataset_id: string;
};

export type RankResult = {
  metric: MetricDef;
  ring: RingId;
  property_type: PropertyType;
  rows: RankRow[];
  sql: string;
};

type BatchRow = { station_id: string } & MetricRow;

/**
 * Batch SQL per metric: $1 ring, $2 property type. Each is the catalogue's
 * single-station query with the station filter lifted to a per-station grouping.
 */
const BATCH_SQL: Record<string, string> = {
  median_price: `select station_id, median_price as value, suppressed, sales_count, dataset_id, as_of
        from v_sales_period where ring_id = $1 and property_type = $2 and period = 'last_12m'`,
  median_price_per_m2: `select station_id, median_price_per_m2 as value, (median_price_per_m2 is null) as suppressed, sales_count, dataset_id, as_of
        from v_sales_period where ring_id = $1 and property_type = $2 and period = 'last_12m'`,
  sales_count: `select station_id, sales_count::float8 as value, false as suppressed, sales_count, dataset_id, as_of
        from v_sales_period where ring_id = $1 and property_type = $2 and period = 'last_12m'`,
  price_change_12m: `select l.station_id as station_id,
               case when l.suppressed or p.suppressed then null else (l.median_price / p.median_price - 1) * 100 end as value,
               (l.suppressed or p.suppressed) as suppressed, least(l.sales_count, p.sales_count) as sales_count, l.dataset_id, l.as_of
        from v_sales_period l join v_sales_period p
          on p.station_id = l.station_id and p.ring_id = l.ring_id and p.property_type = l.property_type and p.period = 'prior_12m'
        where l.ring_id = $1 and l.property_type = $2 and l.period = 'last_12m'`,
  transit_premium: `select n.station_id as station_id,
               case when $2 = 'house' then n.median_price_per_m2 / nullif(f.median_price_per_m2, 0)
                    else n.median_price / nullif(f.median_price, 0) end as value,
               (n.suppressed or f.suppressed or (case when $2 = 'house' then n.median_price_per_m2 is null or f.median_price_per_m2 is null else false end)) as suppressed,
               least(n.sales_count, f.sales_count) as sales_count, n.dataset_id, n.as_of
        from v_sales_period n join v_sales_period f
          on f.station_id = n.station_id and f.property_type = n.property_type and f.period = n.period and f.ring_id = '2-5km'
        where n.ring_id = $1 and n.property_type = $2 and n.period = 'last_12m'`,
  affordable_share: `select station_id, affordable_pct as value, suppressed, sales_count, dataset_id, as_of
        from v_affordable_share where ring_id = $1 and property_type = $2`,
  patronage_12m: `with m as (select * from v_patronage_monthly),
        b as (select station_id, max(month) as last from m group by station_id)
        select m.station_id as station_id,
               case when count(*) = 12 then sum(total)::float8 end as value, count(*) < 12 as suppressed, null::int as sales_count,
               min(m.dataset_id) as dataset_id, max(m.month) as as_of
        from m join b on b.station_id = m.station_id
        where m.month > to_char(to_date(b.last, 'YYYY-MM') - interval '12 months', 'YYYY-MM') and $1::text is not null and $2::text is not null
        group by m.station_id`,
  patronage_change_12m: `with m as (select * from v_patronage_monthly),
        b as (select station_id, max(month) as last from m group by station_id),
        t as (select m.station_id as station_id,
                sum(case when month > to_char(to_date(b.last, 'YYYY-MM') - interval '12 months', 'YYYY-MM') then total end) as last12,
                sum(case when month <= to_char(to_date(b.last, 'YYYY-MM') - interval '12 months', 'YYYY-MM')
                          and month > to_char(to_date(b.last, 'YYYY-MM') - interval '24 months', 'YYYY-MM') then total end) as prior12,
                count(*) filter (where month > to_char(to_date(b.last, 'YYYY-MM') - interval '24 months', 'YYYY-MM')) as months,
                min(m.dataset_id) as dataset_id, max(m.month) as as_of
              from m join b on b.station_id = m.station_id group by m.station_id)
        select station_id, case when months = 24 then (last12::float8 / nullif(prior12, 0) - 1) * 100 end as value, months < 24 as suppressed, null::int as sales_count, dataset_id, as_of
        from t where $1::text is not null and $2::text is not null`,
};

const LAND_USE_CLASS: Record<string, string> = {
  canopy_pct: 'tree_canopy',
  carpark_pct: 'car_park',
  building_pct: 'building',
  construction_pct: 'construction_site',
};
for (const [id, cls] of Object.entries(LAND_USE_CLASS)) {
  BATCH_SQL[id] = `select station_id, cover_pct as value, false as suppressed, null::int as sales_count, dataset_id, capture_date as as_of
        from v_land_use where ring_id = $1 and class = '${cls}' and $2::text is not null`;
}

const oneLine = (sql: string) => sql.replace(/\s+/g, ' ').trim();

export async function rankStations(db: Db, opts: RankOptions): Promise<RankResult> {
  const resolved = resolveMetricArgs(opts.metric, opts.ring, opts.property_type);
  if (!resolved.ok) throw new Error(resolved.error);
  const sql = BATCH_SQL[resolved.metric.id];
  if (!sql) throw new Error(`ranking is not supported for metric ${resolved.metric.id}`);

  const used: string[] = [oneLine(sql)];
  const rows = await db.readOnly<BatchRow>(sql, [resolved.ring, resolved.property_type]);
  let ranked: RankRow[] = [];
  for (const r of rows) {
    if (r.suppressed || r.value === null || r.value === undefined) continue;
    const value = Number(r.value);
    if (!Number.isFinite(value)) continue;
    ranked.push({
      station_id: r.station_id,
      name: stationName(r.station_id),
      value,
      display: formatValue(value, resolved.metric.unit),
      n_sales: r.sales_count === null || r.sales_count === undefined ? null : Number(r.sales_count),
      as_of: r.as_of,
      dataset_id: r.dataset_id,
    });
  }

  const maxMedian = opts.filters?.max_median_price;
  if (maxMedian !== undefined) {
    const medians = await db.readOnly<BatchRow>(BATCH_SQL.median_price!, [resolved.ring, resolved.property_type]);
    used.push(oneLine(BATCH_SQL.median_price!));
    const under = new Set(
      medians.filter((m) => !m.suppressed && m.value !== null && Number(m.value) < maxMedian).map((m) => m.station_id),
    );
    ranked = ranked.filter((r) => under.has(r.station_id));
  }
  const minSales = opts.filters?.min_sales;
  if (minSales !== undefined) ranked = ranked.filter((r) => r.n_sales !== null && r.n_sales >= minSales);

  ranked.sort((a, b) => (opts.order === 'asc' ? a.value - b.value : b.value - a.value) || a.station_id.localeCompare(b.station_id));
  return { metric: resolved.metric, ring: resolved.ring, property_type: resolved.property_type, rows: ranked.slice(0, Math.max(0, opts.limit)), sql: used.join(' | ') };
}
