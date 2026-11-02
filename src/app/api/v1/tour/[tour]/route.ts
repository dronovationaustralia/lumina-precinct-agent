/**
 * GET /api/v1/tour/[tour]: a guided corridor tour. Each stop carries the station and
 * 3 to 4 verified figures with source and date, plus a one-sentence headline.
 * Tours: north-shore, parramatta-corridor, line-<T1..T9|M1>.
 */
import { connection, type NextRequest } from 'next/server';

import { getDb } from '@/server/db/client';
import { errorJson, json, preflight, rateLimit } from '@/server/http';
import { isMetered, takeQuota } from '@/server/quota';
import { buildTour } from '@/server/tour';

export function OPTIONS() {
  return preflight();
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ tour: string }> }) {
  await connection();
  const limited = rateLimit(request);
  if (limited) return limited;
  const { tour } = await ctx.params;
  const db = await getDb();
  // A tour's model headlines count as one demo question; over the limit, template headlines.
  const modelOk = Boolean(process.env.MODEL_API_KEY) && (!(await isMetered(request)) || takeQuota('ask'));
  const built = await buildTour(db, tour, { headlines: modelOk ? 'model' : 'template' });
  if (!built) return errorJson(404, 'unknown_tour', 'tour must be north-shore, parramatta-corridor or line-<T1..T9|M1>');
  return json(built, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
