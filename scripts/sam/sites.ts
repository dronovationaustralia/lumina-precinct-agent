/**
 * SAM 3.1 opportunity sites: car parks and construction sites near stations, as polygons.
 *
 *   npm run sam:sites
 *   npm run sam:sites -- --stations chatswood,parramatta
 *   npm run sam:sites -- --res 0.5
 *
 * Reads the batch tile cache only (no SAM calls). Every `parking lot` and `construction site`
 * mask is rasterised into a per-class station grid, 8-connected components are traced into
 * outlines, simplified to about 1 m, and kept when they cover at least 300 m² with a centroid
 * within 800 m of the station. Overlapping masks of the same class merge by construction.
 *
 * Output: data/derived/sam_sites.geojson. Load with `npm run dev` (automatic) or db:setup --load-sites.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { STATIONS } from '../../src/lib/stations';
import { CHIP_PX } from './concepts';
import { douglasPeucker, labelComponents, lonLatFromMerc, mercFromLonLat, ringArea, traceOutline, type Point } from './polygons';

for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f);
const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const RES = Number(arg('res') ?? 0.5);
// Same split rule as batch.ts and check.ts: a cached parent tile is ignored when the batch
// used its quarters instead (same ceiling env var, so all three always agree).
const CEILING = Number(process.env.SAM_CEILING ?? 80);
const MIN_TILE = 256;
const MIN_AREA_M2 = 300;
const MAX_DIST_M = 800;

const wanted = arg('stations')?.split(',').map((s) => s.trim());
const stations = wanted ? STATIONS.filter((s) => wanted.includes(s.id)) : STATIONS.filter((s) => s.featured);
if (!stations.length) throw new Error('No matching stations');

const CLASSES = [
  { cls: 'car_park', prompt: 'parking lot' },
  { cls: 'construction_site', prompt: 'construction site' },
] as const;
const keyOf = (prompt: string) => prompt.replace(/\W+/g, '_');

type Mask = { left: number; top: number; right: number; bottom: number; w: number; h: number; raster: number[] };
type Tile = { x: number; y: number; sz: number; masks: Mask[]; objects: number; complete?: boolean };

const CACHE = path.join('data', 'derived', 'sam', 'cache');
const files = readdirSync(CACHE);

type Feature = { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: 'Polygon'; coordinates: number[][][] } };
const features: Feature[] = [];
const counts: Array<{ station: string; car_park: number; construction_site: number }> = [];

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
    counts.push({ station: s.id, car_park: 0, construction_site: 0 });
    continue;
  }
  const n = Math.max(...chips.flatMap((c) => [c.gx, c.gy])) + 1;
  if (chips.length !== n * n) console.log(`${s.name}: warning: ${chips.length} chips for a ${n}x${n} grid; gaps have no masks`);
  const size = n * CHIP_PX;
  const chipM = CHIP_PX * RES;
  const mPerDegLat = 111_320, mPerDegLon = 111_320 * Math.cos((s.lat * Math.PI) / 180);
  const chipCentre = (gx: number, gy: number) => {
    const ex = (gx - (n - 1) / 2) * chipM, ny = ((n - 1) / 2 - gy) * chipM;
    return { lat: s.lat + ny / mPerDegLat, lon: s.lon + ex / mPerDegLon };
  };
  const stationMerc = mercFromLonLat(s.lat, s.lon);
  // Grid pixel to Web Mercator via its chip's centre, then to metre offsets from the station.
  const toMetres = (px: number, py: number): Point => {
    const gx = Math.min(n - 1, Math.max(0, Math.floor(px / CHIP_PX)));
    const gy = Math.min(n - 1, Math.max(0, Math.floor(py / CHIP_PX)));
    const { lat, lon } = chipCentre(gx, gy);
    const c = mercFromLonLat(lat, lon);
    const mx = c.x + (px - gx * CHIP_PX + 0.5 - CHIP_PX / 2) * RES;
    const my = c.y + (gy * CHIP_PX + CHIP_PX / 2 - (py + 0.5)) * RES;
    return [mx - stationMerc.x, my - stationMerc.y];
  };
  const toLonLat = (e: number, m: number): Point => {
    const { lat, lon } = lonLatFromMerc(stationMerc.x + e, stationMerc.y + m);
    return [Number(lon.toFixed(7)), Number(lat.toFixed(7))];
  };

  const found = { car_park: 0, construction_site: 0 };
  for (const { cls, prompt } of CLASSES) {
    const key = keyOf(prompt);
    const grid = new Uint8Array(size * size);
    for (const chip of chips) {
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
    const { labels, sizes, starts } = labelComponents(grid, size, size);
    for (let i = 0; i < sizes.length; i++) {
      if (sizes[i]! * RES * RES < MIN_AREA_M2 - 50) continue;
      const id = i + 1;
      const at = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && labels[y * size + x] === id;
      const [sx, sy] = starts[i]!;
      const outline = traceOutline(at, sx, sy, sizes[i]! * 8 + 64);
      if (outline.length < 3) continue;
      const metres = douglasPeucker(outline.map(([x, y]) => toMetres(x, y)), 1);
      if (metres.length < 3) continue;
      const area = Math.abs(ringArea(metres));
      if (area < MIN_AREA_M2) continue;
      const cx = metres.reduce((a, p) => a + p[0], 0) / metres.length;
      const cy = metres.reduce((a, p) => a + p[1], 0) / metres.length;
      const dist = Math.hypot(cx, cy);
      if (dist > MAX_DIST_M) continue;
      let ring = metres.map(([e, m]) => toLonLat(e, m));
      if (ringArea(ring) < 0) ring = ring.reverse();
      ring.push(ring[0]!);
      features.push({
        type: 'Feature',
        properties: { station_id: s.id, class: cls, area_m2: Math.round(area), distance_m: Math.round(dist), method: 'sam-3.1' },
        geometry: { type: 'Polygon', coordinates: [ring] },
      });
      found[cls as keyof typeof found]++;
    }
  }
  counts.push({ station: s.id, ...found });
  const total = found.car_park + found.construction_site;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  console.log(`${s.name}: ${plural(total, 'site')} (${plural(found.car_park, 'car park')}, ${plural(found.construction_site, 'construction site')})`);
}

mkdirSync(path.join('data', 'derived'), { recursive: true });
writeFileSync(path.join('data', 'derived', 'sam_sites.geojson'), JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`Wrote data/derived/sam_sites.geojson (${features.length} sites).`);
