/**
 * Transport for NSW "Train Station Entries and Exits" (Opal tap on/off), monthly.
 *
 * Columns: MonthYear ("2024-10-01 00:00:00.000"), Station ("Chatswood  Station", double space),
 * Station_Type (Train, Metro, Metro Shared, Light rail), Entry_Exit (Entry | Exit), Trip
 * (a count, or "Less than 50").
 *
 * Only the station's own train (or shared train/metro) row is kept. Nearby light rail stops and
 * separate metro stations (Victoria Cross, Crows Nest, Barangaroo) are not added in.
 *
 * Licence: CC BY 4.0, Transport for NSW.
 */
import { STATIONS } from '../../src/lib/stations';

import { readCsv } from './csv';

export type PatronageRow = { station_id: string; month: string; entries: number; exits: number };

const norm = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();
const KEEP_TYPES = new Set(['TRAIN', 'METRO SHARED']);

/** "Chatswood  Station" -> chatswood. Light rail and metro-only rows are ignored. */
export function stationIdFor(name: string, type: string): string | null {
  if (!KEEP_TYPES.has(norm(type))) return null;
  const n = norm(name).replace(/ STATION$/, '');
  return STATIONS.find((s) => norm(s.name) === n)?.id ?? null;
}

export function parsePatronage(text: string): { rows: PatronageRow[]; months: string[]; small: number } {
  const byKey = new Map<string, PatronageRow>();
  let small = 0;
  const months = new Set<string>();
  for (const r of readCsv(text.replace(/^﻿/, ''))) {
    const month = (r.MonthYear ?? '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    months.add(month);
    const id = stationIdFor(r.Station ?? '', r.Station_Type ?? '');
    if (!id) continue;
    const raw = (r.Trip ?? '').trim();
    // "Less than 50" is published for very quiet stations; counted as 0 and reported.
    const n = /^\d+$/.test(raw) ? Number(raw) : 0;
    if (!/^\d+$/.test(raw)) small++;
    const key = `${id}|${month}`;
    const row = byKey.get(key) ?? { station_id: id, month, entries: 0, exits: 0 };
    if (/^entry$/i.test(r.Entry_Exit ?? '')) row.entries += n;
    else if (/^exit$/i.test(r.Entry_Exit ?? '')) row.exits += n;
    byKey.set(key, row);
  }
  const rows = [...byKey.values()].sort((a, b) => a.station_id.localeCompare(b.station_id) || a.month.localeCompare(b.month));
  return { rows, months: [...months].sort(), small };
}
