'use client';

/** Scorecard for the selected station, ordered for the user's work type. Click a tile to ask about it. */
import { useEffect, useState } from 'react';

import { fetchMetrics, type MetricDto, type StationDto } from './api';
import { LineBadges } from './LineBadges';

type Persona = 'developer' | 'lender' | 'planner';
type Tile = { key: string; title: string; m?: MetricDto; sub?: string; ask: string };

const ORDER: Record<Persona, string[]> = {
  developer: ['unit_median', 'unit_change', 'premium', 'house_median', 'trips', 'trips_change'],
  lender: ['unit_median', 'unit_sales', 'house_median', 'unit_change', 'premium', 'afford'],
  planner: ['trips', 'trips_change', 'afford', 'unit_median', 'house_median', 'unit_change'],
};

export function PrecinctSnapshot({ station, persona, onAsk }: { station: StationDto; persona: Persona; onAsk: (q: string) => void }) {
  const [data, setData] = useState<{ id: string; unit: MetricDto[]; house: MetricDto[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([fetchMetrics(station.id, 'unit'), fetchMetrics(station.id, 'house')])
      .then(([unit, house]) => live && (setData({ id: station.id, unit, house }), setError(null)))
      .catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [station.id]);

  const ready = data?.id === station.id ? data : null;
  const u = (id: string) => ready?.unit.find((m) => m.metric === id);
  const h = (id: string) => ready?.house.find((m) => m.metric === id);
  const n = station.name;
  const tiles: Record<string, Tile> = {
    unit_median: { key: 'unit_median', title: 'Unit median, 800 m', m: u('median_price'), sub: u('median_price')?.sales_count ? `${u('median_price')!.sales_count} sales, 12 months` : undefined, ask: `What is the median unit price within 800 m of ${n}, and how has it moved?` },
    house_median: { key: 'house_median', title: 'House median, 800 m', m: h('median_price'), sub: h('median_price')?.sales_count ? `${h('median_price')!.sales_count} sales, 12 months` : undefined, ask: `What is the median house price within 800 m of ${n}?` },
    unit_change: { key: 'unit_change', title: 'Unit price change, 12 months', m: u('price_change_12m'), sub: 'within 800 m', ask: `How have unit prices near ${n} changed over 12 months?` },
    unit_sales: { key: 'unit_sales', title: 'Unit sales, 800 m', m: u('sales_count'), sub: 'last 12 months', ask: `How many unit sales support the median near ${n}?` },
    premium: { key: 'premium', title: 'Transit premium, units', m: u('transit_premium'), sub: '800 m vs 2 to 5 km', ask: `What is the transit premium for units at ${n}?` },
    afford: { key: 'afford', title: 'Affordable unit sales', m: u('affordable_share'), sub: 'at or below the Sydney median', ask: `How affordable are units near ${n}?` },
    trips: { key: 'trips', title: 'Station trips, 12 months', m: u('patronage_12m'), sub: 'entries and exits', ask: `How busy is ${n} station?` },
    trips_change: { key: 'trips_change', title: 'Trips change, 12 months', m: u('patronage_change_12m'), sub: 'vs the year before', ask: `How has patronage at ${n} changed over the last year?` },
  };
  const order = ORDER[persona].map((k) => tiles[k]!);
  const asOf = ready?.unit.find((m) => m.metric === 'median_price')?.as_of;

  return (
    <section className="card snapshot" aria-label={`${n} precinct snapshot`}>
      <header className="snap-head">
        <div>
          <p className="kicker">Precinct snapshot</p>
          <h2>{n}</h2>
        </div>
        <LineBadges lines={station.lines} />
      </header>
      {error && <p className="turn-error">{error}</p>}
      <ul className="snap-tiles">
        {order.map((t) => {
          const withheld = t.m && (t.m.suppressed || t.m.value === null);
          return (
            <li key={t.key}>
              <button type="button" className={`snap-tile${!ready ? ' is-loading' : ''}${withheld ? ' is-withheld' : ''}`} onClick={() => onAsk(t.ask)} title={`Ask: ${t.ask}`}>
                <span className="snap-title">{t.title}</span>
                <span className="snap-value">{!ready ? ' ' : withheld ? 'Withheld' : t.m?.display ?? 'n/a'}</span>
                <span className="snap-sub">{withheld ? (t.key.startsWith('trips') ? 'months missing' : 'fewer than 10 sales') : t.sub ?? ' '}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="snap-foot">NSW Valuer General sales{asOf ? ` to ${asOf}` : ''}; Transport for NSW Opal entries and exits. Click a figure to ask about it.</p>
    </section>
  );
}
