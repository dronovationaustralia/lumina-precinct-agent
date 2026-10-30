/**
 * Fetch NSW Landuse 2017 v1.5 (ALUM classes) around every station from the NSW Government map
 * service. Run on a machine that can reach mapprod1.environment.nsw.gov.au (your laptop).
 *
 *   npm run fetch:landuse                  # all stations, 2.1 km around each
 *   npm run fetch:landuse -- --featured    # only the 10 featured stations (quick test)
 *
 * Output: data/raw/landuse/landuse_features.ndjson (one GeoJSON feature per line, deduplicated)
 *         data/raw/landuse/landuse_fetch_summary.json (fields, class counts, per-station counts)
 * Licence: CC BY 4.0, NSW Department of Climate Change, Energy, the Environment and Water.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- untyped ArcGIS REST responses */
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { STATIONS } from '../../src/lib/stations';

const BASE = process.env.LANDUSE_URL ?? 'https://mapprod1.environment.nsw.gov.au/arcgis/rest/services/Landuse/LandUse2017/MapServer';
const RADIUS_M = 2100;
const OUT = path.join('data', 'raw', 'landuse');
const stations = process.argv.includes('--featured') ? STATIONS.filter((s) => s.featured) : STATIONS;

async function getJson(url: string, tries = 4): Promise<any> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'LuminaPrecinctAgent/0.1 (data ingest)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j?.error) throw new Error(`service error ${j.error.code}: ${j.error.message}`);
      return j;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  }
}

const service = await getJson(`${BASE}?f=json`);
const layers: { id: number; name: string }[] = service.layers ?? [];
let layer: { id: number; name: string; maxRecordCount: number; fields: { name: string; type: string }[] } | null = null;
for (const l of layers) {
  const info = await getJson(`${BASE}/${l.id}?f=json`);
  if (info.geometryType === 'esriGeometryPolygon' && info.type === 'Feature Layer') {
    layer = { id: l.id, name: info.name, maxRecordCount: info.maxRecordCount ?? 1000, fields: info.fields ?? [] };
    break;
  }
}
if (!layer) throw new Error(`No polygon layer found at ${BASE}`);
console.log(`Layer ${layer.id} "${layer.name}", ${layer.fields.length} fields, ${layer.maxRecordCount} per page`);
const idField = layer.fields.find((f) => f.type === 'esriFieldTypeOID')?.name ?? 'OBJECTID';

mkdirSync(OUT, { recursive: true });
const out = createWriteStream(path.join(OUT, 'landuse_features.ndjson'));
const seen = new Set<number>();
const perStation: Record<string, number> = {};
const classes: Record<string, number> = {};

async function fetchStation(s: (typeof STATIONS)[number]) {
  const dLat = RADIUS_M / 111_320, dLon = RADIUS_M / (111_320 * Math.cos((s.lat * Math.PI) / 180));
  const env = [s.lon - dLon, s.lat - dLat, s.lon + dLon, s.lat + dLat].map((v) => v.toFixed(6)).join(',');
  let offset = 0, n = 0;
  for (;;) {
    const q = new URLSearchParams({
      where: '1=1', geometry: env, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
      outFields: '*', returnGeometry: 'true', outSR: '4326', geometryPrecision: '6', maxAllowableOffset: '0.00001',
      resultOffset: String(offset), resultRecordCount: String(layer!.maxRecordCount), orderByFields: idField, f: 'geojson',
    });
    const fc = await getJson(`${BASE}/${layer!.id}/query?${q}`);
    const feats: any[] = fc.features ?? [];
    for (const f of feats) {
      const id = Number(f.properties?.[idField] ?? f.id);
      n++;
      if (seen.has(id)) continue;
      seen.add(id);
      const cls = String(f.properties?.Secondary ?? f.properties?.SECONDARY ?? f.properties?.LU_NSWDeta ?? f.properties?.Tertiary ?? 'unknown');
      classes[cls] = (classes[cls] ?? 0) + 1;
      out.write(JSON.stringify(f) + '\n');
    }
    if (!feats.length || !(fc.exceededTransferLimit || fc.properties?.exceededTransferLimit || feats.length >= layer!.maxRecordCount)) break;
    offset += feats.length;
  }
  perStation[s.id] = n;
}

const queue = [...stations];
let done = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let s = queue.shift(); s; s = queue.shift()) {
    await fetchStation(s);
    process.stdout.write(`\r${++done}/${stations.length} stations, ${seen.size.toLocaleString()} polygons`);
  }
}));
out.end();
console.log();
writeFileSync(path.join(OUT, 'landuse_fetch_summary.json'), JSON.stringify({
  source: BASE, layer, fetched: new Date().toISOString(), radius_m: RADIUS_M, stations: stations.length, polygons: seen.size,
  classes: Object.fromEntries(Object.entries(classes).sort((a, b) => b[1] - a[1])), per_station: perStation,
}, null, 2));
console.log(`Done: ${seen.size.toLocaleString()} polygons -> ${path.join(OUT, 'landuse_features.ndjson')}`);
