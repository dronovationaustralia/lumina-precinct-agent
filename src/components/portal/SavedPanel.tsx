'use client';

/** Saved analyses (kept in this browser for the signed-in user): reopen, export, remove. */
import type { Saved } from './exporting';

export function SavedPanel({ items, names, onOpen, onRemove, onExportAll, onClose }: {
  items: Saved[];
  names: (id?: string) => string | undefined;
  onOpen: (s: Saved) => void;
  onRemove: (id: string) => void;
  onExportAll: () => void;
  onClose: () => void;
}) {
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="saved-title">
        <header className="drawer-head">
          <div>
            <p className="kicker">Your work</p>
            <h2 id="saved-title">Saved analyses</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <p className="drawer-lead">Saved in this browser for your account. Reopen one to add it to the conversation, or export them all as one PDF report.</p>
        {items.length === 0 ? (
          <p className="drawer-lead">Nothing saved yet. Use <strong>Save</strong> under any answer.</p>
        ) : (
          <>
            <button type="button" className="layer-button" onClick={onExportAll}>Export all as a PDF report</button>
            <ul className="saved-list">
              {items.map((s) => (
                <li key={s.id} className="saved-item">
                  <button type="button" className="saved-open" onClick={() => onOpen(s)}>
                    <span className="saved-q">{s.question}</span>
                    <span className="saved-meta">{names(s.station) ? `${names(s.station)} · ` : ''}{new Date(s.saved_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  </button>
                  <button type="button" className="link-button" onClick={() => onRemove(s.id)}>Remove</button>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  );
}
