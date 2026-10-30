/**
 * Sign-in is required for the portal and the API. Public: the sign-in page, the auth routes,
 * the health check, and static files. Machine clients may use an API key instead of a session.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { readSession, SESSION_COOKIE, validApiKey } from '@/server/auth/session';

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
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
    // Everything except sign-in, auth routes, health, Next internals and public files.
    '/((?!signin|api/auth|api/v1/health|_next/|__nextjs|\.well-known|favicon\\.ico|data/|maplibre-gl-worker\\.mjs|.*\\.(?:png|svg|jpg|webp|ico|json|geojson|mjs|txt)$).*)',
  ],
};
