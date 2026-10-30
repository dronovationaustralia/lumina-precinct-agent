/**
 * Rail network for the map: Sydney Trains (T1 to T9), Metro (M1) and light rail (L1 to L4) lines
 * in their official colours, plus their stations, from the TfNSW GTFS zip.
 *
 *   npm run ingest:gtfs-lines     # writes public/data/network.geojson (committed; CC BY 4.0, TfNSW)
 *
 * GTFS has one shape per stopping pattern (hundreds per line). For each line we keep the longest
 * shapes that still add new track, so branches are covered without drawing the same track 50 times,
 * then simplify to about 6 m.
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parseCsvLine } from './csv';
import { readLines } from './zip-lines';

const RAW = process.env.GTFS_RAW_DIR ?? path.join('data', 'raw', 'gtfs');
const zipName = readdirSync(RAW).filter((f) => f.toLowerCase().endsWith('.zip')).sort().at(-1);
if (!zipName) {
  console.error(`No zip in ${RAW}. Download "GTFS Timetables Complete" (see data/README.md).`);
  process.exit(1);
}
const ZIP = path.join(RAW, zipName);

type Row = Record<string, string>;
async function eachRow(file: RegExp, fn: (r: Row) => void) {
  let head: string[] = [];
  const name = await readLines(ZIP, file, (line, n) => {
    const f = parseCsvLine(n === 0 ? line.replace(/^﻿/, '') : line);
    if (n === 0) { head = f; return; }
    const r: Row = {};
    for (let i = 0; i < head.length; i++) r[head[i]!] = f[i] ?? '';
    fn(r);
  });
  if (!name) throw new Error(`${file} not found in ${zipName}`);
}

// 1. Lines we draw.
type Line = { key: string; name: string; color: string; mode: 'train' | 'metro' | 'light_rail' };
const lines = new Map<string, Line>(); // route_id -> line
await eachRow(/(^|\/)routes\.txt$/, (r) => {
  const short = r.route_short_name ?? '';
  const train = r.route_type === '2' && /^T\d$/.test(short);
  const metro = r.route_type === '401';
  const lr = r.route_type === '900' && /^L\d$/.test(short);
  if (!train && !metro && !lr) return;
  lines.set(r.route_id!, {
    key: short,
    name: (r.route_long_name ?? short).replace(/^\w+\s/, ''),
    color: `#${(r.route_color || '888888').toUpperCase()}`,
    mode: train ? 'train' : metro ? 'metro' : 'light_rail',
  });
});
console.log(`${lines.size} routes: ${[...new Set([...lines.values()].map((l) => l.key))].join(', ')}`);

// 2. Shapes and trips per line.
const shapeLine = new Map<string, string>(); // shape_id -> line key
const tripLine = new Map<string, string>(); // trip_id -> line key
await eachRow(/(^|\/)trips\.txt$/, (r) => {
  const l = lines.get(r.route_id!);
  if (!l) return;
  if (r.shape_id) shapeLine.set(r.shape_id, l.key);
  tripLine.set(r.trip_id!, l.key);
});
console.log(`${shapeLine.size} shapes, ${tripLine.size.toLocaleString()} trips`);

// 3. Shape points (only the shapes we need).
const pts = new Map<string, { seq: number; lon: number; lat: number }[]>();
await eachRow(/(^|\/)shapes\.txt$/, (r) => {
  if (!shapeLine.has(r.shape_id!)) return;
  const a = pts.get(r.shape_id!) ?? pts.set(r.shape_id!, []).get(r.shape_id!)!;
  a.push({ seq: Number(r.shape_pt_sequence), lon: Number(r.shape_pt_lon), lat: Number(r.shape_pt_lat) });
});

// 4. Stations served (parent stations of the stops these trips call at).
const stopLines = new Map<string, Set<string>>();
await eachRow(/(^|\/)stop_times\.txt$/, (r) => {
  const key = tripLine.get(r.trip_id!);
  if (!key) return;
  (stopLines.get(r.stop_id!) ?? stopLines.set(r.stop_id!, new Set()).get(r.stop_id!)!).add(key);
});
type Stop = { id: string; name: string; lat: number; lon: number; parent: string; type: string };
const stops = new Map<string, Stop>();
await eachRow(/(^|\/)stops\.txt$/, (r) => {
  stops.set(r.stop_id!, { id: r.stop_id!, name: r.stop_name!, lat: Number(r.stop_lat), lon: Number(r.stop_lon), parent: r.parent_station ?? '', type: r.location_type ?? '' });
});

// Geometry helpers (metres on a local equirectangular plane; fine at city scale).
const K = 111_320, COS = Math.cos((-33.85 * Math.PI) / 180);
const xy = (p: { lon: number; lat: number }) => [p.lon * K * COS, p.lat * K] as const;
function simplify(points: { lon: number; lat: number }[], tol: number) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy(points[a]!), [bx, by] = xy(points[b]!);
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let far = -1, dmax = tol;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy(points[i]!);
      const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > dmax) { dmax = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return points.filter((_, i) => keep[i]);
}
const cell = (p: { lon: number; lat: number }) => {
  const [x, y] = xy(p);
  return `${Math.round(x / 60)}:${Math.round(y / 60)}`;
};

// 5. Per line: longest shapes first, keep a shape only if it adds track (>10% new 60 m cells).
const features: object[] = [];
const byLine = new Map<string, string[]>();
for (const [sid, key] of shapeLine) if (pts.has(sid)) (byLine.get(key) ?? byLine.set(key, []).get(key)!).push(sid);
const lineInfo = new Map([...lines.values()].map((l) => [l.key, l]));
for (const [key, sids] of [...byLine].sort()) {
  const covered = new Set<string>();
  const ordered = sids.map((s) => pts.get(s)!.sort((a, b) => a.seq - b.seq)).sort((a, b) => b.length - a.length);
  let kept = 0;
  for (const p of ordered) {
    const cells = p.map(cell);
    const fresh = cells.filter((c) => !covered.has(c)).length;
    if (fresh / cells.length < 0.1) continue;
    cells.forEach((c) => covered.add(c));
    const coords = simplify(p, 6).map((q) => [Number(q.lon.toFixed(5)), Number(q.lat.toFixed(5))]);
    const l = lineInfo.get(key)!;
    features.push({ type: 'Feature', properties: { kind: 'line', line: key, name: l.name, color: l.color, mode: l.mode }, geometry: { type: 'LineString', coordinates: coords } });
    kept++;
  }
  console.log(`${key}: ${kept} of ${sids.length} shapes kept`);
}

// 6. Stations: one point per parent station, with the lines that call there.
const stations = new Map<string, { name: string; lat: number; lon: number; lines: Set<string> }>();
for (const [sid, keys] of stopLines) {
  const s = stops.get(sid);
  if (!s) continue;
  const parent = s.parent && stops.get(s.parent) ? stops.get(s.parent)! : s;
  const e = stations.get(parent.id) ?? stations.set(parent.id, { name: parent.name, lat: parent.lat, lon: parent.lon, lines: new Set() }).get(parent.id)!;
  keys.forEach((k) => e.lines.add(k));
}
for (const [id, s] of stations) {
  const keys = [...s.lines].sort();
  const mode = keys.some((k) => /^T/.test(k)) ? 'train' : keys.some((k) => /^M/.test(k)) ? 'metro' : 'light_rail';
  features.push({
    type: 'Feature',
    properties: { kind: 'station', id, name: s.name.replace(/ (Station|Light Rail)$/, '').replace(/,.*$/, ''), lines: keys.join(' '), mode },
    geometry: { type: 'Point', coordinates: [Number(s.lon.toFixed(5)), Number(s.lat.toFixed(5))] },
  });
}

// 7. Station registry: every Sydney Trains (T1 to T9) and Metro station, one entry per name.
// Committed as src/lib/station-registry.json; the app, the agent and the ingest scripts read it.
const FEATURED = new Set(['wynyard', 'milsons_point', 'north_sydney', 'st_leonards', 'chatswood', 'westmead', 'parramatta', 'harris_park', 'granville', 'auburn']);
const registry = new Map<string, { id: string; name: string; lines: string[]; lat: number; lon: number; gtfs_stop_id: string; featured: boolean }>();
for (const [id, s] of [...stations].sort((a, b) => a[0].localeCompare(b[0]))) {
  const lines = [...s.lines].filter((k) => /^(T\d|M\d)$/.test(k)).sort();
  if (!lines.length) continue;
  const name = s.name.replace(/ Station$/, '').replace(/,.*$/, '').trim();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const prev = registry.get(slug);
  if (prev) {
    // Same station listed twice (e.g. separate metro and train parents): merge lines, keep the train location.
    prev.lines = [...new Set([...prev.lines, ...lines])].sort();
    continue;
  }
  registry.set(slug, { id: slug, name, lines, lat: Number(s.lat.toFixed(6)), lon: Number(s.lon.toFixed(6)), gtfs_stop_id: id, featured: FEATURED.has(slug) });
}
const missingFeatured = [...FEATURED].filter((f) => !registry.has(f));
if (missingFeatured.length) throw new Error(`Featured stations missing from GTFS: ${missingFeatured.join(', ')}`);
writeFileSync(
  path.join('src', 'lib', 'station-registry.json'),
  JSON.stringify({ source: `Transport for NSW GTFS (${zipName}), CC BY 4.0`, stations: [...registry.values()].sort((a, b) => a.name.localeCompare(b.name)) }, null, 1) + '\n',
);
console.log(`${registry.size} train and metro stations -> src/lib/station-registry.json`);

mkdirSync(path.join('public', 'data'), { recursive: true });
const out = JSON.stringify({
  type: 'FeatureCollection',
  attribution: `Transport for NSW GTFS (${zipName}), CC BY 4.0`,
  features,
});
writeFileSync(path.join('public', 'data', 'network.geojson'), out);
console.log(`${features.length} features, ${(out.length / 1024).toFixed(0)} KB -> public/data/network.geojson (${stations.size} stations)`);
