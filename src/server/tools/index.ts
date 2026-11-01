/**
 * Governed tools the agent can call. Every tool:
 *  - validates its arguments with Zod (the model's arguments are not trusted);
 *  - reads data only through the read-only path;
 *  - registers every number it returns as a numbered fact;
 *  - records a trace entry (args, ms, SQL, fact ids) for the answer's details.
 */
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

import { PropertyType, RINGS, RingId, StationId, type ToolTrace } from '@/lib/contracts';
import { LAND_USE_CATEGORIES, LAND_USE_SOURCE, type LandUseCategory } from '@/lib/landuse';
import { findStation, stationName, STATIONS } from '@/lib/stations';

import type { Db } from '../db/client';
import type { FactStore } from '../facts';
import { METRIC_IDS, METRICS } from '../metrics/catalogue';
import { computeMetric, listDatasets, metricFact, resolveMetricArgs } from '../metrics/query';
import { rankStations } from '../screener';
import { guardSql, VIEW_DATASET } from './sql-guard';

export const MAX_TOOL_CALLS = 5;

/** `notes` carries non-numeric context (dataset names, unmatched places) to the compose step. */
export type ToolContext = { db: Db; facts: FactStore; trace: ToolTrace[]; notes: string[] };

export const queryMetricArgs = z.object({
  metric: z.enum(METRIC_IDS).describe('Catalogued metric id'),
  stations: z.array(StationId).min(1).max(10).describe('Station ids, e.g. ["chatswood", "st_leonards"]'),
  ring: RingId.optional().describe('Distance ring; defaults to the metric default (usually 0-800m)'),
  property_type: PropertyType.optional().describe('house, unit or all; defaults to the metric default'),
});
export const runSqlArgs = z.object({
  sql: z.string().min(10).max(4000).describe('One SELECT over the governed views only'),
  purpose: z.string().min(3).max(200).describe('Why no catalogued metric fits'),
});
export const landUseArgs = z.object({
  stations: z.array(StationId).min(1).max(10),
  ring: z.enum(['0-400m', '0-800m', '800m-2km']).optional(),
});
export const searchPlaceArgs = z.object({ query: z.string().min(2).max(80) });
export const rankStationsArgs = z.object({
  metric: z.enum(METRIC_IDS).describe('Catalogued metric id to rank by'),
  ring: RingId.optional().describe('Distance ring; defaults to the metric default (usually 0-800m)'),
  property_type: PropertyType.optional().describe('house, unit or all; defaults to the metric default'),
  max_median_price: z.number().positive().max(100_000_000).optional().describe('Only stations whose median price (same ring and type) is below this, in dollars'),
  min_sales: z.number().int().min(10).max(100_000).optional().describe('Only stations with at least this many sales'),
  order: z.enum(['desc', 'asc']).optional().describe('desc = highest first (default); asc = lowest first'),
  limit: z.number().int().min(1).max(20).optional().describe('How many top stations to return as facts (default 10, max 20)'),
});

export const TOOL_ARG_SCHEMAS: Record<string, z.ZodTypeAny> = {
  list_datasets: z.object({}),
  query_metric: queryMetricArgs,
  run_sql: runSqlArgs,
  land_use: landUseArgs,
  search_place: searchPlaceArgs,
  rank_stations: rankStationsArgs,
};

async function traced<T>(ctx: ToolContext, name: string, args: unknown, fn: () => Promise<{ result: T; fact_ids: string[]; sql?: string }>): Promise<string> {
  const t0 = performance.now();
  try {
    const { result, fact_ids, sql } = await fn();
    ctx.trace.push({ tool: name, args, ok: true, ms: Math.round(performance.now() - t0), fact_ids, sql });
    return JSON.stringify(result);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    ctx.trace.push({ tool: name, args, ok: false, ms: Math.round(performance.now() - t0), fact_ids: [], error });
    return JSON.stringify({ error });
  }
}

/** Infer a display unit from a governed view column name. */
function unitFor(column: string): string {
  if (/per_m2/.test(column)) return 'aud_per_m2';
  if (/price|median_city|city_median/.test(column)) return 'aud';
  if (/pct|share/.test(column)) return 'pct';
  if (/count|entries|exits|total/.test(column)) return 'count';
  return '';
}

const METRIC_HELP = METRICS.map((m) => `${m.id} (${m.unit}; rings ${m.rings.join('/')}; types ${m.property_types.join('/')}): ${m.description}`).join('\n');

export function buildTools(ctx: ToolContext): StructuredToolInterface[] {
  const listDatasetsTool = tool(
    async () =>
      traced(ctx, 'list_datasets', {}, async () => {
        const rows = await listDatasets(ctx.db);
        for (const d of rows) ctx.notes.push(`Dataset: ${d.name}. Licence: ${d.licence}.${d.is_demo ? ' Synthetic demo data.' : ''}`);
        return { result: rows.map((d) => ({ id: d.dataset_id, name: d.name, coverage: d.coverage, licence: d.licence, as_of: d.as_of, demo: d.is_demo })), fact_ids: [] };
      }),
    { name: 'list_datasets', description: 'List the datasets available, with coverage, licence and as-of date.', schema: z.object({}) },
  );

  const queryMetricTool = tool(
    async (args) =>
      traced(ctx, 'query_metric', args, async () => {
        const resolved = resolveMetricArgs(args.metric, args.ring, args.property_type);
        if (!resolved.ok) throw new Error(resolved.error);
        const datasets = await listDatasets(ctx.db);
        const out = [];
        let sql = '';
        for (const station of args.stations) {
          const res = await computeMetric(ctx.db, resolved.metric, station, resolved.ring, resolved.property_type);
          sql = res.sql;
          const fact = metricFact(ctx.facts, res, datasets);
          out.push({ fact_id: fact.id, label: fact.label, display: fact.display, usable: fact.value !== null, sales_count: res.row?.sales_count ?? undefined });
        }
        return { result: { metric: resolved.metric.id, ring: resolved.ring, property_type: resolved.property_type, facts: out }, fact_ids: out.map((o) => o.fact_id), sql };
      }),
    {
      name: 'query_metric',
      description: `Get a catalogued metric for one or more stations. Prefer this over run_sql. Returns numbered facts.\nMetrics:\n${METRIC_HELP}`,
      schema: queryMetricArgs,
    },
  );

  const landUseTool = tool(
    async (args) =>
      traced(ctx, 'land_use', args, async () => {
        const ring = args.ring ?? '0-800m';
        const datasets = await listDatasets(ctx.db);
        const out = [];
        let sql = '';
        for (const station of args.stations) {
          // Official land use (NSW Landuse 2017): share of the ring's area by category, largest first.
          const mixSql = 'select category, share_pct, dataset_id, as_of from v_land_use_mix where station_id = $1 and ring_id = $2 order by share_pct desc limit 6';
          const mix = await ctx.db.readOnly<{ category: string; share_pct: number; dataset_id: string; as_of: string }>(mixSql, [station, ring]);
          for (const m of mix.filter((x) => x.share_pct >= 1)) {
            const cat = LAND_USE_CATEGORIES[m.category as LandUseCategory]?.label ?? m.category;
            const f = ctx.facts.add({
              label: `${cat} land use, ${stationName(station)}, ${RINGS[ring as RingId]?.label ?? ring} (NSW Landuse 2017)`,
              value: Number(m.share_pct), unit: 'pct', source: LAND_USE_SOURCE.name, dataset_id: m.dataset_id, as_of: m.as_of,
              metric: `land_use_${m.category}`, station_id: station, ring, property_type: 'all',
            });
            out.push({ fact_id: f.id, label: f.label, display: f.display });
          }
          if (mix.length) sql = mixSql;
          // Aerial land cover (SAM 3.1 on imagery; demo until the batch has run).
          for (const id of ['building_pct', 'canopy_pct', 'carpark_pct', 'construction_pct']) {
            const def = METRICS.find((m) => m.id === id)!;
            const res = await computeMetric(ctx.db, def, station, ring, 'all');
            if (!sql) sql = res.sql;
            const f = metricFact(ctx.facts, res, datasets);
            out.push({ fact_id: f.id, label: f.label, display: f.display });
          }
        }
        ctx.notes.push('Land use comes from NSW Landuse 2017 (mapped 2013 to 2017): describe it as land use at that time. Roads and rail are a land-use category.');
        return { result: { ring, note: 'Land-use shares sum to about 100% per ring. Aerial cover classes can overlap and come from one capture date.', facts: out }, fact_ids: out.map((o) => o.fact_id), sql };
      }),
    {
      name: 'land_use',
      description: 'Land use around stations: the official NSW land-use mix (residential, commercial services, public services, recreation, industrial, roads and rail, land in transition, bushland, water; NSW Landuse 2017) as % of ring area, and aerial cover (building, tree canopy, car park, construction site). Rings 0-400m, 0-800m, 800m-2km.',
      schema: landUseArgs,
    },
  );

  const runSqlTool = tool(
    async (args) =>
      traced(ctx, 'run_sql', args, async () => {
        const guard = await guardSql(args.sql);
        if (!guard.ok) throw new Error(`SQL rejected: ${guard.error}`);
        const rows = await ctx.db.readOnly<Record<string, unknown>>(guard.sql, [], { timeoutMs: 3000 });
        const datasets = await listDatasets(ctx.db);
        const dsKind = guard.views.map((v) => VIEW_DATASET[v]).find(Boolean);
        const ds = datasets.find((d) => dsKind && d.dataset_id.endsWith(dsKind)) ?? datasets[0];
        const factIds: string[] = [];
        const shown = rows.slice(0, 40).map((row) => {
          const context = Object.entries(row).filter(([, v]) => typeof v === 'string').map(([k, v]) => `${k}=${k === 'station_id' ? stationName(String(v)) : v}`).join(', ');
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(row)) {
            const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) && !/^\d{4}-\d{2}/.test(v) ? Number(v) : undefined;
            if (n !== undefined && factIds.length < 60) {
              const f = ctx.facts.add({ label: `${k}${context ? ` (${context})` : ''}`, value: n, unit: unitFor(k), source: ds?.name ?? 'governed views', dataset_id: ds?.dataset_id ?? 'views', as_of: ds?.as_of ?? '', demo: ds?.is_demo });
              factIds.push(f.id);
              out[k] = `{${f.id}}`;
            } else out[k] = v;
          }
          return out;
        });
        return { result: { row_count: rows.length, rows: shown, note: 'Numbers are given as fact ids; cite them as {fN}.' }, fact_ids: factIds, sql: guard.sql };
      }),
    {
      name: 'run_sql',
      description:
        'Run one read-only SELECT over governed views when no catalogued metric fits. Views: v_stations(station_id,name,corridor,lat,lon), v_sales_period(station_id,ring_id,property_type,period[last_12m|prior_12m],sales_count,median_price,median_price_per_m2,suppressed,as_of), v_sales_monthly(station_id,ring_id,property_type,month,sales_count), v_affordable_share(station_id,ring_id,property_type,sales_count,affordable_pct,suppressed,city_median), v_patronage_monthly(station_id,month,entries,exits,total), v_land_use(station_id,ring_id,class,cover_pct,capture_date,method), v_datasets. Max 200 rows. The SQL is shown to the user.',
      schema: runSqlArgs,
    },
  );

  const searchPlaceTool = tool(
    async (args) =>
      traced(ctx, 'search_place', args, async () => {
        const s = findStation(args.query);
        ctx.notes.push(s ? `"${args.query}" is ${s.name} station.` : `"${args.query}" is not one of the covered stations.`);
        return {
          result: s
            ? { station_id: s.id, name: s.name, corridor: s.corridor, lat: s.lat, lon: s.lon }
            : { station_id: null, note: `Not one of the covered stations: ${STATIONS.map((x) => x.name).join(', ')}` },
          fact_ids: [],
        };
      }),
    { name: 'search_place', description: 'Resolve a place or station name to a covered station id.', schema: searchPlaceArgs },
  );

  const rankStationsTool = tool(
    async (args) =>
      traced(ctx, 'rank_stations', args, async () => {
        const ranked = await rankStations(ctx.db, {
          metric: args.metric,
          ring: args.ring,
          property_type: args.property_type,
          filters: { ...(args.max_median_price !== undefined ? { max_median_price: args.max_median_price } : {}), ...(args.min_sales !== undefined ? { min_sales: args.min_sales } : {}) },
          order: args.order ?? 'desc',
          limit: args.limit ?? 10,
        });
        const datasets = await listDatasets(ctx.db);
        const out = ranked.rows.map((r) => {
          const fact = metricFact(
            ctx.facts,
            { metric: ranked.metric, station: r.station_id, ring: ranked.ring, property_type: ranked.property_type, row: { value: r.value, suppressed: false, sales_count: r.n_sales, dataset_id: r.dataset_id, as_of: r.as_of }, sql: ranked.sql },
            datasets,
          );
          return { fact_id: fact.id, label: fact.label, display: fact.display, station_id: r.station_id };
        });
        const mapAction = { type: 'highlight', kind: 'station', ids: ranked.rows.map((r) => r.station_id), style: 'pulse' };
        return {
          result: {
            metric: ranked.metric.id, ring: ranked.ring, property_type: ranked.property_type, order: args.order ?? 'desc',
            facts: out, map_action: mapAction,
            note: 'Facts are in ranked order. Include the map_action in your answer actions so the map highlights these stations.',
          },
          fact_ids: out.map((o) => o.fact_id),
          sql: ranked.sql,
        };
      }),
    {
      name: 'rank_stations',
      description: `Screen all 185 stations by one catalogued metric, highest (or lowest) first, with optional filters. Prefer this over query_metric for "which stations", "rank", "top" or "strongest" questions. Returns numbered facts in ranked order plus a map_action to highlight them. Metrics:\n${METRIC_HELP}`,
      schema: rankStationsArgs,
    },
  );

  return [queryMetricTool, rankStationsTool, landUseTool, runSqlTool, searchPlaceTool, listDatasetsTool] as StructuredToolInterface[];
}
