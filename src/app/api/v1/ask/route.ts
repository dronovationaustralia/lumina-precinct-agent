/**
 * POST /api/v1/ask
 *
 * Body: { question, station_context?, radius_m?, history? }
 * Returns an AskResponse (lines, facts, sources, actions, followups, chart, verification, meta).
 *
 * Send `Accept: text/event-stream` (or ?stream=1) to receive progress events
 * (plan, tool, compose, verify, fallback) followed by an `answer` event.
 */
import { AskRequest, type AskResponse } from '@/lib/contracts';
import { runAgent, type AgentEvent } from '@/server/agent/graph';
import { getDb } from '@/server/db/client';
import { CORS_HEADERS, errorJson, json, preflight, rateLimit } from '@/server/http';
import { demoQuota } from '@/server/quota';
import { shareTokenFor } from '@/server/share';

export const maxDuration = 60;

export function OPTIONS() {
  return preflight();
}

export async function POST(request: Request) {
  const limited = rateLimit(request);
  if (limited) return limited;
  const capped = await demoQuota(request, 'ask');
  if (capped) return capped;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorJson(400, 'invalid_json', 'Body must be JSON: { "question": "..." }');
  }
  const parsed = AskRequest.safeParse(body);
  if (!parsed.success) return errorJson(400, 'invalid_request', 'Invalid request', parsed.error.issues);

  const wantsStream = new URL(request.url).searchParams.get('stream') === '1' || (request.headers.get('accept') ?? '').includes('text/event-stream');
  const db = await getDb();
  const withShare = (a: AskResponse): AskResponse => ({ ...a, share_token: shareTokenFor(parsed.data.question, parsed.data.station_context, a) });

  if (!wantsStream) {
    try {
      return json(withShare(await runAgent(db, parsed.data)));
    } catch (e) {
      return errorJson(500, 'agent_error', e instanceof Error ? e.message : String(e));
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const answer = await runAgent(db, parsed.data, { onEvent: (e: AgentEvent) => send(e.type, e) });
        send('answer', withShare(answer));
      } catch (e) {
        send('error', { message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
