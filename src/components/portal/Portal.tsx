'use client';

/**
 * The workspace: answer-first. Questions and answers in the centre, the map on the right driven by
 * each answer, a station search for all 185 stations, and the user's work type shaping starters,
 * the precinct snapshot and the agent's emphasis.
 */
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Fact, MapAction } from '@/lib/contracts';
import { PERSONA_INFO } from '@/lib/personas';

import { AnswerCard, type Turn } from './AnswerCard';
import { ask, fetchLandUse, fetchStations, fetchSummary, fetchUser, type LandUseDto, type StationDto, type StationSummary, type User } from './api';
import { LandUsePanel } from './LandUsePanel';
import { LayerPanel } from './LayerPanel';
import { LineBadges } from './LineBadges';
import { MapView, type HexMeta, type LayerState, type MapState } from './MapView';
import { ModelsPanel, type Health } from './ModelsPanel';
import { PrecinctSnapshot } from './PrecinctSnapshot';
import { StationSearch } from './StationSearch';
import 'maplibre-gl/dist/maplibre-gl.css';

type Persona = keyof typeof PERSONA_INFO;
const money = (v: number) => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}m` : `$${Math.round(v / 1000)}k`);

export function Portal() {
  const [stations, setStations] = useState<StationDto[]>([]);
  const [summary, setSummary] = useState<StationSummary[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [landUse, setLandUse] = useState<LandUseDto | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [showModels, setShowModels] = useState(false);
  const [layers, setLayers] = useState<LayerState>({ lines: true, rings: true, hex: 'off', bounds: 'off', landuse: true });
  const [hexMeta, setHexMeta] = useState<HexMeta | null>(null);
  const [map, setMap] = useState<MapState>({ focus: null, radius_m: 800, compare: null, highlight: [], view: 'overview', flyNonce: 0 });
  const listRef = useRef<HTMLDivElement>(null);
  const stationsRef = useRef<StationDto[]>([]);
  stationsRef.current = stations;
  const persona: Persona = user?.persona ?? 'developer';

  useEffect(() => {
    fetchStations().then(setStations).catch((e: Error) => setLoadError(e.message));
    fetch('/api/v1/health').then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
    fetchSummary().then((r) => setSummary(r.stations)).catch(() => setSummary([]));
    fetchUser().then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    listRef.current?.querySelector('.answer-card:last-of-type')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [turns.length]);

  const resolve = (target: string) => stationsRef.current.find((s) => s.id === target || s.name.toLowerCase() === target.toLowerCase())?.id;

  const runActions = useCallback(async (actions: MapAction[]) => {
    setNote(null);
    let focus: string | null | undefined;
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
          setLayers((l) => ({ ...l, landuse: true }));
          if (focus) setLandUse(await fetchLandUse(focus).catch(() => null));
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
    setTurns((t) => [...t, { id, question: q, station: map.focus ?? undefined, progress: [] }]);
    try {
      const answer = await ask(q, {
        stationContext: map.focus ?? undefined,
        persona,
        onProgress: (e) => setTurns((t) => t.map((x) => (x.id === id ? { ...x, progress: [...x.progress, e] } : x))),
      });
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, answer } : x)));
      await runActions(answer.actions);
    } catch (e) {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: `${e instanceof Error ? e.message : String(e)}. Try again, or name a station.` } : x)));
    } finally {
      setBusy(false);
    }
  }, [busy, map.focus, persona, runActions]);

  const select = (id: string) => {
    setLandUse(null);
    setMap((m) => ({ ...m, focus: id, compare: null, highlight: [], view: 'overview', flyNonce: m.flyNonce + 1 }));
  };

  const changePersona = async (p: Persona) => {
    setUser((u) => (u ? { ...u, persona: p } : u));
    await fetch('/api/auth/session', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona: p }) }).catch(() => null);
  };

  const focusFact = (f: Fact | null) => {
    setMap((m) => ({ ...m, highlight: f?.station_id ? [f.station_id] : [] }));
  };

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.assign('/signin');
  };

  const focus = stations.find((s) => s.id === map.focus) ?? null;
  const kpis = Object.fromEntries(summary.map((k) => [k.id, k.unit_median_800m ? `${money(k.unit_median_800m)} unit median` : '']));
  const TOPIC: Record<string, string> = { demo_sales: 'Property sales', demo_patronage: 'Station patronage', demo_land_use: 'Aerial land cover (until the SAM 3.1 run)' };
  const demoTopics = (health?.datasets ?? []).filter((d) => d.demo).map((d) => TOPIC[d.id] ?? d.id);
  const offline = health?.provider === 'offline';
  const info = PERSONA_INFO[persona];
  const featured = stations.filter((s) => s.featured);

  return (
    <div className="ws">
      <header className="ws-head">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-text"><strong>Lumina</strong> Precinct Agent</span>
        </Link>
        <StationSearch stations={stations} value={map.focus} onChange={select} />
        <div className="head-right">
          <label className="persona-select">
            <span className="sr-only">Work type</span>
            <select value={persona} onChange={(e) => changePersona(e.target.value as Persona)}>
              {(Object.keys(PERSONA_INFO) as Persona[]).map((p) => <option key={p} value={p}>{PERSONA_INFO[p].short}</option>)}
            </select>
          </label>
          <button type="button" className="meta-button" onClick={() => setShowModels(true)}>
            <span className="meta-dot" aria-hidden="true" />
            {offline ? 'Meta AI (offline)' : 'Meta AI'}
          </button>
          {user && (
            <div className="user">
              <span className="avatar" aria-hidden="true">{user.name.slice(0, 1)}</span>
              <span className="user-name">{user.name}</span>
              <button type="button" className="link-button" onClick={signOut}>Sign out</button>
            </div>
          )}
        </div>
      </header>

      <main className="talk" aria-label="Questions and answers">
        <div className="talk-scroll" ref={listRef}>
          <div className="talk-inner">
            {(demoTopics.length > 0 || offline) && (
              <div className="notices">
                {demoTopics.length > 0 && <p className="notice">Demo data: {demoTopics.join(' and ').toLowerCase()} {demoTopics.length > 1 ? 'are' : 'is'} synthetic for now. Other figures are real NSW data.</p>}
                {offline && <p className="notice">No Meta model key is set here, so a rule-based planner is answering. With the key, Muse Spark plans and writes every answer.</p>}
              </div>
            )}
            {loadError && <p className="turn-error" role="alert">{loadError}. Reload the page to try again.</p>}

            {turns.length === 0 && (
              <section className="hello">
                <p className="kicker">{info.label}</p>
                <h1>{user ? `Hello ${user.provider === 'demo' ? 'there' : user.name.split(' ')[0]}.` : 'Hello.'} Which precinct are you looking at?</h1>
                <p className="hello-lead">{info.blurb} Ask about any of Sydney&apos;s {stations.length || 185} train and metro stations.</p>
                <div className="starters">
                  {info.questions.map((q) => (
                    <button key={q} type="button" className="starter" onClick={() => submit(q)}>
                      <span>{q}</span>
                      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
                    </button>
                  ))}
                </div>
                {!focus && featured.length > 0 && (
                  <div className="featured">
                    <h2>Featured precincts</h2>
                    <ul>
                      {featured.map((s) => {
                        const k = summary.find((x) => x.id === s.id);
                        return (
                          <li key={s.id}>
                            <button type="button" className="featured-item" onClick={() => select(s.id)}>
                              <span className="featured-name">{s.name}</span>
                              <LineBadges lines={s.lines} max={3} />
                              <span className="featured-kpi">{k?.unit_median_800m ? `${money(k.unit_median_800m)} unit median` : ' '}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {focus && <PrecinctSnapshot station={focus} persona={persona} onAsk={submit} />}

            {turns.map((t) => (
              <AnswerCard key={t.id} turn={t} stationName={stations.find((s) => s.id === t.station)?.name} onFollowUp={submit} onFocusFact={focusFact} />
            ))}
          </div>
        </div>

        <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(draft); }}>
          <div className="composer-box">
            {focus && (
              <span className="context-chip">
                About {focus.name}
                <button type="button" aria-label="Clear station" onClick={() => setMap((m) => ({ ...m, focus: null, compare: null }))}>×</button>
              </span>
            )}
            <label htmlFor="q" className="sr-only">Your question</label>
            <textarea
              id="q"
              value={draft}
              rows={2}
              placeholder={focus ? `Ask about ${focus.name}, or compare it with another station` : 'Ask about any Sydney station precinct'}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(draft); } }}
            />
            <div className="composer-foot">
              <span className="composer-hint"><span className="meta-dot" aria-hidden="true" />{offline ? 'Offline planner' : 'Muse Spark'} · figures checked before display</span>
              <button type="submit" className="ask-button" disabled={busy || !draft.trim()}>{busy ? 'Working…' : 'Ask'}</button>
            </div>
          </div>
        </form>
      </main>

      <section className="map-pane" aria-label="Map">
        <MapView stations={stations} state={map} layers={layers} kpis={kpis} onSelect={select} onHexMeta={setHexMeta} />
        <div className="map-status" aria-live="polite">
          {map.compare
            ? `Comparing ${stations.find((s) => s.id === map.compare![0])?.name} and ${stations.find((s) => s.id === map.compare![1])?.name}`
            : focus ? `${focus.name} · 400 m and ${map.radius_m} m rings` : `${stations.length || 185} train and metro stations`}
          {layers.hex !== 'off' && <span className="map-status-sub">Hexagons: median {layers.hex} price, last 12 months</span>}
        </div>
        {note && <div className="map-note">{note}</div>}
        <LayerPanel layers={layers} onChange={setLayers} hexMeta={hexMeta} canLandUse={Boolean(map.focus)}
          onLandUse={async () => map.focus && setLandUse(await fetchLandUse(map.focus).catch(() => null))} />
        {landUse && (
          <LandUsePanel data={landUse} stationName={stations.find((st) => st.id === landUse.station)?.name ?? landUse.station} onClose={() => setLandUse(null)} />
        )}
      </section>

      {showModels && <ModelsPanel health={health} onClose={() => setShowModels(false)} />}
    </div>
  );
}
