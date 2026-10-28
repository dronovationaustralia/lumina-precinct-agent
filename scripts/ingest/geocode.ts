/**
 * Step 2b: locate the Valuer General sales with G-NAF and compute reference medians.
 *
 *   npm run ingest:geocode
 *
 * Inputs:  data/derived/vg_sales.csv, gnaf_near_stations.csv, gnaf_street_types.csv
 * Outputs: data/derived/sales_geocoded.csv   (date, price, type, land area, lon, lat, match method;
 *                                              no street addresses)
 *          data/derived/reference_medians.csv (Greater Sydney medians by type, last and prior 12 months)
 *          data/derived/geocode_summary.json  (match rates, overall and in the station postcodes)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { streetTypes } from './address-normalise';
import { readCsv, toCsv } from './csv';
import { GnafIndex, isGreaterSydneyPostcode, type GnafRow } from './match';

const D = path.join('data', 'derived');
const sales = readCsv(readFileSync(path.join(D, 'vg_sales.csv'), 'utf8'));
const gnaf = readCsv(readFileSync(path.join(D, 'gnaf_near_stations.csv'), 'utf8')) as unknown as GnafRow[];
const types = streetTypes(readCsv(readFileSync(path.join(D, 'gnaf_street_types.csv'), 'utf8')).map((r) => ({ code: r.code!, name: r.name! })));
const vgSummary = JSON.parse(readFileSync(path.join(D, 'vg_summary.json'), 'utf8')) as { as_of: string };

const index = new GnafIndex(gnaf);
const nearPostcodes = new Set(gnaf.filter((g) => g.alias === 'P').map((g) => g.postcode));
console.log(`${sales.length.toLocaleString()} sales, ${index.size.toLocaleString()} G-NAF points in ${nearPostcodes.size} postcodes near stations`);

// The postcodes the stations sit in. Most of each lies inside the radius, so the match rate here
// is a fair quality check (postcodes only partly inside the radius understate it).
const CORE_POSTCODES = new Set(['2000', '2060', '2061', '2065', '2067', '2145', '2150', '2142', '2144']);
const out: Record<string, unknown>[] = [];
const methods: Record<string, number> = {};
let inNear = 0, matchedNear = 0, inCore = 0, matchedCore = 0;
for (const s of sales) {
  const near = nearPostcodes.has(s.postcode!);
  const core = CORE_POSTCODES.has(s.postcode!);
  if (near) inNear++;
  if (core) inCore++;
  const m = index.match(s, types);
  if (!m) continue;
  if (near) matchedNear++;
  if (core) matchedCore++;
  methods[m.method] = (methods[m.method] ?? 0) + 1;
  out.push({
    contract_date: s.contract_date, price: s.price, property_type: s.property_type,
    area_m2: s.property_type === 'house' ? s.area_m2 : '', lon: m.point[0].toFixed(7), lat: m.point[1].toFixed(7), match: m.method,
  });
}
writeFileSync(path.join(D, 'sales_geocoded.csv'), toCsv(['contract_date', 'price', 'property_type', 'area_m2', 'lon', 'lat', 'match'], out));

// Greater Sydney medians (the "city median" in the affordability metric), from all sales, not only matched ones.
const asOf = vgSummary.as_of;
const minus = (months: number) => { const d = new Date(`${asOf}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - months); return d.toISOString().slice(0, 10); };
const [m12, m24] = [minus(12), minus(24)];
const median = (xs: number[]) => { const v = [...xs].sort((a, b) => a - b); const h = (v.length - 1) / 2; return v.length ? (v[Math.floor(h)]! + v[Math.ceil(h)]!) / 2 : null; };
const refs: Record<string, unknown>[] = [];
for (const type of ['house', 'unit']) {
  for (const [period, from, to] of [['last_12m', m12, asOf], ['prior_12m', m24, m12]] as const) {
    const prices = sales.filter((s) => s.property_type === type && isGreaterSydneyPostcode(s.postcode!) && s.contract_date! > from && s.contract_date! <= to).map((s) => Number(s.price));
    refs.push({ region: 'greater_sydney', property_type: type, period, median_price: median(prices), sales_count: prices.length });
  }
}
writeFileSync(path.join(D, 'reference_medians.csv'), toCsv(['region', 'property_type', 'period', 'median_price', 'sales_count'], refs));

const summary = {
  as_of: asOf,
  sales_in: sales.length,
  matched: out.length,
  methods,
  station_postcodes: { sales: inCore, matched: matchedCore, rate_pct: inCore ? Math.round((matchedCore / inCore) * 1000) / 10 : null },
  postcodes_touching_radius: { sales: inNear, matched: matchedNear, rate_pct: inNear ? Math.round((matchedNear / inNear) * 1000) / 10 : null },
  reference_medians: refs,
};
writeFileSync(path.join(D, 'geocode_summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
