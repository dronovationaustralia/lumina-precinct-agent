'use client';

/**
 * MapLibre map that renders the state produced by map actions: focus station, radius ring,
 * compared pair and highlighted stations. All map behaviour is driven from props so the
 * same actions can run in the Quest app.
 */
import { useEffect, useRef } from 'react';
import type { GeoJSONSource, Map as MlMap, Marker } from 'maplibre-gl';

import type { StationDto } from './api';

export type MapState = {
  focus: string | null;
  radius_m: number;
  compare: [string, string] | null;
  highlight: string[];
  view: 'overview' | 'close';
  /** Increments on every fly so the same target can be flown to again. */
  flyNonce: number;
};

const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE ?? 'https://tiles.openfreemap.org/styles/positron';
const SYDNEY: [number, number] = [151.1, -33.83];
/** Used when the basemap cannot be reached: stations and rings still render on a plain ground. */
const FALLBACK_STYLE = { version: 8 as const, sources: {}, layers: [{ id: 'ground', type: 'background' as const, paint: { 'background-color': '#e6ebe6' } }] };

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

/** Leave room for the land-use panel on wide screens. */
function sidePadding() {
  const wide = window.matchMedia('(min-width: 861px)').matches;
  return wide ? { top: 70, bottom: 70, left: 70, right: 380 } : 40;
}

function ringFeatures(stations: StationDto[], ids: string[], radius: number) {
  return {
    type: 'FeatureCollection' as const,
    features: ids.flatMap((id) => {
      const s = stations.find((x) => x.id === id);
      return s ? [{ type: 'Feature' as const, properties: { id }, geometry: { type: 'Polygon' as const, coordinates: [circle(s.lon, s.lat, radius)] } }] : [];
    }),
  };
}

export function MapView({ stations, state, onSelect }: { stations: StationDto[]; state: MapState; onSelect: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const lib = useRef<typeof import('maplibre-gl') | null>(null);
  const labels = useRef(new Map<string, Marker>());
  const fitted = useRef(false);
  const latest = useRef({ stations, state, onSelect });
  latest.current = { stations, state, onSelect };

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    const labelMarkers = labels.current;
    (async () => {
      const maplibre = await import('maplibre-gl');
      if (cancelled || !el.current) return;
      // The worker is copied into public/ (scripts/copy-map-worker.mjs) because bundling moves the main module.
      maplibre.setWorkerUrl('/maplibre-gl-worker.mjs');
      lib.current = maplibre;
      const m = new maplibre.Map({
        container: el.current,
        style: STYLE_URL,
        center: SYDNEY,
        zoom: 10.6,
        attributionControl: { compact: true },
      });
      m.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-left');
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
        const ink = css.getPropertyValue('--ink').trim() || '#1e2d2b';
        m.addSource('rings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({ id: 'rings-fill', type: 'fill', source: 'rings', paint: { 'fill-color': harbour, 'fill-opacity': 0.08 } });
        m.addLayer({ id: 'rings-line', type: 'line', source: 'rings', paint: { 'line-color': harbour, 'line-width': 1.5, 'line-dasharray': [2, 2] } });
        m.addSource('stations', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'stations-halo', type: 'circle', source: 'stations', filter: ['==', ['get', 'hot'], true],
          paint: { 'circle-radius': 16, 'circle-color': harbour, 'circle-opacity': 0.18 },
        });
        m.addLayer({
          id: 'stations-dot', type: 'circle', source: 'stations',
          paint: {
            'circle-radius': ['case', ['get', 'hot'], 7, 5],
            'circle-color': ['case', ['get', 'hot'], harbour, '#ffffff'],
            'circle-stroke-color': ['case', ['get', 'hot'], '#ffffff', ink],
            'circle-stroke-width': 2,
          },
        });
        m.on('click', 'stations-dot', (e: { features?: { properties?: Record<string, unknown> }[] }) => {
          const id = e.features?.[0]?.properties?.id;
          if (typeof id === 'string') latest.current.onSelect(id);
        });
        m.on('mouseenter', 'stations-dot', () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', 'stations-dot', () => (m.getCanvas().style.cursor = ''));
        ready.current = true;
        apply();
      });
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      ready.current = false;
      labelMarkers.clear();
      fitted.current = false;
    };
  }, []);

  function apply() {
    const m = map.current;
    if (!m || !ready.current) return;
    const { stations: st, state: s } = latest.current;
    const hot = new Set([...(s.focus ? [s.focus] : []), ...(s.compare ?? []), ...s.highlight]);
    (m.getSource('stations') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: st.map((x) => ({ type: 'Feature', properties: { id: x.id, name: x.name, hot: hot.has(x.id) }, geometry: { type: 'Point', coordinates: [x.lon, x.lat] } })),
    });
    const ringIds = s.compare ?? (s.focus ? [s.focus] : []);
    (m.getSource('rings') as GeoJSONSource | undefined)?.setData(ringFeatures(st, ringIds, s.radius_m));

    // HTML labels: they do not depend on the basemap's fonts, so they show even on the fallback ground.
    const ml = lib.current;
    if (ml) {
      for (const x of st) {
        let mk = labels.current.get(x.id);
        if (!mk) {
          const elx = document.createElement('button');
          elx.type = 'button';
          elx.className = 'station-label';
          elx.textContent = x.name;
          elx.addEventListener('click', () => latest.current.onSelect(x.id));
          mk = new ml.Marker({ element: elx, anchor: 'top', offset: [0, 9] }).setLngLat([x.lon, x.lat]).addTo(m);
          labels.current.set(x.id, mk);
        }
        mk.getElement().classList.toggle('is-hot', hot.has(x.id));
      }
    }
    if (!fitted.current && st.length) {
      fitted.current = true;
      const lons = st.map((x) => x.lon), lats = st.map((x) => x.lat);
      m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 48, duration: 0 });
    }
  }

  // Re-apply data on every state change; fly only when asked.
  useEffect(() => {
    apply();
  }, [stations, state.focus, state.radius_m, state.compare, state.highlight]);

  useEffect(() => {
    const m = map.current;
    if (!m || state.flyNonce === 0) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (state.compare) {
      const pts = state.compare.map((id) => stations.find((s) => s.id === id)).filter(Boolean) as StationDto[];
      if (pts.length === 2) {
        const pad = 0.02;
        m.fitBounds(
          [[Math.min(pts[0]!.lon, pts[1]!.lon) - pad, Math.min(pts[0]!.lat, pts[1]!.lat) - pad], [Math.max(pts[0]!.lon, pts[1]!.lon) + pad, Math.max(pts[0]!.lat, pts[1]!.lat) + pad]],
          { padding: sidePadding(), duration: reduce ? 0 : 1800 },
        );
        return;
      }
    }
    const s = stations.find((x) => x.id === state.focus);
    if (s) m.flyTo({ center: [s.lon, s.lat], zoom: state.view === 'close' ? 14.6 : 12.4, duration: reduce ? 0 : 1800, essential: true });
  }, [state.flyNonce, state.compare, state.focus, state.view, stations]);

  return <div ref={el} className="map-canvas" role="region" aria-label="Map of station precincts" />;
}
