/**
 * Suburb (SAL 2021), LGA (2025) and postcode (POA 2021) boundaries around the 10 stations, from the
 * ABS ASGS Edition 3 shapefile zips in data/raw/abs (GDA2020; no extraction needed).
 *
 *   npm run ingest:boundaries     # writes public/data/boundaries.geojson (committed; CC BY 4.0, ABS)
 *
 * Scope: boundaries touching the 5 km area around each station (the study area for this build).
 * Geometry is simplified to about 10 m, which is plenty for a map at precinct scale.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { unzipSync } from 'fflate';
import * as shapefile from 'shapefile';

import { STATIONS } from '../../src/lib/stations';

const RAW = process.env.ABS_RAW_DIR ?? path.join('data', 'raw', 'abs');
const RADIUS_M = 5000;
const SOURCES = [
  { kind: 'suburb', zip: /^SAL_2021_AUST_GDA2020/i, code: 'SAL_CODE21', name: 'SAL_NAME21' },
  { kind: 'lga', zip: /^LGA_20\d\d_AUST_GDA2020/i, code: /^LGA_CODE\d\d$/, name: /^LGA_NAME\d\d$/ },
  { kind: 'postcode', zip: /^POA_2021_AUST_GDA2020/i, code: 'POA_CODE21', name: 'POA_NAME21' },
] as const;

const K = 111_320, COS = Math.cos((-33.85 * Math.PI) / 180);
const boxes = STATIONS.map((s) => ({
  w: s.lon - RADIUS_M / (K * COS), e: s.lon + RADIUS_M / (K * COS), s: s.lat - RADIUS_M / K, n: s.lat + RADIUS_M / K,
}));

type Pos = number[];
function simplify(ring: Pos[], tol: number): Pos[] {
  if (ring.length < 5) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  const xy = (p: Pos) => [p[0]! * K * COS, p[1]! * K];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy(ring[a]!), [bx, by] = xy(ring[b]!);
    const dx = bx! - ax!, dy = by! - ay!, len = Math.hypot(dx, dy) || 1;
    let far = -1, dmax = tol;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy(ring[i]!);
      const d = len > 1 ? Math.abs(dy * px! - dx * py! + bx! * ay! - by! * ax!) / len : Math.hypot(px! - ax!, py! - ay!);
      if (d > dmax) { dmax = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  const out = ring.filter((_, i) => keep[i]).map((p) => [Number(p[0]!.toFixed(5)), Number(p[1]!.toFixed(5))]);
  return out.length >= 4 ? out : [];
}

function bbox(coords: Pos[][][]) {
  let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
  for (const poly of coords) for (const p of poly[0] ?? []) {
    w = Math.min(w, p[0]!); e = Math.max(e, p[0]!); s = Math.min(s, p[1]!); n = Math.max(n, p[1]!);
  }
  return { w, e, s, n };
}

const files = readdirSync(RAW);
const features: object[] = [];
for (const src of SOURCES) {
  const zipName = files.find((f) => src.zip.test(f) && f.toLowerCase().endsWith('.zip'));
  if (!zipName) {
    console.error(`Missing ${src.kind} zip in ${RAW} (see data/README.md)`);
    process.exit(1);
  }
  const unz = unzipSync(new Uint8Array(readFileSync(path.join(RAW, zipName))), { filter: (f) => /\.(shp|dbf)$/i.test(f.name) });
  const shp = Object.entries(unz).find(([n]) => /\.shp$/i.test(n))![1];
  const dbf = Object.entries(unz).find(([n]) => /\.dbf$/i.test(n))![1];
  const source = await shapefile.open(shp.buffer as ArrayBuffer, dbf.buffer as ArrayBuffer, { encoding: 'utf-8' });
  let kept = 0, seen = 0;
  for (;;) {
    const r = await source.read();
    if (r.done) break;
    seen++;
    const f = r.value;
    const g = f.geometry as { type: string; coordinates: Pos[][] | Pos[][][] } | null;
    if (!g) continue;
    const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as Pos[][][];
    const b = bbox(polys);
    if (!boxes.some((x) => b.w < x.e && b.e > x.w && b.s < x.n && b.n > x.s)) continue;
    const props = f.properties as Record<string, string>;
    const pick = (key: string | RegExp) => (typeof key === 'string' ? props[key] : Object.entries(props).find(([k]) => key.test(k))?.[1]) ?? '';
    const simplified = polys.map((poly) => poly.map((ring) => simplify(ring, 10)).filter((ring) => ring.length)).filter((poly) => poly.length);
    if (!simplified.length) continue;
    const name = String(pick(src.name)).replace(/ \((NSW|N\.S\.W\.)\)$/, '').replace(/ \(NSW\)$/, '');
    features.push({
      type: 'Feature',
      properties: { kind: src.kind, code: String(pick(src.code)), name: src.kind === 'postcode' ? String(pick(src.code)) : name },
      geometry: { type: 'MultiPolygon', coordinates: simplified },
    });
    kept++;
  }
  console.log(`${src.kind}: ${kept} of ${seen.toLocaleString()} kept (${zipName})`);
}

mkdirSync(path.join('public', 'data'), { recursive: true });
const out = JSON.stringify({
  type: 'FeatureCollection',
  attribution: 'Australian Bureau of Statistics, ASGS Edition 3 (SAL 2021, LGA 2025, POA 2021), CC BY 4.0',
  features,
});
writeFileSync(path.join('public', 'data', 'boundaries.geojson'), out);
console.log(`${features.length} boundaries, ${(out.length / 1024).toFixed(0)} KB -> public/data/boundaries.geojson`);
