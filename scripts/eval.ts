/**
 * Agent eval: fixed questions, each scored on
 *   valid schema · numbers verified · banned phrases · correct tool/metric chosen · latency · tokens · cost.
 *
 * Usage:
 *   npm run eval                         # provider from env (meta if MODEL_API_KEY set, else offline)
 *   npm run eval -- --provider meta
 *   npm run eval -- --provider baseten   # Muse Spark Open
 *   npm run eval -- --provider offline   # rule-based baseline, no model
 *
 * Writes evals/results-<provider>.json and evals/results-<provider>.md (the README table).
 * Cost uses PRICE_INPUT_PER_MTOK / PRICE_OUTPUT_PER_MTOK (USD) if set; otherwise "n/a".
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f);

const { AskResponse } = await import('@/lib/contracts');
const { runAgent } = await import('@/server/agent/graph');
const { getModel } = await import('@/server/agent/providers');
const { getDb } = await import('@/server/db/client');

type Case = { id: string; q: string; expect: string[]; kind?: 'in_scope' | 'out_of_scope' };

// `expect` lists metric ids (via query_metric), tool names, or "none" for out-of-scope.
export const CASES: Case[] = [
  { id: 'q01', q: 'How do prices near Parramatta station compare with 2 to 5 km away?', expect: ['transit_premium|median_price'] },
  { id: 'q02', q: 'Which of the 10 stations has the most tree canopy within 800 m?', expect: ['canopy_pct|land_use'] },
  { id: 'q03', q: 'Compare Chatswood and St Leonards on price momentum and car-park cover.', expect: ['price_change_12m', 'carpark_pct|land_use'] },
  { id: 'q04', q: 'Show me where sales are cheapest within 1 km of Westmead.', expect: ['median_price|run_sql'] },
  { id: 'q05', q: 'What is the transit premium for houses at Chatswood?', expect: ['transit_premium'] },
  { id: 'q06', q: 'How affordable are units near Auburn compared with the city median?', expect: ['affordable_share'] },
  { id: 'q07', q: 'How busy is North Sydney station, and is patronage growing?', expect: ['patronage_12m|patronage_change_12m'] },
  { id: 'q08', q: 'What is the land use within 800 m of Granville?', expect: ['land_use|building_pct|canopy_pct'] },
  { id: 'q09', q: 'How much of the area within 400 m of Wynyard is car parks?', expect: ['carpark_pct|land_use'] },
  { id: 'q10', q: 'Median unit price within 800 m of Harris Park?', expect: ['median_price'] },
  { id: 'q11', q: 'How many sales were there near Milsons Point in the last year?', expect: ['sales_count|run_sql'] },
  { id: 'q12', q: 'Has the median house price near Parramatta gone up over the past year?', expect: ['price_change_12m'] },
  { id: 'q13', q: 'Compare construction activity near Parramatta and Westmead.', expect: ['construction_pct|land_use'] },
  { id: 'q14', q: 'Which corridor has higher unit prices near stations, North Shore or Parramatta?', expect: ['median_price|run_sql'] },
  { id: 'q15', q: 'Rank all stations by price momentum for units within 800 m.', expect: ['price_change_12m|run_sql'] },
  { id: 'q16', q: 'Price per square metre of land for houses near St Leonards?', expect: ['median_price_per_m2|transit_premium'] },
  { id: 'q17', q: 'Is Chatswood greener than St Leonards?', expect: ['canopy_pct|land_use'] },
  { id: 'q18', q: 'What data sources do you use?', expect: ['list_datasets'] },
  { id: 'q19', q: 'What is the weather in Perth tomorrow?', expect: ['none'], kind: 'out_of_scope' },
  { id: 'q20', q: 'Should I buy an apartment in Parramatta now?', expect: ['median_price|price_change_12m|none'] },
  { id: 'q21', q: 'Tell me about Bondi Junction station.', expect: ['none|search_place'], kind: 'out_of_scope' },
  { id: 'q22', q: 'Monthly sales counts for units within 800 m of Chatswood over the last year.', expect: ['run_sql|sales_count'] },
  { id: 'q23', q: 'Which stations under $900k unit median had the strongest unit price growth?', expect: ['rank_stations'] },
  { id: 'q24', q: 'Which stations have the lowest unit medians within 800 m?', expect: ['rank_stations'] },
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const providerArg = arg('provider') as 'meta' | 'baseten' | 'offline' | undefined;
const effortArg = arg('effort');
if (effortArg) process.env.MUSE_REASONING_EFFORT = effortArg;
const composeEffortArg = arg('compose-effort');
if (composeEffortArg) process.env.MUSE_COMPOSE_EFFORT = composeEffortArg;
const only = arg('only');
const model = getModel(providerArg);
const db = await getDb();
// Meta list prices for Muse Spark 1.3 (USD per million tokens, 29 Oct 2026); override with env.
const DEFAULT_PRICES: Record<string, [number, number]> = { meta: [1.25, 4.25] };
const priceIn = Number(process.env.PRICE_INPUT_PER_MTOK ?? DEFAULT_PRICES[model.provider]?.[0] ?? NaN);
const priceOut = Number(process.env.PRICE_OUTPUT_PER_MTOK ?? DEFAULT_PRICES[model.provider]?.[1] ?? NaN);
const effort = (model as { effort?: string }).effort ?? 'n/a';

const results = [];
for (const c of CASES.filter((x) => !only || only.split(',').includes(x.id))) {
  const t0 = performance.now();
  let row: Record<string, unknown>;
  try {
    const r = await runAgent(db, { question: c.q }, { model });
    const ms = Math.round(performance.now() - t0);
    const used = new Set<string>();
    for (const t of r.meta.tool_calls) {
      used.add(t.tool);
      const m = (t.args as { metric?: string } | undefined)?.metric;
      if (m) used.add(m);
    }
    if (!r.meta.tool_calls.length) used.add('none');
    const toolOk = c.expect.every((alt) => alt.split('|').some((x) => used.has(x)));
    const check = (name: string) => r.verification.checks.find((k) => k.name === name)?.passed ?? false;
    const schemaOk = AskResponse.safeParse(r).success;
    const numbersOk = r.verification.status !== 'fallback' && check('numbers_verified');
    const wordingOk = r.verification.status !== 'fallback' && check('wording');
    const pass = schemaOk && numbersOk && wordingOk && toolOk;
    const cost = Number.isFinite(priceIn) && Number.isFinite(priceOut) ? (r.meta.tokens.input * priceIn + r.meta.tokens.output * priceOut) / 1e6 : null;
    row = {
      id: c.id, question: c.q, pass, schema: schemaOk, numbers_verified: numbersOk, wording: wordingOk, tool_choice: toolOk,
      status: r.verification.status, tools_used: [...used], latency_ms: ms, tokens_in: r.meta.tokens.input, tokens_out: r.meta.tokens.output,
      cost_usd: cost, lines: r.lines, errors: r.verification.errors,
      tokens_reasoning: r.meta.tokens.reasoning ?? 0, timings_ms: r.meta.timings_ms,
      speculative: r.meta.speculative_compose, attempts: r.verification.attempts,
    };
  } catch (e) {
    row = { id: c.id, question: c.q, pass: false, error: e instanceof Error ? e.message : String(e), latency_ms: Math.round(performance.now() - t0) };
  }
  results.push(row);
  console.log(`${row.pass ? 'PASS' : 'FAIL'} ${c.id} ${row.latency_ms}ms ${row.status ?? row.error} tools=${(row.tools_used as string[] | undefined)?.join(',') ?? ''}`);
}

const passed = results.filter((r) => r.pass).length;
const lat = results.map((r) => Number(r.latency_ms)).sort((a, b) => a - b);
const p50 = lat[Math.floor(lat.length * 0.5)] ?? 0;
const p95 = lat[Math.min(lat.length - 1, Math.ceil(lat.length * 0.95) - 1)] ?? 0;
const tokIn = results.reduce((a, r) => a + Number(r.tokens_in ?? 0), 0);
const tokOut = results.reduce((a, r) => a + Number(r.tokens_out ?? 0), 0);
const costs = results.map((r) => r.cost_usd).filter((x): x is number => typeof x === 'number');
const summary = {
  run_at: new Date().toISOString(), provider: model.provider, model: model.model, reasoning_effort: effort, database: db.kind,
  passed, total: results.length, p50_ms: p50, p95_ms: p95, tokens_in: tokIn, tokens_out: tokOut,
  cost_usd_per_answer: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
};

const yes = (b: unknown) => (b ? 'yes' : '**no**');
const md = [
  `### Eval: ${model.provider} (${model.model}${effort !== 'n/a' ? `, reasoning effort ${effort}` : ''})`,
  '',
  `Run ${summary.run_at.slice(0, 16).replace('T', ' ')} UTC on ${db.kind}. **${passed} of ${results.length} pass.** p50 ${p50} ms, p95 ${p95} ms. Tokens ${tokIn} in / ${tokOut} out.${summary.cost_usd_per_answer !== null ? ` Cost per answer US$${summary.cost_usd_per_answer.toFixed(4)}.` : ''}`,
  '',
  '| # | Question | Pass | Schema | Numbers verified | Wording | Tool choice | Status | ms |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...results.map((r) => `| ${r.id} | ${String(r.question).replace(/\|/g, '/')} | ${yes(r.pass)} | ${yes(r.schema)} | ${yes(r.numbers_verified)} | ${yes(r.wording)} | ${yes(r.tool_choice)} | ${r.status ?? 'error'} | ${r.latency_ms} |`),
  '',
].join('\n');

await mkdir('evals', { recursive: true });
await writeFile(path.join('evals', `results-${model.provider}.json`), JSON.stringify({ summary, results }, null, 2));
await writeFile(path.join('evals', `results-${model.provider}.md`), md);
// Keep every run so latency and cost can be compared across settings.
await mkdir(path.join('evals', 'runs'), { recursive: true });
const stamp = summary.run_at.replace(/[:.]/g, '-').slice(0, 19);
await writeFile(path.join('evals', 'runs', `${stamp}-${model.provider}-${effort.replace('/', '-')}.json`), JSON.stringify({ summary, results }, null, 2));
console.log(`\n${passed}/${results.length} passed · p50 ${p50} ms · p95 ${p95} ms → evals/results-${model.provider}.{json,md}`);
await db.close();
