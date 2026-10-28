/**
 * Step 1 of the sales ingest: parse every Valuer General zip in data/raw/vg into one clean CSV.
 *
 *   npm run ingest:vg                     # writes data/derived/vg_sales.csv and vg_summary.json
 *   npm run ingest:vg -- --months 24 --lag-months 3
 *
 * --lag-months (default 3): recent months are incomplete because sales are lodged after contract,
 * so the window ends at the end of the month this many months before the latest contract date.
 *
 * Next step: ingest:geocode joins these addresses to G-NAF coordinates.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { cleanSales, datTextsFromZip, parseDat, type VgSale } from './vg-parse';

const RAW = process.env.VG_RAW_DIR ?? path.join('data', 'raw', 'vg');
const OUT = path.join('data', 'derived');
const monthsArg = process.argv.indexOf('--months');
const months = monthsArg > 0 ? Number(process.argv[monthsArg + 1]) : 24;
const lagArg = process.argv.indexOf('--lag-months');
const lagMonths = lagArg > 0 ? Number(process.argv[lagArg + 1]) : 3;

const zips = readdirSync(RAW).filter((f) => f.toLowerCase().endsWith('.zip')).sort();
if (!zips.length) {
  console.error(`No zips in ${RAW}. Download the Valuer General files first (see data/README.md).`);
  process.exit(1);
}

const all: VgSale[] = [];
let datFiles = 0;
for (const z of zips) {
  const texts = datTextsFromZip(new Uint8Array(readFileSync(path.join(RAW, z))), z);
  datFiles += texts.length;
  for (const t of texts) all.push(...parseDat(t.text));
  process.stdout.write(`\r${z}: ${all.length.toLocaleString()} sale records so far`);
}
console.log();

const { sales, asOf, latestContract, stats } = cleanSales(all, months, lagMonths);
mkdirSync(OUT, { recursive: true });

const cols: (keyof VgSale)[] = [
  'property_id', 'dealing', 'contract_date', 'price', 'property_type', 'area_m2', 'unit_number', 'house_number',
  'street_name', 'locality', 'postcode', 'legal', 'strata_lot', 'zoning', 'district',
];
const esc = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
writeFileSync(path.join(OUT, 'vg_sales.csv'), [cols.join(','), ...sales.map((s) => cols.map((c) => esc(s[c])).join(','))].join('\n') + '\n');
// Monthly counts show the reporting lag that the cutoff avoids.
const monthly: Record<string, number> = {};
for (const s of all) if (s.nature === 'R' && s.contract_date) monthly[s.contract_date.slice(0, 7)] = (monthly[s.contract_date.slice(0, 7)] ?? 0) + 1;
const recent = Object.fromEntries(Object.entries(monthly).sort().slice(-8));
const summary = {
  source: 'NSW Valuer General bulk property sales (Valuation NSW), Creative Commons Attribution',
  zips: zips.length, dat_files: datFiles, latest_contract_date: latestContract, as_of: asOf, months, lag_months: lagMonths,
  note: `Window ends ${asOf}: later months are still being lodged.`, recent_monthly_records: recent, stats,
};
writeFileSync(path.join(OUT, 'vg_summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
