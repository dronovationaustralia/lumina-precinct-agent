/**
 * Exact station locations from the TfNSW GTFS timetable (stops.txt, parent stations).
 *
 *   npm run ingest:gtfs          # reads the zip in data/raw/gtfs, writes src/lib/station-coords.json
 *
 * The output is small and committed (GTFS is CC BY 4.0, Transport for NSW). Each station is the
 * parent stop (location_type 1) named "<Station> Station" nearest the approximate location;
 * matches more than 1.5 km away are rejected.
 */
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { STATIONS } from '../../src/lib/stations';

import { parseCsvLine } from './csv';
import { readLines } from './zip-lines';

const RAW = process.env.GTFS_RAW_DIR ?? path.join('data', 'raw', 'gtfs');
const zip = readdirSync(RAW).filter((f) => f.toLowerCase().endsWith('.zip')).sort().at(-1);
if (!zip) {
  console.error(`No zip in ${RAW}. Download "GTFS Timetables Complete" from TfNSW Open Data (see data/README.md).`);
  process.exit(1);
}

const norm = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();
const wanted = new Map(STATIONS.map((s) => [`${norm(s.name)} STATION`, s]));
type Cand = { stop_id: string; name: string; lat: number; lon: number };
const cands = new Map<string, Cand[]>();
let head: string[] = [];
let stops = 0;

const entry = await readLines(path.join(RAW, zip), /(^|\/)stops\.txt$/i, (line, n) => {
  const f = parseCsvLine(line.replace(/^﻿/, ''));
  if (n === 0) { head = f; return; }
  stops++;
  const r = Object.fromEntries(head.map((h, i) => [h, f[i] ?? '']));
  if (r.location_type !== '1') return;
  const st = wanted.get(norm(r.stop_name ?? '').replace(/,.*$/, ''));
  if (!st) return;
  (cands.get(st.id) ?? cands.set(st.id, []).get(st.id)!).push({ stop_id: r.stop_id!, name: r.stop_name!, lat: Number(r.stop_lat), lon: Number(r.stop_lon) });
});
if (!entry) throw new Error(`No stops.txt inside ${zip}`);

const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const R = 6_371_000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const out: Record<string, { lat: number; lon: number; stop_id: string; stop_name: string }> = {};
const report: Record<string, string> = {};
for (const s of STATIONS) {
  const best = (cands.get(s.id) ?? []).map((c) => ({ c, d: metres(s, c) })).sort((a, b) => a.d - b.d)[0];
  if (!best || best.d > 1500) { report[s.id] = best ? `rejected: nearest match ${Math.round(best.d)} m away` : 'no match'; continue; }
  out[s.id] = { lat: Number(best.c.lat.toFixed(6)), lon: Number(best.c.lon.toFixed(6)), stop_id: best.c.stop_id, stop_name: best.c.name };
  report[s.id] = `${best.c.name} (stop ${best.c.stop_id}), moved ${Math.round(best.d)} m`;
}

writeFileSync(
  path.join('src', 'lib', 'station-coords.json'),
  JSON.stringify({ source: `Transport for NSW GTFS (${zip}, ${entry}), CC BY 4.0`, generated: new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }), stations: out }, null, 2) + '\n',
);
console.log(`${stops.toLocaleString()} stops read from ${zip}`);
console.log(JSON.stringify(report, null, 2));
console.log(`${Object.keys(out).length} of ${STATIONS.length} stations located. Commit src/lib/station-coords.json.`);
