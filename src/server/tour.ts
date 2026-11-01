/**
 * Guided corridor tours: per-stop verified figures with a one-sentence headline.
 *
 * Figures come from the same governed metric queries as the briefing cards; stations
 * without last-12-month sales rows are skipped, and dynamic line tours are capped at
 * 8 stops. Headlines are templates over the figure displays by default, so they can
 * never contain a number that is not in the figures. When a Meta key is set the API
 * asks Muse Spark for one headline per stop instead, each run through the existing
 * verifier, falling back to the template per stop.
 */
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

import type { PropertyType, RingId } from '@/lib/contracts';
import { STATION_BY_ID } from '@/lib/stations';
import { resolveTour } from '@/lib/tours';

import { parseDraft } from './agent/graph';
import { getModel } from './agent/providers';
import { fillPlaceholders, verifyDraft } from './agent/verify';
import type { Db } from './db/client';
import { FactStore, factsForModel } from './facts';
import { computeMetric, listDatasets, metricFact, resolveMetricArgs } from './metrics/query';

export type TourFigure = {
  label: string;
  display: string;
  value: number | null;
  unit: string;
  source: string;
  dataset_id: string;
  as_of: string;
  demo?: boolean;
};

export type TourStop = {
  station_id: string;
  name: string;
  lines: string[];
  lat: number;
  lon: number;
  figures: TourFigure[];
  headline: string;
  headline_model: boolean;
};

export type StopFigures = { median?: TourFigure; change?: TourFigure; trips?: TourFigure; tripsChange?: TourFigure };

const STOP_QUERIES: ReadonlyArray<{ metric: string; ring: RingId; property_type: PropertyType; key: keyof StopFigures }> = [
  { metric: 'median_price', ring: '0-800m', property_type: 'unit', key: 'median' },
  { metric: 'price_change_12m', ring: '0-800m', property_type: 'unit', key: 'change' },
  { metric: 'patronage_12m', ring: '0-800m', property_type: 'all', key: 'trips' },
  { metric: 'patronage_change_12m', ring: '0-800m', property_type: 'all', key: 'tripsChange' },
];

const MAX_STOPS = 8;

/** One headline from figure displays only: every number it holds is in the figures. */
export function templateHeadline(name: string, f: StopFigures): string {
  const price = f.median
    ? `units ${f.median.display} within 800 m${f.change ? ` (${f.change.display} over 12 months)` : ''}`
    : f.change
      ? `unit prices ${f.change.display} over 12 months`
      : null;
  const trips = f.trips
    ? `${f.trips.display} station trips${f.tripsChange ? ` (${f.tripsChange.display} vs the year before)` : ''}`
    : f.tripsChange
      ? `station trips ${f.tripsChange.display} vs the year before`
      : null;
  const clauses = [price, trips].filter((c): c is string => !!c);
  if (!clauses.length) return `${name}: no verified figures available right now.`;
  return `${name}: ${clauses.join('; ')}.`;
}

const HEADLINE_SYSTEM = `You write one tour-stop headline for Lumina Precinct Agent from verified facts.
Return ONLY a JSON object, no prose around it: {"lines": ["<one headline under 160 characters>"]}
Hard rules: every number MUST be a fact placeholder like {f2} from the facts listed, never a digit you write yourself (except "800 m" and "12 months"). Name the station. Describe, do not explain causes, predict or advise.`;

async function modelHeadline(name: string, store: FactStore): Promise<string | null> {
  try {
    const model = getModel();
    if (model.provider === 'offline') return null;
    const { text } = await model.compose(
      [new SystemMessage(HEADLINE_SYSTEM), new HumanMessage(`Stop: ${name}\n\nFacts (the only numbers you may use):\n${factsForModel(store.all())}`)],
      { question: name, facts: store.all() },
    );
    const { draft } = parseDraft(text);
    if (!draft?.lines.length) return null;
    const v = verifyDraft(draft, store.all(), [], []);
    if (!v.ok) return null;
    return fillPlaceholders(draft.lines[0]!, store.all());
  } catch {
    return null;
  }
}

export async function buildTour(
  db: Db,
  tourId: string,
  opts: { headlines?: 'template' | 'model' } = {},
): Promise<{ id: string; title: string; stops: TourStop[] } | null> {
  const def = resolveTour(tourId);
  if (!def) return null;
  const have = new Set(
    (
      await db.readOnly<{ station_id: string }>(
        'select distinct station_id from v_sales_period where period = $1 and station_id = any($2::text[])',
        ['last_12m', def.stops],
      )
    ).map((r) => r.station_id),
  );
  const ids = def.stops.filter((id) => have.has(id)).slice(0, MAX_STOPS);
  const datasets = await listDatasets(db);
  const stops: TourStop[] = [];
  const stores: FactStore[] = [];
  for (const id of ids) {
    const info = STATION_BY_ID.get(id);
    if (!info) continue;
    const store = new FactStore();
    const figs: StopFigures = {};
    for (const q of STOP_QUERIES) {
      const resolved = resolveMetricArgs(q.metric, q.ring, q.property_type);
      if (!resolved.ok) continue;
      const res = await computeMetric(db, resolved.metric, id, resolved.ring, resolved.property_type);
      const fact = metricFact(store, res, datasets);
      if (fact.suppressed || fact.value === null) continue;
      figs[q.key] = {
        label: fact.label,
        display: fact.display,
        value: fact.value,
        unit: fact.unit,
        source: fact.source,
        dataset_id: fact.dataset_id,
        as_of: fact.as_of,
        ...(fact.demo ? { demo: true } : {}),
      };
    }
    stops.push({
      station_id: id,
      name: info.name,
      lines: [...info.lines],
      lat: info.lat,
      lon: info.lon,
      figures: [figs.median, figs.change, figs.trips, figs.tripsChange].filter((f): f is TourFigure => !!f),
      headline: templateHeadline(info.name, figs),
      headline_model: false,
    });
    stores.push(store);
  }
  if (opts.headlines === 'model' && process.env.MODEL_API_KEY) {
    const heads = await Promise.all(stops.map((s, i) => (s.figures.length ? modelHeadline(s.name, stores[i]!) : Promise.resolve(null))));
    heads.forEach((h, i) => {
      if (h) {
        stops[i]!.headline = h;
        stops[i]!.headline_model = true;
      }
    });
  }
  return { id: def.id, title: def.title, stops };
}
