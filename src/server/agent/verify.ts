/**
 * Deterministic verifier. No model is involved.
 *
 * An answer passes only if:
 *  - it has 1 to 3 short lines;
 *  - every number in the text is a {fN} placeholder for an existing fact with a value
 *    (ring and window labels such as "800 m" or "12 months" are the only allowed digits);
 *  - no banned wording (causal claims, predictions, advice, "new" for land use);
 *  - it cites at least one fact when usable facts exist;
 *  - map actions, follow-ups and the chart request match their schemas and refer to real
 *    stations, metrics and facts;
 *  - every SQL statement that ran came through the guard (read-only, allowlisted, limited).
 */
import { z } from 'zod';

import { ChartRequest, FollowUp, MapAction, STATION_IDS, type Fact, type ToolTrace } from '@/lib/contracts';
import { findStation } from '@/lib/stations';

import { METRIC_BY_ID } from '../metrics/catalogue';
import { MAX_ROWS } from '../tools/sql-guard';

export const Draft = z.object({
  lines: z.array(z.string()),
  actions: z.array(z.unknown()).default([]),
  followups: z.array(z.unknown()).default([]),
  chart: z.unknown().nullable().default(null),
});
export type Draft = z.infer<typeof Draft>;

export type CheckResult = { name: string; passed: boolean; detail?: string };
export type VerifyResult = {
  ok: boolean;
  checks: CheckResult[];
  errors: string[];
  actions: MapAction[];
  followups: FollowUp[];
  chart: ChartRequest | null;
};

const PLACEHOLDER = /\{(f\d+)\}/g;

/** Digits allowed outside placeholders: ring, radius and time-window labels only. */
const ALLOWED_NUMBER_PHRASES = [
  /\b\d+(?:\.\d+)?\s?(?:to|-|–)\s?\d+(?:\.\d+)?\s?(?:km|m)\b/gi, // "2 to 5 km", "800 m-2 km" handled below
  /\b(?:[1-9]|1\d|20)00\s?m\b/gi, // 100 m .. 2000 m
  /\b(?:0\.4|0\.8|1|2|5)\s?km\b/gi,
  /\b(?:12|24)\s?months?\b/gi,
  /\bfewer than 10 sales\b/gi,
];

const BANNED: { name: string; re: RegExp }[] = [
  { name: 'causal claim', re: /\b(caus(?:e|es|ed|ing)|because of|due to|leads? to|led to|results? in|resulted in|driven by|thanks to)\b/i },
  { name: 'prediction', re: /\b(will|going to|expected to|forecast\w*|predict\w*|likely to|set to)\b/i },
  { name: 'advice', re: /\b(buy|buying|sell|selling|invest|investing|investment|recommend\w*|good time|bargain|undervalued|overvalued|you should)\b/i },
];
const LAND_USE_WORDS = /\b(canopy|trees?|car ?parks?|parking|construction|buildings?|land use)\b/i;
const NEW_WORDS = /\b(new|newly|recent(?:ly)?|emerging)\b/i;
const LAND_USE_METRICS = new Set(['canopy_pct', 'carpark_pct', 'building_pct', 'construction_pct']);

export function verifyDraft(draft: Draft, facts: Fact[], trace: ToolTrace[]): VerifyResult {
  const checks: CheckResult[] = [];
  const errors: string[] = [];
  const byId = new Map(facts.map((f) => [f.id, f]));
  const check = (name: string, problems: string[]) => {
    checks.push({ name, passed: problems.length === 0, detail: problems.length ? problems.join('; ') : undefined });
    errors.push(...problems.map((p) => `${name}: ${p}`));
  };

  // 1. Shape of the text.
  const shape: string[] = [];
  if (draft.lines.length < 1 || draft.lines.length > 3) shape.push(`expected 1 to 3 lines, got ${draft.lines.length}`);
  draft.lines.forEach((l, i) => {
    if (!l.trim()) shape.push(`line ${i + 1} is empty`);
    if (l.length > 240) shape.push(`line ${i + 1} is ${l.length} characters (max 240)`);
  });
  check('answer_shape', shape);

  // 2. Every number is a verified fact.
  const numbers: string[] = [];
  const cited = new Set<string>();
  for (const [i, line] of draft.lines.entries()) {
    for (const m of line.matchAll(PLACEHOLDER)) {
      const f = byId.get(m[1]!);
      if (!f) numbers.push(`line ${i + 1} cites {${m[1]}}, which no tool returned`);
      else if (f.value === null) numbers.push(`line ${i + 1} cites {${m[1]}}, which has no value (${f.display})`);
      else cited.add(f.id);
    }
    let rest = line.replace(PLACEHOLDER, ' ');
    if (/[{}]/.test(rest)) numbers.push(`line ${i + 1} has a malformed placeholder; use {fN}`);
    for (const re of ALLOWED_NUMBER_PHRASES) rest = rest.replace(re, ' ');
    const stray = rest.match(/\d[\d,.]*\s?%?/g);
    if (stray) numbers.push(`line ${i + 1} contains unverified number(s) ${stray.map((s) => `"${s.trim()}"`).join(', ')}; every figure must be a {fN} placeholder`);
  }
  check('numbers_verified', numbers);

  const usable = facts.filter((f) => f.value !== null);
  check('cites_facts', usable.length > 0 && cited.size === 0 ? ['no fact cited although usable facts exist'] : []);

  // 3. Wording rules.
  const wording: string[] = [];
  for (const [i, line] of draft.lines.entries()) {
    const plain = line.replace(PLACEHOLDER, ' ');
    for (const b of BANNED) {
      const m = plain.match(b.re);
      if (m) wording.push(`line ${i + 1}: ${b.name} ("${m[0]}"); say "associated with" and describe, do not predict or advise`);
    }
    const citesLandUse = [...line.matchAll(PLACEHOLDER)].some((m) => LAND_USE_METRICS.has(byId.get(m[1]!)?.metric ?? ''));
    if ((citesLandUse || LAND_USE_WORDS.test(plain)) && NEW_WORDS.test(plain)) {
      wording.push(`line ${i + 1}: land use comes from one capture date, so do not call anything "${plain.match(NEW_WORDS)![0]}"`);
    }
  }
  check('wording', wording);

  // 4. Map actions.
  const actionProblems: string[] = [];
  const actions: MapAction[] = [];
  if (draft.actions.length > 3) actionProblems.push(`at most 3 actions (got ${draft.actions.length})`);
  for (const [i, raw] of draft.actions.slice(0, 3).entries()) {
    const p = MapAction.safeParse(raw);
    if (!p.success) {
      actionProblems.push(`action ${i + 1} invalid: ${p.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join(', ')}`);
      continue;
    }
    const a = p.data;
    if (a.type === 'fly_to' && typeof a.target === 'string' && !findStation(a.target)) actionProblems.push(`action ${i + 1}: unknown fly_to target ${a.target}`);
    if (a.type === 'compare') {
      for (const s of a.station_ids) if (!(STATION_IDS as readonly string[]).includes(s)) actionProblems.push(`action ${i + 1}: unknown station ${s}`);
      for (const m of a.metrics) if (!METRIC_BY_ID.has(m)) actionProblems.push(`action ${i + 1}: unknown metric ${m}`);
    }
    if (a.type === 'highlight' && a.kind === 'station') {
      for (const s of a.ids ?? []) if (!(STATION_IDS as readonly string[]).includes(s)) actionProblems.push(`action ${i + 1}: unknown station ${s}`);
    }
    actions.push(a);
  }
  check('map_actions', actionProblems);

  // 5. Follow-ups.
  const fuProblems: string[] = [];
  const followups: FollowUp[] = [];
  if (draft.followups.length > 2) fuProblems.push(`at most 2 follow-ups (got ${draft.followups.length})`);
  for (const [i, raw] of draft.followups.slice(0, 2).entries()) {
    const p = FollowUp.safeParse(raw);
    if (!p.success) fuProblems.push(`follow-up ${i + 1} invalid: ${p.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join(', ')}`);
    else followups.push(p.data);
  }
  check('followups', fuProblems);

  // 6. Chart request: numbers come from facts only.
  const chartProblems: string[] = [];
  let chart: ChartRequest | null = null;
  if (draft.chart) {
    const p = ChartRequest.safeParse(draft.chart);
    if (!p.success) chartProblems.push(`chart invalid: ${p.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join(', ')}`);
    else {
      const fs = p.data.fact_ids.map((id) => byId.get(id));
      if (fs.some((f) => !f)) chartProblems.push('chart cites a fact that does not exist');
      else if (fs.some((f) => f!.value === null)) chartProblems.push('chart cites a fact with no value');
      else if (new Set(fs.map((f) => f!.unit)).size > 1) chartProblems.push('chart mixes units; plot one measure');
      else chart = p.data;
    }
  }
  check('chart', chartProblems);

  // 7. SQL governance: anything that ran went through the guard.
  const sqlProblems: string[] = [];
  for (const t of trace.filter((t) => t.tool === 'run_sql' && t.ok)) {
    if (!t.sql?.startsWith('select * from (') || !t.sql.endsWith(`limit ${MAX_ROWS}`)) sqlProblems.push('a run_sql call bypassed the guard');
  }
  check('sql_read_only', sqlProblems);

  return { ok: errors.length === 0, checks, errors, actions, followups, chart };
}

/** Replace {fN} with the fact's display value. Only called on verified text. */
export function fillPlaceholders(line: string, facts: Fact[]): string {
  const byId = new Map(facts.map((f) => [f.id, f]));
  return line.replace(PLACEHOLDER, (_, id: string) => byId.get(id)?.display ?? `{${id}}`);
}
