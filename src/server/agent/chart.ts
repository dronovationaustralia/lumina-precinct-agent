/**
 * Builds a Vega-Lite spec from verified facts. The model only names the facts; every
 * plotted number comes from a query result.
 */
import type { ChartRequest, Fact, VegaLiteSpec } from '@/lib/contracts';
import { RINGS, type RingId } from '@/lib/contracts';
import { LAND_USE_CATEGORIES, type LandUseCategory } from '@/lib/landuse';
import { stationName } from '@/lib/stations';

import { METRIC_BY_ID } from '../metrics/catalogue';

const AXIS_TITLE: Record<string, string> = {
  aud: 'A$', aud_per_m2: 'A$ per m² of land', pct: '%', pct_change: '% change', ratio: 'ratio', count: 'count', trips: 'trips', pct_points: 'points',
};

/** Short, human series name: a land-use category, or the metric name with its ring. */
function seriesName(f: Fact): string {
  if (f.metric?.startsWith('land_use_')) return LAND_USE_CATEGORIES[f.metric.slice('land_use_'.length) as LandUseCategory]?.label ?? f.label;
  if (!f.metric) return f.label;
  return `${METRIC_BY_ID.get(f.metric)?.name ?? f.metric}${f.ring ? `, ${RINGS[f.ring as RingId]?.label ?? f.ring}` : ''}`;
}

export function buildChart(req: ChartRequest, facts: Fact[]): VegaLiteSpec {
  const rows = req.fact_ids.map((id) => facts.find((f) => f.id === id)!).map((f) => ({
    fact_id: f.id,
    station: f.station_id ? stationName(f.station_id) : f.label,
    series: seriesName(f),
    value: f.value,
    display: f.display,
  }));
  const unit = facts.find((f) => f.id === req.fact_ids[0])?.unit ?? '';
  const oneStation = new Set(rows.map((r) => r.station)).size === 1;
  if (oneStation) for (const r of rows) r.station = r.series;
  const multiSeries = !oneStation && new Set(rows.map((r) => r.series)).size > 1;
  const valueTitle = AXIS_TITLE[unit] ?? unit;
  // Categories of one station (e.g. a land-use mix) read best as horizontal bars, labels in full.
  if (oneStation) {
    return {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      title: req.title,
      data: { values: rows },
      mark: { type: 'bar', tooltip: true, cornerRadiusEnd: 3 },
      encoding: {
        y: { field: 'station', type: 'nominal', title: null, sort: null, axis: { labelLimit: 220 } },
        x: { field: 'value', type: 'quantitative', title: valueTitle },
        tooltip: [{ field: 'station', title: 'item' }, { field: 'display', title: 'value' }],
      },
    };
  }
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    title: req.title,
    data: { values: rows },
    mark: { type: 'bar', tooltip: true },
    encoding: {
      x: { field: 'station', type: 'nominal', title: null, sort: null, axis: { labelAngle: 0, labelLimit: 120 } },
      y: { field: 'value', type: 'quantitative', title: valueTitle },
      ...(multiSeries && req.kind === 'grouped_bar' ? { xOffset: { field: 'series' }, color: { field: 'series', type: 'nominal', title: null } } : {}),
      tooltip: [{ field: 'station' }, { field: 'series' }, { field: 'display', title: 'value' }],
    },
  };
}
