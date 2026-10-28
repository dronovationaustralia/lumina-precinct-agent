'use client';

import { Fragment, useId, useState } from 'react';

import type { AskResponse, Fact } from '@/lib/contracts';

import type { ProgressEvent } from './api';
import { VegaChart } from './VegaChart';

export type Turn = {
  id: string;
  question: string;
  progress: ProgressEvent[];
  answer?: AskResponse;
  error?: string;
};

const TOOL_WORDS: Record<string, string> = {
  query_metric: 'Querying the metrics catalogue',
  land_use: 'Reading land-use cover',
  run_sql: 'Running governed SQL',
  search_place: 'Looking up the place',
  list_datasets: 'Listing datasets',
};

function progressLines(events: ProgressEvent[]): string[] {
  const out: string[] = ['Planning which data to use'];
  for (const e of events) {
    if (e.type === 'tool') out.push(`${TOOL_WORDS[e.name] ?? e.name}${e.facts ? `: ${e.facts} figure${e.facts === 1 ? '' : 's'}` : ''}`);
    if (e.type === 'compose') out.push(e.attempt > 1 ? 'Rewriting the answer to pass the checks' : 'Writing the answer');
    if (e.type === 'verify') out.push(e.ok ? 'Checks passed' : 'A check failed');
    if (e.type === 'fallback') out.push('Building a template answer from the facts');
  }
  return out;
}

/** Splits a template line into text and fact chips, numbering facts in order of first citation. */
function renderLine(template: string, facts: Map<string, Fact>, order: Map<string, number>, ledgerId: string, onHover: (id: string | null) => void) {
  const parts = template.split(/(\{f\d+\})/g);
  return parts.map((p, i) => {
    const m = p.match(/^\{(f\d+)\}$/);
    const f = m ? facts.get(m[1]!) : undefined;
    if (!f) return <Fragment key={i}>{p}</Fragment>;
    const n = order.get(f.id)!;
    return (
      <a
        key={i}
        className="fact"
        href={`#${ledgerId}-${f.id}`}
        onMouseEnter={() => onHover(f.id)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(f.id)}
        onBlur={() => onHover(null)}
        aria-label={`${f.display}, fact ${n}: ${f.label}`}
      >
        {f.display}
        <sup className="fact-ref">{n}</sup>
      </a>
    );
  });
}

export function AnswerView({ turn, onFollowUp }: { turn: Turn; onFollowUp: (question: string) => void }) {
  const ledgerId = useId().replace(/:/g, '');
  const [hover, setHover] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const a = turn.answer;

  if (!a) {
    return (
      <article className="turn">
        <p className="turn-question">{turn.question}</p>
        {turn.error ? (
          <p className="turn-error" role="alert">{turn.error}</p>
        ) : (
          <ol className="progress" aria-live="polite">
            {progressLines(turn.progress).map((l, i, all) => (
              <li key={i} className={i === all.length - 1 ? 'is-current' : undefined}>{l}</li>
            ))}
          </ol>
        )}
      </article>
    );
  }

  const facts = new Map(a.facts.map((f) => [f.id, f]));
  const order = new Map<string, number>();
  for (const t of a.templates) for (const m of t.matchAll(/\{(f\d+)\}/g)) if (!order.has(m[1]!) && facts.has(m[1]!)) order.set(m[1]!, order.size + 1);
  const cited = [...order.keys()].map((id) => facts.get(id)!);
  const passed = a.verification.checks.filter((c) => c.passed).length;
  const statusText =
    a.verification.status === 'verified' ? 'Verified: every figure matches a query result'
      : a.verification.status === 'verified_after_retry' ? 'Verified on the second attempt'
        : 'Template answer: the written draft failed the checks';

  return (
    <article className="turn">
      <p className="turn-question">{turn.question}</p>
      <div className="answer">
        {a.templates.map((t, i) => (
          <p key={i} className="answer-line">{renderLine(t, facts, order, ledgerId, setHover)}</p>
        ))}
      </div>

      {cited.length > 0 && (
        <ol className="ledger" aria-label="Figures in this answer">
          {cited.map((f) => (
            <li key={f.id} id={`${ledgerId}-${f.id}`} className={hover === f.id ? 'is-hot' : undefined}>
              <span className="ledger-label">{f.label}</span>
              <span className="ledger-value">{f.display}</span>
              <span className="ledger-source">{f.source}, as of {f.as_of}</span>
            </li>
          ))}
        </ol>
      )}

      {a.chart && <VegaChart spec={a.chart} />}

      <button type="button" className={`verify verify-${a.verification.status}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M8 1.5 13.5 4v4c0 3.2-2.3 5.6-5.5 6.5C4.8 13.6 2.5 11.2 2.5 8V4L8 1.5Z" fill="none" stroke="currentColor" strokeWidth="1.4" />{a.verification.status !== 'fallback' && <path d="m5.4 8.2 1.8 1.8 3.4-3.6" fill="none" stroke="currentColor" strokeWidth="1.6" />}</svg>
        <span>{statusText}</span>
        <span className="verify-more">{open ? 'Hide checks' : `${passed} of ${a.verification.checks.length} checks`}</span>
      </button>

      {open && (
        <div className="details">
          <ul className="checks">
            {a.verification.checks.map((c) => (
              <li key={c.name} className={c.passed ? 'ok' : 'bad'}>
                <span>{c.passed ? 'Passed' : 'Failed'}</span> {c.name.replace(/_/g, ' ')}{c.detail ? `: ${c.detail}` : ''}
              </li>
            ))}
          </ul>
          <h3>Tool calls</h3>
          <ul className="calls">
            {a.meta.tool_calls.map((t, i) => (
              <li key={i}>
                <strong>{t.tool}</strong> in {t.ms} ms{t.error ? `, failed: ${t.error}` : `, ${t.fact_ids.length} figures`}
                <code className="args">{JSON.stringify(t.args)}</code>
                {t.sql && <pre className="sql">{t.sql}</pre>}
              </li>
            ))}
            {a.meta.tool_calls.length === 0 && <li>No tools were needed.</li>}
          </ul>
          <p className="meta-line">
            {a.meta.provider === 'offline' ? 'Offline rule-based planner (no model)' : `${a.meta.provider === 'meta' ? 'Meta Model API' : 'Baseten'}, ${a.meta.model}`}. {a.meta.timings_ms.total} ms total, {a.meta.tokens.input + a.meta.tokens.output} tokens.
          </p>
        </div>
      )}

      {a.sources.length > 0 && (
        <p className="sources">
          Sources: {a.sources.map((s, i) => (
            <Fragment key={s.dataset_id}>{i > 0 && '; '}{s.url ? <a href={s.url}>{s.name}</a> : s.name} ({s.licence})</Fragment>
          ))}.
        </p>
      )}
      <p className="disclaimer">{a.disclaimer}</p>

      {a.followups.length > 0 && (
        <div className="followups">
          {a.followups.map((f) => (
            <button key={f.label} type="button" className="followup" onClick={() => f.question && onFollowUp(f.question)} disabled={!f.question}>
              {f.label}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
