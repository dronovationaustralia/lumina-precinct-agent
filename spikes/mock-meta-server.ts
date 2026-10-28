/**
 * A tiny stand-in for the Meta Model API, used only to dry-run the spikes offline.
 *
 * It does NOT imitate model quality. It checks that our requests match the documented
 * wire format and flags things the real API rejects (for example any tool_choice other
 * than "auto", which returns HTTP 400 on Meta). Every request body is logged to
 * spikes/results/mock-requests.jsonl so the exact payloads LangChain sends can be read.
 *
 * Usage: npm run spike:mock   (then run any spike with --mock in another terminal)
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';

import { MOCK_PORT, RESULTS_DIR } from './lib/env.js';

const LOG = path.join(RESULTS_DIR, 'mock-requests.jsonl');

// Two masks in the SAM 3 output grammar, taken from the @meta-sam/parser README example.
const SAM_TEXT =
  '<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=1024;h=1024|>' +
  "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>" +
  ',1<|box;x1=155;y1=228;x2=202;y2=254;w=1024;h=1024|>' +
  '<|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>\n';

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

function json(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/** Checks the real API is documented to reject. Returns error text or undefined. */
function toolRequestProblems(b: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (b.tool_choice !== undefined && b.tool_choice !== 'auto') problems.push(`tool_choice=${JSON.stringify(b.tool_choice)} (Meta supports only "auto")`);
  for (const t of (b.tools as Record<string, unknown>[] | undefined) ?? []) {
    const name = (t.name ?? (t.function as Record<string, unknown> | undefined)?.name) as string | undefined;
    if (!name || !/^[a-zA-Z0-9_.-]+$/.test(name) || (name.match(/\./g)?.length ?? 0) > 1) problems.push(`bad tool name ${name}`);
  }
  return problems;
}

let callSeq = 0;
function plannedToolCall(question: string): { name: string; args: Record<string, unknown> } {
  if (/chatswood/i.test(question)) return { name: 'query_metric', args: { metric: 'price_change_12m', stations: ['chatswood', 'st_leonards'], ring: '0-800m' } };
  if (/westmead/i.test(question)) return { name: 'query_metric', args: { metric: 'canopy_pct', stations: ['westmead', 'auburn'], ring: '0-800m' } };
  return { name: 'query_metric', args: { metric: 'transit_premium', stations: ['parramatta'], ring: '0-800m', property_type: 'house' } };
}
const FINAL = 'Mock answer: the 800 m ring is associated with a transit premium of {f1}.\nGeneral information, not financial advice.';

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${MOCK_PORT}`);
  const raw = await body(req);
  const auth = req.headers.authorization ?? '';
  const isJson = (req.headers['content-type'] ?? '').includes('json');
  const parsed = isJson && raw.length ? JSON.parse(raw.toString('utf8')) : undefined;
  await appendFile(LOG, JSON.stringify({ at: new Date().toISOString(), method: req.method, path: url.pathname, auth: auth ? 'Bearer ***' : 'MISSING', body: parsed ?? `<${raw.length} bytes ${req.headers['content-type']}>` }) + '\n');

  if (!auth.startsWith('Bearer ')) return json(res, 401, { error: { message: 'missing bearer token' } });

  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    const problems = toolRequestProblems(parsed);
    if (problems.length) return json(res, 400, { error: { message: problems.join('; ') } });
    const msgs = parsed.messages as { role: string; content: unknown }[];
    if (parsed.reasoning_effort !== undefined && !['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(parsed.reasoning_effort)) {
      return json(res, 400, { error: { message: `invalid reasoning_effort ${parsed.reasoning_effort}` } });
    }
    // A compose call (no tools bound): answer with a JSON draft citing the first fact.
    if (!parsed.tools) {
      const draft = { lines: ['Mock answer: the first figure is {f1}.'], actions: [], followups: [], chart: null };
      return json(res, 200, { id: 'mock', object: 'chat.completion', created: 0, model: parsed.model, usage: { prompt_tokens: 900, completion_tokens: 60, total_tokens: 960, completion_tokens_details: { reasoning_tokens: 40 } }, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(draft) } }] });
    }
    const hasToolResult = msgs.some((m) => m.role === 'tool');
    const question = String(msgs.findLast((m) => m.role === 'user')?.content ?? '');
    const usage = { prompt_tokens: 420, completion_tokens: 40, total_tokens: 460 };
    if (!hasToolResult) {
      const call = plannedToolCall(question);
      return json(res, 200, {
        id: 'mock', object: 'chat.completion', created: 0, model: parsed.model, usage,
        choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: `call_${++callSeq}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] } }],
      });
    }
    return json(res, 200, { id: 'mock', object: 'chat.completion', created: 0, model: parsed.model, usage, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: FINAL } }] });
  }

  if (req.method === 'POST' && url.pathname === '/v1/responses') {
    if (String(parsed.model).startsWith('sam')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const lane = { item_id: 'msg_1', output_index: 0, content_index: 0 };
      const send = (e: Record<string, unknown>) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      send({ type: 'response.created', response: { id: 'resp_mock', status: 'in_progress' } });
      const half = SAM_TEXT.indexOf(',1<|box');
      send({ type: 'response.output_text.delta', ...lane, delta: SAM_TEXT.slice(0, half) });
      send({ type: 'response.output_text.delta', ...lane, delta: SAM_TEXT.slice(half) });
      // Like the real API (per Meta's cookbook): content_part.done, but no output_text.done.
      send({ type: 'response.content_part.done', ...lane, part: { type: 'output_text', text: SAM_TEXT } });
      send({ type: 'response.completed', response: { id: 'resp_mock', status: 'completed' } });
      return res.end();
    }
    const problems = toolRequestProblems(parsed);
    if (problems.length) return json(res, 400, { error: { message: problems.join('; ') } });
    const input = (parsed.input ?? []) as { type?: string; role?: string; content?: unknown }[];
    const hasToolResult = input.some((i) => i.type === 'function_call_output');
    const userItem = input.findLast((i) => i.role === 'user');
    const question = typeof userItem?.content === 'string' ? userItem.content : JSON.stringify(userItem?.content ?? '');
    const usage = { input_tokens: 420, output_tokens: 40, total_tokens: 460 };
    const base = { id: `resp_${++callSeq}`, object: 'response', created_at: 0, status: 'completed', model: parsed.model, usage };
    if (!hasToolResult) {
      const call = plannedToolCall(question);
      return json(res, 200, { ...base, output: [{ type: 'function_call', id: `fc_${callSeq}`, call_id: `call_${callSeq}`, name: call.name, arguments: JSON.stringify(call.args), status: 'completed' }] });
    }
    return json(res, 200, { ...base, output: [{ type: 'message', id: `msg_${callSeq}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: FINAL, annotations: [] }] }] });
  }

  if (req.method === 'POST' && url.pathname === '/v1/asr/transcribe') {
    const form = await new Request('http://x', { method: 'POST', headers: { 'content-type': String(req.headers['content-type']) }, body: new Uint8Array(raw) }).formData();
    const request = form.get('request');
    const audio = form.get('audio');
    if (!(request instanceof Blob) || !(audio instanceof Blob)) return json(res, 400, { error: { message: 'need multipart parts "request" (JSON) and "audio"' } });
    const params = JSON.parse(await request.text());
    if (params.audioEncoding !== 'WAV' || !params.model) return json(res, 400, { error: { message: 'request part needs model and audioEncoding' } });
    const kw = Array.isArray(params.keywords);
    return json(res, 200, {
      sessionId: 'mock-session',
      transcript: kw ? 'How do prices near Parramatta station compare with 2 to 5 km away?' : 'How do prices near Paramatta station compare with two to five km away?',
      audioDurationMs: 4200,
      turns: [{ text: 'mock turn', startMs: 0, endMs: 4200 }],
    });
  }

  json(res, 404, { error: { message: `mock has no route ${req.method} ${url.pathname}` } });
}

await mkdir(RESULTS_DIR, { recursive: true });
createServer((req, res) => {
  handle(req, res).catch((e) => json(res, 500, { error: { message: String(e) } }));
}).listen(MOCK_PORT, '127.0.0.1', () => console.log(`Mock Meta Model API on http://127.0.0.1:${MOCK_PORT}/v1 (log: ${LOG})`));
