'use client';

/** Pick a guided corridor tour: two fixed tours or any train/metro line. */
import { useState } from 'react';

import { FIXED_TOURS, TOURABLE_LINES } from '@/lib/tours';

export function TourPicker({ onPick, onClose }: { onPick: (tourId: string) => void; onClose: () => void }) {
  const [line, setLine] = useState('T1');
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="tour-title">
        <header className="drawer-head">
          <div>
            <p className="kicker">Guided tour</p>
            <h2 id="tour-title">Tour a corridor</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <p className="drawer-lead">The map flies station by station, with a verified briefing at each stop. About a minute per tour.</p>
        <div className="tour-pick">
          {FIXED_TOURS.map((t) => (
            <button key={t.id} type="button" className="tour-option" onClick={() => onPick(t.id)}>
              <span className="tour-option-title">{t.title}</span>
              <span className="tour-option-sub">{t.stops.length} stops</span>
            </button>
          ))}
          <div className="tour-line-pick">
            <label>
              <span className="tour-option-title">A line of your choice</span>
              <select value={line} onChange={(e) => setLine(e.target.value)} aria-label="Line to tour">
                {TOURABLE_LINES.map((l) => (
                  <option key={l} value={l}>
                    {l === 'M1' ? 'M1 Metro' : `${l} Sydney Trains`}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="ask-button" onClick={() => onPick(`line-${line}`)}>
              Start tour
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
