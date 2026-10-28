/**
 * Download two aerial imagery chips from NSW Spatial Services for the SAM 3.1 spike.
 *
 * Source: NSW_Imagery MapServer on SIX Maps (public ArcGIS REST export).
 * Licence and capture dates are still TO CONFIRM (see docs/spikes notes).
 *
 * Each chip is 1024 x 1024 px at about 0.25 m ground resolution (~256 m square),
 * centred on the station. Station coordinates here are approximate; day 2 replaces
 * them with TfNSW GTFS stops.txt.
 *
 * Usage: npm run spike:chips
 * If the export endpoint refuses, save any 1024px JPEG chips by hand into spikes/chips/
 * with the names below and run the SAM spike directly.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ROOT } from './lib/env.js';

export const CHIPS = [
  { id: 'parramatta', name: 'Parramatta', lat: -33.8174, lon: 151.0048 },
  { id: 'chatswood', name: 'Chatswood', lat: -33.7968, lon: 151.1806 },
] as const;

export const CHIP_PX = 1024;
export const GROUND_RES_M = 0.25;
export const CHIP_DIR = path.join(ROOT, 'spikes', 'chips');

const EXPORT_URL =
  process.env.NSW_IMAGERY_EXPORT_URL ??
  'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/export';

const R = 6378137;
function toWebMercator(lat: number, lon: number) {
  const x = (R * lon * Math.PI) / 180;
  const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return { x, y };
}

/** Web Mercator bbox that gives the requested ground resolution at this latitude. */
export function chipBbox(lat: number, lon: number) {
  const { x, y } = toWebMercator(lat, lon);
  const half = (CHIP_PX / 2) * GROUND_RES_M / Math.cos((lat * Math.PI) / 180);
  return [x - half, y - half, x + half, y + half];
}

async function main() {
  await mkdir(CHIP_DIR, { recursive: true });
  for (const chip of CHIPS) {
    const bbox = chipBbox(chip.lat, chip.lon);
    const params = new URLSearchParams({
      bbox: bbox.map((v) => v.toFixed(2)).join(','),
      bboxSR: '3857',
      imageSR: '3857',
      size: `${CHIP_PX},${CHIP_PX}`,
      format: 'jpg',
      transparent: 'false',
      f: 'image',
    });
    const url = `${EXPORT_URL}?${params}`;
    console.log(`Fetching ${chip.name}: ${url}`);
    const res = await fetch(url);
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/')) {
      const body = await res.text().catch(() => '');
      throw new Error(`NSW imagery export failed for ${chip.id}: HTTP ${res.status} ${type} ${body.slice(0, 300)}`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const file = path.join(CHIP_DIR, `${chip.id}.jpg`);
    await writeFile(file, bytes);
    await writeFile(
      path.join(CHIP_DIR, `${chip.id}.json`),
      JSON.stringify({ ...chip, bbox_3857: bbox, size_px: CHIP_PX, ground_res_m: GROUND_RES_M, source: EXPORT_URL, fetched_at: new Date().toISOString() }, null, 2),
    );
    console.log(`  saved ${path.relative(process.cwd(), file)} (${(bytes.length / 1024).toFixed(0)} KB)`);
  }
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) await main();
