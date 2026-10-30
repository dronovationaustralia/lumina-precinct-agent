/**
 * Public contracts of the headless API (v1).
 *
 * These schemas are the product: the portal, the Quest app and external agents all
 * depend on them. `MapAction` must stay identical to the Quest app's definition.
 */
import { z } from 'zod';

import REGISTRY from './station-registry.json';

/** Every Sydney Trains and Metro station id (from the GTFS registry). */
export const STATION_IDS: readonly string[] = REGISTRY.stations.map((s) => s.id);
const STATION_SET = new Set(STATION_IDS);
export const StationId = z.string().refine((v) => STATION_SET.has(v), { message: 'Unknown station id' });
export type StationId = string;

/** Distance bands around a station. 0-400m and 0-800m overlap on purpose. */
export const RINGS = {
  '0-400m': { min_m: 0, max_m: 400, label: 'within 400 m' },
  '0-800m': { min_m: 0, max_m: 800, label: 'within 800 m' },
  '800m-2km': { min_m: 800, max_m: 2000, label: '800 m to 2 km' },
  '2-5km': { min_m: 2000, max_m: 5000, label: '2 to 5 km' },
} as const;
export const RingId = z.enum(['0-400m', '0-800m', '800m-2km', '2-5km']);
export type RingId = z.infer<typeof RingId>;

export const PropertyType = z.enum(['house', 'unit', 'all']);
export type PropertyType = z.infer<typeof PropertyType>;

export const LandUseClass = z.enum(['building', 'tree_canopy', 'car_park', 'construction_site']);
export type LandUseClass = z.infer<typeof LandUseClass>;

const LatLon = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict();

/** Identical to the Quest app's MapAction. Do not change without changing both clients. */
export const MapAction = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('fly_to'),
    target: z.union([z.string().min(1), LatLon]),
    view: z.enum(['overview', 'close']).optional(),
    duration_ms: z.number().int().min(0).max(20_000).optional(),
  }).strict(),
  z.object({
    type: z.literal('set_radius'),
    radius_m: z.number().int().min(100).max(2000).refine((v) => v % 100 === 0, 'radius_m must be a multiple of 100'),
  }).strict(),
  z.object({
    type: z.literal('highlight'),
    kind: z.enum(['station', 'place', 'news', 'landuse_class']),
    ids: z.array(z.string().min(1)).max(20).optional(),
    class: z.string().optional(),
    style: z.enum(['pulse', 'outline']).optional(),
    duration_ms: z.number().int().min(0).max(20_000).optional(),
  }).strict(),
  z.object({
    type: z.literal('compare'),
    station_ids: z.tuple([z.string().min(1), z.string().min(1)]),
    metrics: z.array(z.string().min(1)).min(1).max(6),
    radius_m: z.number().int().min(100).max(2000).optional(),
  }).strict(),
  z.object({
    type: z.literal('show_layer'),
    layer: z.enum(['land_use', 'esg', 'sales', 'patronage', 'news', 'places', 'lines']),
    visible: z.boolean().optional(),
    classes: z.array(z.string()).optional(),
  }).strict(),
]);
export type MapAction = z.infer<typeof MapAction>;

export const FollowUp = z.object({
  label: z.string().min(1).max(32),
  question: z.string().min(1).max(300).optional(),
  action: MapAction.optional(),
}).strict().refine((f) => f.question || f.action, 'a follow-up needs a question or an action');
export type FollowUp = z.infer<typeof FollowUp>;

/** A number the agent is allowed to say. Every figure in an answer is one of these. */
export const Fact = z.object({
  id: z.string().regex(/^f\d+$/),
  label: z.string(),
  value: z.number().nullable(),
  unit: z.string(),
  display: z.string(),
  source: z.string(),
  dataset_id: z.string(),
  as_of: z.string(),
  suppressed: z.boolean().optional(),
  metric: z.string().optional(),
  station_id: z.string().optional(),
  ring: z.string().optional(),
  property_type: z.string().optional(),
  demo: z.boolean().optional(),
});
export type Fact = z.infer<typeof Fact>;

/**
 * The model never writes chart numbers. It names the facts to plot and the server builds
 * a Vega-Lite spec from them.
 */
export const ChartRequest = z.object({
  kind: z.enum(['bar', 'grouped_bar']),
  title: z.string().min(1).max(80),
  fact_ids: z.array(z.string().regex(/^f\d+$/)).min(2).max(12),
}).strict();
export type ChartRequest = z.infer<typeof ChartRequest>;

export const VegaLiteSpec = z.object({
  $schema: z.string(),
  title: z.string(),
  data: z.object({ values: z.array(z.record(z.string(), z.unknown())) }),
  mark: z.unknown(),
  encoding: z.record(z.string(), z.unknown()),
}).passthrough();
export type VegaLiteSpec = z.infer<typeof VegaLiteSpec>;

export const AskRequest = z.object({
  question: z.string().trim().min(3).max(500),
  station_context: StationId.optional(),
  radius_m: z.number().int().min(100).max(2000).optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) })).max(6).optional(),
}).strict();
export type AskRequest = z.infer<typeof AskRequest>;

export const VerificationCheck = z.object({
  name: z.string(),
  passed: z.boolean(),
  detail: z.string().optional(),
});
export const Verification = z.object({
  status: z.enum(['verified', 'verified_after_retry', 'fallback']),
  attempts: z.number().int(),
  checks: z.array(VerificationCheck),
  errors: z.array(z.string()),
});
export type Verification = z.infer<typeof Verification>;

export const Source = z.object({
  dataset_id: z.string(),
  name: z.string(),
  licence: z.string(),
  as_of: z.string(),
  url: z.string().optional(),
  demo: z.boolean(),
});
export type Source = z.infer<typeof Source>;

export const ToolTrace = z.object({
  tool: z.string(),
  args: z.unknown(),
  ok: z.boolean(),
  ms: z.number(),
  fact_ids: z.array(z.string()),
  sql: z.string().optional(),
  error: z.string().optional(),
});
export type ToolTrace = z.infer<typeof ToolTrace>;

export const AskResponse = z.object({
  lines: z.array(z.string()).max(3),
  /** The same lines with {fN} placeholders, so clients can render each figure as a traceable fact. */
  templates: z.array(z.string()).max(3),
  disclaimer: z.string(),
  facts: z.array(Fact),
  sources: z.array(Source),
  actions: z.array(MapAction).max(3),
  followups: z.array(FollowUp).max(2),
  chart: VegaLiteSpec.nullable(),
  verification: Verification,
  meta: z.object({
    request_id: z.string(),
    provider: z.string(),
    model: z.string(),
    demo_data: z.boolean(),
    timings_ms: z.record(z.string(), z.number()),
    reasoning_effort: z.string().optional(),
    tokens: z.object({ input: z.number(), output: z.number(), reasoning: z.number().optional() }),
    speculative_compose: z.object({ used: z.number(), discarded: z.number() }).optional(),
    tool_calls: z.array(ToolTrace),
  }),
});
export type AskResponse = z.infer<typeof AskResponse>;

export const DISCLAIMER = 'General information, not financial advice.';
