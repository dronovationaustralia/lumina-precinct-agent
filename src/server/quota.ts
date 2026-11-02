/**
 * Daily caps on model calls made by the no-account demo (and by the public share pages), so an
 * open demo cannot run up the Meta bill. Invited Microsoft users and API-key clients are not
 * capped. Limits are app settings, changed in the Azure portal (Environment variables):
 *
 *   DEMO_DAILY_ASK    Muse Spark answers and tour headlines (default 400)
 *   DEMO_DAILY_IMAGE  Muse Image pictures actually generated, not cached ones (default 60)
 *   DEMO_DAILY_VOICE  Muse Voice transcriptions (default 150)
 *
 * Set a limit to 0 to switch that feature off for the demo. Counts reset at midnight Sydney
 * time and when the app restarts (they are kept in memory on the single app instance).
 */
import { readSession, SESSION_COOKIE, validApiKey } from './auth/session';
import { json } from './http';

export type QuotaKind = 'ask' | 'image' | 'voice';

const SETTING: Record<QuotaKind, string> = { ask: 'DEMO_DAILY_ASK', image: 'DEMO_DAILY_IMAGE', voice: 'DEMO_DAILY_VOICE' };
const DEFAULT: Record<QuotaKind, number> = { ask: 400, image: 60, voice: 150 };
const WHAT: Record<QuotaKind, string> = { ask: 'questions', image: 'briefing pictures', voice: 'voice questions' };

export function quotaLimit(kind: QuotaKind): number {
  const raw = process.env[SETTING[kind]]?.trim();
  const v = raw ? Number(raw) : NaN;
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : DEFAULT[kind];
}

const sydneyDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
let day = '';
const used = new Map<QuotaKind, number>();

function rollover() {
  const today = sydneyDay();
  if (today !== day) { day = today; used.clear(); }
}

/** Uses one unit of today's demo allowance; false when it is used up. */
export function takeQuota(kind: QuotaKind): boolean {
  rollover();
  const n = used.get(kind) ?? 0;
  if (n >= quotaLimit(kind)) return false;
  used.set(kind, n + 1);
  return true;
}

export function quotaStatus(): { date: string; used: Record<QuotaKind, number>; limits: Record<QuotaKind, number> } {
  rollover();
  const kinds: QuotaKind[] = ['ask', 'image', 'voice'];
  return {
    date: day,
    used: Object.fromEntries(kinds.map((k) => [k, used.get(k) ?? 0])) as Record<QuotaKind, number>,
    limits: Object.fromEntries(kinds.map((k) => [k, quotaLimit(k)])) as Record<QuotaKind, number>,
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

export function quotaExceeded(kind: QuotaKind): Response {
  return json(
    { error: { code: 'demo_limit', message: `The demo has reached today's limit for ${WHAT[kind]}. It resets at midnight Sydney time; sign in with Microsoft for full access.` } },
    { status: 429 },
  );
}

/** For route handlers: null to carry on, or the 429 response to return. */
export async function demoQuota(request: Request, kind: QuotaKind): Promise<Response | null> {
  if (!(await isMetered(request))) return null;
  return takeQuota(kind) ? null : quotaExceeded(kind);
}
