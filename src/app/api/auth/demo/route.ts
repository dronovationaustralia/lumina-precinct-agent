/** POST /api/auth/demo {persona}: one-click demo session for judges (no account). */
import { cookieOptions, isPersona, SESSION_COOKIE, signSession } from '@/server/auth/session';

export async function POST(request: Request) {
  if (process.env.AUTH_DEMO_DISABLED === '1') return Response.json({ error: { code: 'disabled', message: 'Demo sign-in is turned off' } }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const persona = isPersona(body?.persona) ? body.persona : 'developer';
  const token = await signSession({ sub: 'demo', name: 'Demo user', provider: 'demo', persona }, 8);
  const res = Response.json({ ok: true });
  const o = cookieOptions(request, 8 * 3600);
  res.headers.append('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${o.maxAge}; HttpOnly; SameSite=Lax${o.secure ? '; Secure' : ''}`);
  return res;
}
