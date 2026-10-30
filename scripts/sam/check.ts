/**
 * Per-chip, per-class diagnostic for the SAM batch (see batch.ts).
 *
 *   npm run sam:check -- --stations chatswood
 *
 * Reads the tile cache only (no SAM calls). For each chip it reports, per class, the
 * number of objects and cover %, plus a rough vegetation share from the imagery itself
 * (fraction of pixels where excess green 2G-R-B is clearly positive). Flags chips where
 * building objects are under 10 or tree cover is under a third of the vegetation share.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import { STATIONS } from '../../src/lib/stations';
import { CHIP_PX, CONCEPTS, isVegetationPixel } from './concepts';

for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f);
const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const RES = Number(arg('res') ?? 0.5);
// Mirror of the batch split rule: a cached parent tile is ignored when the batch used
// its quarters instead (same ceiling env var, so both always agree).
const CEILING = Number(process.env.SAM_CEILING ?? 80);
const MIN_TILE = 256;

const wanted = arg('stations')?.split(',').map((s) => s.trim());
const stations = wanted ? STATIONS.filter((s) => wanted.includes(s.id)) : STATIONS.filter((s) => s.featured);
if (!stations.length) throw new Error('No matching stations');

const CACHE = path.join('data', 'derived', 'sam', 'cache');
const keyOf = (prompt: string) => prompt.replace(/\W+/g, '_');
const classOfKey = new Map(CONCEPTS.flatMap((c) => c.prompts.map((p) => [keyOf(p), c.cls] as const)));

type Mask = { left: number; top: number; right: number; bottom: number; w: number; h: number; raster: number[] };
type TileFile = { key: string; x: number; y: number; sz: number; masks: Mask[]; objects: number; complete?: boolean };

async function vegetationShare(file: string): Promise<number> {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const px = info.width * info.height;
  let green = 0;
  for (let i = 0; i < px; i++) {
    const r = data[i * info.channels] ?? 0, g = data[i * info.channels + 1] ?? 0, b = data[i * info.channels + 2] ?? 0;
    if (isVegetationPixel(r, g, b)) green++;
  }
  return (green / px) * 100;
}

const files = readdirSync(CACHE);
let summary: { stations?: { station: string; cover?: Record<string, Record<string, number>> }[] } = {};
try {
  summary = JSON.parse(readFileSync(path.join('data', 'derived', 'sam', 'summary.json'), 'utf8')) as typeof summary;
} catch { /* no batch summary yet */ }

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
  const unknown = new Set<string>();
  const totals: Record<string, { objects: number; cover: number }> = {};
  let flagBuildings = 0, flagTrees = 0;
  const head = 'chip'.padEnd(22) + CONCEPTS.map((c) => `${c.cls} objs`.padStart(14) + 'cover%'.padStart(8)).join('') + 'veg%'.padStart(8) + '  flags';
  console.log(`\n${s.name} (${chips.length} chips, res ${RES}):\n${head}`);
  for (const chip of chips) {
    const group = new Map<string, TileFile[]>();
    for (const f of files.filter((g) => g.startsWith(`${chip.base}-v2-`) && g.endsWith('.json'))) {
      const rest = f.slice(chip.base.length + 4, -5);
      const m = /^(.*?)(?:-q(\d+)_(\d+)_(\d+))?$/.exec(rest);
      if (!m) continue;
      const key = m[1] ?? '';
      if (!classOfKey.has(key)) {
        unknown.add(key);
        continue;
      }
      const parsed = JSON.parse(readFileSync(path.join(CACHE, f), 'utf8')) as { masks: Mask[]; objects: number; complete?: boolean };
      const list = group.get(key) ?? [];
      list.push({ key, x: Number(m[2] ?? 0), y: Number(m[3] ?? 0), sz: Number(m[4] ?? CHIP_PX), ...parsed });
      group.set(key, list);
    }
    // Drop parent tiles the batch split into quarters (same rule as batch.ts).
    const tiles = [...group.values()].flatMap((list) => {
      const have = new Set(list.map((t) => `${t.x}_${t.y}_${t.sz}`));
      return list.filter((t) => {
        if (t.sz / 2 < MIN_TILE) return true;
        const h = t.sz / 2;
        const quarters = [`${t.x}_${t.y}_${h}`, `${t.x + h}_${t.y}_${h}`, `${t.x}_${t.y + h}_${h}`, `${t.x + h}_${t.y + h}_${h}`];
        return !(quarters.every((q) => have.has(q)) && (t.objects >= CEILING || t.complete === false));
      });
    });
    const bmp = Object.fromEntries(CONCEPTS.map((c) => [c.cls, new Uint8Array(CHIP_PX * CHIP_PX)])) as Record<string, Uint8Array>;
    const objects: Record<string, number> = {};
    for (const t of tiles) {
      const cls = classOfKey.get(t.key);
      if (!cls) continue;
      objects[cls] = (objects[cls] ?? 0) + t.masks.length;
      const k = t.sz / CHIP_PX;
      const b = bmp[cls] as Uint8Array;
      for (const m of t.masks) {
        const left = t.x + m.left * k, top = t.y + m.top * k;
        const sx = ((t.x + m.right * k) - left) / m.w, sy = ((t.y + m.bottom * k) - top) / m.h;
        for (let my = 0; my < m.h; my++) for (let mx = 0; mx < m.w; mx++) {
          if (!m.raster[my * m.w + mx]) continue;
          const x0 = Math.floor(left + mx * sx), x1 = Math.max(x0 + 1, Math.floor(left + (mx + 1) * sx));
          const y0 = Math.floor(top + my * sy), y1 = Math.max(y0 + 1, Math.floor(top + (my + 1) * sy));
          for (let y = Math.max(0, y0); y < Math.min(CHIP_PX, y1); y++)
            for (let x = Math.max(0, x0); x < Math.min(CHIP_PX, x1); x++) b[y * CHIP_PX + x] = 1;
        }
      }
    }
    const cover: Record<string, number> = {};
    for (const c of CONCEPTS) {
      const b = bmp[c.cls] as Uint8Array;
      let on = 0;
      for (let i = 0; i < b.length; i++) on += b[i] ?? 0;
      cover[c.cls] = (on / (CHIP_PX * CHIP_PX)) * 100;
      const tot = totals[c.cls] ?? { objects: 0, cover: 0 };
      tot.objects += objects[c.cls] ?? 0;
      tot.cover += cover[c.cls] ?? 0;
      totals[c.cls] = tot;
    }
    const veg = await vegetationShare(path.join(CACHE, `${chip.base}.jpg`));
    const flags: string[] = [];
    if (!tiles.length) flags.push('NO-DATA');
    if ((objects.building ?? 0) < 10) {
      flags.push('LOW-BUILDINGS');
      flagBuildings++;
    }
    if ((cover.tree_canopy ?? 0) < veg / 3) {
      flags.push('LOW-TREES');
      flagTrees++;
    }
    const row = `${s.id}-${chip.gx}-${chip.gy}`.padEnd(22)
      + CONCEPTS.map((c) => String(objects[c.cls] ?? 0).padStart(14) + (cover[c.cls] ?? 0).toFixed(1).padStart(8)).join('')
      + veg.toFixed(1).padStart(8) + (flags.length ? `  ${flags.join(',')}` : '');
    console.log(row);
  }
  const mean = (cls: string) => ((totals[cls]?.cover ?? 0) / chips.length).toFixed(1);
  console.log(`total objects: ${CONCEPTS.map((c) => `${c.cls} ${totals[c.cls]?.objects ?? 0}`).join(', ')}`);
  console.log(`mean chip cover: ${CONCEPTS.map((c) => `${c.cls} ${mean(c.cls)}%`).join(', ')}`);
  console.log(`flags: ${flagBuildings} chip(s) LOW-BUILDINGS, ${flagTrees} chip(s) LOW-TREES`);
  const prev = summary.stations?.find((r) => r.station === s.id)?.cover?.['0-800m'];
  if (prev) console.log(`batch 800 m cover for comparison: ${CONCEPTS.map((c) => `${c.cls} ${prev[c.cls] ?? '?'}%`).join(', ')}`);
  for (const key of unknown) console.log(`warning: prompt "${key}" in cache is not in CONCEPTS, ignored`);
}
