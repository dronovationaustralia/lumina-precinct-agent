'use client';

/**
 * One question and its answer, as a card: the answer lines with traceable fact chips, the
 * figures as tiles (each with source and date), an optional chart, the Meta model trail, the
 * checks, sources and follow-ups.
 */
import { Fragment, useId, useState } from 'react';

import type { AskResponse, Fact } from '@/lib/contracts';

import type { ProgressEvent } from './api';
import { ModelTrail, modelLabel } from './ModelTrail';
import { VegaChart } from './VegaChart';

export type Turn = {
  id: string;
  question: string;
  station?: string;
  progress: ProgressEvent[];
  answer?: AskResponse;
  error?: string;
};

const TOOL_WORDS: Record<string, string> = {
  query_metric: 'Querying the metrics catalogue',
  land_use: 'Reading land use',
  run_sql: 'Running governed SQL',
  search_place: 'Looking up the station',
  list_datasets: 'Listing datasets',
};

function progressSteps(events: ProgressEvent[]): { text: string; meta: boolean }[] {
  const out = [{ text: 'Muse Spark is planning which data to use', meta: true }];
  for (const e of events) {
    if (e.type === 'tool') out.push({ text: `${TOOL_WORDS[e.name] ?? e.name}${e.facts ? `: ${e.facts} figure${e.facts === 1 ? '' : 's'}` : ''}`, meta: false });
    if (e.type === 'compose') out.push({ text: e.attempt > 1 ? 'Muse Spark is rewriting the answer to pass the checks' : 'Muse Spark is writing the answer', meta: true });
    if (e.type === 'verify') out.push({ text: e.ok ? 'Every figure checked against the data' : 'A check failed', meta: false });
    if (e.type === 'fallback') out.push({ text: 'Building a template answer from the figures', meta: false });
  }
  return out;
}

const RING_WORDS: Record<string, string> = { '0-400m': 'within 400 m', '0-800m': 'within 800 m', '800m-2km': '800 m to 2 km', '2-5km': '2 to 5 km' };

/** A short tile title from a fact's long label ("Median unit price, Chatswood, within 800 m, ..."). */
function tileParts(f: Fact) {
  const [head, ...rest] = f.label.split(', ');
  return { title: head ?? f.label, context: rest.join(', ') || (f.ring ? RING_WORDS[f.ring] ?? f.ring : '') };
}

function renderLine(template: string, facts: Map<string, Fact>, order: Map<string, number>, anchor: string, onHover: (id: string | null) => void) {
  return template.split(/(\{f\d+\})/g).map((p, i) => {
    const m = p.match(/^\{(f\d+)\}$/);
    const f = m ? facts.get(m[1]!) : undefined;
    if (!f) return <Fragment key={i}>{p}</Fragment>;
    const n = order.get(f.id)!;
    return (
      <a key={i} className="fact" href={`#${anchor}-${f.id}`} onMouseEnter={() => onHover(f.id)} onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(f.id)} onBlur={() => onHover(null)} aria-label={`${f.display}, figure ${n}: ${f.label}`}>
        {f.display}<sup className="fact-ref">{n}</sup>
      </a>
    );
  });
}

export type AnswerActions = { onSave: () => void; onPdf: () => void; onMarkdown: () => void; onCopy: () => void; onShare: () => void; saved: boolean };

export function AnswerCard({ turn, stationName, onFollowUp, onFocusFact, actions, shared }: {
  turn: Turn;
  stationName?: string;
  onFollowUp: (q: string) => void;
  onFocusFact: (f: Fact | null) => void;
  actions?: AnswerActions;
  shared?: boolean;
}) {
  const anchor = useId().replace(/:/g, '');
  const [hover, setHover] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const a = turn.answer;
  const hot = (id: string | null) => {
    setHover(id);
    onFocusFact(id && a ? a.facts.find((f) => f.id === id) ?? null : null);
  };

  return (
    <article className="card answer-card">
      <header className="q-head">
        <p className="q-text">{turn.question}</p>
        {stationName && <span className="q-station">{stationName}</span>}
      </header>

      {!a && (turn.error ? (
        <p className="turn-error" role="alert">{turn.error}</p>
      ) : (
        <ol className="progress" aria-live="polite">
          {progressSteps(turn.progress).map((s, i, all) => (
            <li key={i} className={i === all.length - 1 ? 'is-current' : undefined}>
              {s.meta && <span className="meta-dot" aria-hidden="true" />}{s.text}
            </li>
          ))}
        </ol>
      ))}

      {a && <AnswerBody a={a} anchor={anchor} hover={hover} onHot={hot} open={open} setOpen={setOpen} onFollowUp={onFollowUp} shared={shared} />}
      {a && actions && (
        <div className="answer-actions" role="group" aria-label="Export or save this answer">
          <button type="button" onClick={actions.onCopy} title="Copy the answer, figures and sources as text">Copy</button>
          <button type="button" onClick={actions.onMarkdown} title="Download as a Markdown file">Markdown</button>
          <button type="button" onClick={actions.onPdf} title="Opens the print dialog: choose Save as PDF">Export PDF</button>
          <button type="button" onClick={actions.onShare} title="Copy a public link to this answer">Share</button>
          <button type="button" className={actions.saved ? 'is-on' : ''} onClick={actions.onSave} aria-pressed={actions.saved} title="Keep this analysis in Saved (this browser)">
            {actions.saved ? 'Saved' : 'Save'}
          </button>
        </div>
      )}
    </article>
  );
}

function AnswerBody({ a, anchor, hover, onHot, open, setOpen, onFollowUp, shared }: {
  a: AskResponse; anchor: string; hover: string | null; onHot: (id: string | null) => void;
  open: boolean; setOpen: (f: (o: boolean) => boolean) => void; onFollowUp: (q: string) => void; shared?: boolean;
}) {
  const facts = new Map(a.facts.map((f) => [f.id, f]));
  const order = new Map<string, number>();
  for (const t of a.templates) for (const m of t.matchAll(/\{(f\d+)\}/g)) if (!order.has(m[1]!) && facts.has(m[1]!)) order.set(m[1]!, order.size + 1);
  const cited = [...order.keys()].map((id) => facts.get(id)!);
  const model = modelLabel(a.meta);
  const ok = a.verification.status !== 'fallback';

  return (
    <>
      <div className="answer">
        {a.templates.map((t, i) => <p key={i} className="answer-line">{renderLine(t, facts, order, anchor, onHot)}</p>)}
      </div>

      {cited.length > 0 && (
        <ol className="tiles" aria-label="Figures in this answer">
          {cited.map((f) => {
            const { title, context } = tileParts(f);
            return (
              <li key={f.id} id={`${anchor}-${f.id}`} className={`tile${hover === f.id ? ' is-hot' : ''}${f.suppressed ? ' is-withheld' : ''}`}
                onMouseEnter={() => onHot(f.id)} onMouseLeave={() => onHot(null)}>
                <span className="tile-n">{order.get(f.id)}</span>
                <span className="tile-value">{f.display}</span>
                <span className="tile-title">{title}</span>
                <span className="tile-context">{context}</span>
                <span className={`tile-source${f.demo ? ' is-demo' : ''}`}>{f.demo ? 'Demo data' : f.source} · {f.as_of}</span>
              </li>
            );
          })}
        </ol>
      )}

      {a.chart && <div className="chart-wrap"><VegaChart spec={a.chart} /></div>}

      <section className="made" aria-label="How this answer was made">
        <div className="made-head">
          <h3>How this answer was made</h3>
          <span className={`badge ${ok ? 'badge-ok' : 'badge-warn'}`}>{ok ? 'Verified' : 'Template answer'}</span>
        </div>
        {shared ? (
          <p className="meta-line">{model.name} via {model.host}. Shared answers carry the verified figures and sources; the full query trail is not included.</p>
        ) : (
          <ModelTrail answer={a} />
        )}
        {!shared && (<button type="button" className="link-button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide checks and queries' : 'Show checks and queries'}
        </button>)}
        {!shared && open && (
          <div className="details">
            <ul className="checks">
              {a.verification.checks.map((c) => (
                <li key={c.name} className={c.passed ? 'ok' : 'bad'}><span>{c.passed ? 'Passed' : 'Failed'}</span> {c.name.replace(/_/g, ' ')}{c.detail ? `: ${c.detail}` : ''}</li>
              ))}
            </ul>
            <h4>Data calls</h4>
            <ul className="calls">
              {a.meta.tool_calls.map((t, i) => (
                <li key={i}>
                  <strong>{t.tool}</strong> · {t.ms} ms{t.error ? ` · failed: ${t.error}` : ` · ${t.fact_ids.length} figures`}
                  <code className="args">{JSON.stringify(t.args)}</code>
                  {t.sql && <pre className="sql">{t.sql}</pre>}
                </li>
              ))}
              {a.meta.tool_calls.length === 0 && <li>No data calls were needed.</li>}
            </ul>
            <p className="meta-line">
              {model.name} via {model.host}. {(a.meta.timings_ms.total / 1000).toFixed(1)} s, {(a.meta.tokens.input + a.meta.tokens.output).toLocaleString()} tokens
              {a.meta.tokens.reasoning ? ` (${a.meta.tokens.reasoning.toLocaleString()} reasoning)` : ''}.
            </p>
          </div>
        )}
      </section>

      <footer className="answer-foot">
        {a.sources.length > 0 && (
          <p className="sources">
            Sources: {a.sources.map((s, i) => (
              <Fragment key={s.dataset_id}>{i > 0 && '; '}{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> : s.name}</Fragment>
            ))}.
          </p>
        )}
        <p className="disclaimer">{a.disclaimer}</p>
        {a.followups.length > 0 && (
          <div className="followups">
            {a.followups.map((f) => (
              <button key={f.label} type="button" className="followup" onClick={() => f.question && onFollowUp(f.question)} disabled={!f.question}>{f.label}</button>
            ))}
          </div>
        )}
      </footer>
    </>
  );
}
