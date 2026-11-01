'use client';

/** First-visit tips: three steps, dismissed with one click and remembered per browser. */
const STEPS = [
  { title: 'Pick a station', body: 'Search above, or click any dot on the map.' },
  { title: 'Ask, or start a playbook', body: 'Type below, or pick a guided playbook for your work.' },
  { title: 'Read “How this answer was made”', body: 'Every figure carries its source and date.' },
];

export function CoachMarks({ onDone }: { onDone: () => void }) {
  return (
    <section className="coach" aria-label="First-visit tips">
      <ol>
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <span className="coach-n" aria-hidden="true">{i + 1}</span>
            <span><strong>{s.title}.</strong> {s.body}</span>
          </li>
        ))}
      </ol>
      <button type="button" className="coach-done" onClick={onDone}>Got it</button>
    </section>
  );
}
