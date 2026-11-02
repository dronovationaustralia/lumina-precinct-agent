'use client';

/**
 * "What can I ask?": the question types Lumina answers, one example each, the data
 * behind each with as-of dates, and what Lumina won't do. Pure render, no effects.
 */
import { fillStep } from '@/lib/personas';

export type AskDataset = { id: string; name?: string; as_of?: string; licence?: string; demo?: boolean };

type QuestionType = { type: string; example: string; datasets: string[] };

const TYPES: QuestionType[] = [
  { type: 'Prices', example: 'What is the median unit price within 800 m of {station}?', datasets: ['nsw_vg_sales', 'demo_sales'] },
  { type: 'Momentum', example: 'How have unit prices near {station} changed over 12 months?', datasets: ['nsw_vg_sales', 'demo_sales'] },
  { type: 'Sales depth', example: 'How many unit sales support the median near {station}?', datasets: ['nsw_vg_sales', 'demo_sales'] },
  { type: 'Transit premium', example: 'What is the transit premium for units at {station}?', datasets: ['nsw_vg_sales', 'demo_sales'] },
  { type: 'Patronage', example: 'How busy is {station} station compared with a year earlier?', datasets: ['tfnsw_entries_exits', 'demo_patronage'] },
  { type: 'Land use and aerial cover', example: 'What is the land use within 800 m of {station}?', datasets: ['nsw_landuse_2017', 'sam_land_cover', 'demo_land_use'] },
  { type: 'Sites', example: 'Find candidate development sites near {station}.', datasets: ['sam_sites'] },
  { type: 'Screening', example: 'Which stations have the strongest unit price momentum under $1,000,000?', datasets: ['nsw_vg_sales', 'demo_sales', 'tfnsw_entries_exits', 'demo_patronage'] },
  { type: 'Tours', example: 'Open the Tour picker up top and fly the T1 line station by station.', datasets: ['nsw_vg_sales', 'demo_sales', 'tfnsw_entries_exits', 'demo_patronage'] },
];

const WONT_DO = [
  'No advice on whether to buy: general information, not financial advice.',
  'No figures without a source: every number is computed from open data and checked before you see it.',
  'No forecasts: only what the data shows, never what happens next.',
  'No individual property records: medians and counts only, never one sale.',
];

function findDataset(datasets: AskDataset[], keys: string[]): AskDataset[] {
  const out: AskDataset[] = [];
  for (const k of keys) {
    const d = datasets.find((x) => x.id === k) ?? datasets.find((x) => x.id.includes(k));
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

export function AskDrawer({ datasets, stationName, onClose, onAsk }: { datasets: AskDataset[] | null; stationName?: string; onClose: () => void; onAsk: (q: string) => void }) {
  // Examples are templates; they read with the selected station (or a sample one) and go into
  // the question box with their {station} slot, so the user can pick or change the station.
  const shown = (t: string) => fillStep(t, stationName ?? 'Chatswood');
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer guide" role="dialog" aria-modal="true" aria-labelledby="ask-title">
        <header className="drawer-head">
          <div>
            <p className="kicker">Ask guide</p>
            <h2 id="ask-title">What can I ask?</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </header>

        <dl className="guide-list ask-list">
          {TYPES.map((t) => {
            const found = datasets ? findDataset(datasets, t.datasets) : [];
            return (
              <div key={t.type}>
                <dt>{t.type}</dt>
                <dd>
                  {t.type === 'Tours' ? <span className="ask-example">{t.example}</span> : <button type="button" className="link-button ask-example" onClick={() => { onAsk(t.example); onClose(); }} title="Put this question in the box">
                    “{shown(t.example)}”
                  </button>}
                  <span className="ask-data">
                    {found.length
                      ? found.map((d) => `${d.name ?? d.id}${d.as_of ? ` (as of ${d.as_of})` : ''}${d.demo ? ' [demo]' : ''}`).join('; ')
                      : 'Data not loaded yet.'}
                  </span>
                </dd>
              </div>
            );
          })}
        </dl>

        <h3>What Lumina won&apos;t do</h3>
        <ul className="guide-tips">
          {WONT_DO.map((w) => <li key={w}>{w}</li>)}
        </ul>
      </aside>
    </div>
  );
}
