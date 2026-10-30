'use client';

/**
 * "How this answer was made": the pipeline behind one answer, naming the Meta model at each
 * step that used one. Muse Spark plans and writes; governed SQL computes every figure; a
 * deterministic checker verifies the draft before it is shown.
 */
import type { AskResponse } from '@/lib/contracts';

const TOOL_NAMES: Record<string, string> = {
  query_metric: 'metrics',
  land_use: 'land use',
  run_sql: 'governed SQL',
  search_place: 'place lookup',
  list_datasets: 'datasets',
};

const secs = (ms?: number) => (ms === undefined ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export function modelLabel(meta: AskResponse['meta']): { name: string; host: string; meta: boolean } {
  if (meta.provider === 'meta') return { name: meta.model.replace(/^muse-spark-/, 'Muse Spark ').replace(/-/g, ' '), host: 'Meta Model API', meta: true };
  if (meta.provider === 'baseten') return { name: 'Muse Spark Open', host: 'Baseten (open weights)', meta: true };
  return { name: 'Offline planner', host: 'rules, no model key', meta: false };
}

export function ModelTrail({ answer }: { answer: AskResponse }) {
  const m = answer.meta;
  const model = modelLabel(m);
  const tools = [...new Set(m.tool_calls.map((t) => TOOL_NAMES[t.tool] ?? t.tool))];
  const figures = m.tool_calls.reduce((n, t) => n + t.fact_ids.length, 0);
  const passed = answer.verification.checks.filter((c) => c.passed).length;
  const ok = answer.verification.status !== 'fallback';
  const effort = m.reasoning_effort ? `, ${m.reasoning_effort} reasoning` : '';
  const steps = [
    { key: 'plan', kind: model.meta ? 'meta' : 'rule', who: model.name, what: `Planned ${m.tool_calls.length || 'no'} data ${m.tool_calls.length === 1 ? 'call' : 'calls'}${effort}`, ms: m.timings_ms.plan },
    { key: 'data', kind: 'data', who: 'NSW open data', what: tools.length ? `${figures} figures from ${tools.join(', ')}` : 'No data needed', ms: m.timings_ms.tools },
    { key: 'write', kind: model.meta ? 'meta' : 'rule', who: model.name, what: 'Wrote the answer with figure placeholders', ms: m.timings_ms.compose },
    { key: 'check', kind: ok ? 'ok' : 'warn', who: 'Checker', what: ok ? `${passed} of ${answer.verification.checks.length} checks passed` : 'Draft failed; template answer used', ms: undefined },
  ];
  return (
    <ol className="trail" aria-label="How this answer was made">
      {steps.map((s) => (
        <li key={s.key} className={`trail-step trail-${s.kind}`}>
          <span className="trail-who">
            {s.kind === 'meta' && <span className="meta-dot" aria-hidden="true" />}
            {s.who}
          </span>
          <span className="trail-what">{s.what}</span>
          {s.ms !== undefined && <span className="trail-ms">{secs(s.ms)}</span>}
        </li>
      ))}
    </ol>
  );
}
