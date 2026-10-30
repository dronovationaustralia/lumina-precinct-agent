'use client';

/**
 * The line strip: both corridors drawn as T1 line diagrams, one roundel per station with its
 * 800 m unit median. It is the station switcher.
 */
import type { StationDto, StationSummary } from './api';

const T1 = '#F99D1C';
const CORRIDORS: { id: string; label: string; order: string[] }[] = [
  { id: 'parramatta', label: 'T1 Western', order: ['westmead', 'parramatta', 'harris_park', 'granville', 'auburn'] },
  { id: 'north_shore', label: 'T1 North Shore', order: ['wynyard', 'milsons_point', 'north_sydney', 'st_leonards', 'chatswood'] },
];

export const money = (v: number) => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}m` : `$${Math.round(v / 1000)}k`);

export function StationStrip({
  stations,
  summary,
  active,
  onSelect,
}: {
  stations: StationDto[];
  summary: StationSummary[];
  active: string[];
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="strip" aria-label="Stations">
      {CORRIDORS.map((c) => (
        <div key={c.id} className="strip-line">
          <span className="strip-badge" style={{ background: T1 }}>T1</span>
          <span className="strip-label">{c.label.replace('T1 ', '')}</span>
          <ol className="strip-stops" style={{ ['--line' as string]: T1 }}>
            {c.order.map((id) => {
              const s = stations.find((x) => x.id === id);
              if (!s) return null;
              const k = summary.find((x) => x.id === id);
              const on = active.includes(id);
              return (
                <li key={id}>
                  <button type="button" className={`stop${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => onSelect(id)}>
                    <span className="stop-dot" aria-hidden="true" />
                    <span className="stop-name">{s.name}</span>
                    <span className="stop-kpi">{k?.unit_median_800m ? `${money(k.unit_median_800m)} unit` : ' '}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </nav>
  );
}
