/**
 * Station registry: every Sydney Trains (T1 to T9) and Sydney Metro station, generated from the
 * TfNSW GTFS feed by `npm run ingest:gtfs-lines` into `station-registry.json` (committed).
 *
 * `featured` marks the ten stations used in demos and starter questions; nothing else treats
 * them differently. Adding a city means another registry file, not new code.
 */
import REGISTRY from './station-registry.json';

export type Station = {
  id: string;
  name: string;
  /** Lines calling at the station, e.g. ["M1", "T1", "T9"]. */
  lines: string[];
  /** Main line, used to colour and group the station (first T line, else the metro line). */
  corridor: string;
  lat: number;
  lon: number;
  featured: boolean;
  aliases: string[];
  coord_source: 'gtfs';
};

/** Common spellings people type. */
const ALIASES: Record<string, string[]> = {
  parramatta: ['parra', 'paramatta'],
  north_sydney: ['n sydney', 'north syd'],
  st_leonards: ['saint leonards', 'st. leonards'],
  milsons_point: ['milsons'],
  central: ['central station', 'sydney central'],
  olympic_park: ['sydney olympic park'],
  international_airport: ['sydney airport', 'airport'],
  macquarie_university: ['macquarie uni'],
  st_james: ['saint james'],
  st_marys: ['saint marys', "st mary's"],
  st_peters: ['saint peters'],
};

type RegistryRow = { id: string; name: string; lines: string[]; lat: number; lon: number; featured: boolean };

export const STATIONS: readonly Station[] = (REGISTRY.stations as RegistryRow[]).map((s) => ({
  ...s,
  corridor: s.lines.find((l) => l.startsWith('T')) ?? s.lines[0] ?? '',
  aliases: ALIASES[s.id] ?? [],
  coord_source: 'gtfs' as const,
}));

export const STATION_BY_ID = new Map(STATIONS.map((s) => [s.id, s]));
export const FEATURED_STATIONS = STATIONS.filter((s) => s.featured);

export function stationName(id: string): string {
  return STATION_BY_ID.get(id)?.name ?? id;
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

/**
 * All stations whose names appear in free text, in order of appearance. Longer names win where
 * they overlap ("North Strathfield" is not also "Strathfield").
 */
export function stationsInText(text: string): Station[] {
  const t = ` ${norm(text)} `;
  const hits: { s: Station; at: number; end: number }[] = [];
  for (const s of STATIONS) {
    for (const n of [s.name, ...s.aliases].map(norm)) {
      const i = t.indexOf(` ${n} `);
      if (i >= 0) {
        hits.push({ s, at: i, end: i + n.length + 1 });
        break;
      }
    }
  }
  const kept = hits.filter((h) => !hits.some((o) => o !== h && o.at <= h.at && o.end >= h.end && o.end - o.at > h.end - h.at));
  return kept.sort((a, b) => a.at - b.at).map((h) => h.s);
}
