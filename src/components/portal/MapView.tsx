'use client';

/**
 * MapLibre map that renders the state produced by map actions: focus station, radius ring,
 * compared pair, highlighted stations and visible layers. All map behaviour is driven from
 * props so the same actions can run in the Quest app.
 *
 * Layers, bottom to top: basemap, sales hexagons, rail lines (official line colours), rings,
 * every train and metro station as a dot in its line colour, then the selected station(s) as an
 * HTML roundel with a KPI.
 */
import { useEffect, useRef, useState } from 'react';
import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, Map as MlMap, Marker, Popup } from 'maplibre-gl';

import { LAND_USE_CATEGORIES, type LandUseCategory } from '@/lib/landuse';
import { LINE_COLOURS } from '@/lib/lines';

import type { StationDto } from './api';

export type HexMode = 'off' | 'unit' | 'house';
export type BoundaryMode = 'off' | 'suburb' | 'lga' | 'postcode';
export type StationMetricMode = 'off' | 'unit_median' | 'unit_change' | 'house_median' | 'trips' | 'trips_change';
export type LayerState = { lines: boolean; rings: boolean; hex: HexMode; bounds: BoundaryMode; landuse: boolean; stationMetric: StationMetricMode; sites: boolean; sam: boolean; samOpacity: number; aerial: boolean };

export type MapState = {
  focus: string | null;
  radius_m: number;
  compare: [string, string] | null;
  highlight: string[];
  view: 'overview' | 'close';
  /** Increments on every fly so the same target can be flown to again. */
  flyNonce: number;
};

export type HexMeta = { breaks: number[]; as_of: string | null; demo_data: boolean; source: string | null; property_type: string };
export type MetricMeta = { breaks: number[]; breakLabels: string[]; as_of: string | null; unit: string; label: string };
export type SamMeta = { counts: Record<string, number>; capture_date: string | null; count: number; source: string | null };

const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE ?? 'https://tiles.openfreemap.org/styles/positron';
const SYDNEY: [number, number] = [151.1, -33.83];
/** Used when the basemap cannot be reached: stations, lines and rings still render on a plain ground. */
const FALLBACK_STYLE = { version: 8 as const, sources: {}, layers: [{ id: 'ground', type: 'background' as const, paint: { 'background-color': '#e6ebe6' } }] };
export const HEX_COLOURS = ['#efe9da', '#cddbe6', '#93b6d8', '#5487c2', '#1f5fad'];
/** Station dots with no value for the selected metric. */
export const STATION_NO_VALUE = '#9aa5a1';
export const SITE_COLOURS = { car_park: '#4361ee', construction_site: '#d97706' };
/** What SAM 3.1 sees: one colour per class, matching the batch review overlays. */
export const SAM_COLOURS: Record<string, string> = { building: '#e4572e', tree_canopy: '#29bf12', car_park: '#4361ee', construction_site: '#ffc914' };
export const SAM_CLASSES = ['building', 'tree_canopy', 'car_park', 'construction_site'] as const;
export const SAM_CLASS_NAMES: Record<string, string> = { building: 'buildings', tree_canopy: 'tree canopy', car_park: 'car parks', construction_site: 'construction sites' };
export const SAM_CLASS_PLURALS: Record<string, string> = { building: 'buildings', tree_canopy: 'tree crowns', car_park: 'car parks', construction_site: 'construction sites' };
/** NSW Spatial Services imagery tiles (note the {z}/{y}/{x} order). Verified 2026-11-02. */
const NSW_AERIAL_TILES = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/{z}/{y}/{x}';

const STATION_METRIC_QUERY: Record<Exclude<StationMetricMode, 'off'>, { metric: string; property_type: string }> = {
  unit_median: { metric: 'median_price', property_type: 'unit' },
  unit_change: { metric: 'price_change_12m', property_type: 'unit' },
  house_median: { metric: 'median_price', property_type: 'house' },
  trips: { metric: 'patronage_12m', property_type: 'all' },
  trips_change: { metric: 'patronage_change_12m', property_type: 'all' },
};

const STATION_METRIC_LABEL: Record<Exclude<StationMetricMode, 'off'>, string> = {
  unit_median: 'Median unit price within 800 m',
  unit_change: 'Unit price change over 12 months',
  house_median: 'Median house price within 800 m',
  trips: 'Station trips over 12 months',
  trips_change: 'Trips change over 12 months',
};

function circle(lon: number, lat: number, radiusM: number, steps = 96): [number, number][] {
  const out: [number, number][] = [];
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    out.push([lon + dLon * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  return out;
}

function ringFeatures(stations: StationDto[], ids: string[], radius: number) {
  return {
    type: 'FeatureCollection' as const,
    features: ids.flatMap((id) => {
      const s = stations.find((x) => x.id === id);
      if (!s) return [];
      // 400 m inner ring as well as the chosen radius, so the TOD distance is always visible.
      const radii = radius > 400 ? [400, radius] : [radius];
      return radii.map((r) => ({ type: 'Feature' as const, properties: { id, r }, geometry: { type: 'Polygon' as const, coordinates: [circle(s.lon, s.lat, r)] } }));
    }),
  };
}

const narrow = () => window.matchMedia('(max-width: 900px)').matches;
const money = (v: number) => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}m` : `$${Math.round(v / 1000)}k`);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function MapView({
  stations,
  state,
  layers,
  kpis,
  onSelect,
  onHexMeta,
  onMetricMeta,
  onSamMeta,
  samPeek,
}: {
  stations: StationDto[];
  state: MapState;
  layers: LayerState;
  kpis: Record<string, string>;
  onSelect: (id: string) => void;
  onMetricMeta: (meta: MetricMeta | null) => void;
  onHexMeta: (meta: HexMeta | null) => void;
  onSamMeta: (meta: SamMeta | null) => void;
  /** While true (press and hold), the SAM masks hide so the aerial photo shows alone. */
  samPeek: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const lib = useRef<typeof import('maplibre-gl') | null>(null);
  const roundels = useRef(new Map<string, Marker>());
  const popup = useRef<Popup | null>(null);
  const fitted = useRef(false);
  const hexLoaded = useRef<HexMode>('off');
  const metricLoaded = useRef<StationMetricMode>('off');
  const metricData = useRef<{ mode: StationMetricMode; values: Map<string, { value: number; display: string }>; breaks: number[] } | null>(null);
  const boundsLoaded = useRef(false);
  const landuseFor = useRef<string | null>(null);
  const sitesFor = useRef<string | null>(null);
  const samFor = useRef<string | null>(null);
  const baseLayers = useRef<{ id: string; type: string }[]>([]);
  const revealTimers = useRef<number[]>([]);
  const [samCaption, setSamCaption] = useState<string | null>(null);
  const latest = useRef({ stations, state, layers, kpis, onSelect, onHexMeta, onMetricMeta, onSamMeta, samPeek });
  latest.current = { stations, state, layers, kpis, onSelect, onHexMeta, onMetricMeta, onSamMeta, samPeek };

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    const markers = roundels.current;
    (async () => {
      const maplibre = await import('maplibre-gl');
      if (cancelled || !el.current) return;
      // The worker is copied into public/ (scripts/copy-map-worker.mjs) because bundling moves the main module.
      maplibre.setWorkerUrl('/maplibre-gl-worker.mjs');
      lib.current = maplibre;
      // Fetch the basemap style first and decide once: real basemap, or a plain ground if it is
      // unreachable. (Switching styles after the map starts loading drops every layer added later.)
      const style = await fetch(STYLE_URL, { signal: AbortSignal.timeout(6000) })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .catch((e: Error) => {
          console.warn('[map] basemap style unreachable, using a plain ground:', e.message);
          return FALLBACK_STYLE;
        });
      if (cancelled || !el.current) return;
      const m = new maplibre.Map({ container: el.current, style, center: SYDNEY, zoom: 10.6, attributionControl: { compact: true } });
      m.addControl(new maplibre.NavigationControl({ showCompass: false }), 'bottom-right');
      map.current = m;
      // Keep the canvas sized to its pane (the screen split can change at any time).
      const ro = new ResizeObserver(() => m.resize());
      ro.observe(el.current);
      m.once('remove', () => ro.disconnect());
      if (process.env.NODE_ENV !== 'production') (window as unknown as { __luminaMap?: MlMap }).__luminaMap = m;
      // Tile or data errors are reported, never fatal: the rest of the map keeps working.
      m.on('error', (e: { error?: { message?: string }; sourceId?: string }) => {
        console.warn('[map] error', e.sourceId ?? '', e.error?.message ?? e);
      });
      m.on('load', () => {
        const css = getComputedStyle(document.documentElement);
        const harbour = css.getPropertyValue('--harbour').trim() || '#1f5fad';
        // Put data under the basemap's labels so street and suburb names stay readable.
        const firstSymbol = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
        baseLayers.current = m.getStyle().layers.map((l) => ({ id: l.id, type: l.type }));

        // Aerial photo basemap (NSW Spatial Services imagery), hidden until toggled on.
        m.addSource('aerial', { type: 'raster', tiles: [NSW_AERIAL_TILES], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Spatial Services NSW (CC BY 4.0)' });
        m.addLayer({ id: 'aerial', type: 'raster', source: 'aerial', layout: { visibility: 'none' }, paint: { 'raster-opacity': 1 } }, m.getStyle().layers[0]?.id);

        m.addSource('hex', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'hex-fill', type: 'fill', source: 'hex', filter: ['!=', ['get', 'median'], null],
          paint: { 'fill-color': '#cddbe6', 'fill-opacity': 0.55 },
        }, firstSymbol);
        m.addLayer({
          id: 'hex-line', type: 'line', source: 'hex',
          paint: { 'line-color': '#ffffff', 'line-width': ['case', ['==', ['get', 'median'], null], 0.6, 1], 'line-opacity': 0.9 },
        }, firstSymbol);
        m.addLayer({
          id: 'hex-suppressed', type: 'line', source: 'hex', filter: ['==', ['get', 'median'], null],
          paint: { 'line-color': '#8a948f', 'line-width': 0.8, 'line-dasharray': [2, 2], 'line-opacity': 0.6 },
        }, firstSymbol);

        // Official land use around the selected station (NSW Landuse 2017), under the labels.
        m.addSource('landuse', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        const catColour: ExpressionSpecification = ['match', ['get', 'category'],
          ...Object.entries(LAND_USE_CATEGORIES).flatMap(([k, v]) => [k, v.colour]), '#cccccc'] as unknown as ExpressionSpecification;
        m.addLayer({ id: 'landuse-fill', type: 'fill', source: 'landuse', paint: { 'fill-color': catColour, 'fill-opacity': 0.62 } }, firstSymbol);
        m.addLayer({ id: 'landuse-line', type: 'line', source: 'landuse', paint: { 'line-color': '#ffffff', 'line-width': 0.4, 'line-opacity': 0.7 } }, firstSymbol);
        m.on('mousemove', 'landuse-fill', (e) => {
          if (m.getLayer('hex-fill') && latest.current.layers.hex !== 'off') return;
          const p = e.features?.[0]?.properties as { category?: string; tertiary?: string } | undefined;
          if (!p?.category) return;
          const label = LAND_USE_CATEGORIES[p.category as LandUseCategory]?.label ?? p.category;
          popup.current?.setLngLat(e.lngLat).setHTML(`<strong>${label}</strong><br>${(p.tertiary ?? '').replace(/^[\d.]+\s*/, '')}<br><span style="opacity:.7">NSW Landuse 2017</span>`).addTo(m);
        });
        m.on('mouseleave', 'landuse-fill', () => popup.current?.remove());

        // Opportunity sites (SAM 3.1) around the selected station, under the labels.
        m.addSource('sites', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        const siteColour: ExpressionSpecification = ['match', ['get', 'class'],
          'car_park', SITE_COLOURS.car_park, 'construction_site', SITE_COLOURS.construction_site, '#cccccc'] as unknown as ExpressionSpecification;
        m.addLayer({ id: 'sites-fill', type: 'fill', source: 'sites', paint: { 'fill-color': siteColour, 'fill-opacity': 0.18 } }, firstSymbol);
        m.addLayer({ id: 'sites-line', type: 'line', source: 'sites', paint: { 'line-color': siteColour, 'line-width': 2 } }, firstSymbol);
        m.on('mousemove', 'sites-fill', (e) => {
          const p = e.features?.[0]?.properties as { class?: string; area_m2?: number; distance_m?: number } | undefined;
          if (!p?.class) return;
          const label = p.class === 'car_park' ? 'Car park' : p.class === 'construction_site' ? 'Construction site' : p.class;
          popup.current?.setLngLat(e.lngLat).setHTML(
            `<strong>${label}</strong><br>${Math.round(Number(p.area_m2)).toLocaleString('en-AU')} m², ${Math.round(Number(p.distance_m))} m from the station<br><span style="opacity:.7">SAM 3.1 candidate site</span>`,
          ).addTo(m);
        });
        m.on('mouseleave', 'sites-fill', () => popup.current?.remove());

        // What SAM 3.1 sees: one fill + outline layer per class so the reveal can fade
        // them in one after another. Opacities start at 0 and are set when data loads.
        m.addSource('sam', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        for (const cls of SAM_CLASSES) {
          m.addLayer({
            id: `sam-fill-${cls}`, type: 'fill', source: 'sam', filter: ['==', ['get', 'class'], cls],
            paint: { 'fill-color': SAM_COLOURS[cls], 'fill-opacity': 0, 'fill-opacity-transition': { duration: 600, delay: 0 } },
          }, firstSymbol);
          m.addLayer({
            id: `sam-line-${cls}`, type: 'line', source: 'sam', filter: ['==', ['get', 'class'], cls],
            paint: { 'line-color': SAM_COLOURS[cls], 'line-width': 1, 'line-opacity': 0, 'line-opacity-transition': { duration: 600, delay: 0 } },
          }, firstSymbol);
        }

        // Boundaries: loaded on first use (about 850 KB), drawn as quiet outlines with names.
        m.addSource('bounds', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        // Hovered area: warm fill and a solid outline that stand out against the grey basemap,
        // the blue station palette and the land-use colours.
        m.addLayer({ id: 'bounds-hover', type: 'fill', source: 'bounds', filter: ['==', ['get', 'code'], ''], paint: { 'fill-color': '#f2a900', 'fill-opacity': 0.22 } }, firstSymbol);
        m.addLayer({
          id: 'bounds-hover-line', type: 'line', source: 'bounds', filter: ['==', ['get', 'code'], ''],
          paint: { 'line-color': '#c26a00', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 3.5], 'line-opacity': 0.95 },
        }, firstSymbol);
        m.addLayer({ id: 'bounds-hit', type: 'fill', source: 'bounds', filter: ['==', ['get', 'kind'], 'none'], paint: { 'fill-color': '#000', 'fill-opacity': 0 } }, firstSymbol);
        m.addLayer({
          id: 'bounds-line', type: 'line', source: 'bounds', filter: ['==', ['get', 'kind'], 'none'],
          paint: { 'line-color': '#3d4b47', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 15, 1.8], 'line-opacity': 0.7, 'line-dasharray': [4, 2] },
        }, firstSymbol);
        if (m.getStyle().glyphs) {
          m.addLayer({
            id: 'bounds-name', type: 'symbol', source: 'bounds', filter: ['==', ['get', 'kind'], 'none'], minzoom: 11,
            layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-font': ['Noto Sans Bold'], 'text-transform': 'uppercase', 'text-letter-spacing': 0.06, 'symbol-placement': 'point' },
            paint: { 'text-color': '#3d4b47', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6, 'text-opacity': 0.85 },
          });
          // The hovered area's name, larger and at any zoom.
          m.addLayer({
            id: 'bounds-hover-name', type: 'symbol', source: 'bounds', filter: ['==', ['get', 'code'], ''],
            layout: { 'text-field': ['get', 'name'], 'text-size': 15, 'text-font': ['Noto Sans Bold'], 'text-transform': 'uppercase', 'text-letter-spacing': 0.06, 'symbol-placement': 'point', 'text-allow-overlap': true },
            paint: { 'text-color': '#7a3f00', 'text-halo-color': '#ffffff', 'text-halo-width': 2.2 },
          });
        }
        m.on('mousemove', 'bounds-hit', (e) => {
          const p = e.features?.[0]?.properties as { code?: string } | undefined;
          const f: FilterSpecification = ['all', ['==', ['get', 'code'], p?.code ?? ''], ['==', ['get', 'kind'], latest.current.layers.bounds]];
          for (const id of ['bounds-hover', 'bounds-hover-line', 'bounds-hover-name']) if (m.getLayer(id)) m.setFilter(id, f);
        });
        m.on('mouseleave', 'bounds-hit', () => {
          for (const id of ['bounds-hover', 'bounds-hover-line', 'bounds-hover-name']) if (m.getLayer(id)) m.setFilter(id, ['==', ['get', 'code'], '']);
        });

        m.addSource('network', { type: 'geojson', data: '/data/network.geojson' });
        // Zoom must be the top-level input of a width expression, so the casing gets its own ramp.
        const widthAt = (extra: number): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'],
          9, ['case', ['==', ['get', 'mode'], 'light_rail'], 1 + extra, 1.8 + extra],
          14, ['case', ['==', ['get', 'mode'], 'light_rail'], 3 + extra, 5 + extra]];
        const lineWidth = widthAt(0);
        // Where lines share track, the precinct lines (T1, then Metro and L4) draw on top.
        const sortKey: ExpressionSpecification = ['match', ['get', 'line'], 'T1', 10, 'M1', 9, 'L4', 8, 'T9', 7, 'T2', 3, 'T3', 3, 1];
        m.addLayer({
          id: 'lines-casing', type: 'line', source: 'network', filter: ['==', ['get', 'kind'], 'line'],
          layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': sortKey },
          paint: { 'line-color': '#ffffff', 'line-width': widthAt(2.5), 'line-opacity': 0.9 },
        });
        m.addLayer({
          id: 'lines', type: 'line', source: 'network', filter: ['==', ['get', 'kind'], 'line'],
          layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': sortKey },
          paint: { 'line-color': ['get', 'color'], 'line-width': lineWidth, 'line-opacity': ['case', ['==', ['get', 'mode'], 'light_rail'], 0.75, 0.95] },
        });

        m.addSource('rings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({ id: 'rings-fill', type: 'fill', source: 'rings', filter: ['>', ['get', 'r'], 400], paint: { 'fill-color': harbour, 'fill-opacity': 0.06 } });
        m.addLayer({
          id: 'rings-line', type: 'line', source: 'rings',
          paint: { 'line-color': harbour, 'line-width': ['case', ['==', ['get', 'r'], 400], 1.2, 1.8], 'line-dasharray': [2, 2] },
        });

        // Other rail stations: small white dots, named from zoom 13 (when the basemap has fonts).
        // Light rail stops from the network file; train and metro stations come from the registry below.
        const others: FilterSpecification = ['all', ['==', ['get', 'kind'], 'station'], ['==', ['get', 'mode'], 'light_rail']];
        m.addLayer({
          id: 'net-stations', type: 'circle', source: 'network', filter: others, minzoom: 10.5,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10.5, 2.5, 14, 5],
            'circle-color': '#ffffff',
            'circle-stroke-color': ['match', ['get', 'mode'], 'metro', '#168388', 'light_rail', '#BB2043', '#4a5754'],
            'circle-stroke-width': 1.5,
          },
        });
        if (m.getStyle().glyphs) {
          m.addLayer({
            id: 'net-station-names', type: 'symbol', source: 'network', filter: others, minzoom: 13,
            layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'] },
            paint: { 'text-color': '#4a5754', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
          });
        }

        // All train and metro stations: dots in their main line colour; featured ones larger.
        m.addSource('stations', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'stations-dot', type: 'circle', source: 'stations',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, ['case', ['get', 'featured'], 4, 2.5], 13, ['case', ['get', 'featured'], 8, 6]],
            'circle-color': '#ffffff',
            'circle-stroke-color': ['get', 'color'],
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 13, 3],
          },
        });
        if (m.getStyle().glyphs) {
          m.addLayer({
            id: 'stations-name', type: 'symbol', source: 'stations',
            filter: ['any', ['get', 'featured'], ['>=', ['zoom'], 12]],
            layout: {
              'text-field': ['get', 'name'], 'text-size': ['case', ['get', 'featured'], 12, 11], 'text-font': ['Noto Sans Bold'],
              'text-offset': [0.9, 0], 'text-anchor': 'left', 'text-optional': true,
            },
            paint: { 'text-color': '#24312e', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
          });
        }
        m.on('click', 'stations-dot', (e) => {
          const id = e.features?.[0]?.properties?.id;
          if (typeof id === 'string') latest.current.onSelect(id);
        });
        m.on('mouseenter', 'stations-dot', () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mousemove', 'stations-dot', (e) => {
          const md = metricData.current;
          if (!md || latest.current.layers.stationMetric === 'off') return;
          const p = e.features?.[0]?.properties as { name?: string; value?: number | null; display?: string | null } | undefined;
          if (!p?.name) return;
          const html = p.value == null
            ? `<strong>${esc(p.name)}</strong><br>No figure for this metric`
            : `<strong>${esc(p.name)}</strong><br>${esc(p.display ?? String(p.value))}`;
          popup.current?.setLngLat(e.lngLat).setHTML(html).addTo(m);
        });
        m.on('mouseleave', 'stations-dot', () => {
          if (latest.current.layers.stationMetric !== 'off') popup.current?.remove();
        });
        m.on('mouseleave', 'stations-dot', () => (m.getCanvas().style.cursor = ''));

        popup.current = new maplibre.Popup({ closeButton: false, closeOnClick: false, className: 'hex-popup', offset: 8 });
        m.on('mousemove', 'hex-line', (e) => {
          const p = e.features?.[0]?.properties as { sales?: number; median?: number | null } | undefined;
          if (!p) return;
          const type = latest.current.layers.hex === 'house' ? 'house' : 'unit';
          const html = p.median != null
            ? `<strong>${money(Number(p.median))}</strong> median ${type} price<br>${p.sales} sales, last 12 months`
            : `${p.sales} ${type} sales: too few to publish a median (minimum 10)`;
          popup.current?.setLngLat(e.lngLat).setHTML(html).addTo(m);
        });
        m.on('mouseleave', 'hex-line', () => popup.current?.remove());
        // Far out, roundels show names only (the KPI stays on the selected station).
        const zoomClass = () => el.current?.classList.toggle('is-far', m.getZoom() < 12.2);
        m.on('zoom', zoomClass);
        zoomClass();
        ready.current = true;
        apply();
      });
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      ready.current = false;
      markers.clear();
      fitted.current = false;
      hexLoaded.current = 'off';
      metricLoaded.current = 'off';
      metricData.current = null;
      boundsLoaded.current = false;
      landuseFor.current = null;
      sitesFor.current = null;
      samFor.current = null;
      baseLayers.current = [];
      for (const t of revealTimers.current) clearTimeout(t);
      revealTimers.current = [];
    };
  }, []);

  async function loadHex(mode: HexMode) {
    const m = map.current;
    if (!m) return;
    hexLoaded.current = mode;
    const src = m.getSource('hex') as GeoJSONSource | undefined;
    if (mode === 'off') {
      src?.setData({ type: 'FeatureCollection', features: [] });
      latest.current.onHexMeta(null);
      return;
    }
    const res = await fetch(`/api/v1/layers/sales-hex?type=${mode}`).catch(() => null);
    if (!res?.ok || hexLoaded.current !== mode) return;
    const fc = await res.json();
    const b: number[] = fc.meta?.breaks ?? [];
    if (b.length === 4 && b.every((x, i) => i === 0 || x > b[i - 1]!)) {
      m.setPaintProperty('hex-fill', 'fill-color', ['step', ['get', 'median'], HEX_COLOURS[0], b[0], HEX_COLOURS[1], b[1], HEX_COLOURS[2], b[2], HEX_COLOURS[3], b[3], HEX_COLOURS[4]]);
    }
    src?.setData(fc);
    latest.current.onHexMeta({ breaks: b, as_of: fc.meta?.as_of ?? null, demo_data: Boolean(fc.meta?.demo_data), source: fc.meta?.source ?? null, property_type: mode });
  }

  async function loadMetric(mode: StationMetricMode) {
    const m = map.current;
    if (!m) return;
    metricLoaded.current = mode;
    if (mode === 'off') {
      metricData.current = null;
      latest.current.onMetricMeta(null);
      apply();
      return;
    }
    const q = STATION_METRIC_QUERY[mode];
    const res = await fetch(`/api/v1/layers/station-metric?metric=${q.metric}&property_type=${q.property_type}&ring=0-800m`).catch(() => null);
    if (!res?.ok || metricLoaded.current !== mode) return;
    const fc = await res.json();
    const b: number[] = fc.breaks ?? [];
    const values = new Map<string, { value: number; display: string }>(
      ((fc.stations ?? []) as { id: string; value: number; display: string }[]).map((s) => [s.id, { value: s.value, display: s.display }]),
    );
    metricData.current = { mode, values, breaks: b };
    latest.current.onMetricMeta({ breaks: b, breakLabels: fc.break_labels ?? [], as_of: fc.as_of ?? null, unit: fc.unit ?? '', label: STATION_METRIC_LABEL[mode] });
    apply();
  }

  function clearReveal() {
    for (const t of revealTimers.current) clearTimeout(t);
    revealTimers.current = [];
  }

  /** Set every SAM class layer's opacity at once (slider moves, peek, reduced motion). */
  function setSamPaint(fill: number, instant: boolean) {
    const m = map.current;
    if (!m) return;
    for (const cls of SAM_CLASSES) {
      const f = `sam-fill-${cls}`, l = `sam-line-${cls}`;
      if (m.getLayer(f)) {
        m.setPaintProperty(f, 'fill-opacity-transition', { duration: instant ? 0 : 600, delay: 0 });
        m.setPaintProperty(f, 'fill-opacity', fill);
      }
      if (m.getLayer(l)) {
        m.setPaintProperty(l, 'line-opacity-transition', { duration: instant ? 0 : 600, delay: 0 });
        m.setPaintProperty(l, 'line-opacity', Math.min(1, fill + 0.35));
      }
    }
  }

  /** Fade the classes in one after another with a caption, unless reduced motion is set. */
  function revealSam(station: string) {
    clearReveal();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setSamPaint(latest.current.samPeek ? 0 : latest.current.layers.samOpacity, true);
      return;
    }
    const lead = 'Meta SAM 3.1 is segmenting NSW aerial imagery';
    SAM_CLASSES.forEach((cls, i) => {
      revealTimers.current.push(window.setTimeout(() => {
        const m = map.current;
        if (samFor.current !== station || !latest.current.layers.sam || !m) return;
        const t = latest.current.samPeek ? 0 : latest.current.layers.samOpacity;
        const f = `sam-fill-${cls}`, l = `sam-line-${cls}`;
        if (m.getLayer(f)) {
          m.setPaintProperty(f, 'fill-opacity-transition', { duration: 600, delay: 0 });
          m.setPaintProperty(f, 'fill-opacity', t);
        }
        if (m.getLayer(l)) {
          m.setPaintProperty(l, 'line-opacity-transition', { duration: 600, delay: 0 });
          m.setPaintProperty(l, 'line-opacity', Math.min(1, t + 0.35));
        }
        const parts = SAM_CLASSES.slice(0, i + 1).map((c) => SAM_CLASS_NAMES[c]);
        setSamCaption(`${lead}: ${parts.join('… ')}${i === SAM_CLASSES.length - 1 ? '' : '…'}`);
        if (i === SAM_CLASSES.length - 1) revealTimers.current.push(window.setTimeout(() => setSamCaption(null), 1800));
      }, i * 600));
    });
  }

  function apply() {
    const m = map.current;
    if (!m || !ready.current) return;
    const { stations: st, state: s, layers: ly, kpis: k } = latest.current;
    const hot = new Set([...(s.focus ? [s.focus] : []), ...(s.compare ?? []), ...s.highlight]);
    const ringIds = ly.rings ? (s.compare ?? (s.focus ? [s.focus] : [])) : [];
    (m.getSource('rings') as GeoJSONSource | undefined)?.setData(ringFeatures(st, ringIds, s.radius_m));
    for (const id of ['lines', 'lines-casing']) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', ly.lines ? 'visible' : 'none');
    if (ly.hex !== hexLoaded.current) void loadHex(ly.hex);
    if (ly.stationMetric !== metricLoaded.current) void loadMetric(ly.stationMetric);
    const luTarget = ly.landuse ? s.focus : null;
    if (luTarget !== landuseFor.current) {
      landuseFor.current = luTarget;
      const src = m.getSource('landuse') as GeoJSONSource | undefined;
      if (!luTarget) src?.setData({ type: 'FeatureCollection', features: [] });
      else {
        fetch(`/api/v1/layers/landuse?station=${luTarget}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((fc) => { if (fc && landuseFor.current === luTarget) src?.setData(fc); })
          .catch(() => null);
      }
    }
    const sitesTarget = ly.sites ? s.focus : null;
    if (sitesTarget !== sitesFor.current) {
      sitesFor.current = sitesTarget;
      const src = m.getSource('sites') as GeoJSONSource | undefined;
      if (!sitesTarget) src?.setData({ type: 'FeatureCollection', features: [] });
      else {
        fetch(`/api/v1/layers/sites?station=${sitesTarget}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((fc) => { if (fc && sitesFor.current === sitesTarget) src?.setData(fc); })
          .catch(() => null);
      }
    }
    // Aerial basemap: the photo underneath, street labels kept, everything else hidden.
    if (m.getLayer('aerial')) {
      m.setLayoutProperty('aerial', 'visibility', ly.aerial ? 'visible' : 'none');
      for (const b of baseLayers.current) {
        if (b.type === 'symbol' || !m.getLayer(b.id)) continue;
        m.setLayoutProperty(b.id, 'visibility', ly.aerial ? 'none' : 'visible');
      }
    }
    const samTarget = ly.sam ? s.focus : null;
    if (samTarget !== samFor.current) {
      samFor.current = samTarget;
      clearReveal();
      const src = m.getSource('sam') as GeoJSONSource | undefined;
      if (!samTarget) {
        src?.setData({ type: 'FeatureCollection', features: [] });
        latest.current.onSamMeta(null);
        setSamCaption(null);
      } else {
        setSamPaint(0, true);
        fetch(`/api/v1/layers/sam?station=${samTarget}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((fc) => {
            if (!fc || samFor.current !== samTarget || !latest.current.layers.sam) return;
            src?.setData(fc);
            latest.current.onSamMeta({ counts: fc.meta?.counts ?? {}, capture_date: fc.meta?.capture_date ?? null, count: fc.meta?.count ?? 0, source: fc.meta?.source ?? null });
            revealSam(samTarget);
          })
          .catch(() => null);
      }
    } else if (samTarget) {
      setSamPaint(latest.current.samPeek ? 0 : ly.samOpacity, true);
    }
    if (ly.bounds !== 'off' && !boundsLoaded.current) {
      boundsLoaded.current = true;
      (m.getSource('bounds') as GeoJSONSource | undefined)?.setData('/data/boundaries.geojson');
    }
    const kindFilter: FilterSpecification = ['==', ['get', 'kind'], ly.bounds === 'off' ? 'none' : ly.bounds];
    for (const id of ['bounds-line', 'bounds-name', 'bounds-hit']) if (m.getLayer(id)) m.setFilter(id, kindFilter);

    (m.getSource('stations') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: st.map((x) => ({
        type: 'Feature',
        properties: { id: x.id, name: x.name, featured: x.featured, color: LINE_COLOURS[x.corridor] ?? '#4a5754', value: metricData.current?.values.get(x.id)?.value ?? null, display: metricData.current?.values.get(x.id)?.display ?? null },
        geometry: { type: 'Point', coordinates: [x.lon, x.lat] },
      })),
    });

    // Station dots coloured by the selected metric; grey where there is no value.
    if (m.getLayer('stations-dot')) {
      const md = metricData.current;
      const b = md?.mode === ly.stationMetric ? md.breaks : [];
      if (md && ly.stationMetric !== 'off' && b.length === 4 && b.every((x, i) => i === 0 || x > b[i - 1]!)) {
        m.setPaintProperty('stations-dot', 'circle-color', ['case', ['==', ['get', 'value'], null], STATION_NO_VALUE,
          ['step', ['get', 'value'], HEX_COLOURS[0], b[0], HEX_COLOURS[1], b[1], HEX_COLOURS[2], b[2], HEX_COLOURS[3], b[3], HEX_COLOURS[4]]] as unknown as ExpressionSpecification);
      } else {
        m.setPaintProperty('stations-dot', 'circle-color', '#ffffff');
      }
    }

    // Selected stations: HTML roundels (independent of basemap fonts) with name and a KPI.
    const ml = lib.current;
    if (ml) {
      for (const [id, mk] of roundels.current) if (!hot.has(id)) { mk.remove(); roundels.current.delete(id); }
      for (const id of hot) {
        const x = st.find((y) => y.id === id);
        if (!x) continue;
        let mk = roundels.current.get(x.id);
        if (!mk) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'roundel is-hot';
          b.innerHTML = '<span class="roundel-dot" aria-hidden="true"></span><span class="roundel-text"><span class="roundel-name"></span><span class="roundel-kpi"></span></span>';
          b.querySelector('.roundel-name')!.textContent = x.name;
          b.addEventListener('click', () => latest.current.onSelect(x.id));
          mk = new ml.Marker({ element: b, anchor: 'left', offset: [-11, 0] }).setLngLat([x.lon, x.lat]).addTo(m);
          roundels.current.set(x.id, mk);
        }
        const node = mk.getElement();
        node.querySelector('.roundel-kpi')!.textContent = k[x.id] ?? '';
        node.setAttribute('aria-label', `${x.name}${k[x.id] ? `, ${k[x.id]}` : ''}`);
      }
    }
    if (!fitted.current && st.length) {
      fitted.current = true;
      // Open on the inner city and both featured corridors rather than the whole network.
      const f = st.filter((x) => x.featured);
      const lons = f.map((x) => x.lon), lats = f.map((x) => x.lat);
      if (f.length) m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: narrow() ? 30 : { top: 70, bottom: 40, left: 40, right: 60 }, duration: 0 });
    }
  }

  useEffect(() => {
    apply();
  }, [stations, state.focus, state.radius_m, state.compare, state.highlight, layers.lines, layers.rings, layers.hex, layers.bounds, layers.landuse, layers.stationMetric, layers.sites, layers.sam, layers.samOpacity, layers.aerial, samPeek, kpis]);

  useEffect(() => {
    const m = map.current;
    if (!m || state.flyNonce === 0) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pad = narrow() ? { top: 60, bottom: 30, left: 30, right: 30 } : { top: 70, bottom: 60, left: 60, right: 280 };
    if (state.compare) {
      const pts = state.compare.map((id) => stations.find((s) => s.id === id)).filter(Boolean) as StationDto[];
      if (pts.length === 2) {
        const d = 0.012;
        m.fitBounds(
          [[Math.min(pts[0]!.lon, pts[1]!.lon) - d, Math.min(pts[0]!.lat, pts[1]!.lat) - d], [Math.max(pts[0]!.lon, pts[1]!.lon) + d, Math.max(pts[0]!.lat, pts[1]!.lat) + d]],
          { padding: pad, duration: reduce ? 0 : 1800 },
        );
        return;
      }
    }
    const s = stations.find((x) => x.id === state.focus);
    if (s) m.flyTo({ center: [s.lon, s.lat], zoom: state.view === 'close' ? 14.6 : 13.6, padding: pad, duration: reduce ? 0 : 1800, essential: true });
  }, [state.flyNonce, state.compare, state.focus, state.view, stations]);

  return (
    <div ref={el} className="map-canvas" role="region" aria-label="Map of station precincts">
      {samCaption && <p className="sam-caption" aria-hidden="true"><span className="meta-dot" aria-hidden="true" />{samCaption}</p>}
    </div>
  );
}
