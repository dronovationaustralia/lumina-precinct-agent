/**
 * Station order along each line for guided tours: a nearest-neighbour chain through the
 * registry stations on each line, starting from the station farthest from the line's
 * centre. Sydney's lines are linear enough that this walks the track in order
 * (verified: the T1 North Shore leg comes out as one consecutive run).
 *
 *   npm run ingest:line-order     # writes src/lib/line-order.json (committed)
 */
import { readFileSync, writeFileSync } from 'node:fs';

type Station = { id: string; lines: string[]; lat: number; lon: number };

const registry = JSON.parse(readFileSync('src/lib/station-registry.json', 'utf8')) as { stations: Station[] };
const byId = new Map(registry.stations.map((s) => [s.id, s]));

const out: Record<string, string[]> = {};
const lines = [...new Set(registry.stations.flatMap((s) => s.lines))].sort();
for (const line of lines) {
  const ids = registry.stations.filter((s) => s.lines.includes(line)).map((s) => s.id);
  const cx = ids.reduce((a, id) => a + byId.get(id)!.lon, 0) / ids.length;
  const cy = ids.reduce((a, id) => a + byId.get(id)!.lat, 0) / ids.length;
  const dist = (a: string, bLon: number, bLat: number) => {
    const s = byId.get(a)!;
    return (s.lon - bLon) ** 2 + (s.lat - bLat) ** 2;
  };
  // Start at an endpoint: the station farthest from the line's centre (id breaks ties).
  let cur = [...ids].sort((a, b) => dist(b, cx, cy) - dist(a, cx, cy) || (a < b ? -1 : 1))[0]!;
  const order = [cur];
  const left = new Set(ids);
  left.delete(cur);
  while (left.size) {
    const s = byId.get(cur)!;
    cur = [...left].sort((a, b) => dist(a, s.lon, s.lat) - dist(b, s.lon, s.lat) || (a < b ? -1 : 1))[0]!;
    order.push(cur);
    left.delete(cur);
  }
  out[line] = order;
  console.log(`${line}: ${order.length} stations (${order[0]} to ${order[order.length - 1]})`);
}
writeFileSync('src/lib/line-order.json', `${JSON.stringify(out, null, 1)}\n`);
console.log('Wrote src/lib/line-order.json');
