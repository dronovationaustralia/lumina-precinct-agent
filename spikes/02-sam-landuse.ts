/**
 * Spike 2: SAM 3.1 land-use segmentation on two NSW aerial chips.
 *
 * Questions this answers:
 *  - Request shape for SAM 3.1 on the Responses API (one noun phrase per request,
 *    image as a data URL, streamed) and how to decode its masks.
 *  - Do the four land-use prompts return sensible masks on 0.25 m Sydney imagery?
 *  - % cover per class for the chip and for a 100 m circle around the station.
 *  - Latency per request, so we can size the 10-station batch (day 4).
 *
 * Usage:
 *   npm run spike:chips            # fetch spikes/chips/{parramatta,chatswood}.jpg
 *   npm run spike:sam              # live
 *   npm run spike:sam -- --mock    # against the local mock server
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  decodeMaskToRaster,
  decodeMaskToSVGPath,
  parseImageStream,
  recordsOfKind,
  type ImageSegmentationResult,
  type ResponsesEvent,
} from '@meta-sam/parser';
import OpenAI from 'openai';

import { CHIPS, CHIP_DIR, CHIP_PX, GROUND_RES_M } from './fetch-nsw-chips.js';
import { META_BASE_URL, MOCK, MODELS, RESULTS_DIR, apiKey } from './lib/env.js';

export const LAND_USE_CLASSES = ['building', 'tree canopy', 'car park', 'construction site'] as const;
const COLOURS: Record<string, string> = {
  building: '#e4572e', 'tree canopy': '#29bf12', 'car park': '#4361ee', 'construction site': '#ffc914',
};
const INNER_RADIUS_M = 100;

/**
 * The API emits `response.content_part.done` but not always `response.output_text.done`,
 * which the parser needs to close a text lane. Synthesise it once per lane.
 */
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

async function segment(client: OpenAI, imageDataUrl: string, concept: string): Promise<ImageSegmentationResult> {
  const stream = await client.responses.create({
    model: MODELS.sam,
    stream: true,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: concept },
          { type: 'input_image', image_url: imageDataUrl, detail: 'auto' },
        ],
      },
    ],
  });
  return parseImageStream(withTextDone(stream as AsyncIterable<unknown>)).finalResult;
}

/** Paint each mask's raster into a chip-sized bitmap (union of all objects for one class). */
function unionBitmap(result: ImageSegmentationResult): Uint8Array {
  const bmp = new Uint8Array(CHIP_PX * CHIP_PX);
  for (const rec of recordsOfKind(result.records, 'mask')) {
    const raster = decodeMaskToRaster(rec.mask);
    const { left, top, right, bottom } = rec.bounds;
    const sx = (right - left) / rec.mask.width;
    const sy = (bottom - top) / rec.mask.height;
    for (let my = 0; my < rec.mask.height; my++) {
      for (let mx = 0; mx < rec.mask.width; mx++) {
        if (!raster[my * rec.mask.width + mx]) continue;
        const x0 = Math.floor(left + mx * sx), x1 = Math.max(x0 + 1, Math.floor(left + (mx + 1) * sx));
        const y0 = Math.floor(top + my * sy), y1 = Math.max(y0 + 1, Math.floor(top + (my + 1) * sy));
        for (let y = Math.max(0, y0); y < Math.min(CHIP_PX, y1); y++)
          for (let x = Math.max(0, x0); x < Math.min(CHIP_PX, x1); x++) bmp[y * CHIP_PX + x] = 1;
      }
    }
  }
  return bmp;
}

function coverPct(bmp: Uint8Array, radiusPx?: number): number {
  let on = 0, total = 0;
  const c = CHIP_PX / 2;
  for (let y = 0; y < CHIP_PX; y++)
    for (let x = 0; x < CHIP_PX; x++) {
      if (radiusPx !== undefined && (x + 0.5 - c) ** 2 + (y + 0.5 - c) ** 2 > radiusPx ** 2) continue;
      total++;
      on += bmp[y * CHIP_PX + x]!;
    }
  return total ? Math.round((on / total) * 1000) / 10 : 0;
}

function overlaySvg(chipFile: string, layers: { concept: string; result: ImageSegmentationResult }[]): string {
  const paths = layers.flatMap(({ concept, result }) =>
    recordsOfKind(result.records, 'mask').map((rec) => {
      const { left, top, right, bottom } = rec.bounds;
      const t = `translate(${left} ${top}) scale(${(right - left) / rec.mask.width} ${(bottom - top) / rec.mask.height})`;
      return `<path d="${decodeMaskToSVGPath(rec.mask)}" transform="${t}" fill="${COLOURS[concept]}" fill-opacity="0.45" fill-rule="evenodd"><title>${concept} #${rec.objectId}</title></path>`;
    }),
  );
  const r = INNER_RADIUS_M / GROUND_RES_M;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CHIP_PX} ${CHIP_PX}" width="${CHIP_PX}" height="${CHIP_PX}">
<image href="../chips/${chipFile}" width="${CHIP_PX}" height="${CHIP_PX}"/>
${paths.join('\n')}
<circle cx="${CHIP_PX / 2}" cy="${CHIP_PX / 2}" r="${r}" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="12 8"/>
</svg>\n`;
}

async function main() {
  const client = new OpenAI({ baseURL: META_BASE_URL, apiKey: apiKey(), timeout: 120_000, maxRetries: 1 });
  await mkdir(RESULTS_DIR, { recursive: true });
  const summary = [];

  for (const chip of CHIPS) {
    const file = path.join(CHIP_DIR, `${chip.id}.jpg`);
    const bytes = await readFile(file).catch(() => {
      throw new Error(`Missing ${file}. Run "npm run spike:chips" first.`);
    });
    const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`;
    const layers: { concept: string; result: ImageSegmentationResult }[] = [];
    const classes = [];

    for (const concept of LAND_USE_CLASSES) {
      const t0 = performance.now();
      let result: ImageSegmentationResult | undefined;
      let error: string | undefined;
      try {
        result = await segment(client, dataUrl, concept);
      } catch (e) {
        error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      }
      const latency = Math.round(performance.now() - t0);
      if (!result) {
        console.log(`${chip.name} / ${concept}: ERROR ${error}`);
        classes.push({ concept, latency_ms: latency, error });
        continue;
      }
      layers.push({ concept, result });
      const masks = recordsOfKind(result.records, 'mask');
      const confidences = masks.map((m) => m.confidence).filter((c): c is number => c !== undefined);
      const bmp = unionBitmap(result);
      const row = {
        concept,
        outcome: result.outcome.status,
        latency_ms: latency,
        objects: masks.length,
        mean_confidence: confidences.length ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100 : null,
        cover_pct_chip: coverPct(bmp),
        cover_pct_100m: coverPct(bmp, INNER_RADIUS_M / GROUND_RES_M),
        diagnostics: result.diagnostics.map((d) => `${d.severity}:${d.code}`),
      };
      console.log(`${chip.name} / ${concept}: ${row.objects} objects, chip ${row.cover_pct_chip}%, 100 m ${row.cover_pct_100m}%, ${latency} ms`);
      classes.push(row);
    }

    const svgFile = path.join(RESULTS_DIR, `02-sam-${chip.id}${MOCK ? '.mock' : ''}.svg`);
    await writeFile(svgFile, overlaySvg(`${chip.id}.jpg`, layers));
    summary.push({ chip: chip.id, size_px: CHIP_PX, ground_res_m: GROUND_RES_M, classes });
  }

  const out = path.join(RESULTS_DIR, `02-sam-landuse${MOCK ? '.mock' : ''}.json`);
  await writeFile(out, JSON.stringify({ run_at: new Date().toISOString(), model: MODELS.sam, base_url: META_BASE_URL, note: 'Classes can overlap (e.g. canopy over car park); cover is per class, not a partition.', summary }, null, 2));
  console.log(`\nWrote ${path.relative(process.cwd(), out)} and overlay SVGs (open them in a browser).`);
  if (summary.some((s) => s.classes.some((c) => 'error' in c && c.error))) process.exitCode = 1;
}

await main();
