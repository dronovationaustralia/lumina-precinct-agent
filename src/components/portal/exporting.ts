/** Export helpers: an answer as Markdown, and saved analyses in this browser. */
import type { AskResponse } from '@/lib/contracts';

import type { Turn } from './AnswerCard';
import { modelLabel } from './ModelTrail';

export function answerMarkdown(t: Turn, stationName?: string): string {
  const a = t.answer;
  if (!a) return `## ${t.question}\n\n(no answer)\n`;
  const model = modelLabel(a.meta);
  const lines = [
    `## ${t.question}`,
    stationName ? `_Station: ${stationName}_` : '',
    '',
    ...a.lines.map((l) => l),
    '',
    '| # | Figure | Value | Source | As of |',
    '| --- | --- | --- | --- | --- |',
    ...a.facts.filter((f) => a.templates.some((tp) => tp.includes(`{${f.id}}`))).map((f, i) => `| ${i + 1} | ${f.label} | ${f.display} | ${f.demo ? 'Demo data' : f.source} | ${f.as_of} |`),
    '',
    `How this answer was made: ${model.name} (${model.host}) planned ${a.meta.tool_calls.length} data call(s) over governed NSW open data and wrote the answer; a deterministic checker passed ${a.verification.checks.filter((c) => c.passed).length} of ${a.verification.checks.length} checks (${a.verification.status}).`,
    '',
    `Sources: ${a.sources.map((s) => `${s.name}${s.url ? ` (${s.url})` : ''}, ${s.licence}`).join('; ')}.`,
    '',
    `_${a.disclaimer}_`,
    '',
  ];
  return lines.filter((l, i, all) => !(l === '' && all[i - 1] === '')).join('\n');
}

export function reportMarkdown(turns: Turn[], names: (id?: string) => string | undefined, user?: string): string {
  const date = new Date().toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
  return [`# Lumina precinct analysis`, '', `Prepared ${date}${user ? ` by ${user}` : ''} with Lumina Precinct Agent (Dronovation Labs).`, '', ...turns.map((t) => answerMarkdown(t, names(t.station)))].join('\n');
}

export function download(filename: string, text: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'analysis';

export type Saved = { id: string; saved_at: string; question: string; station?: string; answer: AskResponse };
const key = (user?: string) => `lumina:saved:${user ?? 'anon'}`;

export function loadSaved(user?: string): Saved[] {
  try {
    return JSON.parse(localStorage.getItem(key(user)) ?? '[]') as Saved[];
  } catch {
    return [];
  }
}

export function storeSaved(user: string | undefined, list: Saved[]) {
  try {
    localStorage.setItem(key(user), JSON.stringify(list.slice(0, 50)));
  } catch {
    /* storage full or blocked: saving is best-effort */
  }
}
