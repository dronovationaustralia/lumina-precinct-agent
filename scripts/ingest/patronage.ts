/**
 * Station patronage: TfNSW entries and exits CSV(s) in data/raw/patronage -> data/derived/patronage.csv.
 *
 *   npm run ingest:patronage
 *
 * Then `npm run db:setup -- --load-real` (or just restart local dev) replaces the demo patronage.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { STATIONS } from '../../src/lib/stations';

import { toCsv } from './csv';
import { parsePatronage, type PatronageRow } from './patronage-parse';

const RAW = process.env.PATRONAGE_RAW_DIR ?? path.join('data', 'raw', 'patronage');
const OUT = path.join('data', 'derived');

const files = readdirSync(RAW).filter((f) => f.toLowerCase().endsWith('.csv')).sort();
if (!files.length) {
  console.error(`No CSV in ${RAW}. Download "Train Station Entries and Exits" from TfNSW Open Data (see data/README.md).`);
  process.exit(1);
}

// Later files win for the same station and month (revised figures).
const merged = new Map<string, PatronageRow>();
const months = new Set<string>();
let small = 0;
for (const f of files) {
  const r = parsePatronage(readFileSync(path.join(RAW, f), 'utf8'));
  r.rows.forEach((x) => merged.set(`${x.station_id}|${x.month}`, x));
  r.months.forEach((m) => months.add(m));
  small += r.small;
}
const rows = [...merged.values()].sort((a, b) => a.station_id.localeCompare(b.station_id) || a.month.localeCompare(b.month));
const allMonths = [...months].sort();

const perStation = Object.fromEntries(
  STATIONS.map((s) => {
    const mine = rows.filter((r) => r.station_id === s.id);
    const last12 = mine.filter((r) => r.month > shift(allMonths.at(-1)!, -12)).reduce((t, r) => t + r.entries + r.exits, 0);
    return [s.id, { months: mine.length, last_12m_total: last12 }];
  }),
);
const missing = STATIONS.filter((s) => perStation[s.id]!.months < allMonths.length).map((s) => s.id);

function shift(month: string, by: number): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'patronage.csv'), toCsv(['station_id', 'month', 'entries', 'exits'], rows));
const summary = {
  source: 'Transport for NSW, Train Station Entries and Exits (Opal), CC BY 4.0',
  files,
  first_month: allMonths[0],
  last_month: allMonths.at(-1),
  rows: rows.length,
  stations_with_gaps: missing,
  less_than_50_cells: small,
  per_station: perStation,
};
writeFileSync(path.join(OUT, 'patronage_summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
