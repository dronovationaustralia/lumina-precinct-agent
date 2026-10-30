'use client';

import { useState } from 'react';

import { HEX_COLOURS, type HexMeta, type LayerState } from './MapView';
import { money } from './StationStrip';

const LINES = [
  { key: 'T1', color: '#F99D1C' },
  { key: 'T2', color: '#0098CD' },
  { key: 'T9', color: '#D11F2F' },
  { key: 'M1', color: '#168388' },
  { key: 'L4', color: '#BB2043' },
];

export function LayerPanel({
  layers,
  onChange,
  hexMeta,
  canLandUse,
  onLandUse,
}: {
  layers: LayerState;
  onChange: (l: LayerState) => void;
  hexMeta: HexMeta | null;
  canLandUse: boolean;
  onLandUse: () => void;
}) {
  // null = not chosen yet: CSS shows the panel on desktop and only the button on phones.
  const [open, setOpen] = useState<boolean | null>(null);
  const auto = open === null ? ' is-auto' : '';
  const toggle = (
    <button type="button" className={`layers-toggle${auto}`} aria-expanded="false" onClick={() => setOpen(true)}>
      Layers{layers.hex !== 'off' ? ` · ${layers.hex === 'unit' ? 'units' : 'houses'}` : ''}
    </button>
  );
  if (open === false) return toggle;
  return (
    <>
    {open === null && toggle}
    <aside className={`layers${auto}`} aria-label="Map layers">
      <div className="layers-head">
        <h2>Layers</h2>
        <button type="button" className="icon-button" aria-label="Hide layers" aria-expanded="true" onClick={() => setOpen(false)}>×</button>
      </div>
      <fieldset>
        <legend>Transport</legend>
        <label className="layer-row">
          <input type="checkbox" checked={layers.lines} onChange={(e) => onChange({ ...layers, lines: e.target.checked })} />
          <span>Train, metro and light rail</span>
        </label>
        {layers.lines && (
          <div className="line-keys" aria-hidden="true">
            {LINES.map((l) => <span key={l.key} className="line-key" style={{ background: l.color }}>{l.key}</span>)}
          </div>
        )}
        <label className="layer-row">
          <input type="checkbox" checked={layers.rings} onChange={(e) => onChange({ ...layers, rings: e.target.checked })} />
          <span>400 m and 800 m rings</span>
        </label>
      </fieldset>
      <fieldset>
        <legend>Market: median sale price</legend>
        <div className="seg" role="radiogroup" aria-label="Sales hexagons">
          {(['off', 'unit', 'house'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={layers.hex === m} className={layers.hex === m ? 'is-on' : ''} onClick={() => onChange({ ...layers, hex: m })}>
              {m === 'off' ? 'Off' : m === 'unit' ? 'Units' : 'Houses'}
            </button>
          ))}
        </div>
        {layers.hex !== 'off' && hexMeta && hexMeta.breaks.length === 4 && (
          <div className="hex-legend">
            <div className="ramp">{HEX_COLOURS.map((c) => <span key={c} style={{ background: c }} />)}</div>
            <div className="ramp-labels">
              <span>{money(hexMeta.breaks[0]!)}</span>
              <span>{money(hexMeta.breaks[1]!)}</span>
              <span>{money(hexMeta.breaks[2]!)}</span>
              <span>{money(hexMeta.breaks[3]!)}</span>
            </div>
            <p>Last 12 months{hexMeta.as_of ? ` to ${hexMeta.as_of}` : ''}. Dashed: fewer than 10 sales.{hexMeta.demo_data ? ' Demo data.' : ''}</p>
          </div>
        )}
      </fieldset>
      <fieldset>
        <legend>Boundaries</legend>
        <div className="seg seg-4" role="radiogroup" aria-label="Boundaries">
          {(['off', 'suburb', 'lga', 'postcode'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={layers.bounds === m} className={layers.bounds === m ? 'is-on' : ''} onClick={() => onChange({ ...layers, bounds: m })}>
              {m === 'off' ? 'Off' : m === 'suburb' ? 'Suburbs' : m === 'lga' ? 'LGAs' : 'Postcodes'}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Land use</legend>
        <button type="button" className="layer-button" disabled={!canLandUse} onClick={onLandUse}>
          {canLandUse ? 'Show cover by ring' : 'Pick a station first'}
        </button>
      </fieldset>
    </aside>
    </>
  );
}
