/**
 * Step 1 of the sales ingest: parse every Valuer General zip in data/raw/vg into one clean CSV.
 *
 *   npm run ingest:vg                     # writes data/derived/vg_sales.csv and vg_summary.json
 *   npm run ingest:vg -- --months 24
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

const { sales, asOf, stats } = cleanSales(all, months);
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
const summary = { source: 'NSW Valuer General bulk property sales (Valuation NSW), Creative Commons Attribution', zips: zips.length, dat_files: datFiles, as_of: asOf, months, stats };
writeFileSync(path.join(OUT, 'vg_summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
