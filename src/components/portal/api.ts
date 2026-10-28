'use client';

import type { AskResponse, MapAction } from '@/lib/contracts';

export type StationDto = { id: string; name: string; corridor: string; lat: number; lon: number; coord_source: string };

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
  opts: { stationContext?: string; onProgress: (e: ProgressEvent) => void; signal?: AbortSignal },
): Promise<AskResponse> {
  const res = await fetch('/api/v1/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ question, ...(opts.stationContext ? { station_context: opts.stationContext } : {}) }),
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
