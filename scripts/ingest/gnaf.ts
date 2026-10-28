/**
 * Step 2a: extract G-NAF addresses near the ten stations, streaming straight from the zip.
 *
 *   npm run ingest:gnaf                       # writes data/derived/gnaf_near_stations.csv
 *   npm run ingest:gnaf -- --radius 5600      # metres around each station (default 5600)
 *
 * Reads four NSW tables (locality, street locality, default geocode, address detail) and the
 * street type authority table. Only current (not retired) addresses within the radius are kept.
 * Licence: Open G-NAF EULA. Credit: "Incorporates or developed using G-NAF © Geoscape Australia
 * licensed by the Commonwealth of Australia under the Open G-NAF End User Licence Agreement."
 */
import { createWriteStream, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { STATIONS } from '../../src/lib/stations';
import { clean, flatNumber } from './address-normalise';
import { columns, readLines, splitPsv } from './zip-lines';

const DIR = process.env.GNAF_DIR ?? path.join('data', 'raw', 'gnaf');
const OUT_DIR = path.join('data', 'derived');
const radiusArg = process.argv.indexOf('--radius');
const RADIUS = radiusArg > 0 ? Number(process.argv[radiusArg + 1]) : 5600;
const zipArg = process.argv.slice(2).find((a) => a.toLowerCase().endsWith('.zip'));
const zipFile = zipArg ?? path.join(DIR, readdirSync(DIR).find((f) => f.toLowerCase().endsWith('.zip')) ?? '');

function metresBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371008.8, r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const box = {
  minLat: Math.min(...STATIONS.map((s) => s.lat)) - RADIUS / 111_000,
  maxLat: Math.max(...STATIONS.map((s) => s.lat)) + RADIUS / 111_000,
  minLon: Math.min(...STATIONS.map((s) => s.lon)) - RADIUS / 92_000,
  maxLon: Math.max(...STATIONS.map((s) => s.lon)) + RADIUS / 92_000,
};
const near = (lat: number, lon: number) =>
  lat >= box.minLat && lat <= box.maxLat && lon >= box.minLon && lon <= box.maxLon &&
  STATIONS.some((s) => metresBetween(lat, lon, s.lat, s.lon) <= RADIUS);

async function table(re: RegExp, cols: string[], onRow: (r: Record<string, string>) => void): Promise<number> {
  let idx: Record<string, number> | null = null;
  let n = 0;
  const found = await readLines(zipFile, re, (line, i) => {
    if (i === 0) {
      idx = columns(line, cols);
      return;
    }
    if (!line) return;
    const f = splitPsv(line);
    const row: Record<string, string> = {};
    for (const c of cols) row[c] = f[idx![c]!] ?? '';
    onRow(row);
    n++;
    if (n % 500_000 === 0) process.stdout.write(`\r  ${n.toLocaleString()} rows`);
  });
  if (!found) throw new Error(`Table matching ${re} not found in ${zipFile}`);
  process.stdout.write(`\r  ${n.toLocaleString()} rows\n`);
  return n;
}

const t0 = Date.now();
console.log(`G-NAF: ${zipFile}\nKeeping addresses within ${RADIUS} m of ${STATIONS.length} stations`);

mkdirSync(OUT_DIR, { recursive: true });
console.log('Street types');
const typeRows: string[] = ['code,name'];
await table(/STREET_TYPE_AUT_psv\.psv$/i, ['CODE', 'NAME'], (r) => typeRows.push(`${clean(r.CODE!)},${clean(r.NAME!)}`));
writeFileSync(path.join(OUT_DIR, 'gnaf_street_types.csv'), typeRows.join('\n') + '\n');

console.log('Localities');
const localities = new Map<string, string>();
await table(/Standard\/NSW_LOCALITY_psv\.psv$/i, ['LOCALITY_PID', 'LOCALITY_NAME'], (r) => localities.set(r.LOCALITY_PID!, clean(r.LOCALITY_NAME!)));

console.log('Streets');
const streets = new Map<string, { name: string; type: string; suffix: string; locality: string }>();
await table(/Standard\/NSW_STREET_LOCALITY_psv\.psv$/i, ['STREET_LOCALITY_PID', 'STREET_NAME', 'STREET_TYPE_CODE', 'STREET_SUFFIX_CODE', 'LOCALITY_PID'], (r) =>
  streets.set(r.STREET_LOCALITY_PID!, { name: clean(r.STREET_NAME!), type: clean(r.STREET_TYPE_CODE!), suffix: clean(r.STREET_SUFFIX_CODE!), locality: r.LOCALITY_PID! }),
);

console.log('Geocodes (keeping points near stations)');
const points = new Map<string, [number, number]>();
await table(/Standard\/NSW_ADDRESS_DEFAULT_GEOCODE_psv\.psv$/i, ['ADDRESS_DETAIL_PID', 'LONGITUDE', 'LATITUDE', 'DATE_RETIRED'], (r) => {
  if (r.DATE_RETIRED) return;
  const lat = Number(r.LATITUDE), lon = Number(r.LONGITUDE);
  if (Number.isFinite(lat) && Number.isFinite(lon) && near(lat, lon)) points.set(r.ADDRESS_DETAIL_PID!, [lon, lat]);
});
console.log(`  ${points.size.toLocaleString()} address points near stations`);

console.log('Address details');
const outPath = path.join(OUT_DIR, 'gnaf_near_stations.csv');
const out = createWriteStream(outPath);
out.write('pid,alias,flat,number,number_suffix,street,type,street_suffix,locality,postcode,legal,lon,lat\n');
let written = 0;
await table(
  /Standard\/NSW_ADDRESS_DETAIL_psv\.psv$/i,
  ['ADDRESS_DETAIL_PID', 'DATE_RETIRED', 'FLAT_NUMBER_PREFIX', 'FLAT_NUMBER', 'FLAT_NUMBER_SUFFIX', 'NUMBER_FIRST', 'NUMBER_FIRST_SUFFIX',
    'STREET_LOCALITY_PID', 'LOCALITY_PID', 'ALIAS_PRINCIPAL', 'POSTCODE', 'LEGAL_PARCEL_ID'],
  (r) => {
    if (r.DATE_RETIRED) return;
    const p = points.get(r.ADDRESS_DETAIL_PID!);
    if (!p) return;
    const st = streets.get(r.STREET_LOCALITY_PID!);
    const flat = flatNumber(`${r.FLAT_NUMBER_PREFIX}${r.FLAT_NUMBER}${r.FLAT_NUMBER_SUFFIX}`);
    const row = [
      r.ADDRESS_DETAIL_PID, r.ALIAS_PRINCIPAL, flat, r.NUMBER_FIRST, clean(r.NUMBER_FIRST_SUFFIX!), st?.name ?? '', st?.type ?? '', st?.suffix ?? '',
      localities.get(r.LOCALITY_PID!) ?? '', r.POSTCODE, r.LEGAL_PARCEL_ID!.toUpperCase().trim(), p[0].toFixed(7), p[1].toFixed(7),
    ];
    out.write(row.map((v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',') + '\n');
    written++;
  },
);
await new Promise<void>((resolve) => out.end(resolve));
console.log(`\nWrote ${written.toLocaleString()} addresses to ${outPath} in ${Math.round((Date.now() - t0) / 1000)} s`);
