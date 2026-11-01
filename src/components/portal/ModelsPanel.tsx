'use client';

/** Where each Meta model is used in Lumina, with its status in this deployment. */
export type Health = { provider: string; model: string; demo_data?: boolean; datasets?: { id: string; demo: boolean }[] };

type Tone = 'ok' | 'warn' | 'muted';

/** Status of Muse Spark in this running app, from /api/v1/health. */
function sparkStatus(health: Health | null, checking: boolean): { text: string; tone: Tone } {
  if (!health) return checking ? { text: 'Checking…', tone: 'muted' } : { text: 'Unknown: the server did not answer', tone: 'warn' };
  if (health.provider === 'meta') return { text: 'Live: answering questions', tone: 'ok' };
  if (health.provider === 'offline') return { text: 'Offline: no API key set', tone: 'warn' };
  return { text: 'Error: see the server log', tone: 'warn' };
}

/** Status of a Meta feature (voice, image) that needs a Meta key on the server. */
function featureStatus(health: Health | null, checking: boolean, liveText: string): { text: string; tone: Tone } {
  if (!health) return checking ? { text: 'Checking…', tone: 'muted' } : { text: 'Unknown: the server did not answer', tone: 'warn' };
  if (health.provider === 'meta') return { text: liveText, tone: 'ok' };
  return { text: 'Offline: no API key set', tone: 'warn' };
}

export function ModelsPanel({ health, checking, onClose, onShowSam, samStationName }: { health: Health | null; checking: boolean; onClose: () => void; onShowSam: () => void; samStationName: string | null }) {
  const spark = sparkStatus(health, checking);
  const voice = featureStatus(health, checking, 'Live: microphone in the question box');
  const image = featureStatus(health, checking, 'Live: “Brief me” on the precinct snapshot');
  const sam = health?.datasets?.find((d) => d.id === 'sam_land_cover');
  const rows: { name: string; id: string; role: string; where: string; status: { text: string; tone: Tone } }[] = [
    {
      name: 'Muse Spark', id: health?.provider === 'meta' ? health.model : 'muse-spark-1.3',
      role: 'The agent. Plans which governed data calls answer the question (native tool calling), then writes the answer with a placeholder for every figure, and the map actions.',
      where: 'Every answer: see "How this answer was made" under it.',
      status: spark,
    },
    {
      name: 'SAM 3.1', id: 'sam-3.1',
      role: 'Segments NSW aerial imagery into building, tree canopy, car park and construction site, giving current physical cover per ring next to the official land-use map.',
      where: 'Aerial land cover in the land-use breakdown and land-use answers. Run offline with npm run sam:batch.',
      status: !health ? { text: checking ? 'Checking…' : 'Unknown', tone: 'muted' } : sam ? { text: 'Live: measured cover loaded', tone: 'ok' } : { text: 'Not run yet: demo cover shown', tone: 'warn' },
    },
    { name: 'Muse Voice Transcribe', id: 'muse-voice-transcribe-1.0', role: 'Ask by voice, biased to station and street names.', where: 'Microphone in the question box.', status: voice },
    { name: 'Muse Image', id: 'muse-image-1.0', role: 'A shareable precinct briefing card, built only from verified figures and labelled AI-generated.', where: '“Brief me” on the precinct snapshot.', status: image },
    { name: 'Muse Code', id: 'coding agent', role: 'Used to build parts of Lumina itself; those changes are marked in the changelog and commits.', where: 'Repository history, not inside the app.', status: { text: 'Development tool', tone: 'ok' } },
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
                <span className={`badge badge-${r.status.tone}`}>{r.status.text}</span>
              </div>
              <code className="model-id">{r.id}</code>
              <p>{r.role}</p>
              <p className="model-where">{r.where}</p>
              {r.name === 'SAM 3.1' && (
                samStationName
                  ? <button type="button" className="layer-button" onClick={() => { onShowSam(); onClose(); }} title={`Turn on the reveal near ${samStationName}`}>Show what SAM 3.1 saw</button>
                  : <button type="button" className="layer-button" disabled>Show what SAM 3.1 saw</button>
              )}
            </li>
          ))}
        </ul>
        <dl className="status-key">
          <dt>Live</dt><dd>used by this running app right now.</dd>
          <dt>Offline</dt><dd>no Meta key on this server, so a rule-based planner answers instead (same data, same checks, plainer wording).</dd>
          <dt>Not run yet</dt><dd>the SAM batch has not been run for this data, so the aerial cover is demo data.</dd>
          <dt>Planned</dt><dd>part of the hackathon build, not in this version yet.</dd>
        </dl>
      </aside>
    </div>
  );
}
