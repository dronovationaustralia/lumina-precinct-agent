'use client';

/**
 * The "Brief me" precinct card in a drawer: the Muse Image illustration on top
 * (labelled AI-generated), then the verified figures as real text tiles.
 * "Download card" composes the same card into a PNG with a <canvas>.
 */
import { useEffect, useRef, useState } from 'react';

import { LINE_COLOURS } from '@/lib/lines';

import { LineBadges } from './LineBadges';
import { fetchBriefing, type BriefingDto, type StationDto } from './api';

/** Shorten text with an ellipsis until it fits the width. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The illustration could not be drawn.'));
    img.src = src;
  });
}

export function BriefingCard({ station, onClose }: { station: StationDto; onClose: () => void }) {
  const [data, setData] = useState<BriefingDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let live = true;
    fetchBriefing(station.id)
      .then((d) => live && (setData(d), setError(null)))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [station.id]);

  const download = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !data?.image) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const img = await loadImage(data.image);
      const W = 720;
      const pad = 40;
      const imgH = Math.round((W * img.naturalHeight) / img.naturalWidth);
      const headH = 190;
      const rowH = 118;
      const footH = 120;
      canvas.width = W;
      canvas.height = imgH + headH + data.figures.length * rowH + footH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This browser cannot draw the card.');

      const ink = '#1e2d2b';
      const muted = '#56645f';
      const faint = '#7d8a85';
      const rule = '#e5e9e4';
      const font = '"Public Sans", system-ui, sans-serif';

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, W, imgH);

      let y = imgH + 44;
      ctx.fillStyle = muted;
      ctx.font = `600 19px ${font}`;
      ctx.fillText('PRECINCT BRIEFING', pad, y);
      y += 52;
      ctx.fillStyle = ink;
      ctx.font = `700 46px ${font}`;
      ctx.fillText(fitText(ctx, data.name, W - pad * 2), pad, y);
      y += 22;
      let bx = pad;
      for (const line of station.lines.slice(0, 4)) {
        ctx.font = `700 20px ${font}`;
        const w = ctx.measureText(line).width + 24;
        roundRectPath(ctx, bx, y, w, 34, 8);
        ctx.fillStyle = LINE_COLOURS[line] ?? '#56645f';
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(line, bx + 12, y + 24);
        bx += w + 8;
      }
      y += 64;

      for (const f of data.figures) {
        ctx.strokeStyle = rule;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(W - pad, y);
        ctx.stroke();
        y += 40;
        ctx.fillStyle = ink;
        ctx.font = `700 34px ${font}`;
        ctx.fillText(f.display, pad, y);
        y += 32;
        ctx.fillStyle = muted;
        ctx.font = `400 20px ${font}`;
        ctx.fillText(fitText(ctx, f.label, W - pad * 2), pad, y);
        y += 28;
        ctx.fillStyle = faint;
        ctx.font = `400 16px ${font}`;
        ctx.fillText(fitText(ctx, `${f.source} · ${f.as_of}`, W - pad * 2), pad, y);
        y += rowH - 100;
      }

      ctx.strokeStyle = rule;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(W - pad, y);
      ctx.stroke();
      y += 34;
      ctx.fillStyle = faint;
      ctx.font = `400 17px ${font}`;
      ctx.fillText('Figures: governed NSW open data, checked. Not financial advice.', pad, y);
      y += 28;
      ctx.fillText('Illustration: AI-generated (Muse Image).', pad, y);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('The card could not be rendered.');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lumina-briefing-${data.station}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer brief-drawer" role="dialog" aria-modal="true" aria-labelledby="brief-title">
        <header className="drawer-head">
          <div>
            <p className="kicker">Precinct briefing</p>
            <h2 id="brief-title">{station.name}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {!data && !error && (
          <p className="brief-loading" aria-live="polite">
            <span className="meta-dot" aria-hidden="true" />
            Muse Image is drawing the precinct…
          </p>
        )}
        {error && !data && (
          <p className="turn-error" role="alert">
            {error}
          </p>
        )}

        {data && (
          <>
            {data.image ? (
              <figure className="brief-figure">
                {/* eslint-disable-next-line @next/next/no-img-element -- data-URL illustration, not optimizable */}
                <img src={data.image} alt={`AI-generated illustration of the ${data.name} precinct`} />
                <figcaption>Illustration: AI-generated (Muse Image)</figcaption>
              </figure>
            ) : (
              <p className="notice">The illustration is unavailable right now; the figures below are current.</p>
            )}
            <div className="brief-lines">
              <LineBadges lines={station.lines} />
            </div>
            <ul className="brief-tiles">
              {data.figures.map((f) => (
                <li key={f.label} className="brief-tile">
                  <span className="brief-value">{f.display}</span>
                  <span className="brief-label">{f.label}</span>
                  <span className="brief-source">
                    {f.source} · {f.as_of}
                  </span>
                </li>
              ))}
            </ul>
            <p className="brief-foot">Figures: governed NSW open data, checked. Not financial advice.</p>
            {downloadError && (
              <p className="turn-error" role="alert">
                {downloadError}
              </p>
            )}
            <div className="brief-actions">
              <button type="button" className="ask-button" disabled={downloading || !data.image} onClick={() => void download()}>
                {downloading ? 'Drawing…' : 'Download card'}
              </button>
              <button type="button" className="head-button" onClick={onClose}>
                Close
              </button>
            </div>
            <canvas ref={canvasRef} hidden aria-hidden="true" />
          </>
        )}
      </aside>
    </div>
  );
}
