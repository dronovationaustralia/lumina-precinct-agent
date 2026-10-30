'use client';

/** Where each Meta model is used in Lumina, with its status in this deployment. */
export type Health = { provider: string; model: string; demo_data?: boolean; datasets?: { id: string; demo: boolean }[] };

export function ModelsPanel({ health, onClose }: { health: Health | null; onClose: () => void }) {
  const live = health?.provider === 'meta';
  const rows = [
    {
      name: 'Muse Spark', id: health?.provider === 'meta' ? health.model : 'muse-spark-1.3',
      role: 'The agent. Plans which governed data calls answer the question (native tool calling), then writes the answer with a placeholder for every figure, and the map actions.',
      where: 'Every answer: see "How this answer was made" under it.',
      status: live ? 'Live' : 'Not connected here: the offline planner is answering', ok: live,
    },
    {
      name: 'SAM 3.1', id: 'sam-3.1',
      role: 'Segments NSW aerial imagery into building, tree canopy, car park and construction site, giving current physical cover per ring next to the official land-use map.',
      where: 'Land use layer and land-use answers.',
      status: health?.datasets?.some((d) => d.id === 'sam_land_cover') ? 'Live' : 'Batch run in progress', ok: Boolean(health?.datasets?.some((d) => d.id === 'sam_land_cover')),
    },
    { name: 'Muse Voice Transcribe', id: 'muse-voice-transcribe-1.0', role: 'Ask by voice, biased to station and street names.', where: 'Microphone in the question box.', status: 'Coming in this build', ok: false },
    { name: 'Muse Image', id: 'muse-image-1.0', role: 'A shareable precinct briefing card, built only from verified figures and labelled AI-generated.', where: '"Brief me" on a precinct.', status: 'Coming in this build', ok: false },
    { name: 'Muse Code', id: 'coding agent', role: 'Used to build parts of Lumina itself; those changes are marked in the changelog.', where: 'Repository history.', status: 'Development tool', ok: true },
  ];
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="models-title">
        <header className="drawer-head">
          <div>
            <p className="kicker">Built on Meta models</p>
            <h2 id="models-title">Where Meta AI is used</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <p className="drawer-lead">
          Meta models plan, read imagery and write. They never invent a number: every figure comes from a governed SQL query
          over NSW open data, and a deterministic checker rejects any answer whose numbers do not match.
        </p>
        <ul className="model-list">
          {rows.map((r) => (
            <li key={r.name} className="model-row">
              <div className="model-top">
                <span className="meta-chip">{r.name}</span>
                <span className={`badge ${r.ok ? 'badge-ok' : 'badge-muted'}`}>{r.status}</span>
              </div>
              <code className="model-id">{r.id}</code>
              <p>{r.role}</p>
              <p className="model-where">{r.where}</p>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
