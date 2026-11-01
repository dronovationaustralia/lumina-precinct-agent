/**
 * POST /api/v1/share: make a shareable link (signed-in users only; the proxy
 * keeps this route protected).
 *
 * { type: 'answer', token } -> { url } for /a/[token]. The token is the `share_token` the
 *   server signed when it produced the answer (/api/v1/ask); figures from a client are
 *   never signed, so a shared link cannot carry invented numbers.
 * { type: 'precinct', station } -> { url } for /p/[station] (public data, no token).
 */
import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { StationId } from '@/lib/contracts';
import { publicOrigin, readSession, SESSION_COOKIE, validApiKey } from '@/server/auth/session';
import { errorJson, json, preflight, rateLimit } from '@/server/http';
import { verifyShare } from '@/server/share';

export function OPTIONS() {
  return preflight();
}

// The client sends back the token the server signed when it produced the answer; the server
// never signs figures a client supplies.
const ShareAnswerBody = z.object({ type: z.literal('answer'), token: z.string().min(10).max(9000) });

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
  if (!verifyShare(parsed.data.token)) return errorJson(400, 'bad_share', 'This answer cannot be shared: its signature does not match.');
  return json({ url: `${publicOrigin(request)}/a/${parsed.data.token}` });
}
