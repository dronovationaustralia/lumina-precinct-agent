/**
 * NSW Landuse 2017 polygons (from `npm run fetch:landuse`) -> data/derived/landuse.ndjson with a
 * category per polygon (ALUM tertiary class grouped into ten categories, src/lib/landuse.ts).
 *
 *   npm run ingest:landuse
 */
import { createReadStream, mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { categoryFor } from '../../src/lib/landuse';

const IN = process.env.LANDUSE_NDJSON ?? path.join('data', 'raw', 'landuse', 'landuse_features.ndjson');
const OUT = path.join('data', 'derived');
mkdirSync(OUT, { recursive: true });
const out = createWriteStream(path.join(OUT, 'landuse.ndjson'));
const counts: Record<string, number> = {};
let n = 0, skipped = 0;
for await (const line of createInterface({ input: createReadStream(IN), crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  const f = JSON.parse(line) as { id?: number; geometry?: { type: string; coordinates: unknown }; properties?: Record<string, unknown> };
  const p = f.properties ?? {};
  const tertiary = String(p.Tertiary ?? p.Secondary ?? '');
  if (!f.geometry || !/^(Multi)?Polygon$/.test(f.geometry.type) || !tertiary) { skipped++; continue; }
  const c = categoryFor(tertiary);
  counts[c] = (counts[c] ?? 0) + 1;
  out.write(JSON.stringify({ i: Number(p.OBJECTID ?? f.id), c, t: tertiary, g: f.geometry }) + '\n');
  n++;
}
out.end();
writeFileSync(path.join(OUT, 'landuse_summary.json'), JSON.stringify({ source: IN, polygons: n, skipped, categories: counts }, null, 2));
console.log(`${n.toLocaleString()} polygons (${skipped} skipped) -> data/derived/landuse.ndjson`, counts);
