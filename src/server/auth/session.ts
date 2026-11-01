/**
 * Sessions: a signed (HS256) JWT in an HTTP-only cookie. No server-side session store.
 *
 * Sign-in methods: Microsoft (Entra ID, any work or personal account) and a one-click demo
 * session for hackathon judges. Both carry the user type (persona) the person chose.
 */
import { jwtVerify, SignJWT } from 'jose';

export const SESSION_COOKIE = 'lumina_session';
export const PERSONAS = ['developer', 'lender', 'planner'] as const;
export type Persona = (typeof PERSONAS)[number];
export const isPersona = (v: unknown): v is Persona => typeof v === 'string' && (PERSONAS as readonly string[]).includes(v);

export type Session = {
  sub: string;
  name: string;
  email?: string;
  provider: 'microsoft' | 'demo';
  persona: Persona;
};

const DEV_SECRET = 'lumina-local-development-secret-not-for-production';

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET (32+ characters) must be set in production');
    return new TextEncoder().encode(DEV_SECRET);
  }
  return new TextEncoder().encode(s);
}

export async function signSession(s: Session, hours = 12): Promise<string> {
  return new SignJWT({ name: s.name, email: s.email, provider: s.provider, persona: s.persona })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(s.sub)
    .setIssuedAt()
    .setExpirationTime(`${hours}h`)
    .sign(secret());
}

export async function readSession(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    if (!payload.sub || typeof payload.name !== 'string' || !isPersona(payload.persona)) return null;
    return {
      sub: payload.sub,
      name: payload.name,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      provider: payload.provider === 'microsoft' ? 'microsoft' : 'demo',
      persona: payload.persona,
    };
  } catch {
    return null;
  }
}

export function cookieOptions(request: Request, maxAgeSeconds = 12 * 3600) {
  const secure = new URL(request.url).protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  return { httpOnly: true, sameSite: 'lax' as const, secure, path: '/', maxAge: maxAgeSeconds };
}

/** Public origin of this deployment (App Service sits behind a proxy). */
export function publicOrigin(request: Request): string {
  if (process.env.AUTH_URL) return process.env.AUTH_URL.replace(/\/$/, '');
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') ?? url.host;
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  return `${proto}://${host}`;
}

export const microsoftConfigured = () => Boolean(process.env.AUTH_MICROSOFT_CLIENT_ID && process.env.AUTH_MICROSOFT_CLIENT_SECRET);

/** Pages anyone may open without signing in: the about page, precinct cards, shared answers and their preview images. */
export function isPublicPath(pathname: string): boolean {
  return pathname === '/about' || pathname === '/p' || pathname.startsWith('/p/') || pathname === '/a' || pathname.startsWith('/a/');
}

/** Machine clients (the Quest app, scripts) may call the API with a key from LUMINA_API_KEYS. */
export function validApiKey(header: string | null): boolean {
  const keys = (process.env.LUMINA_API_KEYS ?? '').split(',').map((k) => k.trim()).filter((k) => k.length >= 24);
  const got = header?.replace(/^Bearer\s+/i, '').trim();
  return Boolean(got && keys.includes(got));
}
