/** GET /api/auth/callback/microsoft: finish the Microsoft sign-in and set the session cookie. */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

import { cookieOptions, isPersona, publicOrigin, SESSION_COOKIE, signSession } from '@/server/auth/session';

const PENDING_COOKIE = 'lumina_oidc';
const JWKS = createRemoteJWKSet(new URL('https://login.microsoftonline.com/common/discovery/v2.0/keys'));

function fail(request: Request, code: string) {
  return Response.redirect(new URL(`/signin?error=${code}`, publicOrigin(request)), 302);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const raw = jar.get(PENDING_COOKIE)?.value;
  jar.delete({ name: PENDING_COOKIE, path: '/api/auth' });
  if (url.searchParams.get('error')) return fail(request, 'microsoft_declined');
  if (!raw) return fail(request, 'sign_in_expired');
  let pending: { verifier: string; state: string; nonce: string; persona: string; next: string };
  try {
    pending = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return fail(request, 'sign_in_expired');
  }
  if (url.searchParams.get('state') !== pending.state) return fail(request, 'state_mismatch');

  const tenant = process.env.AUTH_MICROSOFT_TENANT ?? 'common';
  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.AUTH_MICROSOFT_CLIENT_ID!,
      client_secret: process.env.AUTH_MICROSOFT_CLIENT_SECRET!,
      grant_type: 'authorization_code',
      code: url.searchParams.get('code') ?? '',
      redirect_uri: `${publicOrigin(request)}/api/auth/callback/microsoft`,
      code_verifier: pending.verifier,
    }),
  });
  if (!tokenRes.ok) return fail(request, 'token_exchange_failed');
  const { id_token } = (await tokenRes.json()) as { id_token?: string };
  if (!id_token) return fail(request, 'token_exchange_failed');

  try {
    const { payload } = await jwtVerify(id_token, JWKS, { audience: process.env.AUTH_MICROSOFT_CLIENT_ID });
    // Multi-tenant: the issuer names the user's tenant; check its shape and that it matches the tid claim.
    const tid = typeof payload.tid === 'string' ? payload.tid : '';
    if (payload.iss !== `https://login.microsoftonline.com/${tid}/v2.0`) return fail(request, 'bad_issuer');
    // Single-tenant deployments (AUTH_MICROSOFT_TENANT set to a tenant ID) accept only that tenant,
    // whatever the app registration allows; Entra "assignment required" then limits who in it.
    const only = process.env.AUTH_MICROSOFT_TENANT;
    if (only && /^[0-9a-f-]{36}$/i.test(only) && tid.toLowerCase() !== only.toLowerCase()) return fail(request, 'wrong_tenant');
    if (payload.nonce !== pending.nonce) return fail(request, 'nonce_mismatch');
    const name = typeof payload.name === 'string' ? payload.name : 'Signed-in user';
    const email = typeof payload.email === 'string' ? payload.email : typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined;
    const token = await signSession({ sub: `ms:${tid}:${payload.oid ?? payload.sub}`, name, email, provider: 'microsoft', persona: isPersona(pending.persona) ? pending.persona : 'developer' });
    jar.set(SESSION_COOKIE, token, cookieOptions(request));
  } catch {
    return fail(request, 'invalid_token');
  }
  return Response.redirect(new URL(pending.next.startsWith('/') ? pending.next : '/', publicOrigin(request)), 302);
}
