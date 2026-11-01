/**
 * SAM 3.1 cover polygons: every class's masks for each featured station, as polygons.
 *
 *   npm run sam:polygons
 *   npm run sam:polygons -- --stations chatswood,parramatta
 *   npm run sam:polygons -- --res 0.5
 *
 * Reads the batch tile cache only (no SAM calls). Each class's prompts are unioned into one
 * per-class station grid (the same union the batch measures cover from), 8-connected
 * components are traced into outlines, simplified to about 1.5 m, and kept when they cover at
 * least 20 m². Overlapping masks of the same class merge by construction.
 *
 * Output: data/derived/sam_cover_polygons.geojson. Load with `npm run dev` (automatic) or
 * db:setup --load-sam-polygons.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { STATIONS } from '../../src/lib/stations';
import { CHIP_PX, CONCEPTS } from './concepts';
import { createStationProjection, douglasPeucker, labelComponents, ringArea, traceOutline } from './polygons';

for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f);
const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const RES = Number(arg('res') ?? 0.5);
// Same split rule as batch.ts, check.ts and sites.ts: a cached parent tile is ignored when the
// batch used its quarters instead (same ceiling env var, so all four always agree).
const CEILING = Number(process.env.SAM_CEILING ?? 80);
const MIN_TILE = 256;
const SIMPLIFY_TOL_M = 1.5;
const MIN_AREA_M2 = 20;

const wanted = arg('stations')?.split(',').map((s) => s.trim());
const stations = wanted ? STATIONS.filter((s) => wanted.includes(s.id)) : STATIONS.filter((s) => s.featured);
if (!stations.length) throw new Error('No matching stations');

const keyOf = (prompt: string) => prompt.replace(/\W+/g, '_');

type Mask = { left: number; top: number; right: number; bottom: number; w: number; h: number; raster: number[] };
type Tile = { x: number; y: number; sz: number; masks: Mask[]; objects: number; complete?: boolean };

const CACHE = path.join('data', 'derived', 'sam', 'cache');
const files = existsSync(CACHE) ? readdirSync(CACHE) : [];

type Feature = { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: 'Polygon'; coordinates: number[][][] } };
const features: Feature[] = [];

/** Rasterise one cached prompt's masks for one chip into the class grid. */
function rasterizePrompt(grid: Uint8Array, size: number, chip: { base: string; gx: number; gy: number }, key: string) {
  const group: Tile[] = [];
  for (const f of files.filter((g) => g.startsWith(`${chip.base}-v2-`) && g.endsWith('.json'))) {
    const rest = f.slice(chip.base.length + 4, -5);
    const m = /^(.*?)(?:-q(\d+)_(\d+)_(\d+))?$/.exec(rest);
    if (!m || m[1] !== key) continue;
    const parsed = JSON.parse(readFileSync(path.join(CACHE, f), 'utf8')) as { masks: Mask[]; objects: number; complete?: boolean };
    group.push({ x: Number(m[2] ?? 0), y: Number(m[3] ?? 0), sz: Number(m[4] ?? CHIP_PX), ...parsed });
  }
  const have = new Set(group.map((t) => `${t.x}_${t.y}_${t.sz}`));
  const tiles = group.filter((t) => {
    if (t.sz / 2 < MIN_TILE) return true;
    const h = t.sz / 2;
    const quarters = [`${t.x}_${t.y}_${h}`, `${t.x + h}_${t.y}_${h}`, `${t.x}_${t.y + h}_${h}`, `${t.x + h}_${t.y + h}_${h}`];
    return !(quarters.every((q) => have.has(q)) && (t.objects >= CEILING || t.complete === false));
  });
  const ox = chip.gx * CHIP_PX, oy = chip.gy * CHIP_PX;
  for (const t of tiles) {
    const k = t.sz / CHIP_PX;
    for (const m of t.masks) {
      const left = t.x + m.left * k, top = t.y + m.top * k;
      const sx = ((t.x + m.right * k) - left) / m.w, sy = ((t.y + m.bottom * k) - top) / m.h;
      for (let my = 0; my < m.h; my++) for (let mx = 0; mx < m.w; mx++) {
        if (!m.raster[my * m.w + mx]) continue;
        const x0 = Math.floor(left + mx * sx), x1 = Math.max(x0 + 1, Math.floor(left + (mx + 1) * sx));
        const y0 = Math.floor(top + my * sy), y1 = Math.max(y0 + 1, Math.floor(top + (my + 1) * sy));
        for (let y = Math.max(0, y0); y < Math.min(CHIP_PX, y1); y++)
          for (let x = Math.max(0, x0); x < Math.min(CHIP_PX, x1); x++) grid[(oy + y) * size + ox + x] = 1;
      }
    }
  }
}

for (const s of stations) {
  const prefix = `${s.id}-${RES}-`;
  const chips = files
    .filter((f) => f.startsWith(prefix) && f.endsWith('.jpg'))
    .map((f) => {
      const [gx, gy] = f.slice(prefix.length, -4).split('-').map(Number);
      return { base: f.slice(0, -4), gx: gx ?? 0, gy: gy ?? 0 };
    })
    .sort((a, b) => a.gy - b.gy || a.gx - b.gx);
  if (!chips.length) {
    console.log(`${s.name}: no chips in cache for res ${RES}`);
    continue;
  }
  const n = Math.max(...chips.flatMap((c) => [c.gx, c.gy])) + 1;
  if (chips.length !== n * n) console.log(`${s.name}: warning: ${chips.length} chips for a ${n}x${n} grid; gaps have no masks`);
  const size = n * CHIP_PX;
  const { toMetres, toLonLat } = createStationProjection(s, n, CHIP_PX, RES);

  const stationFeatures: Feature[] = [];
  const found: Record<string, number> = {};
  for (const { cls, prompts } of CONCEPTS) {
    const grid = new Uint8Array(size * size);
    for (const chip of chips) for (const prompt of prompts) rasterizePrompt(grid, size, chip, keyOf(prompt));
    const { labels, sizes, starts } = labelComponents(grid, size, size);
    let kept = 0;
    for (let i = 0; i < sizes.length; i++) {
      if (sizes[i]! * RES * RES < MIN_AREA_M2 - 5) continue;
      const id = i + 1;
      const at = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && labels[y * size + x] === id;
      const [sx, sy] = starts[i]!;
      const outline = traceOutline(at, sx, sy, sizes[i]! * 8 + 64);
      if (outline.length < 3) continue;
      const metres = douglasPeucker(outline.map(([x, y]) => toMetres(x, y)), SIMPLIFY_TOL_M);
      if (metres.length < 3) continue;
      const area = Math.abs(ringArea(metres));
      if (area < MIN_AREA_M2) continue;
      let ring = metres.map(([e, m]) => toLonLat(e, m));
      if (ringArea(ring) < 0) ring = ring.reverse();
      ring.push(ring[0]!);
      stationFeatures.push({
        type: 'Feature',
        properties: { station_id: s.id, class: cls, area_m2: Math.round(area), method: 'sam-3.1' },
        geometry: { type: 'Polygon', coordinates: [ring] },
      });
      kept++;
    }
    found[cls] = kept;
  }
  features.push(...stationFeatures);
  const kb = Math.round(Buffer.byteLength(JSON.stringify(stationFeatures)) / 1024);
  console.log(`${s.name}: ${stationFeatures.length} polygons (${CONCEPTS.map((c) => `${c.cls} ${found[c.cls] ?? 0}`).join(', ')}), ${kb.toLocaleString('en-AU')} KB`);
}

mkdirSync(path.join('data', 'derived'), { recursive: true });
const out = path.join('data', 'derived', 'sam_cover_polygons.geojson');
writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`Wrote ${out} (${features.length} polygons, ${(statSync(out).size / 1024 / 1024).toFixed(2)} MB).`);
