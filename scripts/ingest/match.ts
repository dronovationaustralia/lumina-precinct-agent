/**
 * Match Valuer General sales to G-NAF address points.
 *
 * Order of attempts (the first hit wins, and the method is recorded):
 *   1. legal     lot/plan (or lot/strata plan) equals G-NAF LEGAL_PARCEL_ID
 *   2. address   flat, number, street name, street type, suffix and locality all equal
 *   3. no_type   as 2 without the street type (abbreviation mismatches)
 *   4. building  units only: same building (strata plan, else street address without the flat)
 */
import {
  addressKey, flatNumber, houseNumber, legalKeys, splitStreet, strataPlan, clean, type AddressParts, type StreetTypes,
} from './address-normalise';

export type GnafRow = {
  pid: string; alias: string; flat: string; number: string; number_suffix: string; street: string; type: string;
  street_suffix: string; locality: string; postcode: string; legal: string; lon: string; lat: string;
};
export type SaleRow = Record<string, string>;
export type MatchMethod = 'legal' | 'address' | 'no_type' | 'building';
export type Point = [number, number];

export class GnafIndex {
  private legal = new Map<string, Point>();
  private full = new Map<string, Point>();
  private noType = new Map<string, Point>();
  private building = new Map<string, Point>();
  private plan = new Map<string, Point>();
  size = 0;

  constructor(rows: Iterable<GnafRow>) {
    // Principal addresses first so they win over aliases.
    const all = [...rows].sort((a, b) => (a.alias === 'P' ? 0 : 1) - (b.alias === 'P' ? 0 : 1));
    for (const r of all) {
      const p: Point = [Number(r.lon), Number(r.lat)];
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      this.size++;
      const a: AddressParts = { flat: r.flat, number: r.number, numberSuffix: r.number_suffix, street: r.street, type: r.type, streetSuffix: r.street_suffix, locality: r.locality };
      const set = (m: Map<string, Point>, k: string) => { if (!m.has(k)) m.set(k, p); };
      if (r.legal) set(this.legal, r.legal);
      set(this.full, addressKey(a));
      set(this.noType, addressKey(a, { withType: false }));
      set(this.building, addressKey(a, { withFlat: false }));
      const sp = strataPlan(r.legal);
      if (sp) set(this.plan, sp);
    }
  }

  match(s: SaleRow, types: StreetTypes): { point: Point; method: MatchMethod } | null {
    for (const k of legalKeys(s.legal ?? '')) {
      const p = this.legal.get(k);
      if (p) return { point: p, method: 'legal' };
    }
    const st = splitStreet(s.street_name ?? '', types);
    const hn = houseNumber(s.house_number ?? '');
    const a: AddressParts = { flat: flatNumber(s.unit_number ?? ''), number: hn.first, numberSuffix: hn.suffix, street: st.name, type: st.type, streetSuffix: st.suffix, locality: clean(s.locality ?? '') };
    if (a.number && a.street) {
      const full = this.full.get(addressKey(a));
      if (full) return { point: full, method: 'address' };
      const nt = this.noType.get(addressKey(a, { withType: false }));
      if (nt) return { point: nt, method: 'no_type' };
    }
    if (s.property_type === 'unit') {
      const sp = strataPlan(s.legal ?? '');
      const byPlan = sp ? this.plan.get(sp) : undefined;
      if (byPlan) return { point: byPlan, method: 'building' };
      const b = a.number && a.street ? this.building.get(addressKey(a, { withFlat: false })) : undefined;
      if (b) return { point: b, method: 'building' };
    }
    return null;
  }
}

/** Greater Sydney, approximated by postcode ranges, for the "city median" reference. */
export function isGreaterSydneyPostcode(pc: string): boolean {
  const n = Number(pc);
  return (n >= 2000 && n <= 2249) || (n >= 2555 && n <= 2574) || (n >= 2740 && n <= 2786);
}
