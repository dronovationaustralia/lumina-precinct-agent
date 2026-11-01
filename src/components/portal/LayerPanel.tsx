'use client';

/**
 * Map layers. Folds to a small "Layers" button (top right) so the map stays clear; the header
 * says how to fold and unfold it. "How to read the map" explains every symbol.
 */
import { useState } from 'react';

import { money } from '@/lib/format';
import { LAND_USE_CATEGORIES } from '@/lib/landuse';
import { LINE_COLOURS } from '@/lib/lines';
import { FEATURED_STATIONS } from '@/lib/stations';

import { MapGuide } from './MapGuide';
import { HEX_COLOURS, SAM_CLASSES, SAM_CLASS_PLURALS, SAM_COLOURS, SITE_COLOURS, type HexMeta, type LayerState, type MetricMeta, type SamMeta, type StationMetricMode } from './MapView';

const LINES = ['T1', 'T2', 'T3', 'T4', 'T8', 'T9', 'M1', 'L4'];
const FEATURED_NAMES = FEATURED_STATIONS.map((s) => s.name).join(', ');

export function LayerPanel({ layers, onChange, hexMeta, metricMeta, canLandUse, onLandUse, samMeta, samPeek, onSamPeek, focusName, samAvailable }: {
  layers: LayerState;
  onChange: (l: LayerState) => void;
  hexMeta: HexMeta | null;
  metricMeta: MetricMeta | null;
  canLandUse: boolean;
  onLandUse: () => void;
  samMeta: SamMeta | null;
  samPeek: boolean;
  onSamPeek: (v: boolean) => void;
  focusName: string | null;
  samAvailable: boolean;
}) {
  // null = not chosen yet: CSS shows the panel on desktop and only the button on phones.
  const [open, setOpen] = useState<boolean | null>(null);
  const [guide, setGuide] = useState(false);
  const on = [layers.aerial && 'aerial photo', layers.lines && 'lines', layers.hex !== 'off' && (layers.hex === 'unit' ? 'unit prices' : 'house prices'), layers.stationMetric !== 'off' && 'station colours', layers.bounds !== 'off' && `${layers.bounds}s`, layers.landuse && 'land use', layers.sites && 'sites', layers.sam && 'SAM 3.1'].filter(Boolean);
  const samTip = samAvailable ? undefined : `SAM 3.1 has segmented the featured stations so far: ${FEATURED_NAMES}.`;
  const auto = open === null ? ' is-auto' : '';
  const toggle = (
    <button type="button" className={`layers-toggle${auto}`} aria-expanded="false" onClick={() => setOpen(true)} title="Show the layers panel">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2 1.5 5.5 8 9l6.5-3.5L8 2Zm-6.5 6.5L8 12l6.5-3.5M1.5 11.5 8 15l6.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
      Layers{on.length ? ` · ${on.length} on` : ''}
    </button>
  );
  return (
    <>
      {open === false && toggle}
      {open === null && toggle}
      {open !== false && (
        <aside className={`layers${auto}`} aria-label="Map layers">
          <div className="layers-head">
            <h2>Layers</h2>
            <div className="layers-actions">
              <button type="button" className="hide-button" onClick={() => setOpen(false)} aria-expanded="true" title="Hide this panel. Click Layers (top right) to show it again.">
                Hide
                <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
              </button>
            </div>
          </div>
          <button type="button" className="guide-link" onClick={() => setGuide(true)}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M8 7.2V11M8 5v.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            How to read the map
          </button>

          <fieldset>
            <legend>Basemap</legend>
            <label className="layer-row">
              <input type="checkbox" checked={layers.aerial} onChange={(e) => onChange({ ...layers, aerial: e.target.checked })} />
              <span>Aerial photo (NSW)</span>
            </label>
            {layers.aerial && <p className="layer-hint">Imagery © Spatial Services NSW (CC BY 4.0).</p>}
          </fieldset>

          <fieldset>
            <legend>Transport</legend>
            <label className="layer-row">
              <input type="checkbox" checked={layers.lines} onChange={(e) => onChange({ ...layers, lines: e.target.checked })} />
              <span>Train, metro and light rail lines</span>
            </label>
            {layers.lines && (
              <div className="line-keys" aria-hidden="true">
                {LINES.map((l) => <span key={l} className="line-key" style={{ background: LINE_COLOURS[l] }}>{l}</span>)}
              </div>
            )}
            <label className="layer-row">
              <input type="checkbox" checked={layers.rings} onChange={(e) => onChange({ ...layers, rings: e.target.checked })} />
              <span>400 m and 800 m walking rings</span>
            </label>
          </fieldset>

          <fieldset>
            <legend>Median sale price (hexagons)</legend>
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
                  <span>under {money(hexMeta.breaks[0]!)}</span>
                  <span>{money(hexMeta.breaks[1]!)}</span>
                  <span>{money(hexMeta.breaks[2]!)}</span>
                  <span>over {money(hexMeta.breaks[3]!)}</span>
                </div>
                <p>
                  Each hexagon is about 520 m across. Its colour is the median {hexMeta.property_type} sale price inside it over the
                  12 months to {hexMeta.as_of ?? 'the latest data'}; darker is dearer. Hover for the price and number of sales.
                  Dashed outline: fewer than 10 sales, so no price is shown.{hexMeta.demo_data ? ' Demo data.' : ''}
                </p>
              </div>
            )}
          </fieldset>

          <fieldset>
            <legend>Colour stations by</legend>
            <select
              className="layer-select"
              aria-label="Colour stations by"
              value={layers.stationMetric}
              onChange={(e) => onChange({ ...layers, stationMetric: e.target.value as StationMetricMode })}
            >
              <option value="off">Off</option>
              <option value="unit_median">Unit median</option>
              <option value="unit_change">Unit price change 12 m</option>
              <option value="house_median">House median</option>
              <option value="trips">Station trips</option>
              <option value="trips_change">Trips change</option>
            </select>
            {layers.stationMetric !== 'off' && metricMeta && metricMeta.breaks.length === 4 && (
              <div className="hex-legend">
                <div className="ramp">{HEX_COLOURS.map((c) => <span key={c} style={{ background: c }} />)}</div>
                <div className="ramp-labels">
                  <span>under {metricMeta.breakLabels[0]}</span>
                  <span>{metricMeta.breakLabels[1]}</span>
                  <span>{metricMeta.breakLabels[2]}</span>
                  <span>over {metricMeta.breakLabels[3]}</span>
                </div>
                <p>
                  {metricMeta.label}, split into five equal-sized groups; darker is higher. Hover a
                  station for its figure. Grey: no figure{metricMeta.as_of ? ` (12 months to ${metricMeta.as_of})` : ''}.
                </p>
              </div>
            )}
          </fieldset>

          <fieldset>
            <legend>Boundaries</legend>
            <div className="seg seg-4" role="radiogroup" aria-label="Boundaries">
              {(['off', 'suburb', 'lga', 'postcode'] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={layers.bounds === m} className={layers.bounds === m ? 'is-on' : ''} onClick={() => onChange({ ...layers, bounds: m })}>
                  {m === 'off' ? 'Off' : m === 'suburb' ? 'Suburbs' : m === 'lga' ? 'Councils' : 'Postcodes'}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Opportunity sites <span className="meta-dot" aria-hidden="true" /> SAM 3.1</legend>
            <label className="layer-row">
              <input type="checkbox" checked={layers.sites} onChange={(e) => onChange({ ...layers, sites: e.target.checked })} />
              <span>Car parks and construction sites near the selected station</span>
            </label>
            {layers.sites && (
              <ul className="lu-keys">
                <li><span className="swatch" style={{ background: SITE_COLOURS.car_park }} />Car park</li>
                <li><span className="swatch" style={{ background: SITE_COLOURS.construction_site }} />Construction site</li>
              </ul>
            )}
          </fieldset>

          <fieldset>
            <legend>What SAM 3.1 sees <span className="meta-dot" aria-hidden="true" /></legend>
            <label className="layer-row" title={samTip}>
              <input type="checkbox" checked={layers.sam} disabled={!samAvailable} onChange={(e) => onChange({ ...layers, sam: e.target.checked })} />
              <span>Segmentation over the aerial photo{focusName ? ` near ${focusName}` : ''}</span>
            </label>
            {!samAvailable && <p className="layer-hint">Available for the 10 featured stations only.</p>}
            {layers.sam && !samMeta && <p className="layer-hint">Loading the segmentation…</p>}
            {layers.sam && samMeta && samMeta.count === 0 && <p className="layer-hint">No SAM data for this station yet.</p>}
            {layers.sam && samMeta && samMeta.count > 0 && (
              <>
                <ul className="lu-keys sam-keys">
                  {SAM_CLASSES.map((c) => (
                    <li key={c}><span className="swatch" style={{ background: SAM_COLOURS[c] }} />{(samMeta.counts[c] ?? 0).toLocaleString('en-AU')} {SAM_CLASS_PLURALS[c]}</li>
                  ))}
                </ul>
                {samMeta.capture_date && <p className="layer-hint">One aerial capture ({samMeta.capture_date}). Masks can overlap.</p>}
                <label className="layer-row sam-opacity">
                  <span>Masks opacity</span>
                  <input type="range" min={0.1} max={1} step={0.05} value={layers.samOpacity} onChange={(e) => onChange({ ...layers, samOpacity: Number(e.target.value) })} aria-label="Segmentation masks opacity" />
                </label>
                <button
                  type="button" className="layer-button sam-hold"
                  onPointerDown={() => onSamPeek(true)} onPointerUp={() => onSamPeek(false)} onPointerLeave={() => onSamPeek(false)} onPointerCancel={() => onSamPeek(false)}
                  onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') onSamPeek(true); }} onKeyUp={() => onSamPeek(false)} onBlur={() => onSamPeek(false)}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  {samPeek ? 'Showing the photo alone…' : 'Hold to see the photo alone'}
                </button>
              </>
            )}
          </fieldset>

          <fieldset>
            <legend>Land use (NSW, mapped 2017)</legend>
            <label className="layer-row">
              <input type="checkbox" checked={layers.landuse} onChange={(e) => onChange({ ...layers, landuse: e.target.checked })} />
              <span>Colour the 2 km around the selected station</span>
            </label>
            {layers.landuse && (
              <ul className="lu-keys">
                {Object.values(LAND_USE_CATEGORIES).slice(0, 8).map((c) => (
                  <li key={c.label}><span className="swatch" style={{ background: c.colour }} />{c.label}</li>
                ))}
              </ul>
            )}
            <button type="button" className="layer-button" disabled={!canLandUse} onClick={onLandUse}>
              {canLandUse ? 'Open the land-use breakdown' : 'Pick a station first'}
            </button>
          </fieldset>
        </aside>
      )}
      {guide && <MapGuide onClose={() => setGuide(false)} />}
    </>
  );
}
