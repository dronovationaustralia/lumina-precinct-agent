'use client';

/** The card shown during a guided tour: stop name, figures, headline and controls. */
import { LineBadges } from './LineBadges';
import type { TourDto } from './api';

export function TourCard({ tour, index, playing, onPause, onPrev, onNext, onExit }: {
  tour: TourDto;
  index: number;
  playing: boolean;
  onPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
}) {
  const stop = tour.stops[index]!;
  const last = index >= tour.stops.length - 1;
  return (
    <div className="tour-card" role="region" aria-label={`${tour.title}, stop ${index + 1} of ${tour.stops.length}`}>
      <div className="tour-head">
        <span className="tour-stop">
          {tour.title} · stop {index + 1} of {tour.stops.length}
        </span>
        <button type="button" className="tour-exit" onClick={onExit} aria-label="Exit tour">
          Exit
        </button>
      </div>
      <h2 className="tour-title">
        {stop.name}
        <LineBadges lines={stop.lines} max={4} />
      </h2>
      <p className="tour-headline">{stop.headline}</p>
      {stop.figures.length > 0 && (
        <ul className="tour-tiles" aria-label="Figures at this stop">
          {stop.figures.map((f) => (
            <li key={f.label} className="tour-tile">
              <span className="tour-value">{f.display}</span>
              <span className="tour-label">{f.label.split(',')[0]}</span>
              <span className="tour-source">
                {f.demo ? 'Demo data' : f.source} · {f.as_of}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="tour-controls">
        <button type="button" onClick={onPrev} disabled={index === 0} aria-label="Previous stop">
          ← Prev
        </button>
        <button type="button" onClick={onPause} aria-label={playing ? 'Pause tour' : 'Resume tour'}>
          {playing ? 'Pause' : last ? 'Replay' : 'Resume'}
        </button>
        <button type="button" onClick={onNext} disabled={last} aria-label="Next stop">
          Next →
        </button>
        <div className="tour-progress" aria-hidden="true">
          <i style={{ width: `${((index + 1) / tour.stops.length) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}
