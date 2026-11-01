'use client';

import type { AskResponse, MapAction } from '@/lib/contracts';

export type StationDto = { id: string; name: string; corridor: string; lines: string[]; featured: boolean; lat: number; lon: number; coord_source: string };

export type ProgressEvent =
  | { type: 'plan'; tool_calls: { name: string; args: unknown }[] }
  | { type: 'tool'; name: string; ok: boolean; ms: number; facts: number }
  | { type: 'compose'; attempt: number }
  | { type: 'verify'; ok: boolean; errors: string[] }
  | { type: 'fallback'; reason: string };

export type LandUseDto = {
  station: string;
  capture_date: string | null;
  demo_data: boolean;
  rings: Record<string, Record<string, number>>;
  mix?: Record<string, Record<string, number>>;
  mix_source?: { dataset_id: string; as_of: string; name: string } | null;
};

export async function fetchStations(): Promise<StationDto[]> {
  const res = await fetch('/api/v1/stations');
  if (!res.ok) throw new Error(`Stations failed to load (HTTP ${res.status})`);
  return (await res.json()).stations;
}

export async function fetchLandUse(station: string): Promise<LandUseDto> {
  const res = await fetch(`/api/v1/landuse/${station}`);
  if (!res.ok) throw new Error(`Land use failed to load (HTTP ${res.status})`);
  return res.json();
}

/** POST /api/v1/ask with streamed progress events. */
export async function ask(
  question: string,
  opts: { stationContext?: string; persona?: string; onProgress: (e: ProgressEvent) => void; signal?: AbortSignal },
): Promise<AskResponse> {
  const res = await fetch('/api/v1/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ question, ...(opts.stationContext ? { station_context: opts.stationContext } : {}), ...(opts.persona ? { persona: opts.persona } : {}) }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `The request failed (HTTP ${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = chunk.match(/^event: (.+)$/m)?.[1];
      const data = chunk.match(/^data: (.+)$/m)?.[1];
      if (!event || !data) continue;
      const parsed = JSON.parse(data);
      if (event === 'answer') return parsed as AskResponse;
      if (event === 'error') throw new Error(parsed.message);
      opts.onProgress(parsed as ProgressEvent);
    }
  }
  throw new Error('The answer stream ended early');
}

export type { AskResponse, MapAction };

export type StationSummary = {
  id: string;
  unit_median_800m: number | null;
  unit_sales_800m: number;
  house_median_800m: number | null;
  house_sales_800m: number;
  trips_12m: number | null;
};

export async function fetchSummary(): Promise<{ stations: StationSummary[]; as_of: { sales: string | null; patronage: string | null } }> {
  const res = await fetch('/api/v1/summary');
  if (!res.ok) throw new Error(`Summary failed to load (HTTP ${res.status})`);
  return res.json();
}

export type MetricDto = {
  metric: string; name: string; unit: string; ring: string; property_type: string; value: number | null; display: string;
  suppressed: boolean; sales_count: number | null; source: string; as_of: string; demo: boolean;
};

export async function fetchMetrics(station: string, propertyType?: 'unit' | 'house'): Promise<MetricDto[]> {
  const res = await fetch(`/api/v1/metrics?station=${station}${propertyType ? `&property_type=${propertyType}` : ''}`);
  if (!res.ok) throw new Error(`Metrics failed to load (HTTP ${res.status})`);
  return (await res.json()).metrics;
}

export type User = { sub: string; name: string; email?: string; provider: 'microsoft' | 'demo'; persona: 'developer' | 'lender' | 'planner' };

export type BriefingFigureDto = {
  label: string; display: string; value: number | null; unit: string;
  source: string; dataset_id: string; as_of: string; demo?: boolean;
};

export type BriefingDto = {
  station: string; name: string;
  image: string | null; image_model: string | null; image_ms: number | null;
  cached: boolean; figures: BriefingFigureDto[]; generated_at: string;
  error?: { code: string; message: string };
};

/** GET /api/v1/briefing/{station}. A 503 still carries the figures when the image fails. */
export async function fetchBriefing(station: string): Promise<BriefingDto> {
  const res = await fetch(`/api/v1/briefing/${station}`);
  if (res.status !== 200 && res.status !== 503) throw new Error(`Briefing failed to load (HTTP ${res.status})`);
  return res.json();
}
export type TourFigureDto = {
  label: string; display: string; value: number | null; unit: string;
  source: string; dataset_id: string; as_of: string; demo?: boolean;
};

export type TourStopDto = {
  station_id: string; name: string; lines: string[]; lat: number; lon: number;
  figures: TourFigureDto[]; headline: string; headline_model: boolean;
};

export type TourDto = { id: string; title: string; stops: TourStopDto[] };

export async function fetchTour(tour: string): Promise<TourDto> {
  const res = await fetch(`/api/v1/tour/${tour}`);
  if (!res.ok) throw new Error(`Tour failed to load (HTTP ${res.status})`);
  return res.json();
}
export async function fetchUser(): Promise<User | null> {
  const res = await fetch('/api/auth/session');
  return res.ok ? (await res.json()).user : null;
}
