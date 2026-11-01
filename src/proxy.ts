/**
 * Sign-in is required for the portal and the API. Public: the sign-in page, the auth routes,
 * the health check, and static files. Machine clients may use an API key instead of a session.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isPublicPath, readSession, SESSION_COOKIE, validApiKey } from '@/server/auth/session';

/**
 * One public address: when AUTH_URL names a custom domain, visits to the default
 * *.azurewebsites.net address are forwarded to it, so sign-in cookies and the Microsoft
 * return address always match. (The deploy check calls /api/v1/health, which is not matched.)
 */
function canonicalRedirect(request: NextRequest): NextResponse | null {
  const canonical = process.env.AUTH_URL;
  if (!canonical) return null;
  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '').split(',')[0]!.trim().toLowerCase();
  let target: URL;
  try { target = new URL(canonical); } catch { return null; }
  if (!host.endsWith('.azurewebsites.net') || host === target.host.toLowerCase()) return null;
  const to = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, target);
  return NextResponse.redirect(to, 308);
}

export async function proxy(request: NextRequest) {
  const moved = canonicalRedirect(request);
  if (moved) return moved;
  const { pathname, search } = request.nextUrl;
  if (pathname === '/signin' || pathname.startsWith('/api/auth')) return NextResponse.next();
  if (isPublicPath(pathname)) return NextResponse.next();
  const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();
  if (pathname.startsWith('/api/')) {
    if (request.method === 'OPTIONS' || validApiKey(request.headers.get('authorization'))) return NextResponse.next();
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in, or send an API key' } }, { status: 401 });
  }
  const to = new URL('/signin', request.url);
  if (pathname !== '/') to.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(to);
}

export const config = {
  matcher: [
    // Everything except health, Next internals and public files. Sign-in and the auth routes
    // are matched only for the address redirect and then pass straight through.
    '/((?!api/v1/health|_next/|__nextjs|\.well-known|favicon\\.ico|data/|maplibre-gl-worker\\.mjs|.*\\.(?:png|svg|jpg|webp|ico|json|geojson|mjs|txt)$).*)',
  ],
};
