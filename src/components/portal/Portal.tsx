'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { MapAction } from '@/lib/contracts';

import { AnswerView, type Turn } from './AnswerView';
import { ask, fetchLandUse, fetchStations, fetchSummary, type LandUseDto, type StationDto, type StationSummary } from './api';
import { LayerPanel } from './LayerPanel';
import { MapView, type HexMeta, type LayerState, type MapState } from './MapView';
import { money, StationStrip } from './StationStrip';
import 'maplibre-gl/dist/maplibre-gl.css';

const SUGGESTIONS: { who: string; questions: string[] }[] = [
  {
    who: 'Development and site acquisition',
    questions: [
      'Compare Chatswood and St Leonards on unit price momentum and car-park cover',
      'How do unit prices within 800 m of Parramatta compare with 2 to 5 km away?',
    ],
  },
  { who: 'Lending and valuation', questions: ['How many unit sales support the median near Granville, and how has it moved?'] },
  { who: 'Planning', questions: ['Which of the 10 stations has the most tree canopy within 800 m?', 'How busy is North Sydney station compared with a year earlier?'] },
];

const CLASS_NAMES: Record<string, string> = { building: 'Building', tree_canopy: 'Tree canopy', car_park: 'Car park', construction_site: 'Construction site' };
const RING_NAMES: Record<string, string> = { '0-400m': 'Within 400 m', '0-800m': 'Within 800 m', '800m-2km': '800 m to 2 km' };

export function Portal() {
  const [stations, setStations] = useState<StationDto[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [landUse, setLandUse] = useState<LandUseDto | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [health, setHealth] = useState<{ demo_data: boolean; provider: string; datasets?: { id: string; demo: boolean }[] } | null>(null);
  const [summary, setSummary] = useState<StationSummary[]>([]);
  const [layers, setLayers] = useState<LayerState>({ lines: true, rings: true, hex: 'off' });
  const [hexMeta, setHexMeta] = useState<HexMeta | null>(null);
  const [map, setMap] = useState<MapState>({ focus: null, radius_m: 800, compare: null, highlight: [], view: 'overview', flyNonce: 0 });
  const listRef = useRef<HTMLDivElement>(null);
  const stationsRef = useRef<StationDto[]>([]);
  stationsRef.current = stations;

  useEffect(() => {
    fetchStations().then(setStations).catch((e: Error) => setLoadError(e.message));
    fetch('/api/v1/health').then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
    fetchSummary().then((r) => setSummary(r.stations)).catch(() => setSummary([]));
  }, []);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [turns.length]);

  const resolve = (target: string) => stationsRef.current.find((s) => s.id === target || s.name.toLowerCase() === target.toLowerCase())?.id;

  const runActions = useCallback(async (actions: MapAction[]) => {
    setNote(null);
    let focus: string | null | undefined;
    // A compare action frames both stations itself, so a fly_to in the same answer must not cancel it.
    const comparing = actions.some((a) => a.type === 'compare');
    for (const a of actions) {
      if (a.type === 'fly_to' && comparing) continue;
      if (a.type === 'fly_to' && typeof a.target === 'string') {
        const id = resolve(a.target);
        if (id) {
          focus = id;
          setMap((m) => ({ ...m, focus: id, compare: null, view: a.view ?? 'close', flyNonce: m.flyNonce + 1 }));
        }
      } else if (a.type === 'set_radius') {
        setMap((m) => ({ ...m, radius_m: a.radius_m }));
      } else if (a.type === 'highlight' && a.kind === 'station') {
        setMap((m) => ({ ...m, highlight: a.ids ?? [] }));
      } else if (a.type === 'compare') {
        const ids = a.station_ids.map(resolve).filter(Boolean) as string[];
        if (ids.length === 2) {
          focus = ids[0];
          setMap((m) => ({ ...m, compare: [ids[0]!, ids[1]!], focus: ids[0]!, radius_m: a.radius_m ?? m.radius_m, flyNonce: m.flyNonce + 1 }));
        }
      } else if (a.type === 'show_layer') {
        if (a.layer === 'land_use' && a.visible !== false) {
          const id = focus ?? null;
          if (id) setLandUse(await fetchLandUse(id).catch(() => null));
        } else if (a.layer === 'sales') {
          setLayers((l) => ({ ...l, hex: a.visible === false ? 'off' : l.hex === 'off' ? 'unit' : l.hex }));
        } else if (a.layer === 'lines') {
          setLayers((l) => ({ ...l, lines: a.visible !== false }));
        } else if (a.visible !== false) {
          setNote(`The ${a.layer.replace('_', ' ')} layer arrives in a later build.`);
        }
      }
    }
  }, []);

  const submit = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const id = crypto.randomUUID();
    setDraft('');
    setBusy(true);
    setLandUse(null);
    setTurns((t) => [...t, { id, question: q, progress: [] }]);
    try {
      const answer = await ask(q, {
        stationContext: map.focus ?? undefined,
        onProgress: (e) => setTurns((t) => t.map((x) => (x.id === id ? { ...x, progress: [...x.progress, e] } : x))),
      });
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, answer } : x)));
      await runActions(answer.actions);
    } catch (e) {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: `${e instanceof Error ? e.message : String(e)}. Try again, or ask about one of the ten stations.` } : x)));
    } finally {
      setBusy(false);
    }
  }, [busy, map.focus, runActions]);

  const focusName = stations.find((s) => s.id === map.focus)?.name;
  const select = (id: string) => {
    setLandUse(null);
    setMap((m) => ({ ...m, focus: id, compare: null, highlight: [], view: 'overview', flyNonce: m.flyNonce + 1 }));
  };
  const kpis = Object.fromEntries(summary.map((k) => [k.id, k.unit_median_800m ? `${money(k.unit_median_800m)} unit median` : '']));
  // Name what is still synthetic, so real datasets are not tarred with the same brush.
  const TOPIC: Record<string, string> = { demo_sales: 'Property sales', demo_patronage: 'Station patronage', demo_land_use: 'Land use' };
  const demoTopics = (health?.datasets ?? []).filter((d) => d.demo).map((d) => TOPIC[d.id] ?? d.id);
  const demo = demoTopics.length > 0 || Boolean(health?.demo_data) || turns.some((t) => t.answer?.meta.demo_data);
  const demoText = !demoTopics.length
    ? 'Demo data: some figures are synthetic.'
    : demoTopics.length === 3
      ? 'Demo data: figures are synthetic until the NSW datasets are loaded.'
      : `Demo data: ${demoTopics.join(' and ').toLowerCase().replace(/^./, (c) => c.toUpperCase())} ${demoTopics.length > 1 ? 'are' : 'is'} synthetic for now. Other figures are real NSW data.`;

  return (
    <div className="portal">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>Lumina Precinct Agent</h1>
            <p>Station precinct screening for Sydney</p>
          </div>
        </div>
        <StationStrip stations={stations} summary={summary} active={map.compare ?? (map.focus ? [map.focus] : [])} onSelect={select} />
      </header>

      <section className="talk-pane" aria-label="Ask about a precinct">
        <header className="talk-head">
          <p>Ask about prices, transport and land use around ten stations. Every figure is checked against the data before you see it.</p>
          {demo && <p className="demo-flag">{demoText}</p>}
          {health?.provider === 'offline' && <p className="demo-flag">No model key set: answers come from the offline rule-based planner.</p>}
        </header>

        <div className="turns" ref={listRef}>
          {loadError && <p className="turn-error" role="alert">{loadError}. Reload the page to try again.</p>}
          {turns.length === 0 && (
            <div className="starter">
              <p>Start with one of these, or ask your own.</p>
              {SUGGESTIONS.map((g) => (
                <div key={g.who} className="starter-group">
                  <h2>{g.who}</h2>
                  {g.questions.map((q) => (
                    <button key={q} type="button" className="starter-q" onClick={() => submit(q)}>{q}</button>
                  ))}
                </div>
              ))}
            </div>
          )}
          {turns.map((t) => <AnswerView key={t.id} turn={t} onFollowUp={submit} />)}
        </div>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
        >
          <label htmlFor="q" className="sr-only">Your question</label>
          <textarea
            id="q"
            value={draft}
            rows={3}
            placeholder={focusName ? `Ask about ${focusName}` : 'Ask about a station precinct'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(draft);
              }
            }}
          />
          <button type="submit" className="ask-button" disabled={busy || !draft.trim()}>{busy ? 'Checking' : 'Ask'}</button>
        </form>
      </section>

      <section className="map-pane">
        <MapView stations={stations} state={map} layers={layers} kpis={kpis} onSelect={select} onHexMeta={setHexMeta} />
        <div className="map-status" aria-live="polite">
          {map.compare
            ? `Comparing ${stations.find((s) => s.id === map.compare![0])?.name} and ${stations.find((s) => s.id === map.compare![1])?.name}, ${map.radius_m} m rings`
            : focusName
              ? `${focusName} · 400 m and ${map.radius_m} m rings`
              : 'Ten station precincts on two T1 corridors'}
          {layers.hex !== 'off' && <span className="map-status-sub">Hexagons: median {layers.hex} price, last 12 months</span>}
        </div>
        {note && <div className="map-note">{note}</div>}
        <LayerPanel
          layers={layers}
          onChange={setLayers}
          hexMeta={hexMeta}
          canLandUse={Boolean(map.focus)}
          onLandUse={async () => map.focus && setLandUse(await fetchLandUse(map.focus).catch(() => null))}
        />
        {landUse && (
          <aside className="landuse" aria-label="Land-use cover">
            <div className="landuse-head">
              <h2>Land use near {stations.find((s) => s.id === landUse.station)?.name}</h2>
              <button type="button" className="icon-button" onClick={() => setLandUse(null)} aria-label="Close land use">×</button>
            </div>
            {Object.entries(landUse.rings).map(([ring, classes]) => (
              <div key={ring} className="landuse-ring">
                <h3>{RING_NAMES[ring] ?? ring}</h3>
                {Object.entries(classes).sort((a, b) => b[1] - a[1]).map(([cls, pct]) => (
                  <div key={cls} className={`bar bar-${cls}`}>
                    <span className="bar-name">{CLASS_NAMES[cls] ?? cls}</span>
                    <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.min(100, pct)}%` }} /></span>
                    <span className="bar-value">{pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            ))}
            <p className="landuse-foot">One capture date{landUse.capture_date ? ` (${landUse.capture_date})` : ''}. Classes can overlap.{landUse.demo_data ? ' Demo data.' : ''}</p>
          </aside>
        )}
      </section>
    </div>
  );
}
