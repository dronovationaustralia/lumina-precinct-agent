/**
 * Facts: the only numbers the agent may say.
 *
 * Tools register every figure they return here and get back an id (f1, f2, ...). The
 * model writes `{f3}` in its answer; the verifier checks each placeholder exists, and the
 * server swaps in `display`.
 */
import type { Fact } from '@/lib/contracts';

export type Unit = 'aud' | 'aud_per_m2' | 'pct' | 'pct_change' | 'ratio' | 'count' | 'trips' | 'pct_points' | 'm2' | 'm';

export function formatValue(value: number | null, unit: Unit | string): string {
  if (value === null || !Number.isFinite(value)) return 'not available';
  switch (unit) {
    case 'aud':
      if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}m`;
      if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1_000)}k`;
      return `$${Math.round(value)}`;
    case 'aud_per_m2':
      return `$${Math.round(value).toLocaleString('en-AU')}/m²`;
    case 'pct':
      return `${value.toFixed(1)}%`;
    case 'pct_change':
      return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
    case 'pct_points':
      return `${value >= 0 ? '+' : ''}${value.toFixed(1)} pts`;
    case 'ratio':
      return `${value.toFixed(2)}×`;
    case 'trips':
      return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}m` : `${Math.round(value / 1000)}k`;
    case 'count':
      return Math.round(value).toLocaleString('en-AU');
    case 'm2':
      return `${Math.round(value).toLocaleString('en-AU')} m²`;
    case 'm':
      return `${Math.round(value).toLocaleString('en-AU')} m`;
    default:
      return `${Number.isInteger(value) ? value : value.toFixed(2)}${unit ? ` ${unit}` : ''}`;
  }
}

export class FactStore {
  private readonly facts: Fact[] = [];

  add(f: Omit<Fact, 'id' | 'display'> & { display?: string }): Fact {
    const fact: Fact = {
      ...f,
      id: `f${this.facts.length + 1}`,
      display: f.display ?? (f.suppressed ? 'suppressed (fewer than 10 sales)' : formatValue(f.value, f.unit)),
    };
    this.facts.push(fact);
    return fact;
  }

  get(id: string): Fact | undefined {
    return this.facts.find((f) => f.id === id);
  }

  all(): Fact[] {
    return [...this.facts];
  }

  get size(): number {
    return this.facts.length;
  }
}

/** Compact form of facts for the model: id, label, display, and whether usable. */
export function factsForModel(facts: Fact[]): string {
  return facts
    .map((f) => `${f.id}: ${f.label} = ${f.display}${f.value === null ? ' [NOT USABLE: no value]' : ''}`)
    .join('\n');
}
