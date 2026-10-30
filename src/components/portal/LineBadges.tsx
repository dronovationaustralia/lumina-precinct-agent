import { LINE_COLOURS } from '@/lib/lines';

export function LineBadges({ lines, max = 6 }: { lines: string[]; max?: number }) {
  const shown = lines.slice(0, max);
  return (
    <span className="line-badges" aria-label={`Lines ${lines.join(', ')}`}>
      {shown.map((l) => <span key={l} className="line-badge" style={{ background: LINE_COLOURS[l] ?? '#56645f' }}>{l}</span>)}
      {lines.length > max && <span className="line-more">+{lines.length - max}</span>}
    </span>
  );
}
