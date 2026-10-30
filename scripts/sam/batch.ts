/**
 * SAM 3.1 aerial land cover around stations (run on a machine that can reach NSW Spatial Services
 * and the Meta Model API: your laptop).
 *
 *   npm run sam:batch                         # the 10 featured stations
 *   npm run sam:batch -- --stations chatswood,parramatta
 *   npm run sam:batch -- --res 0.5            # finer imagery (4x the requests)
 *   npm run sam:batch -- --mock               # against the local mock server (npm run spike:mock)
 *
 * For each station: aerial imagery chips (1024 px) from the NSW Imagery service covering the
 * 800 m ring (0.5 m per pixel), SAM 3.1 segments four classes per chip (building, tree canopy, car park,
 * construction site), masks are merged into one station grid, and cover % is measured inside
 * 400 m and 800 m. Results are cached per chip, so a re-run only calls SAM for what is missing.
 *
 * Output: data/derived/sam_cover.csv, data/derived/sam/<station>.svg (overlay for review),
 *         data/derived/sam/summary.json. Load with `npm run dev` (automatic) or db:setup --load-real.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { decodeMaskToRaster, decodeMaskToSVGPath, parseImageStream, recordsOfKind, type ImageSegmentationResult, type ResponsesEvent } from '@meta-sam/parser';
import OpenAI from 'openai';
import sharp from 'sharp';

import { STATIONS } from '../../src/lib/stations';

for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f);
const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const MOCK = process.argv.includes('--mock');
const BASE = MOCK ? `http://127.0.0.1:${process.env.MOCK_PORT ?? 8787}/v1` : (process.env.META_BASE_URL ?? 'https://api.meta.ai/v1');
const MODEL = process.env.SAM_MODEL ?? 'sam-3.1';
const KEY = MOCK ? 'mock-key' : process.env.MODEL_API_KEY;
if (!KEY) throw new Error('MODEL_API_KEY is not set in .env.local');
const IMAGERY = process.env.NSW_IMAGERY_EXPORT_URL ?? 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/export';

const CHIP_PX = 1024;
// 0.5 m per pixel: a 512 m chip, so a house roof is ~20 px wide. At 1 m SAM only found large buildings.
const RES = Number(arg('res') ?? 0.5); // metres per pixel
const RINGS = [{ id: '0-400m', r: 400 }, { id: '0-800m', r: 800 }];
// Short, literal noun phrases work best for SAM 3 concepts; a class can union several prompts
// ("house" catches the detached roofs "building" misses; "tree" finds single crowns and "forest"
// the continuous canopy of bushland and parks; "parking lot" beats "car park").
// `tile`: the largest area sent in one request, in chip pixels. Dense, small objects (roofs, tree
// crowns) start at 512 px quarters: on whole 1024 px chips SAM sometimes returned almost nothing
// for streets of 300 houses. Large objects (car parks, construction sites) use whole chips.
const CONCEPTS = [
  { cls: 'building', prompts: ['building', 'house'], tile: 512 },
  { cls: 'tree_canopy', prompts: ['tree', 'forest'], tile: 512 },
  { cls: 'car_park', prompts: ['parking lot'], tile: 1024 },
  { cls: 'construction_site', prompts: ['construction site'], tile: 1024 },
] as const;
const COLOURS: Record<string, string> = { building: '#e4572e', tree_canopy: '#29bf12', car_park: '#4361ee', construction_site: '#ffc914' };
const CONCURRENCY = Number(arg('concurrency') ?? 3);

const wanted = arg('stations')?.split(',').map((s) => s.trim());
const stations = wanted ? STATIONS.filter((s) => wanted.includes(s.id)) : STATIONS.filter((s) => s.featured);
if (!stations.length) throw new Error('No matching stations');

const OUT = path.join('data', 'derived');
const DIR = path.join(OUT, 'sam');
const CACHE = path.join(DIR, 'cache');
mkdirSync(CACHE, { recursive: true });

const client = new OpenAI({ baseURL: BASE, apiKey: KEY, timeout: 180_000, maxRetries: 2 });

/** The API may skip `response.output_text.done`, which the parser needs; synthesise it once per lane. */
async function* withTextDone(stream: AsyncIterable<unknown>): AsyncIterable<ResponsesEvent> {
  const closed = new Set<string>();
  for await (const raw of stream) {
    const ev = raw as Record<string, unknown> & { type?: string };
    const lane = `${ev.item_id}:${ev.output_index}:${ev.content_index}`;
    if (ev.type === 'response.output_text.done') {
      if (closed.has(lane)) continue;
      closed.add(lane);
    }
    yield ev as unknown as ResponsesEvent;
    const part = ev.part as { type?: string; text?: string } | undefined;
    if (ev.type === 'response.content_part.done' && part?.type === 'output_text' && !closed.has(lane)) {
      closed.add(lane);
      yield { type: 'response.output_text.done', item_id: ev.item_id, output_index: ev.output_index, content_index: ev.content_index, text: part.text ?? '' } as unknown as ResponsesEvent;
    }
  }
}

async function segment(dataUrl: string, prompt: string): Promise<ImageSegmentationResult> {
  const stream = await client.responses.create({
    model: MODEL,
    stream: true,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: dataUrl, detail: 'high' }] }],
  });
  return parseImageStream(withTextDone(stream as AsyncIterable<unknown>)).finalResult;
}

const R = 6378137;
const merc = (lat: number, lon: number) => ({ x: (R * lon * Math.PI) / 180, y: R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) });

async function fetchChip(lat: number, lon: number, file: string): Promise<Buffer> {
  if (existsSync(file)) return readFileSync(file);
  const { x, y } = merc(lat, lon);
  const half = ((CHIP_PX / 2) * RES) / Math.cos((lat * Math.PI) / 180);
  const q = new URLSearchParams({
    bbox: [x - half, y - half, x + half, y + half].map((v) => v.toFixed(2)).join(','), bboxSR: '3857', imageSR: '3857',
    size: `${CHIP_PX},${CHIP_PX}`, format: 'jpg', transparent: 'false', f: 'image',
  });
  const res = await fetch(`${IMAGERY}?${q}`);
  if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) throw new Error(`Imagery export failed: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, bytes);
  return bytes;
}

type Mask = { left: number; top: number; right: number; bottom: number; w: number; h: number; raster: number[]; svg: string };
type Tile = { masks: Mask[]; objects: number; ms: number; complete?: boolean };

async function callSam(dataUrl: string, cacheFile: string, prompt: string): Promise<Tile & { cached: boolean }> {
  if (existsSync(cacheFile)) return { ...(JSON.parse(readFileSync(cacheFile, 'utf8')) as Tile), cached: true };
  const t0 = performance.now();
  const result = await segment(dataUrl, prompt);
  const masks = recordsOfKind(result.records, 'mask').map((rec) => {
    const raster = decodeMaskToRaster(rec.mask);
    return { ...rec.bounds, w: rec.mask.width, h: rec.mask.height, raster: Array.from(raster, (v) => (v ? 1 : 0)), svg: decodeMaskToSVGPath(rec.mask) };
  });
  const out: Tile = { masks, objects: masks.length, ms: Math.round(performance.now() - t0), complete: result.outcome.status === 'completed' };
  writeFileSync(cacheFile, JSON.stringify(out));
  return { ...out, cached: false };
}

// SAM returns at most ~100 objects per image. A tile that hits the ceiling (or whose response was
// cut short) is split into four quarters, each enlarged to 1024 px and segmented again, down to
// 256 px quarters (0.125 m per source pixel after enlargement). Masks come back in chip pixels.
const CEILING = Number(process.env.SAM_CEILING ?? 80);
const MIN_TILE = 256;

async function segmentTile(
  chipFile: string, prompt: string, x: number, y: number, sz: number, stats: { calls: number; cached: number; ms: number; split: number },
): Promise<Mask[]> {
  const base = chipFile.replace(/\.jpg$/, `-v2-${prompt.replace(/\W+/g, '_')}`); // v2: records whether the response completed
  const cacheFile = sz === CHIP_PX ? `${base}.json` : `${base}-q${x}_${y}_${sz}.json`;
  const bytes = sz === CHIP_PX
    ? readFileSync(chipFile)
    : await sharp(chipFile).extract({ left: x, top: y, width: sz, height: sz }).resize(CHIP_PX, CHIP_PX, { kernel: 'lanczos3' }).jpeg({ quality: 92 }).toBuffer();
  const r = await callSam(`data:image/jpeg;base64,${bytes.toString('base64')}`, cacheFile, prompt);
  if (r.cached) stats.cached++; else { stats.calls++; stats.ms += r.ms; }
  if ((r.objects >= CEILING || r.complete === false) && sz / 2 >= MIN_TILE) {
    stats.split++;
    const h = sz / 2;
    const parts = await Promise.all([[0, 0], [h, 0], [0, h], [h, h]].map(([dx, dy]) => segmentTile(chipFile, prompt, x + dx!, y + dy!, h, stats)));
    return parts.flat();
  }
  const k = sz / CHIP_PX;
  return r.masks.map((m) => ({ ...m, left: x + m.left * k, top: y + m.top * k, right: x + m.right * k, bottom: y + m.bottom * k }));
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => { for (let t = q.shift(); t; t = q.shift()) await fn(t); }));
}

const rows: string[] = ['station_id,ring_id,class,cover_pct,res_m,chips,method,fetched'];
const summary: Record<string, unknown>[] = [];
const fetched = new Date().toISOString().slice(0, 10);

for (const s of stations) {
  // A square grid of chips centred on the station, just covering the 800 m ring.
  const chipM = CHIP_PX * RES;
  const n = Math.max(1, Math.ceil((2 * 800) / chipM));
  const size = n * CHIP_PX; // station grid in pixels
  const grid = Object.fromEntries(CONCEPTS.map((c) => [c.cls, new Uint8Array(size * size)]));
  const svgLayers: string[] = [];
  const chips: { file: string; px: number; py: number }[] = [];
  const mPerDegLat = 111_320, mPerDegLon = 111_320 * Math.cos((s.lat * Math.PI) / 180);
  for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
    // Chip centre offset from the station, in metres (east, north).
    const ex = (gx - (n - 1) / 2) * chipM, ny = ((n - 1) / 2 - gy) * chipM;
    const lat = s.lat + ny / mPerDegLat, lon = s.lon + ex / mPerDegLon;
    const file = path.join(CACHE, `${s.id}-${RES}-${gx}-${gy}.jpg`);
    chips.push({ file, px: gx * CHIP_PX, py: gy * CHIP_PX });
    await fetchChip(lat, lon, file);
  }
  const jobs = chips.flatMap((c) => CONCEPTS.flatMap((k) => k.prompts.map((prompt) => ({ c, k, prompt }))));
  const stats = { calls: 0, cached: 0, ms: 0, split: 0 };
  const objects: Record<string, number> = {};
  let done = 0;
  await pool(jobs, CONCURRENCY, async ({ c, k, prompt }) => {
    const starts: number[] = [];
    for (let v = 0; v < CHIP_PX; v += k.tile) starts.push(v);
    const masks = (await Promise.all(starts.flatMap((ty) => starts.map((tx) => segmentTile(c.file, prompt, tx, ty, k.tile, stats))))).flat();
    objects[k.cls] = (objects[k.cls] ?? 0) + masks.length;
    const bmp = grid[k.cls]!;
    for (const m of masks) {
      const sx = (m.right - m.left) / m.w, sy = (m.bottom - m.top) / m.h;
      for (let my = 0; my < m.h; my++) for (let mx = 0; mx < m.w; mx++) {
        if (!m.raster[my * m.w + mx]) continue;
        const x0 = Math.floor(m.left + mx * sx), x1 = Math.max(x0 + 1, Math.floor(m.left + (mx + 1) * sx));
        const y0 = Math.floor(m.top + my * sy), y1 = Math.max(y0 + 1, Math.floor(m.top + (my + 1) * sy));
        for (let y = Math.max(0, y0); y < Math.min(CHIP_PX, y1); y++)
          for (let x = Math.max(0, x0); x < Math.min(CHIP_PX, x1); x++) bmp[(c.py + y) * size + c.px + x] = 1;
      }
      svgLayers.push(`<path d="${m.svg}" transform="translate(${c.px + m.left} ${c.py + m.top}) scale(${sx} ${sy})" fill="${COLOURS[k.cls]}" fill-opacity="0.45" fill-rule="evenodd"/>`);
    }
    process.stdout.write(`\r${s.name}: ${++done}/${jobs.length} chip prompts, ${stats.calls + stats.cached} SAM calls`);
  });

  // Cover % inside each ring (station at the grid centre).
  const cxy = size / 2;
  const cover: Record<string, Record<string, number>> = {};
  for (const ring of RINGS) {
    const rPx = ring.r / RES;
    for (const k of CONCEPTS) {
      let on = 0, total = 0;
      const bmp = grid[k.cls]!;
      for (let y = Math.max(0, Math.floor(cxy - rPx)); y < Math.min(size, Math.ceil(cxy + rPx)); y++)
        for (let x = Math.max(0, Math.floor(cxy - rPx)); x < Math.min(size, Math.ceil(cxy + rPx)); x++) {
          if ((x + 0.5 - cxy) ** 2 + (y + 0.5 - cxy) ** 2 > rPx * rPx) continue;
          total++;
          on += bmp[y * size + x]!;
        }
      const pct = total ? Math.round((on / total) * 1000) / 10 : 0;
      (cover[ring.id] ??= {})[k.cls] = pct;
      rows.push(`${s.id},${ring.id},${k.cls},${pct},${RES},${chips.length},sam-3.1,${fetched}`);
    }
  }
  const img = chips.map((c) => `<image href="cache/${path.basename(c.file)}" x="${c.px}" y="${c.py}" width="${CHIP_PX}" height="${CHIP_PX}"/>`).join('');
  const ringsSvg = RINGS.map((r) => `<circle cx="${cxy}" cy="${cxy}" r="${r.r / RES}" fill="none" stroke="#fff" stroke-width="4" stroke-dasharray="16 10"/>`).join('');
  writeFileSync(path.join(DIR, `${s.id}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${img}${svgLayers.join('')}${ringsSvg}</svg>\n`);
  summary.push({ station: s.id, chips: chips.length, res_m: RES, sam_calls: stats.calls, cached: stats.cached, tiles_split: stats.split, sam_ms_avg: stats.calls ? Math.round(stats.ms / stats.calls) : null, objects, cover });
  console.log(`\r${s.name}: ${chips.length} chips, ${stats.calls} SAM calls (${stats.cached} cached, ${stats.split} tiles split), within 800 m: ${CONCEPTS.map((k) => `${k.cls} ${cover['0-800m']![k.cls]}%`).join(', ')}`);
}

writeFileSync(path.join(OUT, 'sam_cover.csv'), rows.join('\n') + '\n');
writeFileSync(path.join(DIR, 'summary.json'), JSON.stringify({ model: MODEL, base_url: BASE, imagery: IMAGERY, run_at: new Date().toISOString(), note: 'Classes can overlap (canopy over a car park). One imagery capture; cover per class, not a partition.', stations: summary }, null, 2));
console.log(`\nWrote data/derived/sam_cover.csv and overlays in data/derived/sam/ (open the .svg files in a browser to review).`);
