/**
 * Guided corridor tours: fixed station lists in line order, plus per-line orders for
 * tours built from any line the user picks (see `scripts/ingest/line-order.ts`).
 * Client-safe: station lists only, no database. The server skips stations without
 * sales data and caps dynamic tours at 8 stops (see `src/server/tour.ts`).
 */
import LINE_ORDER from './line-order.json';

export type TourDef = { id: string; title: string; stops: string[] };

export const FIXED_TOURS: readonly TourDef[] = [
  {
    id: 'north-shore',
    title: 'North Shore: Wynyard to Chatswood',
    stops: ['wynyard', 'milsons_point', 'north_sydney', 'st_leonards', 'chatswood'],
  },
  {
    id: 'parramatta-corridor',
    title: 'Parramatta corridor',
    stops: ['auburn', 'granville', 'harris_park', 'parramatta', 'westmead'],
  },
];

/** Lines with registry stations, in order: T1 to T9 and the Metro. */
export const TOURABLE_LINES: readonly string[] = Object.keys(LINE_ORDER).sort();

/** Resolve a tour id: a fixed tour, or `line-<T1..T9|M1>` for a line tour. */
export function resolveTour(tour: string): TourDef | null {
  const fixed = FIXED_TOURS.find((t) => t.id === tour);
  if (fixed) return { ...fixed, stops: [...fixed.stops] };
  const m = /^line-(T[1-9]|M1)$/.exec(tour);
  if (!m) return null;
  const stops = (LINE_ORDER as Record<string, string[]>)[m[1]!] ?? [];
  if (!stops.length) return null;
  return { id: tour, title: `${m[1]} line tour`, stops: [...stops] };
}
