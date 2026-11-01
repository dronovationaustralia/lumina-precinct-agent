/**
 * POST /api/v1/share: make a shareable link (signed-in users only; the proxy
 * keeps this route protected).
 *
 * { type: 'answer', question, station?, templates, facts, sources, status, model }
 *   -> { url } for /a/[token]. Facts are trimmed to the cited ones; the chart and
 *   tool call details are never included. Still over 6 KB compressed -> 413.
 * { type: 'precinct', station } -> { url } for /p/[station] (public data, no token).
 */
import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { Fact, Source, StationId } from '@/lib/contracts';
import { publicOrigin, readSession, SESSION_COOKIE, validApiKey } from '@/server/auth/session';
import { errorJson, json, preflight, rateLimit } from '@/server/http';
import { signShare, type SharedAnswer } from '@/server/share';

export function OPTIONS() {
  return preflight();
}

const ShareAnswerBody = z.object({
  type: z.literal('answer'),
  question: z.string().trim().min(3).max(500),
  station: StationId.optional(),
  templates: z.array(z.string().max(500)).min(1).max(3),
  facts: z.array(Fact).max(60),
  sources: z.array(Source).max(20),
  status: z.enum(['verified', 'verified_after_retry', 'fallback']),
  model: z.object({ provider: z.string().max(40), model: z.string().max(80) }),
});

const SharePrecinctBody = z.object({ type: z.literal('precinct'), station: StationId });

export async function POST(request: NextRequest) {
  const limited = rateLimit(request);
  if (limited) return limited;
  const authed = (await readSession(request.cookies.get(SESSION_COOKIE)?.value)) ?? validApiKey(request.headers.get('authorization'));
  if (!authed) return errorJson(401, 'unauthorized', 'Sign in, or send an API key');
  const body = await request.json().catch(() => null);
  const precinct = SharePrecinctBody.safeParse(body);
  if (precinct.success) return json({ url: `${publicOrigin(request)}/p/${precinct.data.station}` });
  const parsed = ShareAnswerBody.safeParse(body);
  if (!parsed.success) {
    return errorJson(400, 'bad_share', `invalid share payload: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  }
  const b = parsed.data;
  const cited = new Set<string>();
  for (const t of b.templates) for (const m of t.matchAll(/\{(f\d+)\}/g)) cited.add(m[1]!);
  const payload: SharedAnswer = {
    v: 1,
    question: b.question,
    ...(b.station ? { station: b.station } : {}),
    templates: b.templates,
    facts: b.facts.filter((f) => cited.has(f.id)),
    sources: b.sources,
    status: b.status,
    model: b.model,
    created_at: new Date().toISOString(),
  };
  try {
    return json({ url: `${publicOrigin(request)}/a/${signShare(payload)}` });
  } catch (e) {
    return errorJson(413, 'share_too_large', e instanceof Error ? e.message : 'shared answer too large');
  }
}
