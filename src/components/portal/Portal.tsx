'use client';

/**
 * The workspace: answer-first. Questions and answers in the centre, the map on the right driven by
 * each answer, a station search for all 185 stations, and the user's work type shaping starters,
 * the precinct snapshot and the agent's emphasis.
 */
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Fact, MapAction } from '@/lib/contracts';
import { PERSONA_INFO, STATION_SLOT, TOUR_STEP, fillStep, type Playbook } from '@/lib/personas';

import { AnswerCard, type AnswerActions, type Turn } from './AnswerCard';
import { AskDrawer } from './AskDrawer';
import { CoachMarks } from './CoachMarks';
import { answerMarkdown, download, loadSaved, shareLink, slug, storeSaved, type Saved } from './exporting';
import { PrintReport } from './PrintReport';
import { SavedPanel } from './SavedPanel';
import { ask, fetchLandUse, fetchStations, fetchSummary, fetchTour, fetchUser, shareAnswer, type LandUseDto, type StationDto, type StationSummary, type TourDto, type User } from './api';
import { LandUsePanel } from './LandUsePanel';
import { LayerPanel } from './LayerPanel';
import { LineBadges } from './LineBadges';
import { MapView, type HexMeta, type LayerState, type MapState, type MetricMeta, type SamMeta, type StationMetricMode } from './MapView';
import { MicButton } from './MicButton';
import { ModelsPanel, type Health } from './ModelsPanel';
import { PrecinctSnapshot } from './PrecinctSnapshot';
import { StationSearch } from './StationSearch';
import { TourCard } from './TourCard';
import { TourPicker } from './TourPicker';
import 'maplibre-gl/dist/maplibre-gl.css';

type Persona = keyof typeof PERSONA_INFO;
type TourState = { data: TourDto; index: number; playing: boolean };
const money = (v: number) => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}m` : `$${Math.round(v / 1000)}k`);

export function Portal() {
  const [stations, setStations] = useState<StationDto[]>([]);
  const [summary, setSummary] = useState<StationSummary[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  /**
   * A pre-built question waiting in the box. Its {station} slot follows the selected station
   * (the text updates when the station changes) until the user edits the text or asks.
   */
  const [draftTemplate, setDraftTemplate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [landUse, setLandUse] = useState<LandUseDto | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [showModels, setShowModels] = useState(false);
  // Screen split: answers and map side by side (40/60), or one of them full width.
  const [view, setView] = useState<'split' | 'chat' | 'map'>('split');
  const [saved, setSaved] = useState<Saved[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [printTurns, setPrintTurns] = useState<Turn[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // The first start after a data change rebuilds the local database (a few minutes); say so.
  const [warming, setWarming] = useState(false);
  const [checked, setChecked] = useState(false);
  const [layers, setLayers] = useState<LayerState>({ lines: true, rings: true, hex: 'off', bounds: 'off', landuse: true, stationMetric: 'off', sites: false, sam: false, samOpacity: 0.45, aerial: false });
  const [hexMeta, setHexMeta] = useState<HexMeta | null>(null);
  const [metricMeta, setMetricMeta] = useState<MetricMeta | null>(null);
  const [samMeta, setSamMeta] = useState<SamMeta | null>(null);
  const [samPeek, setSamPeek] = useState(false);
  const [tourPicker, setTourPicker] = useState(false);
  const [tour, setTour] = useState<TourState | null>(null);
  const [map, setMap] = useState<MapState>({ focus: null, radius_m: 800, compare: null, highlight: [], view: 'overview', flyNonce: 0 });
  const [playbook, setPlaybook] = useState<{ book: Playbook; index: number } | null>(null);
  const [showAsk, setShowAsk] = useState(false);
  const [coachSeen, setCoachSeen] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem('lumina-coach') === 'done';
    } catch {
      return false;
    }
  });
  const [phIdx, setPhIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const stationsRef = useRef<StationDto[]>([]);
  stationsRef.current = stations;
  const persona: Persona = user?.persona ?? 'developer';

  useEffect(() => {
    fetchStations().then(setStations).catch((e: Error) => setLoadError(e.message));
    const slow = setTimeout(() => setWarming(true), 2500);
    fetch('/api/v1/health').then((r) => r.json()).then(setHealth).catch(() => setHealth(null)).finally(() => { clearTimeout(slow); setWarming(false); setChecked(true); });
    fetchSummary().then((r) => setSummary(r.stations)).catch(() => setSummary([]));
    fetchUser().then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (user) setSaved(loadSaved(user.sub));
  }, [user]);

  // Export PDF: render the report, open the print dialog (choose "Save as PDF"), then clear it.
  useEffect(() => {
    if (!printTurns) return;
    const done = () => setPrintTurns(null);
    window.addEventListener('afterprint', done, { once: true });
    const t = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [printTurns]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    listRef.current?.querySelector('.answer-card:last-of-type')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [turns.length]);

  // The composer's placeholder rotates through the persona's example questions.
  useEffect(() => { setPhIdx(0); }, [persona]);
  useEffect(() => {
    if (draft) return;
    const t = setInterval(() => setPhIdx((i) => i + 1), 5000);
    return () => clearInterval(t);
  }, [draft, persona]);

  const resolve = (target: string) => stationsRef.current.find((s) => s.id === target || s.name.toLowerCase() === target.toLowerCase())?.id;

  /**
   * "What SAM 3.1 sees" is a mode: entering it shows the aerial photo and hides the land-use
   * colours (which would cover the photo), remembering what was on; leaving it puts them back.
   */
  const beforeSam = useRef<{ aerial: boolean; landuse: boolean } | null>(null);
  const withSamMode = useCallback((prev: LayerState, next: LayerState): LayerState => {
    if (next.sam && !prev.sam) {
      beforeSam.current = { aerial: prev.aerial, landuse: prev.landuse };
      return { ...next, aerial: true, landuse: false };
    }
    if (!next.sam && prev.sam) {
      const back = beforeSam.current ?? { aerial: false, landuse: true };
      beforeSam.current = null;
      return { ...next, aerial: back.aerial, landuse: back.landuse };
    }
    return next;
  }, []);
  const setSam = useCallback((on: boolean) => setLayers((l) => withSamMode(l, { ...l, sam: on })), [withSamMode]);

  const changeLayers = (l: LayerState) => {
    if (l.sam && !layers.sam && map.focus) setMap((m) => ({ ...m, view: 'close', flyNonce: m.flyNonce + 1 }));
    setLayers((prev) => withSamMode(prev, l));
  };

  /** Turn on the SAM reveal for the selected station, or the first featured one. */
  const showSam = () => {
    const id = stations.find((s) => s.id === map.focus)?.featured
      ? map.focus!
      : stations.find((s) => s.featured)?.id;
    if (!id) return;
    setSam(true);
    setMap((m) => ({ ...m, focus: id, compare: null, view: 'close', flyNonce: m.flyNonce + 1 }));
  };

  /** Put a pre-built question in the box (not asked yet); a {station} slot follows the selection. */
  const prefill = (template: string) => {
    const hasSlot = template.includes('{station}');
    setDraftTemplate(hasSlot ? template : null);
    setDraft(hasSlot ? '' : template);
    const box = document.querySelector<HTMLTextAreaElement>('#q');
    box?.focus();
    if (hasSlot && !map.focus) {
      setToast('Now pick a station: the question will update to match.');
      document.querySelector<HTMLInputElement>('.station-search input')?.focus();
    }
  };

  /** Start a playbook: its first step goes in the box; the rest follow as chips under each answer. */
  const startPlaybook = (book: Playbook) => {
    const first = book.steps[0];
    if (!first || first === TOUR_STEP) return;
    setPlaybook(book.steps.length > 1 ? { book, index: 1 } : null);
    prefill(first);
  };

  const handleNextStep = (_display: string, position: number) => {
    if (!playbook) return;
    const at = playbook.index + position;
    const step = playbook.book.steps[at];
    if (!step) return;
    const advance = () => setPlaybook(at + 1 < playbook.book.steps.length ? { book: playbook.book, index: at + 1 } : null);
    if (step === TOUR_STEP) {
      setTourPicker(true);
      advance();
      return;
    }
    advance();
    prefill(step);
  };

  const dismissCoach = () => {
    try {
      localStorage.setItem('lumina-coach', 'done');
    } catch {
      // Private mode: the tips just show again next visit.
    }
    setCoachSeen(true);
  };

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
        if (a.layer === 'places' && (a.classes ?? []).includes('opportunity_sites')) {
          setLayers((l) => ({ ...l, sites: a.visible !== false }));
        } else if (a.layer === 'land_use' && (a.classes ?? []).includes('sam')) {
          // "Turn on What SAM 3.1 sees" for a featured station; otherwise the plain land use.
          const id = focus ?? undefined;
          const featured = id ? stationsRef.current.find((s) => s.id === id)?.featured : false;
          if (a.visible !== false && featured) {
            setSam(true);
            setMap((m) => ({ ...m, view: 'close', flyNonce: m.flyNonce + 1 }));
          } else if (a.visible !== false) {
            setLayers((l) => ({ ...l, landuse: true }));
            if (focus) setLandUse(await fetchLandUse(focus).catch(() => null));
          } else {
            setSam(false);
          }
        } else if (a.layer === 'land_use' && a.visible !== false) {
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
  }, [setSam]);

  const submit = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    if (q.includes(STATION_SLOT)) {
      setToast('Pick a station first: search at the top or click a dot on the map.');
      document.querySelector<HTMLInputElement>('.station-search input')?.focus();
      return;
    }
    const id = crypto.randomUUID();
    setDraft('');
    setDraftTemplate(null);
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
      // A screening answer colours the stations by the metric it ranked.
      const ranked = answer.meta.tool_calls.find((t) => t.tool === 'rank_stations' && t.ok);
      const rArgs = ranked?.args as { metric?: string; property_type?: string } | undefined;
      const pt = rArgs?.property_type ?? (rArgs?.metric === 'median_price' || rArgs?.metric === 'price_change_12m' ? 'unit' : 'all');
      const mode: StationMetricMode | undefined =
        rArgs?.metric === 'median_price' && pt === 'house' ? 'house_median'
        : rArgs?.metric === 'median_price' && pt === 'unit' ? 'unit_median'
        : rArgs?.metric === 'price_change_12m' && pt === 'unit' ? 'unit_change'
        : rArgs?.metric === 'patronage_12m' ? 'trips'
        : rArgs?.metric === 'patronage_change_12m' ? 'trips_change'
        : undefined;
      if (mode) setLayers((l) => ({ ...l, stationMetric: mode }));
    } catch (e) {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: `${e instanceof Error ? e.message : String(e)}. Try again, or name a station.` } : x)));
    } finally {
      setBusy(false);
    }
  }, [busy, map.focus, persona, runActions]);

  const tourRef = useRef<TourState | null>(null);
  tourRef.current = tour;

  const goToStop = useCallback((i: number) => {
    const t = tourRef.current;
    const stop = t?.data.stops[i];
    if (!t || !stop) return;
    setTour({ ...t, index: i });
    setMap((m) => ({ ...m, focus: stop.station_id, compare: null, highlight: [], radius_m: 800, view: 'close', flyNonce: m.flyNonce + 1 }));
  }, []);

  const toggleTour = useCallback(() => {
    const t = tourRef.current;
    if (!t) return;
    if (!t.playing && t.index >= t.data.stops.length - 1) {
      goToStop(0);
      setTour({ ...t, index: 0, playing: true });
    } else {
      setTour({ ...t, playing: !t.playing });
    }
  }, [goToStop]);

  const exitTour = useCallback(() => setTour(null), []);

  const startTour = useCallback(async (tourId: string) => {
    setTourPicker(false);
    setToast('Loading tour…');
    try {
      const data = await fetchTour(tourId);
      if (!data.stops.length) {
        setToast('This tour has no stations with data yet.');
        return;
      }
      setToast(null);
      setTour({ data, index: 0, playing: true });
      const s = data.stops[0]!;
      setMap((m) => ({ ...m, focus: s.station_id, compare: null, highlight: [], radius_m: 800, view: 'close', flyNonce: m.flyNonce + 1 }));
    } catch {
      setToast('The tour could not be loaded.');
    }
  }, []);

  useEffect(() => {
    if (!tour?.playing) return;
    if (tour.index >= tour.data.stops.length - 1) {
      setTour((t) => (t ? { ...t, playing: false } : t));
      return;
    }
    const id = setTimeout(() => goToStop(tour.index + 1), 7000);
    return () => clearTimeout(id);
  }, [tour, goToStop]);

  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      if (e.key === ' ') {
        e.preventDefault();
        toggleTour();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const t = tourRef.current!;
        goToStop(Math.min(t.data.stops.length - 1, t.index + 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToStop(Math.max(0, tourRef.current!.index - 1));
      } else if (e.key === 'Escape') {
        exitTour();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tour, goToStop, toggleTour, exitTour]);

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

  const nameOf = (id?: string) => stations.find((x) => x.id === id)?.name;
  const actionsFor = (t: Turn): AnswerActions => ({
    onShare: async () => {
      if (!t.answer) return;
      try {
        if (!t.answer.share_token) { setToast('This answer is too long to share as a link. Use Markdown or PDF instead.'); return; }
        const { url } = await shareAnswer(t.answer.share_token);
        const r = await shareLink(url, t.question);
        if (r === 'shared') setToast('Shared');
        else if (r === 'copied') setToast('Link copied');
        else if (r === 'failed') setToast('Sharing failed in this browser');
      } catch {
        setToast('The share link could not be made.');
      }
    },
    saved: saved.some((x) => x.id === t.id),
    onCopy: () => {
      void navigator.clipboard?.writeText(answerMarkdown(t, nameOf(t.station))).then(() => setToast('Copied'), () => setToast('Copy is blocked in this browser'));
    },
    onMarkdown: () => download(`lumina-${slug(t.question)}.md`, answerMarkdown(t, nameOf(t.station))),
    onPdf: () => setPrintTurns([t]),
    onSave: () => {
      if (!t.answer) return;
      const next = saved.some((x) => x.id === t.id)
        ? saved.filter((x) => x.id !== t.id)
        : [{ id: t.id, saved_at: new Date().toISOString(), question: t.question, station: t.station, answer: t.answer }, ...saved];
      setSaved(next);
      storeSaved(user?.sub, next);
      setToast(next.length > saved.length ? 'Saved. Find it under Saved at the top.' : 'Removed from Saved');
    },
  });

  const focus = stations.find((s) => s.id === map.focus) ?? null;
  const composerText = draftTemplate ? fillStep(draftTemplate, focus?.name ?? STATION_SLOT) : draft;
  const kpis = Object.fromEntries(summary.map((k) => [k.id, k.unit_median_800m ? `${money(k.unit_median_800m)} unit median` : '']));
  const TOPIC: Record<string, string> = { demo_sales: 'Property sales', demo_patronage: 'Station patronage', demo_land_use: 'Aerial land cover (until the SAM 3.1 run)' };
  const demoTopics = (health?.datasets ?? []).filter((d) => d.demo).map((d) => TOPIC[d.id] ?? d.id);
  const offline = health?.provider === 'offline';
  const info = PERSONA_INFO[persona];
  const featured = stations.filter((s) => s.featured);

  return (
    <div className={`ws ws-${view}`}>
      <header className="ws-head">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-text"><strong>Lumina</strong> Precinct Agent</span>
        </Link>
        <StationSearch stations={stations} value={map.focus} onChange={select} />
        <div className="head-right">
          <div className="seg view-switch" role="radiogroup" aria-label="Screen layout">
            {([['chat', 'Answers'], ['split', 'Split'], ['map', 'Map']] as const).map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={view === v} className={view === v ? 'is-on' : ''} onClick={() => setView(v)}
                title={v === 'split' ? 'Answers 40%, map 60%' : v === 'chat' ? 'Answers full width' : 'Map full width'}>{label}</button>
            ))}
          </div>
          <label className="persona-select">
            <span className="sr-only">Work type</span>
            <select value={persona} onChange={(e) => changePersona(e.target.value as Persona)}>
              {(Object.keys(PERSONA_INFO) as Persona[]).map((p) => <option key={p} value={p}>{PERSONA_INFO[p].short}</option>)}
            </select>
          </label>
          <button type="button" className="head-button" onClick={() => setTourPicker(true)} title="Fly the map station by station with verified briefings">
            Tour
          </button>
          <button type="button" className="head-button" onClick={() => setShowSaved(true)} title="Saved analyses and the session report">
            Saved{saved.length ? ` (${saved.length})` : ''}
          </button>
          {turns.some((t) => t.answer) && (
            <button type="button" className="head-button" onClick={() => setPrintTurns(turns)} title="All answers in this session as one PDF report">Report</button>
          )}
          <button type="button" className="meta-button" onClick={() => setShowModels(true)}>
            <span className="meta-dot" aria-hidden="true" />
            {offline ? 'Meta AI (offline)' : 'Meta AI'}
          </button>
          {user && (
            <div className="user">
              <span className="avatar" aria-hidden="true">{user.name.slice(0, 1)}</span>
              <span className="user-name">{user.name}</span>
              <Link className="link-button" href="/about">About</Link>
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
                {warming && <p className="notice">Loading the data. The first start after a data change rebuilds the local database, which takes about 3 minutes; the snapshot, map layers and land use appear when it is ready.</p>}
                {checked && !health && <p className="notice">The server did not answer the health check. Check the terminal running the app.</p>}
                {demoTopics.length > 0 && <p className="notice">Demo data: {demoTopics.join(' and ').toLowerCase()} {demoTopics.length > 1 ? 'are' : 'is'} synthetic for now. Other figures are real NSW data.</p>}
                {offline && <p className="notice">No Meta model key is set here, so a rule-based planner is answering. With the key, Muse Spark plans and writes every answer.</p>}
              </div>
            )}
            {loadError && <p className="turn-error" role="alert">{loadError}. Reload the page to try again.</p>}

            {!coachSeen && turns.length === 0 && <CoachMarks onDone={dismissCoach} />}

            {turns.length === 0 && (
              <section className="hello">
                <p className="kicker">{info.label}</p>
                <h1>{user ? `Hello ${user.provider === 'demo' ? 'there' : user.name.split(' ')[0]}.` : 'Hello.'} Which precinct are you looking at?</h1>
                <p className="hello-lead">{info.blurb} Ask about any of Sydney&apos;s {stations.length || 185} train and metro stations.</p>
                <div className="playbooks">
                  {info.playbooks.map((b) => (
                    <div key={b.title} className="playbook">
                      <div>
                        <h3>{b.title}</h3>
                        <p>{b.why}</p>
                      </div>
                      <button type="button" className="playbook-start" onClick={() => startPlaybook(b)}>
                        Start
                        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
                      </button>
                    </div>
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

            {focus && <PrecinctSnapshot station={focus} persona={persona} onAsk={prefill} />}

            {turns.map((t) => (
              <AnswerCard
                key={t.id} turn={t} stationName={stations.find((s) => s.id === t.station)?.name} onFollowUp={submit} onFocusFact={focusFact} actions={actionsFor(t)}
                nextSteps={playbook && t.answer ? playbook.book.steps.slice(playbook.index).map((s) => fillStep(s, focus?.name ?? 'a station')) : undefined}
                onNextStep={handleNextStep}
              />
            ))}
          </div>
        </div>

        <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(composerText); }}>
          {focus && (
            <div className="quick-chips" role="group" aria-label={`Quick questions about ${focus.name}`}>
              {info.playbooks.map((b) => (
                <button key={b.title} type="button" className="quick-chip" title={fillStep(b.steps[0] ?? '', focus.name)} onClick={() => startPlaybook(b)}>
                  {b.title}
                </button>
              ))}
            </div>
          )}
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
              value={composerText}
              rows={2}
              placeholder={info.questions[phIdx % info.questions.length]}
              onChange={(e) => { setDraftTemplate(null); setDraft(e.target.value); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(composerText); } }}
            />
            <div className="composer-foot">
              <span className="composer-left">
                <span className="composer-hint"><span className="meta-dot" aria-hidden="true" />{offline ? 'Offline planner' : 'Muse Spark'} · figures checked before display</span>
                <button type="button" className="link-button" onClick={() => setShowAsk(true)}>What can I ask?</button>
              </span>
              <span className="composer-actions">
                 <MicButton onTranscript={(t) => { setDraftTemplate(null); setDraft(t); }} station={stations.find((st) => st.id === map.focus)?.name} />
                <button type="submit" className="ask-button" disabled={busy || !draft.trim()}>{busy ? 'Working…' : 'Ask'}</button>
              </span>
            </div>
          </div>
        </form>
      </main>

      <section className="map-pane" aria-label="Map">
        <MapView stations={stations} state={map} layers={layers} kpis={kpis} onSelect={select} onHexMeta={setHexMeta} onMetricMeta={setMetricMeta} onSamMeta={setSamMeta} samPeek={samPeek} />
        <div className="map-status" aria-live="polite">
          {map.compare
            ? `Comparing ${stations.find((s) => s.id === map.compare![0])?.name} and ${stations.find((s) => s.id === map.compare![1])?.name}`
            : focus ? `${focus.name} · 400 m and ${map.radius_m} m rings` : `${stations.length || 185} train and metro stations`}
          {layers.hex !== 'off' && <span className="map-status-sub">Hexagons: median {layers.hex} price, last 12 months</span>}
          {layers.stationMetric !== 'off' && <span className="map-status-sub">Stations coloured by {metricMeta?.label ?? 'metric'}</span>}
          {layers.sites && <span className="map-status-sub">Opportunity sites{focus ? ` near ${focus.name}` : ' (pick a station)'}</span>}
          {layers.sam && <span className="map-status-sub">What SAM 3.1 sees{focus ? ` near ${focus.name}` : ''}</span>}
        </div>
        {layers.sam && (
          <button type="button" className="sam-exit" onClick={() => setSam(false)} title="Turn off the SAM 3.1 view and go back to the street map">
            Back to the normal map
          </button>
        )}
        {note && <div className="map-note">{note}</div>}
        {tour && (
          <TourCard
            tour={tour.data} index={tour.index} playing={tour.playing} onPause={toggleTour}
            onPrev={() => goToStop(Math.max(0, tour.index - 1))}
            onNext={() => goToStop(Math.min(tour.data.stops.length - 1, tour.index + 1))}
            onExit={exitTour}
          />
        )}
        <LayerPanel layers={layers} onChange={changeLayers} hexMeta={hexMeta} metricMeta={metricMeta} canLandUse={Boolean(map.focus)}
          samMeta={samMeta} samPeek={samPeek} onSamPeek={setSamPeek} focusName={focus?.name ?? null} samAvailable={focus?.featured ?? false}
          onLandUse={async () => {
            if (!map.focus) return;
            setToast('Loading land use…');
            const lu = await fetchLandUse(map.focus).catch(() => null);
            if (lu) { setLandUse(lu); setToast(null); } else setToast(warming ? 'Still loading the data. Try again in a minute.' : 'Land use is not available for this station.');
          }} />
        {landUse && (
          <LandUsePanel data={landUse} stationName={stations.find((st) => st.id === landUse.station)?.name ?? landUse.station} onClose={() => setLandUse(null)} onShowSam={showSam} />
        )}
      </section>

      {showModels && <ModelsPanel health={health} checking={!checked} onClose={() => setShowModels(false)} onShowSam={showSam} samStationName={(focus?.featured ? focus : featured[0] ?? null)?.name ?? null} />}
      {showAsk && <AskDrawer datasets={health?.datasets ?? null} stationName={focus?.name} onClose={() => setShowAsk(false)} onAsk={prefill} />}
      {tourPicker && <TourPicker onPick={(id) => void startTour(id)} onClose={() => setTourPicker(false)} />}
      {showSaved && (
        <SavedPanel
          items={saved}
          names={nameOf}
          onClose={() => setShowSaved(false)}
          onRemove={(id) => { const next = saved.filter((x) => x.id !== id); setSaved(next); storeSaved(user?.sub, next); }}
          onOpen={(x) => { setTurns((ts) => (ts.some((t) => t.id === x.id) ? ts : [...ts, { id: x.id, question: x.question, station: x.station, progress: [], answer: x.answer }])); setShowSaved(false); }}
          onExportAll={() => { setShowSaved(false); setPrintTurns(saved.map((x) => ({ id: x.id, question: x.question, station: x.station, progress: [], answer: x.answer }))); }}
        />
      )}
      {printTurns && <PrintReport turns={printTurns} names={nameOf} user={user?.name} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
