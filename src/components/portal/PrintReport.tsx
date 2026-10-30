'use client';

/**
 * A clean report of one or more answers, shown only when printing (Export PDF -> Save as PDF).
 * Every figure keeps its source and date; the Meta model trail is summarised.
 */
import type { Turn } from './AnswerCard';
import { modelLabel } from './ModelTrail';

export function PrintReport({ turns, names, user }: { turns: Turn[]; names: (id?: string) => string | undefined; user?: string }) {
  const date = new Date().toLocaleString('en-AU', { dateStyle: 'long', timeStyle: 'short' });
  return (
    <div className="print-report" aria-hidden="true">
      <header className="pr-head">
        <p className="pr-brand">Lumina Precinct Agent · Dronovation Labs</p>
        <h1>Precinct analysis</h1>
        <p className="pr-meta">Prepared {date}{user ? ` by ${user}` : ''}. Figures computed from NSW open data and checked before display.</p>
      </header>
      {turns.filter((t) => t.answer).map((t) => {
        const a = t.answer!;
        const cited = a.facts.filter((f) => a.templates.some((tp) => tp.includes(`{${f.id}}`)));
        const model = modelLabel(a.meta);
        return (
          <section key={t.id} className="pr-section">
            <h2>{t.question}</h2>
            {names(t.station) && <p className="pr-meta">Station: {names(t.station)}</p>}
            {a.lines.map((l, i) => <p key={i} className="pr-line">{l}</p>)}
            {cited.length > 0 && (
              <table className="pr-table">
                <thead><tr><th>#</th><th>Figure</th><th>Value</th><th>Source, as of</th></tr></thead>
                <tbody>
                  {cited.map((f, i) => (
                    <tr key={f.id}><td>{i + 1}</td><td>{f.label}</td><td>{f.display}</td><td>{f.demo ? 'Demo data' : f.source}, {f.as_of}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="pr-meta">
              How it was made: {model.name} ({model.host}) planned {a.meta.tool_calls.length} governed data call(s) and wrote the answer;
              the checker passed {a.verification.checks.filter((c) => c.passed).length} of {a.verification.checks.length} checks.
            </p>
            <p className="pr-meta">Sources: {a.sources.map((s) => `${s.name} (${s.licence})`).join('; ')}.</p>
            <p className="pr-disclaimer">{a.disclaimer}</p>
          </section>
        );
      })}
    </div>
  );
}
