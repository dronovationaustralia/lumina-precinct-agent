/** Shared HTTP helpers for /api/v1 route handlers. */

import { gzipSync } from 'node:zlib';

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': process.env.CORS_ALLOW_ORIGIN ?? '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
};

export function json(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, { ...init, headers: { ...CORS_HEADERS, ...(init.headers ?? {}) } });
}

export function errorJson(status: number, code: string, message: string, details?: unknown): Response {
  return json({ error: { code, message, details } }, { status });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Simple fixed-window rate limit per client IP (per server instance). */
const windows = new Map<string, { start: number; count: number }>();
export function rateLimit(request: Request, limit = Number(process.env.RATE_LIMIT_PER_MIN ?? 20)): Response | null {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local';
  const now = Date.now();
  const w = windows.get(ip);
  if (!w || now - w.start > 60_000) {
    windows.set(ip, { start: now, count: 1 });
    if (windows.size > 10_000) windows.clear();
    return null;
  }
  w.count += 1;
  if (w.count > limit) {
    const retry = Math.ceil((w.start + 60_000 - now) / 1000);
    return json({ error: { code: 'rate_limited', message: `Too many requests; try again in ${retry} s` } }, { status: 429, headers: { 'Retry-After': String(retry) } });
  }
  return null;
}

/**
 * JSON gzipped when the client accepts it, for the large map layers (route handlers are not
 * compressed by the standalone server). GeoJSON shrinks to about a fifth.
 */
export function jsonGzip(request: Request, body: unknown, init: ResponseInit = {}): Response {
  const text = JSON.stringify(body);
  const headers = new Headers({ ...CORS_HEADERS, ...((init.headers as Record<string, string> | undefined) ?? {}) });
  headers.set('Content-Type', 'application/json');
  headers.set('Vary', 'Accept-Encoding');
  if (text.length < 2048 || !/\bgzip\b/.test(request.headers.get('accept-encoding') ?? '')) {
    return new Response(text, { ...init, headers });
  }
  headers.set('Content-Encoding', 'gzip');
  return new Response(new Uint8Array(gzipSync(text)), { ...init, headers });
}
