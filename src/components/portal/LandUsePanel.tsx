'use client';

/**
 * Land use around a station: the official NSW land-use mix per ring as stacked bars (sums to 100%),
 * then aerial land cover (SAM 3.1 classes; labelled demo until the batch has run).
 */
import { useState } from 'react';

import { LAND_USE_CATEGORIES, type LandUseCategory } from '@/lib/landuse';
import { FEATURED_STATIONS } from '@/lib/stations';

import type { LandUseDto } from './api';

const RING_NAMES: Record<string, string> = { '0-400m': 'Within 400 m', '0-800m': 'Within 800 m', '800m-2km': '800 m to 2 km' };
const COVER_NAMES: Record<string, string> = { building: 'Building', tree_canopy: 'Tree canopy', car_park: 'Car park', construction_site: 'Construction site' };
const ORDER = Object.keys(LAND_USE_CATEGORIES) as LandUseCategory[];

export function LandUsePanel({ data, stationName, onClose }: { data: LandUseDto; stationName: string; onClose: () => void }) {
  const mix = data.mix ?? {};
  const rings = ['0-400m', '0-800m', '800m-2km'].filter((r) => mix[r]);
  const present = ORDER.filter((c) => rings.some((r) => (mix[r]?.[c] ?? 0) >= 0.5));
  const [min, setMin] = useState(false);
  if (min) {
    return (
      <button type="button" className="landuse-pill" onClick={() => setMin(false)} title="Show the land-use breakdown">
        <span className="mix-bar mini">{ORDER.filter((c) => (mix['0-800m']?.[c] ?? 0) > 0).map((c) => <span key={c} style={{ width: `${mix['0-800m']![c]}%`, background: LAND_USE_CATEGORIES[c].colour }} />)}</span>
        Land use · {stationName}
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="m3 7.5 3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
    );
  }
  return (
    <aside className="landuse" aria-label={`Land use near ${stationName}`}>
      <div className="landuse-head">
        <div>
          <p className="kicker">Land use</p>
          <h2>{stationName}</h2>
        </div>
        <div className="layers-actions">
          <button type="button" className="hide-button" onClick={() => setMin(true)} title="Minimise to a small bar; click it to open again">
            Minimise
            <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
          </button>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close land use" title="Close">×</button>
        </div>
      </div>
      <p className="landuse-how">Each bar is one ring around the station, split by what the land is used for. Hover a colour on the map for detail.</p>

      {rings.length > 0 ? (
        <>
          {rings.map((r) => (
            <div key={r} className="mix-ring">
              <h3>{RING_NAMES[r]}</h3>
              <div className="mix-bar" role="img" aria-label={`${RING_NAMES[r]}: ${ORDER.filter((c) => mix[r]?.[c]).map((c) => `${LAND_USE_CATEGORIES[c].label} ${mix[r]![c]!.toFixed(0)}%`).join(', ')}`}>
                {ORDER.filter((c) => (mix[r]?.[c] ?? 0) > 0).map((c) => (
                  <span key={c} style={{ width: `${mix[r]![c]}%`, background: LAND_USE_CATEGORIES[c].colour }} title={`${LAND_USE_CATEGORIES[c].label}: ${mix[r]![c]!.toFixed(1)}%`} />
                ))}
              </div>
            </div>
          ))}
          <ul className="mix-legend">
            {present.map((c) => (
              <li key={c}>
                <span className="swatch" style={{ background: LAND_USE_CATEGORIES[c].colour }} />
                <span className="mix-name">{LAND_USE_CATEGORIES[c].label}</span>
                {rings.map((r) => <span key={r} className="mix-val">{(mix[r]?.[c] ?? 0).toFixed(0)}%</span>)}
              </li>
            ))}
          </ul>
          <p className="mix-cols"><span /> {rings.map((r) => <span key={r}>{RING_NAMES[r]?.replace('Within ', '≤ ').replace('800 m to 2 km', '0.8–2 km')}</span>)}</p>
          <p className="landuse-foot">Share of each ring&apos;s area. NSW Landuse 2017 v1.5 (mapped 2013 to 2017), CC BY 4.0. Colours match the map.</p>
        </>
      ) : (
        <p className="landuse-foot">Official land use is not loaded yet: run <code>npm run ingest:landuse</code>.</p>
      )}

      <h3 className="cover-head">Aerial land cover{data.demo_data ? <span className="badge badge-warn">Demo until SAM 3.1 run</span> : <span className="meta-chip">SAM 3.1</span>}</h3>
      {!data.rings['0-800m'] && (
        <p className="landuse-foot">
          Not measured here yet. Meta SAM 3.1 has segmented the aerial imagery around the 10 featured stations so far
          ({FEATURED_STATIONS.map((s) => s.name).join(', ')}). The same batch runs on any station or on your own drone imagery.
        </p>
      )}
      {Object.entries(data.rings).filter(([r]) => r === '0-800m').map(([ring, classes]) => (
        <div key={ring} className="landuse-ring">
          {Object.entries(classes).sort((a, b) => b[1] - a[1]).map(([cls, pct]) => (
            <div key={cls} className={`bar bar-${cls}`}>
              <span className="bar-name">{COVER_NAMES[cls] ?? cls}</span>
              <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.min(100, pct)}%` }} /></span>
              <span className="bar-value">{pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      ))}
      {data.rings['0-800m'] && <p className="landuse-foot">Within 800 m, one capture date{data.capture_date ? ` (${data.capture_date})` : ''}. Classes can overlap.</p>}
    </aside>
  );
}
