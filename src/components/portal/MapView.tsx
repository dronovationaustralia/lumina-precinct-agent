'use client';

/**
 * MapLibre map that renders the state produced by map actions: focus station, radius ring,
 * compared pair, highlighted stations and visible layers. All map behaviour is driven from
 * props so the same actions can run in the Quest app.
 *
 * Layers, bottom to top: basemap, sales hexagons, rail lines (official line colours), rings,
 * other rail stations, then the ten precinct stations as HTML roundels with a KPI.
 */
import { useEffect, useRef } from 'react';
import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, Map as MlMap, Marker, Popup } from 'maplibre-gl';

import type { StationDto } from './api';

export type HexMode = 'off' | 'unit' | 'house';
export type LayerState = { lines: boolean; rings: boolean; hex: HexMode };

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

const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE ?? 'https://tiles.openfreemap.org/styles/positron';
const SYDNEY: [number, number] = [151.1, -33.83];
/** Used when the basemap cannot be reached: stations, lines and rings still render on a plain ground. */
const FALLBACK_STYLE = { version: 8 as const, sources: {}, layers: [{ id: 'ground', type: 'background' as const, paint: { 'background-color': '#e6ebe6' } }] };
/** Stations whose label sits to the left of the dot, so neighbours a kilometre apart do not collide. */
const LABEL_LEFT = new Set(['westmead', 'harris_park', 'milsons_point']);
export const HEX_COLOURS = ['#efe9da', '#cddbe6', '#93b6d8', '#5487c2', '#1f5fad'];

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

export function MapView({
  stations,
  state,
  layers,
  kpis,
  onSelect,
  onHexMeta,
}: {
  stations: StationDto[];
  state: MapState;
  layers: LayerState;
  kpis: Record<string, string>;
  onSelect: (id: string) => void;
  onHexMeta: (meta: HexMeta | null) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const lib = useRef<typeof import('maplibre-gl') | null>(null);
  const roundels = useRef(new Map<string, Marker>());
  const popup = useRef<Popup | null>(null);
  const fitted = useRef(false);
  const hexLoaded = useRef<HexMode>('off');
  const latest = useRef({ stations, state, layers, kpis, onSelect, onHexMeta });
  latest.current = { stations, state, layers, kpis, onSelect, onHexMeta };

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
      const m = new maplibre.Map({ container: el.current, style: STYLE_URL, center: SYDNEY, zoom: 10.6, attributionControl: { compact: true } });
      m.addControl(new maplibre.NavigationControl({ showCompass: false }), 'bottom-right');
      map.current = m;
      let fellBack = false;
      m.on('error', () => {
        if (!fellBack && !ready.current && !m.isStyleLoaded()) {
          fellBack = true;
          m.setStyle(FALLBACK_STYLE);
        }
      });
      m.on('load', () => {
        const css = getComputedStyle(document.documentElement);
        const harbour = css.getPropertyValue('--harbour').trim() || '#1f5fad';
        // Put data under the basemap's labels so street and suburb names stay readable.
        const firstSymbol = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;

        m.addSource('hex', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'hex-fill', type: 'fill', source: 'hex', filter: ['!=', ['get', 'median'], null],
          paint: { 'fill-color': '#cddbe6', 'fill-opacity': 0.62 },
        }, firstSymbol);
        m.addLayer({
          id: 'hex-line', type: 'line', source: 'hex',
          paint: { 'line-color': '#ffffff', 'line-width': ['case', ['==', ['get', 'median'], null], 0.6, 1], 'line-opacity': 0.9 },
        }, firstSymbol);
        m.addLayer({
          id: 'hex-suppressed', type: 'line', source: 'hex', filter: ['==', ['get', 'median'], null],
          paint: { 'line-color': '#8a948f', 'line-width': 0.8, 'line-dasharray': [2, 2], 'line-opacity': 0.6 },
        }, firstSymbol);

        m.addSource('network', { type: 'geojson', data: '/data/network.geojson' });
        const lineWidth: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 9, ['case', ['==', ['get', 'mode'], 'light_rail'], 1, 1.8], 14, ['case', ['==', ['get', 'mode'], 'light_rail'], 3, 5]];
        // Where lines share track, the precinct lines (T1, then Metro and L4) draw on top.
        const sortKey: ExpressionSpecification = ['match', ['get', 'line'], 'T1', 10, 'M1', 9, 'L4', 8, 'T9', 7, 'T2', 3, 'T3', 3, 1];
        m.addLayer({
          id: 'lines-casing', type: 'line', source: 'network', filter: ['==', ['get', 'kind'], 'line'],
          layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': sortKey },
          paint: { 'line-color': '#ffffff', 'line-width': ['+', lineWidth, 2.5], 'line-opacity': 0.9 },
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
        const ours = latest.current.stations.map((s) => s.name);
        const others: FilterSpecification = ['all', ['==', ['get', 'kind'], 'station'], ['!', ['in', ['get', 'name'], ['literal', ours]]]];
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

  function apply() {
    const m = map.current;
    if (!m || !ready.current) return;
    const { stations: st, state: s, layers: ly, kpis: k } = latest.current;
    const hot = new Set([...(s.focus ? [s.focus] : []), ...(s.compare ?? []), ...s.highlight]);
    const ringIds = ly.rings ? (s.compare ?? (s.focus ? [s.focus] : [])) : [];
    (m.getSource('rings') as GeoJSONSource | undefined)?.setData(ringFeatures(st, ringIds, s.radius_m));
    for (const id of ['lines', 'lines-casing']) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', ly.lines ? 'visible' : 'none');
    if (ly.hex !== hexLoaded.current) void loadHex(ly.hex);

    // Precinct stations: HTML roundels (independent of basemap fonts) with name and a KPI.
    const ml = lib.current;
    if (ml) {
      for (const x of st) {
        let mk = roundels.current.get(x.id);
        if (!mk) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = LABEL_LEFT.has(x.id) ? 'roundel is-left' : 'roundel';
          b.innerHTML = '<span class="roundel-dot" aria-hidden="true"></span><span class="roundel-text"><span class="roundel-name"></span><span class="roundel-kpi"></span></span>';
          b.querySelector('.roundel-name')!.textContent = x.name;
          b.addEventListener('click', () => latest.current.onSelect(x.id));
          const left = LABEL_LEFT.has(x.id);
          mk = new ml.Marker({ element: b, anchor: left ? 'right' : 'left', offset: [left ? 9 : -9, 0] }).setLngLat([x.lon, x.lat]).addTo(m);
          roundels.current.set(x.id, mk);
        }
        const node = mk.getElement();
        node.classList.toggle('is-hot', hot.has(x.id));
        node.querySelector('.roundel-kpi')!.textContent = k[x.id] ?? '';
        node.setAttribute('aria-label', `${x.name}${k[x.id] ? `, ${k[x.id]}` : ''}`);
      }
    }
    if (!fitted.current && st.length) {
      fitted.current = true;
      const lons = st.map((x) => x.lon), lats = st.map((x) => x.lat);
      m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: narrow() ? { top: 60, bottom: 20, left: 70, right: 90 } : { top: 80, bottom: 50, left: 130, right: 300 }, duration: 0 });
    }
  }

  useEffect(() => {
    apply();
  }, [stations, state.focus, state.radius_m, state.compare, state.highlight, layers.lines, layers.rings, layers.hex, kpis]);

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

  return <div ref={el} className="map-canvas" role="region" aria-label="Map of station precincts" />;
}
