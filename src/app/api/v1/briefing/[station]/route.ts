/**
 * GET /api/v1/briefing/{station}
 *
 * The "Brief me" card: a Muse Image illustration plus the precinct's verified figures.
 * When the image model is unavailable the figures are still returned with image null
 * (status 503 with a plain message).
 */
import type { NextRequest } from 'next/server';

import { StationId } from '@/lib/contracts';
import { STATION_BY_ID } from '@/lib/stations';
import { briefingFacts, briefingIllustration, briefingPrompt } from '@/server/briefing';
import { getDb } from '@/server/db/client';
import { errorJson, json, preflight, rateLimit } from '@/server/http';
import { isMetered, takeQuota, visitorOf } from '@/server/quota';

export const maxDuration = 120;

export function OPTIONS() {
  return preflight();
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ station: string }> }) {
  const limited = rateLimit(request);
  if (limited) return limited;

  const { station } = await ctx.params;
  const parsed = StationId.safeParse(station);
  if (!parsed.success) {
    return errorJson(404, 'unknown_station', 'station must be a Sydney Trains or Metro station id (see /api/v1/stations)');
  }
  const info = STATION_BY_ID.get(parsed.data)!;

  const db = await getDb();
  const figures = await briefingFacts(db, parsed.data);
  const generated_at = new Date().toISOString();
  const prompt = briefingPrompt(
    info,
    figures.filter((f) => f.category).map((f) => ({ category: f.category!, share_pct: f.share_pct! })),
  );

  try {
    const illustration = await briefingIllustration(parsed.data, prompt, (await isMetered(request)) ? () => takeQuota('image', visitorOf(request)) : undefined);
    return json({
      station: parsed.data,
      name: info.name,
      image: illustration.image,
      image_model: illustration.model,
      image_ms: illustration.ms,
      cached: illustration.cached,
      figures,
      generated_at,
    });
  } catch (e) {
    return json(
      {
        station: parsed.data,
        name: info.name,
        image: null,
        image_model: null,
        image_ms: null,
        cached: false,
        figures,
        generated_at,
        error: { code: 'image_unavailable', message: e instanceof Error ? e.message : String(e) },
      },
      { status: 503 },
    );
  }
}
