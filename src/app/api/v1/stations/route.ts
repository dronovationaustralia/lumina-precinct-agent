/** GET /api/v1/stations: the station registry. */
import { STATIONS } from '@/lib/stations';
import { json, preflight } from '@/server/http';

export function OPTIONS() {
  return preflight();
}

export function GET() {
  return json({
    stations: STATIONS.map(({ id, name, corridor, lat, lon, coord_source }) => ({ id, name, corridor, lat, lon, coord_source })),
  });
}
