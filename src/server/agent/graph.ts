/**
 * The agent graph (LangGraph.js):
 *
 *   START -> plan <-> tools        Muse Spark picks governed tools (at most 5 calls)
 *            plan -> compose       writes up to 3 lines with {fN} placeholders, actions, follow-ups, chart
 *         compose -> verify        deterministic checks, no model
 *          verify -> compose       retry once with the errors listed
 *          verify -> fallback      template answer built from facts if the retry fails too
 *          verify -> respond       fill placeholders, attach sources, verification, timings
 */
import { randomUUID } from 'node:crypto';

import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

import { DISCLAIMER, type AskRequest, type AskResponse, type Fact, type Source, type ToolTrace } from '@/lib/contracts';
import type { Db } from '../db/client';
import { FactStore, factsForModel } from '../facts';
import { listDatasets } from '../metrics/query';
import { buildTools, MAX_TOOL_CALLS, TOOL_ARG_SCHEMAS } from '../tools';
import { buildChart } from './chart';
import { offlineComposeFromFacts } from './offline';
import { COMPOSE_SYSTEM, PLAN_SYSTEM, composeUser } from './prompts';
import { getModel, usageOf, type AgentModel, type ProviderId, type Usage } from './providers';
import { Draft, fillPlaceholders, verifyDraft, type VerifyResult } from './verify';

export type AgentEvent =
  | { type: 'plan'; tool_calls: { name: string; args: unknown }[] }
  | { type: 'tool'; name: string; ok: boolean; ms: number; facts: number }
  | { type: 'compose'; attempt: number }
  | { type: 'verify'; ok: boolean; errors: string[] }
  | { type: 'fallback'; reason: string };

const State = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  toolCalls: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  planTurns: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  draft: Annotation<Draft | null>({ reducer: (_, b) => b, default: () => null }),
  composeErrors: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  attempts: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  verification: Annotation<VerifyResult | null>({ reducer: (_, b) => b, default: () => null }),
  fallbackReason: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
});
type S = typeof State.State;

/** Pull a JSON object out of model text (tolerates code fences and stray prose). */
export function parseDraft(text: string): { draft: Draft | null; error?: string } {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return { draft: null, error: 'the answer was not a JSON object' };
  try {
    const parsed = Draft.safeParse(JSON.parse(cleaned.slice(start, end + 1)));
    if (!parsed.success) return { draft: null, error: `JSON did not match the answer shape: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}` };
    return { draft: parsed.data };
  } catch (e) {
    return { draft: null, error: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export type RunOptions = { provider?: ProviderId; model?: AgentModel; onEvent?: (e: AgentEvent) => void };

export async function runAgent(db: Db, req: AskRequest, opts: RunOptions = {}): Promise<AskResponse> {
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const time = async <T,>(name: string, fn: () => Promise<T>): Promise<T> => {
    const s = performance.now();
    try { return await fn(); } finally { timings[name] = Math.round((timings[name] ?? 0) + performance.now() - s); }
  };
  const model = opts.model ?? getModel(opts.provider);
  const facts = new FactStore();
  const trace: ToolTrace[] = [];
  const tools = buildTools({ db, facts, trace });
  const byName = new Map(tools.map((t) => [t.name, t]));
  const usage: Usage = { input: 0, output: 0 };
  const emit = (e: AgentEvent) => opts.onEvent?.(e);

  const contextLine = req.station_context ? ` [station_context=${req.station_context}]` : '';
  const history = (req.history ?? []).map((h) => (h.role === 'user' ? new HumanMessage(h.content) : new AIMessage(h.content)));

  const plan = async (s: S): Promise<Partial<S>> => {
    const ai = await time('plan', () => model.plan(s.messages, tools));
    usage.input += usageOf(ai).input;
    usage.output += usageOf(ai).output;
    emit({ type: 'plan', tool_calls: (ai.tool_calls ?? []).map((c) => ({ name: c.name, args: c.args })) });
    return { messages: [ai], planTurns: s.planTurns + 1 };
  };

  const runTools = async (s: S): Promise<Partial<S>> => {
    const last = s.messages.at(-1) as AIMessage;
    const out: ToolMessage[] = [];
    let count = s.toolCalls;
    for (const call of last.tool_calls ?? []) {
      const id = call.id ?? `call_${count + 1}`;
      count += 1;
      if (count > MAX_TOOL_CALLS) {
        out.push(new ToolMessage({ tool_call_id: id, content: JSON.stringify({ error: `tool call budget (${MAX_TOOL_CALLS}) used up; answer with the facts you have` }) }));
        continue;
      }
      const t = byName.get(call.name);
      const schema = TOOL_ARG_SCHEMAS[call.name];
      const parsed = schema?.safeParse(call.args ?? {});
      if (!t || !parsed?.success) {
        const error = !t ? `unknown tool ${call.name}` : `invalid arguments: ${parsed!.error!.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`;
        trace.push({ tool: call.name, args: call.args, ok: false, ms: 0, fact_ids: [], error });
        out.push(new ToolMessage({ tool_call_id: id, content: JSON.stringify({ error }) }));
        emit({ type: 'tool', name: call.name, ok: false, ms: 0, facts: 0 });
        continue;
      }
      const before = trace.length;
      const content = await time('tools', async () => String(await t.invoke(parsed.data)));
      const tr = trace[before];
      emit({ type: 'tool', name: call.name, ok: tr?.ok ?? false, ms: tr?.ms ?? 0, facts: tr?.fact_ids.length ?? 0 });
      out.push(new ToolMessage({ tool_call_id: id, content }));
    }
    return { messages: out, toolCalls: count };
  };

  const compose = async (s: S): Promise<Partial<S>> => {
    const attempt = s.attempts + 1;
    emit({ type: 'compose', attempt });
    const msgs = [new SystemMessage(COMPOSE_SYSTEM), new HumanMessage(composeUser(req.question, factsForModel(facts.all()), s.composeErrors))];
    const { text, usage: u } = await time('compose', () => model.compose(msgs, { question: req.question, facts: facts.all() }));
    usage.input += u.input;
    usage.output += u.output;
    const { draft, error } = parseDraft(text);
    return { draft, attempts: attempt, composeErrors: error ? [error] : [] };
  };

  const verify = async (s: S): Promise<Partial<S>> => {
    const result = s.draft
      ? verifyDraft(s.draft, facts.all(), trace)
      : { ok: false, checks: [{ name: 'answer_shape', passed: false, detail: s.composeErrors.join('; ') }], errors: s.composeErrors, actions: [], followups: [], chart: null };
    emit({ type: 'verify', ok: result.ok, errors: result.errors });
    return { verification: result, composeErrors: result.ok ? [] : result.errors };
  };

  const fallback = async (s: S): Promise<Partial<S>> => {
    const reason = s.verification?.errors.join('; ') || 'verification failed';
    emit({ type: 'fallback', reason });
    const { draft } = parseDraft(offlineComposeFromFacts(req.question, facts.all()));
    const result = draft ? verifyDraft(draft, facts.all(), trace) : null;
    return { draft, verification: result, fallbackReason: reason };
  };

  const graph = new StateGraph(State)
    .addNode('plan', plan)
    .addNode('tools', runTools)
    .addNode('compose', compose)
    .addNode('verify', verify)
    .addNode('fallback', fallback)
    .addEdge(START, 'plan')
    .addConditionalEdges('plan', (s: S) => {
      const last = s.messages.at(-1) as AIMessage;
      return last.tool_calls?.length && s.toolCalls < MAX_TOOL_CALLS && s.planTurns <= MAX_TOOL_CALLS ? 'tools' : 'compose';
    }, ['tools', 'compose'])
    .addEdge('tools', 'plan')
    .addEdge('compose', 'verify')
    .addConditionalEdges('verify', (s: S) => (s.verification?.ok ? END : s.attempts < 2 ? 'compose' : 'fallback'), ['compose', 'fallback', END])
    .addEdge('fallback', END)
    .compile();

  let final: S;
  try {
    final = (await graph.invoke(
      { messages: [new SystemMessage(PLAN_SYSTEM), ...history, new HumanMessage(`${req.question}${contextLine}`)] },
      { recursionLimit: 30 },
    )) as S;
  } catch (e) {
    // Model or network failure: answer from whatever facts the tools produced.
    const reason = `model call failed: ${e instanceof Error ? e.message : String(e)}`;
    emit({ type: 'fallback', reason });
    const { draft } = parseDraft(offlineComposeFromFacts(req.question, facts.all()));
    final = { messages: [], toolCalls: trace.length, planTurns: 0, draft, composeErrors: [], attempts: 0, verification: draft ? verifyDraft(draft, facts.all(), trace) : null, fallbackReason: reason };
  }

  timings.total = Math.round(performance.now() - t0);
  return respond(db, final, facts.all(), trace, { model, usage, timings });
}

async function respond(
  db: Db,
  s: S,
  facts: Fact[],
  trace: ToolTrace[],
  ctx: { model: AgentModel; usage: Usage; timings: Record<string, number> },
): Promise<AskResponse> {
  const v = s.verification;
  const ok = Boolean(v?.ok && s.draft);
  const lines = ok ? s.draft!.lines.map((l) => fillPlaceholders(l, facts)) : ['I could not produce a verified answer for that question. Try naming one of the covered stations.'];
  const cited = new Set<string>();
  for (const l of s.draft?.lines ?? []) for (const m of l.matchAll(/\{(f\d+)\}/g)) cited.add(m[1]!);
  for (const id of v?.chart?.fact_ids ?? []) cited.add(id);

  const datasets = await listDatasets(db);
  const usedDatasetIds = new Set(facts.filter((f) => cited.has(f.id) || !cited.size).map((f) => f.dataset_id));
  const sources: Source[] = datasets
    .filter((d) => usedDatasetIds.has(d.dataset_id))
    .map((d) => ({ dataset_id: d.dataset_id, name: d.name, licence: d.licence, as_of: d.as_of, url: d.source_url ?? undefined, demo: d.is_demo }));
  const demo = sources.some((x) => x.demo) || facts.some((f) => f.demo);

  const status = s.fallbackReason ? 'fallback' : s.attempts > 1 ? 'verified_after_retry' : 'verified';
  return {
    lines,
    disclaimer: demo ? `${DISCLAIMER} Demo data: figures are synthetic, not real.` : DISCLAIMER,
    facts,
    sources,
    actions: ok ? v!.actions : [],
    followups: ok ? v!.followups : [],
    chart: ok && v!.chart ? buildChart(v!.chart, facts) : null,
    verification: {
      status,
      attempts: Math.max(1, s.attempts),
      checks: v?.checks ?? [],
      errors: s.fallbackReason ? [s.fallbackReason] : v?.errors ?? [],
    },
    meta: {
      request_id: randomUUID(),
      provider: ctx.model.provider,
      model: ctx.model.model,
      demo_data: demo,
      timings_ms: ctx.timings,
      tokens: ctx.usage,
      tool_calls: trace,
    },
  };
}


