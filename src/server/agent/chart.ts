/**
 * Builds a Vega-Lite spec from verified facts. The model only names the facts; every
 * plotted number comes from a query result.
 */
import type { ChartRequest, Fact, VegaLiteSpec } from '@/lib/contracts';
import { RINGS, type RingId } from '@/lib/contracts';
import { stationName } from '@/lib/stations';

import { METRIC_BY_ID } from '../metrics/catalogue';

const AXIS_TITLE: Record<string, string> = {
  aud: 'A$', aud_per_m2: 'A$ per m² of land', pct: '%', pct_change: '% change', ratio: 'ratio', count: 'count', trips: 'trips', pct_points: 'points',
};

export function buildChart(req: ChartRequest, facts: Fact[]): VegaLiteSpec {
  const rows = req.fact_ids.map((id) => facts.find((f) => f.id === id)!).map((f) => ({
    fact_id: f.id,
    station: f.station_id ? stationName(f.station_id) : f.label,
    series: f.metric ? `${METRIC_BY_ID.get(f.metric)?.name ?? f.metric}${f.ring ? `, ${RINGS[f.ring as RingId]?.label ?? f.ring}` : ''}` : f.label,
    value: f.value,
    display: f.display,
  }));
  const unit = facts.find((f) => f.id === req.fact_ids[0])?.unit ?? '';
  const oneStation = new Set(rows.map((r) => r.station)).size === 1;
  if (oneStation) for (const r of rows) r.station = r.series;
  const multiSeries = !oneStation && new Set(rows.map((r) => r.series)).size > 1;
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    title: req.title,
    data: { values: rows },
    mark: { type: 'bar', tooltip: true },
    encoding: {
      x: { field: 'station', type: 'nominal', title: null, sort: null },
      y: { field: 'value', type: 'quantitative', title: AXIS_TITLE[unit] ?? unit },
      ...(multiSeries && req.kind === 'grouped_bar' ? { xOffset: { field: 'series' }, color: { field: 'series', type: 'nominal', title: null } } : {}),
      tooltip: [{ field: 'station' }, { field: 'series' }, { field: 'display', title: 'value' }],
    },
  };
}
