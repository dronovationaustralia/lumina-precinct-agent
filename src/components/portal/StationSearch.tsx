'use client';

/** Station picker for all 185 stations: type to filter, arrows to move, Enter to choose. */
import { useId, useMemo, useRef, useState } from 'react';

import type { StationDto } from './api';
import { LineBadges } from './LineBadges';

export function StationSearch({ stations, value, onChange }: { stations: StationDto[]; value: string | null; onChange: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const current = stations.find((s) => s.id === value);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t
      ? stations.filter((s) => s.name.toLowerCase().includes(t) || s.lines.some((l) => l.toLowerCase() === t))
          .sort((a, b) => Number(b.name.toLowerCase().startsWith(t)) - Number(a.name.toLowerCase().startsWith(t)) || a.name.localeCompare(b.name))
      : [...stations.filter((s) => s.featured), ...stations.filter((s) => !s.featured)];
    return list.slice(0, 40);
  }, [q, stations]);

  const choose = (id: string) => {
    onChange(id);
    setQ('');
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className="station-search">
      <label htmlFor={`${listId}-input`} className="sr-only">Station</label>
      <svg className="search-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="m10.5 10.5 3.5 3.5" stroke="currentColor" strokeWidth="1.6" /></svg>
      <input
        ref={input}
        id={`${listId}-input`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${listId}-${results[active].id}` : undefined}
        placeholder={current ? current.name : `Find a station (${stations.length || 185})`}
        value={q}
        onFocus={() => { setOpen(true); setActive(0); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter' && results[active]) { e.preventDefault(); choose(results[active].id); }
          else if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
        }}
      />
      {current && !q && <span className="search-current" aria-hidden="true"><LineBadges lines={current.lines} max={3} /></span>}
      {open && results.length > 0 && (
        <ul id={listId} role="listbox" className="search-list">
          {!q && <li className="search-group" role="presentation">Featured precincts, then A to Z</li>}
          {results.map((s, i) => (
            <li key={s.id} id={`${listId}-${s.id}`} role="option" aria-selected={i === active} className={`search-item${i === active ? ' is-active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); choose(s.id); }} onMouseEnter={() => setActive(i)}>
              <span className="search-name">{s.name}</span>
              <LineBadges lines={s.lines} max={4} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
