/**
 * Daily caps on model calls made by the no-account demo (and by the public share pages), so an
 * open demo cannot run up the Meta bill. Invited Microsoft users and API-key clients are not
 * capped. Limits are app settings, changed in the Azure portal (Environment variables):
 *
 *   DEMO_DAILY_ASK    Muse Spark answers and tour headlines (default 400)
 *   DEMO_DAILY_IMAGE  Muse Image pictures actually generated, not cached ones (default 60)
 *   DEMO_DAILY_VOICE  Muse Voice transcriptions (default 150)
 *
 * Each visitor (by IP address) also has their own smaller daily share, so one person or script
 * cannot use up the day for everyone else:
 *
 *   DEMO_PERSON_ASK    per visitor (default 25)
 *   DEMO_PERSON_IMAGE  per visitor (default 5)
 *   DEMO_PERSON_VOICE  per visitor (default 15)
 *
 * Set a limit to 0 to switch that feature off for the demo. Counts reset at midnight Sydney
 * time and when the app restarts (they are kept in memory on the single app instance).
 */
import { readSession, SESSION_COOKIE, validApiKey } from './auth/session';
import { json } from './http';

export type QuotaKind = 'ask' | 'image' | 'voice';

const SETTING: Record<QuotaKind, string> = { ask: 'DEMO_DAILY_ASK', image: 'DEMO_DAILY_IMAGE', voice: 'DEMO_DAILY_VOICE' };
const DEFAULT: Record<QuotaKind, number> = { ask: 400, image: 60, voice: 150 };
const PERSON_SETTING: Record<QuotaKind, string> = { ask: 'DEMO_PERSON_ASK', image: 'DEMO_PERSON_IMAGE', voice: 'DEMO_PERSON_VOICE' };
const PERSON_DEFAULT: Record<QuotaKind, number> = { ask: 25, image: 5, voice: 15 };
const WHAT: Record<QuotaKind, string> = { ask: 'questions', image: 'briefing pictures', voice: 'voice questions' };

function setting(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const v = raw ? Number(raw) : NaN;
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}
export const quotaLimit = (kind: QuotaKind): number => setting(SETTING[kind], DEFAULT[kind]);
export const personLimit = (kind: QuotaKind): number => setting(PERSON_SETTING[kind], PERSON_DEFAULT[kind]);

/**
 * Who a visitor is for the per-person share: their IP address. App Service puts the caller's
 * address in X-Client-IP; X-Forwarded-For (first hop, port removed) is the fallback.
 */
export function visitorOf(request: Request): string {
  const h = request.headers;
  const raw = h.get('x-client-ip')?.trim() || h.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
  if (!raw) return 'local';
  const v6 = raw.match(/^\[([^\]]+)\]/);
  if (v6) return v6[1];
  return /^\d+\.\d+\.\d+\.\d+:\d+$/.test(raw) ? raw.slice(0, raw.lastIndexOf(':')) : raw;
}

const sydneyDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
let day = '';
const used = new Map<QuotaKind, number>();
const byPerson = new Map<string, number>();

function rollover() {
  const today = sydneyDay();
  if (today !== day || byPerson.size > 100_000) { day = today; used.clear(); byPerson.clear(); }
}

export type QuotaResult = 'ok' | 'person' | 'all';

/**
 * Uses one unit of today's demo allowance: the visitor's own share (when `who` is given) and the
 * shared total. Nothing is counted when either is used up.
 */
export function spendQuota(kind: QuotaKind, who?: string): QuotaResult {
  rollover();
  const key = who ? `${kind}|${who}` : '';
  const mine = key ? (byPerson.get(key) ?? 0) : 0;
  if (key && mine >= personLimit(kind)) return 'person';
  const n = used.get(kind) ?? 0;
  if (n >= quotaLimit(kind)) return 'all';
  used.set(kind, n + 1);
  if (key) byPerson.set(key, mine + 1);
  return 'ok';
}

/** Uses one unit of today's demo allowance; false when it is used up. */
export function takeQuota(kind: QuotaKind, who?: string): boolean {
  return spendQuota(kind, who) === 'ok';
}

export function quotaStatus(): { date: string; used: Record<QuotaKind, number>; limits: Record<QuotaKind, number>; per_visitor: Record<QuotaKind, number>; visitors: number } {
  rollover();
  const kinds: QuotaKind[] = ['ask', 'image', 'voice'];
  return {
    date: day,
    used: Object.fromEntries(kinds.map((k) => [k, used.get(k) ?? 0])) as Record<QuotaKind, number>,
    limits: Object.fromEntries(kinds.map((k) => [k, quotaLimit(k)])) as Record<QuotaKind, number>,
    per_visitor: Object.fromEntries(kinds.map((k) => [k, personLimit(k)])) as Record<QuotaKind, number>,
    visitors: new Set([...byPerson.keys()].map((k) => k.slice(k.indexOf('|') + 1))).size,
  };
}

/** True for the no-account demo and anonymous requests; false for Microsoft users and API keys. */
export async function isMetered(request: Request): Promise<boolean> {
  if (validApiKey(request.headers.get('authorization'))) return false;
  const cookie = request.headers.get('cookie') ?? '';
  const token = cookie.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  const session = await readSession(token);
  return !session || session.provider === 'demo';
}

export function quotaExceeded(kind: QuotaKind, scope: 'person' | 'all' = 'all'): Response {
  const message = scope === 'person'
    ? `You have used today's demo allowance of ${personLimit(kind)} ${WHAT[kind]}. It resets at midnight Sydney time; sign in with Microsoft for full access.`
    : `The demo has reached today's limit for ${WHAT[kind]}. It resets at midnight Sydney time; sign in with Microsoft for full access.`;
  return json({ error: { code: 'demo_limit', message } }, { status: 429 });
}

/** For route handlers: null to carry on, or the 429 response to return. */
export async function demoQuota(request: Request, kind: QuotaKind): Promise<Response | null> {
  if (!(await isMetered(request))) return null;
  const r = spendQuota(kind, visitorOf(request));
  return r === 'ok' ? null : quotaExceeded(kind, r);
}
