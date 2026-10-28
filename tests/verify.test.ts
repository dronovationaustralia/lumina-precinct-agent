import { describe, expect, test } from 'vitest';

import type { Fact, ToolTrace } from '@/lib/contracts';
import { fillPlaceholders, verifyDraft, type Draft } from '@/server/agent/verify';

const fact = (id: string, value: number | null, extra: Partial<Fact> = {}): Fact => ({
  id, label: `fact ${id}`, value, unit: 'aud', display: value === null ? 'suppressed (fewer than 10 sales)' : `$${value}`,
  source: 'test', dataset_id: 'demo_sales', as_of: '2026-09-30', metric: 'median_price', station_id: 'chatswood', ring: '0-800m', ...extra,
});
const FACTS = [fact('f1', 1_340_000), fact('f2', 1_240_000, { station_id: 'st_leonards' }), fact('f3', null), fact('f4', 21.5, { unit: 'pct', metric: 'canopy_pct', display: '21.5%' })];
const draft = (d: Partial<Draft>): Draft => ({ lines: ['Chatswood units have a median of {f1}.'], actions: [], followups: [], chart: null, ...d });
const errorsOf = (d: Partial<Draft>, trace: ToolTrace[] = []) => verifyDraft(draft(d), FACTS, trace).errors.join(' | ');

describe('verifier', () => {
  test('accepts a grounded answer with actions, follow-ups and a chart', () => {
    const r = verifyDraft(
      draft({
        lines: ['Median unit prices within 800 m are {f1} at Chatswood and {f2} at St Leonards.', 'Tree canopy within 800 m of Chatswood is {f4}.'],
        actions: [{ type: 'compare', station_ids: ['chatswood', 'st_leonards'], metrics: ['median_price'], radius_m: 800 }, { type: 'fly_to', target: 'chatswood' }],
        followups: [{ label: 'Land use', question: 'What is the land use near Chatswood?' }],
        chart: { kind: 'bar', title: 'Median unit price', fact_ids: ['f1', 'f2'] },
      }),
      FACTS, [],
    );
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.actions).toHaveLength(2);
    expect(r.chart?.fact_ids).toEqual(['f1', 'f2']);
  });

  test('allows ring and window labels but no other digits', () => {
    expect(errorsOf({ lines: ['Within 800 m and 2 to 5 km away over 12 months: {f1}.'] })).toBe('');
    expect(errorsOf({ lines: ['The median is $1.34m ({f1}).'] })).toMatch(/unverified number/);
    expect(errorsOf({ lines: ['Prices rose 13% near {f1}.'] })).toMatch(/unverified number/);
  });

  test('allows digits that come verbatim from tool notes (dataset names, licences)', () => {
    const d = draft({ lines: ['Sales come from NSW Valuer General data under CC BY 4.0, with {f1} as the median.'] });
    expect(verifyDraft(d, FACTS, [], []).errors.join(' ')).toMatch(/unverified number/);
    expect(verifyDraft(d, FACTS, [], ['Dataset: NSW Valuer General bulk sales. Licence: CC BY 4.0.']).errors).toEqual([]);
  });

  test('rejects unknown and unusable placeholders', () => {
    expect(errorsOf({ lines: ['The median is {f9}.'] })).toMatch(/no tool returned/);
    expect(errorsOf({ lines: ['The median is {f3}.'] })).toMatch(/has no value/);
    expect(errorsOf({ lines: ['The median is {f1} and {price}.'] })).toMatch(/malformed placeholder/);
  });

  test('requires at least one cited fact when facts exist', () => {
    expect(errorsOf({ lines: ['Chatswood is a busy centre.'] })).toMatch(/no fact cited/);
  });

  test.each([
    ['Prices are high because of the Metro, at {f1}.', /causal claim/],
    ['The station causes a premium of {f1}.', /causal claim/],
    ['Prices will keep rising from {f1}.', /prediction/],
    ['It is a good time to buy at {f1}.', /advice/],
    ['There are new buildings, with canopy at {f4}.', /one capture date/],
  ])('bans wording: %s', (line, re) => {
    expect(errorsOf({ lines: [line] })).toMatch(re);
  });

  test('checks the shape: 1 to 3 lines', () => {
    expect(errorsOf({ lines: [] })).toMatch(/1 to 3 lines/);
    expect(errorsOf({ lines: ['{f1}.', '{f1}.', '{f1}.', '{f1}.'] })).toMatch(/1 to 3 lines/);
  });

  test('validates map actions against the Quest schema', () => {
    expect(errorsOf({ actions: [{ type: 'set_radius', radius_m: 150 }] })).toMatch(/multiple of 100/);
    expect(errorsOf({ actions: [{ type: 'set_radius', radius_m: 2500 }] })).toMatch(/action 1 invalid/);
    expect(errorsOf({ actions: [{ type: 'fly_to', target: 'bondi' }] })).toMatch(/unknown fly_to target/);
    expect(errorsOf({ actions: [{ type: 'compare', station_ids: ['chatswood', 'bondi'], metrics: ['vibes'] }] })).toMatch(/unknown station bondi.*unknown metric vibes/);
    expect(errorsOf({ actions: [{ type: 'teleport' }] })).toMatch(/action 1 invalid/);
  });

  test('validates follow-ups and charts', () => {
    expect(errorsOf({ followups: [{ label: 'x'.repeat(33), question: 'q' }] })).toMatch(/follow-up 1 invalid/);
    expect(errorsOf({ chart: { kind: 'bar', title: 'Mixed', fact_ids: ['f1', 'f4'] } })).toMatch(/mixes units/);
    expect(errorsOf({ chart: { kind: 'bar', title: 'Bad', fact_ids: ['f1', 'f3'] } })).toMatch(/no value/);
  });

  test('flags SQL that did not come through the guard', () => {
    const trace: ToolTrace[] = [{ tool: 'run_sql', args: {}, ok: true, ms: 1, fact_ids: [], sql: 'delete from sales' }];
    expect(errorsOf({}, trace)).toMatch(/bypassed the guard/);
  });

  test('fills placeholders with display values', () => {
    expect(fillPlaceholders('{f1} vs {f2}', FACTS)).toBe('$1340000 vs $1240000');
  });
});
