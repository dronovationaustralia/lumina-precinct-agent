/**
 * Station registry for the 10 hackathon stations on two corridors.
 *
 * Coordinates are APPROXIMATE (platform centres read off a map) until the TfNSW GTFS
 * `stops.txt` ingest replaces them; `coord_source` says which applies.
 */
import type { StationId } from './contracts';

export type Station = {
  id: StationId;
  name: string;
  corridor: 'north_shore' | 'parramatta';
  lat: number;
  lon: number;
  aliases: string[];
  coord_source: 'approximate' | 'gtfs';
};

export const STATIONS: readonly Station[] = [
  { id: 'wynyard', name: 'Wynyard', corridor: 'north_shore', lat: -33.8658, lon: 151.2058, aliases: [], coord_source: 'approximate' },
  { id: 'milsons_point', name: 'Milsons Point', corridor: 'north_shore', lat: -33.8461, lon: 151.2118, aliases: ['milsons'], coord_source: 'approximate' },
  { id: 'north_sydney', name: 'North Sydney', corridor: 'north_shore', lat: -33.8406, lon: 151.2072, aliases: ['n sydney', 'north syd'], coord_source: 'approximate' },
  { id: 'st_leonards', name: 'St Leonards', corridor: 'north_shore', lat: -33.8230, lon: 151.1945, aliases: ['saint leonards', 'st. leonards', 'crows nest'], coord_source: 'approximate' },
  { id: 'chatswood', name: 'Chatswood', corridor: 'north_shore', lat: -33.7968, lon: 151.1806, aliases: [], coord_source: 'approximate' },
  { id: 'westmead', name: 'Westmead', corridor: 'parramatta', lat: -33.8079, lon: 150.9874, aliases: [], coord_source: 'approximate' },
  { id: 'parramatta', name: 'Parramatta', corridor: 'parramatta', lat: -33.8174, lon: 151.0048, aliases: ['parra', 'paramatta'], coord_source: 'approximate' },
  { id: 'harris_park', name: 'Harris Park', corridor: 'parramatta', lat: -33.8226, lon: 151.0076, aliases: [], coord_source: 'approximate' },
  { id: 'granville', name: 'Granville', corridor: 'parramatta', lat: -33.8326, lon: 151.0119, aliases: [], coord_source: 'approximate' },
  { id: 'auburn', name: 'Auburn', corridor: 'parramatta', lat: -33.8494, lon: 151.0330, aliases: [], coord_source: 'approximate' },
];

export const STATION_BY_ID = new Map(STATIONS.map((s) => [s.id, s]));

export function stationName(id: string): string {
  return STATION_BY_ID.get(id as StationId)?.name ?? id;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\b(station|railway|train)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Gazetteer lookup: exact name, id, alias, then prefix. */
export function findStation(query: string): Station | undefined {
  const q = norm(query);
  if (!q) return undefined;
  return (
    STATIONS.find((s) => norm(s.name) === q || s.id === q.replace(/ /g, '_') || s.aliases.some((a) => norm(a) === q)) ??
    STATIONS.find((s) => norm(s.name).startsWith(q) || q.startsWith(norm(s.name)))
  );
}

/** All stations whose names appear in free text, in order of appearance. */
export function stationsInText(text: string): Station[] {
  const t = ` ${norm(text)} `;
  const hits: { s: Station; at: number }[] = [];
  for (const s of STATIONS) {
    const names = [s.name, ...s.aliases].map(norm);
    const at = Math.min(...names.map((n) => { const i = t.indexOf(` ${n} `); return i < 0 ? Infinity : i; }));
    if (at !== Infinity) hits.push({ s, at });
  }
  // "North Sydney" also contains no other station names, but "St Leonards" alias "crows nest" is fine.
  return hits.sort((a, b) => a.at - b.at).map((h) => h.s);
}
