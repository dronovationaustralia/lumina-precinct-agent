'use client';

/** "How to read the map": every symbol on the map, in plain words. */
import { LAND_USE_CATEGORIES } from '@/lib/landuse';
import { LINE_COLOURS } from '@/lib/lines';

import { HEX_COLOURS, SITE_COLOURS } from './MapView';

export function MapGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer guide" role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <header className="drawer-head">
          <div>
            <p className="kicker">Map guide</p>
            <h2 id="guide-title">How to read the map</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </header>

        <dl className="guide-list">
          <dt><span className="g-dot" style={{ borderColor: LINE_COLOURS.T1 }} /> Stations</dt>
          <dd>Every Sydney train and metro station, ringed in its main line&apos;s colour. Click one (or search at the top) to select it.</dd>

          <dt><span className="g-roundel" /> Selected station</dt>
          <dd>The blue label shows its name and the median unit price within 800 m. The answers and the snapshot refer to it.</dd>

          <dt><span className="g-ring" /> Walking rings</dt>
          <dd>Dashed circles at 400 m (about a 5 minute walk; the NSW Transport Oriented Development distance) and 800 m (about 10 minutes; the usual station catchment). Figures &quot;within 800 m&quot; count everything inside the outer ring.</dd>

          <dt><span className="g-lines"><i style={{ background: LINE_COLOURS.T1 }} /><i style={{ background: LINE_COLOURS.M1 }} /><i style={{ background: LINE_COLOURS.L4 }} /></span> Lines</dt>
          <dd>Train, metro and light rail lines in their official colours (T1 orange, M1 teal, light rail red).</dd>

          <dt><span className="g-ramp">{HEX_COLOURS.map((c) => <i key={c} style={{ background: c }} />)}</span> Price hexagons</dt>
          <dd>
            The area is cut into hexagons about 520 m across. Each is coloured by the median price of the units (or houses) sold
            inside it over the last 12 months: pale is cheaper, dark blue is dearer, split into five equal-sized groups. Hover a
            hexagon for its median and the number of sales. A dashed hexagon had fewer than 10 sales, so no price is shown: too
            few sales make a misleading median and could identify a property.
          </dd>

          <dt><span className="g-ramp">{HEX_COLOURS.map((c) => <i key={c} style={{ background: c }} />)}</span> Station colours</dt>
          <dd>
            &quot;Colour stations by&quot; fills every station dot by one figure: unit or house median price,
            unit price change, station trips or trips change. Stations are split into five equal-sized
            groups: pale is lower, dark blue is higher. Hover a dot for its figure. A grey dot has no
            figure (too few sales, or missing months). Asking a screening question, such as which
            stations had the strongest price growth, switches this on for that figure.
          </dd>

          <dt><span className="g-ramp">{Object.values(LAND_USE_CATEGORIES).slice(0, 5).map((c) => <i key={c.label} style={{ background: c.colour }} />)}</span> Land use</dt>
          <dd>
            What each parcel within 2 km of the selected station was used for, from the NSW Government&apos;s land-use map (mapped
            2013 to 2017): residential, commercial, public services, parks, industrial, roads and rail, land in transition and
            more. Hover a shape for its detailed class. &quot;Land in transition&quot; is land between uses, often a development site.
          </dd>

          <dt><span className="g-lines"><i style={{ background: SITE_COLOURS.car_park }} /><i style={{ background: SITE_COLOURS.construction_site }} /></span> Opportunity sites</dt>
          <dd>
            Car parks (blue) and construction sites (amber) found by SAM 3.1 on one aerial capture
            within 800 m of the selected station. Hover one for its area and distance from the
            station. Candidates for investigation only, not zoning or ownership advice.
          </dd>

          <dt><span className="g-bounds" /> Boundaries</dt>
          <dd>Suburb, council (LGA) or postcode outlines from the ABS, to relate a station to the areas people know.</dd>
        </dl>

        <h3>Tips</h3>
        <ul className="guide-tips">
          <li>Hover any figure in an answer to highlight its station on the map.</li>
          <li>Use <strong>Answers / Split / Map</strong> at the top to give the map the whole screen.</li>
          <li>Click <strong>Hide</strong> on a panel to fold it away; click its button to bring it back.</li>
        </ul>
      </aside>
    </div>
  );
}
