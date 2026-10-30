/** GET /api/auth/session: the signed-in user. PATCH {persona}: change user type. */
import { cookies } from 'next/headers';

import { cookieOptions, isPersona, readSession, SESSION_COOKIE, signSession } from '@/server/auth/session';

export async function GET() {
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return Response.json({ user: null }, { status: 401 });
  return Response.json({ user: session });
}

export async function PATCH(request: Request) {
  const jar = await cookies();
  const session = await readSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return Response.json({ user: null }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (!isPersona(body?.persona)) return Response.json({ error: { code: 'bad_persona', message: 'persona must be developer, lender or planner' } }, { status: 400 });
  const next = { ...session, persona: body.persona };
  jar.set(SESSION_COOKIE, await signSession(next, session.provider === 'demo' ? 8 : 12), cookieOptions(request, (session.provider === 'demo' ? 8 : 12) * 3600));
  return Response.json({ user: next });
}
