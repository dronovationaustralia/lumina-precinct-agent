/**
 * GET /api/auth/login/microsoft?persona=&next= : start the Microsoft (Entra ID) sign-in.
 * Authorization code flow with PKCE; state, nonce and verifier ride in a short-lived cookie.
 */
import { randomBytes, createHash } from 'node:crypto';

import { cookieOptions, isPersona, microsoftConfigured, publicOrigin } from '@/server/auth/session';

const PENDING_COOKIE = 'lumina_oidc';
const b64url = (b: Buffer) => b.toString('base64url');

export function GET(request: Request) {
  if (!microsoftConfigured()) return Response.redirect(new URL('/signin?error=microsoft_not_configured', request.url), 302);
  const url = new URL(request.url);
  const persona = isPersona(url.searchParams.get('persona')) ? url.searchParams.get('persona')! : 'developer';
  const next = (url.searchParams.get('next') ?? '/').startsWith('/') ? url.searchParams.get('next') ?? '/' : '/';
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(16));
  const nonce = b64url(randomBytes(16));
  const tenant = process.env.AUTH_MICROSOFT_TENANT ?? 'common';
  const auth = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
  auth.search = new URLSearchParams({
    client_id: process.env.AUTH_MICROSOFT_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: `${publicOrigin(request)}/api/auth/callback/microsoft`,
    response_mode: 'query',
    scope: 'openid profile email',
    state,
    nonce,
    code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  const pending = Buffer.from(JSON.stringify({ verifier, state, nonce, persona, next })).toString('base64url');
  const o = cookieOptions(request, 600);
  const res = new Response(null, { status: 302, headers: { Location: auth.toString() } });
  res.headers.append('Set-Cookie', `${PENDING_COOKIE}=${pending}; Path=/api/auth; Max-Age=${o.maxAge}; HttpOnly; SameSite=Lax${o.secure ? '; Secure' : ''}`);
  return res;
}
