/**
 * "Brief me" precinct cards: an illustration drawn by Muse Image with the precinct's
 * verified figures laid over it as real text by our code.
 *
 * The rule that shapes everything: the agent never invents numbers, and image models
 * render text badly. So the prompt always bans text and numbers, and every figure on
 * the card comes from the governed metric queries (suppressed or missing figures are
 * left out, never estimated).
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PropertyType, RingId } from '@/lib/contracts';
import { LAND_USE_CATEGORIES, type LandUseCategory } from '@/lib/landuse';
import { LINE_COLOURS } from '@/lib/lines';
import type { Station } from '@/lib/stations';

import type { Db } from './db/client';
import { FactStore } from './facts';
import { computeMetric, listDatasets, metricFact, resolveMetricArgs } from './metrics/query';

export function briefingImageModel(): string {
  return process.env.MUSE_IMAGE_MODEL ?? 'muse-image-1.0';
}

function metaBaseUrl(): string {
  return process.env.META_BASE_URL ?? 'https://api.meta.ai/v1';
}

/** One figure for the card: label, display value, source and date, all from governed data. */
export type BriefingFigure = {
  label: string;
  display: string;
  value: number | null;
  unit: string;
  source: string;
  dataset_id: string;
  as_of: string;
  demo?: boolean;
  /** Land-use figures only: the category and share behind the prompt and the tile. */
  category?: string;
  share_pct?: number;
};

const FIGURE_QUERIES: readonly { metric: string; ring: RingId; property_type: PropertyType }[] = [
  { metric: 'median_price', ring: '0-800m', property_type: 'unit' },
  { metric: 'price_change_12m', ring: '0-800m', property_type: 'unit' },
  { metric: 'median_price', ring: '0-800m', property_type: 'house' },
  { metric: 'patronage_12m', ring: '0-800m', property_type: 'all' },
  { metric: 'patronage_change_12m', ring: '0-800m', property_type: 'all' },
];

/** The figures for the card, each with label, display value, source and as-of date. */
export async function briefingFacts(db: Db, station: string): Promise<BriefingFigure[]> {
  const datasets = await listDatasets(db);
  const store = new FactStore();
  const figures: BriefingFigure[] = [];
  for (const q of FIGURE_QUERIES) {
    const resolved = resolveMetricArgs(q.metric, q.ring, q.property_type);
    if (!resolved.ok) continue;
    const res = await computeMetric(db, resolved.metric, station, resolved.ring, resolved.property_type);
    const fact = metricFact(store, res, datasets);
    if (fact.suppressed || fact.value === null) continue;
    figures.push({
      label: fact.label,
      display: fact.display,
      value: fact.value,
      unit: fact.unit,
      source: fact.source,
      dataset_id: fact.dataset_id,
      as_of: fact.as_of,
      ...(fact.demo ? { demo: true } : {}),
    });
  }
  const mix = await db.readOnly<{ category: string; share_pct: number; as_of: string; dataset_id: string }>(
    'select category, share_pct, as_of, dataset_id from v_land_use_mix where station_id = $1 and ring_id = $2 order by share_pct desc limit 3',
    [station, '0-800m'],
  );
  for (const row of mix) {
    const info = (LAND_USE_CATEGORIES as Record<string, { label: string } | undefined>)[row.category];
    if (!info) continue;
    const share = Number(row.share_pct);
    if (!Number.isFinite(share)) continue;
    figures.push({
      label: `${info.label} share, within 800 m`,
      display: `${share.toFixed(1)}%`,
      value: share,
      unit: 'pct',
      source: 'NSW Landuse 2017 v1.5',
      dataset_id: row.dataset_id,
      as_of: row.as_of,
      category: row.category,
      share_pct: share,
    });
  }
  return figures;
}

export type LandUseSlice = { category: string; share_pct: number };

/** What each land-use category looks like from above. None of these may contain a digit. */
const LAND_USE_PHRASES: Record<LandUseCategory, string> = {
  residential: 'mid-rise apartment buildings near the station and low-rise houses with gardens further out',
  commercial: 'a small shopping street with awnings and shopfronts',
  public_services: 'civic buildings with a school oval',
  recreation: 'parks, playing fields and a village green',
  industrial: 'low warehouses set apart from the homes',
  transport: 'wide streets with bus stops and a taxi rank',
  in_transition: 'a fenced construction site with a tower crane',
  natural: 'patches of bushland with tall eucalyptus trees',
  water: 'a river winding along one edge with a footbridge',
  rural_other: 'open paddocks at the fringe',
};

/** Official line colours as words, so the prompt never carries a hex code or line number. */
const LINE_WORDS: Record<string, string> = {
  '#F99D1C': 'orange',
  '#0098CD': 'sky blue',
  '#F37021': 'burnt orange',
  '#005AA3': 'navy blue',
  '#C4258F': 'magenta',
  '#F6891F': 'amber',
  '#6F818E': 'slate grey',
  '#00954C': 'green',
  '#D11F2F': 'red',
  '#168388': 'teal',
  '#BE1622': 'crimson',
  '#DD1E25': 'scarlet',
  '#781140': 'maroon',
  '#BB2043': 'ruby',
};

function joinWords(words: string[]): string {
  if (words.length <= 2) return words.join(' and ');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function linePhrase(lines: string[]): string {
  const seen = new Map<string, boolean>();
  for (const line of lines) {
    const colour = LINE_COLOURS[line];
    const word = colour ? LINE_WORDS[colour] : undefined;
    if (!word || seen.has(word)) continue;
    seen.set(word, line.startsWith('M'));
  }
  const words = [...seen.keys()];
  if (words.length === 0) return 'a train line';
  if (words.length === 1) return `a ${seen.get(words[0]!) ? 'metro' : 'train'} line in ${words[0]}`;
  const metros = [...seen.values()];
  const kind = metros.every(Boolean) ? 'metro' : metros.some(Boolean) ? 'rail and metro' : 'rail';
  return `${kind} lines in ${joinWords(words.slice(0, 3))}`;
}

/** The no-text rule every briefing prompt must carry. */
export const NO_TEXT_RULE =
  'No text, no letters, no numbers, no logos, no real brand names, no identifiable people.';

/**
 * An image prompt describing the precinct's character only, driven by the land-use mix
 * and the station's lines. Never contains a digit: figures are rendered by our code.
 */
export function briefingPrompt(station: Station, landUse: LandUseSlice[]): string {
  const phrases = landUse
    .map((s) => (LAND_USE_PHRASES as Record<string, string | undefined>)[s.category])
    .filter((p): p is string => typeof p === 'string')
    .slice(0, 3);
  const features = [...phrases, linePhrase(station.lines), 'tree-lined streets'];
  return `A calm isometric illustration of a Sydney rail station precinct: ${features.join(', ')}. ${NO_TEXT_RULE}`;
}

type ImageResponse = { data?: { b64_json?: string; url?: string }[] };

/** Calls Muse Image and returns the picture as a data URL, plus model and latency. */
export async function generateIllustration(prompt: string): Promise<{ image: string; model: string; ms: number }> {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error('MODEL_API_KEY is not set, so briefing illustrations are unavailable.');
  const model = briefingImageModel();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const t0 = performance.now();
    let res: Response;
    try {
      res = await fetch(`${metaBaseUrl()}/images/generations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, size: '1024x1024', response_format: 'b64_json' }),
        signal: controller.signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw new Error('The illustration took over 60 s and was stopped.');
      throw new Error(`Illustration request failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    const ms = Math.round(performance.now() - t0);
    const text = await res.text();
    if (!res.ok) throw new Error(`Illustration failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
    const first = (JSON.parse(text) as ImageResponse).data?.[0];
    let b64 = first?.b64_json ?? null;
    if (!b64 && first?.url) {
      const img = await fetch(first.url, { signal: controller.signal });
      if (!img.ok) throw new Error(`Illustration download failed (HTTP ${img.status}).`);
      b64 = Buffer.from(await img.arrayBuffer()).toString('base64');
    }
    if (!b64) throw new Error('The image model returned no picture.');
    const bytes = Buffer.from(b64, 'base64');
    const mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : 'image/png';
    return { image: `data:${mime};base64,${b64}`, model, ms };
  } finally {
    clearTimeout(timer);
  }
}

const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

type CachedIllustration = { at: number; promptHash: string; image: string; model: string };

const memoryCache = new Map<string, CachedIllustration>();

const hashPrompt = (prompt: string) => createHash('sha256').update(prompt).digest('hex').slice(0, 16);

const cacheFile = (station: string) => join(tmpdir(), `lumina-briefing-${station}.json`);

function fresh(entry: CachedIllustration | undefined, promptHash: string): entry is CachedIllustration {
  return !!entry && entry.promptHash === promptHash && Date.now() - entry.at < CACHE_TTL_MS;
}

/**
 * The station's illustration, cached per station in memory plus a file under the OS temp
 * dir for 7 days, so repeated "Brief me" clicks cost nothing.
 */
export async function briefingIllustration(
  station: string,
  prompt: string,
  /** Asked before a new picture is generated (cached pictures are free); false refuses. */
  canGenerate?: () => boolean,
): Promise<{ image: string; model: string; ms: number; cached: boolean }> {
  const want = hashPrompt(prompt);
  const mem = memoryCache.get(station);
  if (fresh(mem, want)) return { image: mem.image, model: mem.model, ms: 0, cached: true };
  try {
    const file = JSON.parse(await readFile(cacheFile(station), 'utf8')) as CachedIllustration;
    if (fresh(file, want)) {
      memoryCache.set(station, file);
      return { image: file.image, model: file.model, ms: 0, cached: true };
    }
  } catch {
    // Miss, corrupt or unreadable: generate below.
  }
  if (canGenerate && !canGenerate()) throw new Error("The demo has reached today's limit for briefing pictures.");
  const gen = await generateIllustration(prompt);
  const entry: CachedIllustration = { at: Date.now(), promptHash: want, image: gen.image, model: gen.model };
  memoryCache.set(station, entry);
  await writeFile(cacheFile(station), JSON.stringify(entry)).catch(() => undefined);
  return { ...gen, cached: false };
}
