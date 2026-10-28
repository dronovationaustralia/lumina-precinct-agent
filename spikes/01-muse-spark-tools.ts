/**
 * Spike 1: Muse Spark native tool calling through LangChain.js.
 *
 * Questions this answers:
 *  - Does `ChatOpenAI` from @langchain/openai work against the Meta Model API
 *    (base URL https://api.meta.ai/v1) on both Chat Completions and Responses?
 *  - Does Muse Spark pick the right tool, with arguments that pass our Zod schemas?
 *  - Will it compose an answer using fact placeholders ({f1}) instead of raw numbers?
 *  - Latency and token usage per turn.
 *
 * Tools return FIXTURE data (clearly labelled), not real figures. Real data starts day 2.
 *
 * Usage:
 *   npm run spike:spark            # live, uses MODEL_API_KEY from .env.local
 *   npm run spike:spark -- --mock  # against the local mock server
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';

import { META_BASE_URL, MOCK, MODELS, RESULTS_DIR, apiKey } from './lib/env.js';

const STATIONS = [
  'wynyard', 'milsons_point', 'north_sydney', 'st_leonards', 'chatswood',
  'westmead', 'parramatta', 'harris_park', 'granville', 'auburn',
] as const;

const METRICS = ['median_price', 'transit_premium', 'price_change_12m', 'canopy_pct', 'carpark_pct', 'sales_count'] as const;

const queryMetricArgs = z.object({
  metric: z.enum(METRICS),
  stations: z.array(z.enum(STATIONS)).min(1).max(10),
  ring: z.enum(['0-400m', '0-800m', '800m-2km', '2-5km']),
  property_type: z.enum(['house', 'unit', 'all']).optional(),
});

const searchPlaceArgs = z.object({ query: z.string().min(2).max(80) });

type Fact = { id: string; label: string; value: number; unit: string; source: string };
let factCounter = 0;

/** Deterministic fixture numbers so runs are comparable. NOT real data. */
function fixtureValue(metric: string, station: string, ring: string): number {
  let h = 0;
  for (const c of `${metric}|${station}|${ring}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const r = (h % 1000) / 1000;
  switch (metric) {
    case 'median_price': return Math.round(700_000 + r * 1_300_000);
    case 'transit_premium': return Math.round((0.9 + r * 0.5) * 100) / 100;
    case 'price_change_12m': return Math.round((-5 + r * 15) * 10) / 10;
    case 'canopy_pct': return Math.round((5 + r * 30) * 10) / 10;
    case 'carpark_pct': return Math.round((2 + r * 12) * 10) / 10;
    default: return Math.round(10 + r * 400);
  }
}

const UNITS: Record<string, string> = {
  median_price: 'AUD', transit_premium: 'ratio', price_change_12m: '%',
  canopy_pct: '%', carpark_pct: '%', sales_count: 'sales',
};

const queryMetric = tool(
  async (args) => {
    const facts: Fact[] = args.stations.map((s) => ({
      id: `f${++factCounter}`,
      label: `${args.metric} ${s} ${args.ring}${args.property_type ? ` ${args.property_type}` : ''}`,
      value: fixtureValue(args.metric, s, args.ring),
      unit: UNITS[args.metric] ?? '',
      source: 'SPIKE FIXTURE (not real data)',
    }));
    return JSON.stringify({ facts });
  },
  {
    name: 'query_metric',
    description:
      'Get a catalogued metric for one or more Sydney station precincts and a distance ring. ' +
      'Returns numbered facts. Station ids are snake_case, e.g. parramatta, st_leonards.',
    schema: queryMetricArgs,
  },
);

const searchPlace = tool(
  async ({ query }) => {
    const q = query.toLowerCase().replace(/\s+station$/, '').replace(/\s+/g, '_');
    const hit = STATIONS.find((s) => s === q || s.includes(q) || q.includes(s));
    return JSON.stringify(hit ? { station_id: hit } : { station_id: null, note: 'not in the 10-station registry' });
  },
  {
    name: 'search_place',
    description: 'Resolve a place or station name to a station id from the registry.',
    schema: searchPlaceArgs,
  },
);

const TOOLS = [queryMetric, searchPlace];
const TOOL_SCHEMAS: Record<string, z.ZodTypeAny> = { query_metric: queryMetricArgs, search_place: searchPlaceArgs };

const SYSTEM = `You are Lumina Precinct Agent, answering questions about Sydney train-station precincts.
Use the tools to get data; never invent numbers. Make at most 5 tool calls.
When you answer, write at most 3 short lines. Every number MUST be written as a fact placeholder such as {f3}
using the ids returned by the tools; never write a digit yourself. Say "associated with", never "caused by".
No predictions and no buy/sell advice.`;

const QUESTIONS = [
  'How do prices near Parramatta station compare with 2 to 5 km away?',
  'Compare Chatswood and St Leonards on price momentum and car-park cover.',
  'Which has more tree canopy within 800 m: Westmead or Auburn?',
];

type CallLog = { name: string; args: unknown; argsValid: boolean; argErrors?: string };
type TurnLog = { latency_ms: number; input_tokens?: number; output_tokens?: number; tool_calls: CallLog[] };

async function runQuestion(model: ReturnType<ChatOpenAI['bindTools']>, question: string) {
  factCounter = 0;
  const messages: BaseMessage[] = [new SystemMessage(SYSTEM), new HumanMessage(question)];
  const turns: TurnLog[] = [];
  let totalCalls = 0;
  let final = '';
  let error: string | undefined;

  try {
    for (let step = 0; step < 6; step++) {
      const t0 = performance.now();
      const ai = (await model.invoke(messages)) as AIMessage;
      const latency = Math.round(performance.now() - t0);
      messages.push(ai);

      const calls: CallLog[] = (ai.tool_calls ?? []).map((c) => {
        const parsed = TOOL_SCHEMAS[c.name]?.safeParse(c.args);
        return {
          name: c.name,
          args: c.args,
          argsValid: Boolean(parsed?.success),
          argErrors: parsed && !parsed.success ? parsed.error.message : parsed ? undefined : 'unknown tool',
        };
      });
      turns.push({
        latency_ms: latency,
        input_tokens: ai.usage_metadata?.input_tokens,
        output_tokens: ai.usage_metadata?.output_tokens,
        tool_calls: calls,
      });

      if (!ai.tool_calls?.length) {
        final = ai.text;
        break;
      }
      for (const c of ai.tool_calls) {
        totalCalls++;
        const t = TOOLS.find((x) => x.name === c.name);
        const out = t && totalCalls <= 5
          ? String(await (t as typeof queryMetric).invoke(c.args as never))
          : JSON.stringify({ error: totalCalls > 5 ? 'tool call budget (5) exceeded' : `unknown tool ${c.name}` });
        messages.push(new ToolMessage({ content: out, tool_call_id: c.id ?? `call_${totalCalls}` }));
      }
    }
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }

  // Mini verify: digits outside {fN} placeholders, and placeholders that point at no fact.
  // Ring and radius labels ("800 m", "2 to 5 km") are allowed; the real verifier will use an allowlist.
  const stripped = final
    .replace(/\{f\d+\}/g, '')
    .replace(/\b\d+(\.\d+)?\s?(to|-|–)\s?\d+(\.\d+)?\s?(km|m)\b/g, '')
    .replace(/\b(100|400|800|1000|2000)\s?m\b|\b(1|2|5)\s?km\b/g, '');
  const strayNumbers = stripped.match(/\d[\d,.]*/g) ?? [];
  const placeholders = [...final.matchAll(/\{f(\d+)\}/g)].map((m) => Number(m[1]));
  const danglingPlaceholders = placeholders.filter((n) => n < 1 || n > factCounter);

  return {
    question,
    final,
    error,
    turns,
    total_tool_calls: totalCalls,
    tools_used: [...new Set(turns.flatMap((t) => t.tool_calls.map((c) => c.name)))],
    all_args_valid: turns.every((t) => t.tool_calls.every((c) => c.argsValid)),
    stray_numbers: strayNumbers,
    dangling_placeholders: danglingPlaceholders,
    total_latency_ms: turns.reduce((a, t) => a + t.latency_ms, 0),
    total_input_tokens: turns.reduce((a, t) => a + (t.input_tokens ?? 0), 0),
    total_output_tokens: turns.reduce((a, t) => a + (t.output_tokens ?? 0), 0),
  };
}

async function main() {
  const results = [];
  for (const useResponsesApi of [false, true]) {
    const api = useResponsesApi ? 'responses' : 'chat_completions';
    const llm = new ChatOpenAI({
      model: MODELS.spark,
      apiKey: apiKey(),
      configuration: { baseURL: META_BASE_URL },
      useResponsesApi,
      temperature: 0,
      maxRetries: 1,
      timeout: 60_000,
    });
    // Meta supports only tool_choice "auto" (the default), so we never set tool_choice.
    const model = llm.bindTools(TOOLS);
    for (const q of QUESTIONS) {
      console.log(`[${api}] ${q}`);
      const r = await runQuestion(model, q);
      console.log(
        `  -> tools=${r.tools_used.join(',') || 'none'} calls=${r.total_tool_calls} argsValid=${r.all_args_valid} ` +
        `stray=${r.stray_numbers.length} ${r.total_latency_ms}ms${r.error ? ` ERROR ${r.error}` : ''}`,
      );
      if (r.final) console.log(`     ${r.final.replace(/\n/g, '\n     ')}`);
      results.push({ api, model: MODELS.spark, ...r });
    }
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  const out = path.join(RESULTS_DIR, `01-muse-spark-tools${MOCK ? '.mock' : ''}.json`);
  await writeFile(out, JSON.stringify({ run_at: new Date().toISOString(), base_url: META_BASE_URL, results }, null, 2));
  console.log(`\nWrote ${path.relative(process.cwd(), out)}`);
  if (results.some((r) => r.error)) process.exitCode = 1;
}

await main();
