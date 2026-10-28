/**
 * Address normalisation shared by the G-NAF extract and the sales matcher.
 *
 * Both sides are reduced to G-NAF street type CODES (ROAD, AVENUE, ...), upper case, single spaces.
 * G-NAF's authority table maps CODE -> abbreviation (ROAD -> RD, AVENUE -> AV); the Valuer General
 * files use their own abbreviations (AVE, CRES, CT), so extra aliases are added here.
 */

/** Valuer General abbreviations that differ from G-NAF's (abbreviation -> G-NAF code). */
export const EXTRA_STREET_TYPES: Record<string, string> = {
  AVE: 'AVENUE', CRES: 'CRESCENT', CT: 'COURT', GR: 'GROVE', GLD: 'GLADE', PKWY: 'PARKWAY', CIR: 'CIRCLE',
  GDNS: 'GARDENS', RDGE: 'RIDGE', QY: 'QUAY', CH: 'CHASE', SQ: 'SQUARE', BVD: 'BOULEVARD', BOULEVARDE: 'BOULEVARD',
  BLVD: 'BOULEVARD', CCT: 'CIRCUIT', PDE: 'PARADE', TCE: 'TERRACE', HWY: 'HIGHWAY', ESP: 'ESPLANADE', PL: 'PLACE',
  CL: 'CLOSE', DR: 'DRIVE', ST: 'STREET', RD: 'ROAD', LA: 'LANE', LN: 'LANE', MWY: 'MOTORWAY', FWY: 'FREEWAY',
};

export const SUFFIXES: Record<string, string> = {
  N: 'N', S: 'S', E: 'E', W: 'W', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', NE: 'NE', NW: 'NW', SE: 'SE', SW: 'SW',
  EXTENSION: 'EX', EX: 'EX', LOWER: 'LR', LR: 'LR', UPPER: 'UP', UP: 'UP', CENTRAL: 'CN', CN: 'CN',
};

export type StreetTypes = { toCode: Map<string, string>; codes: Set<string> };

/** Build the abbreviation -> code map from G-NAF's STREET_TYPE_AUT rows (CODE|NAME|DESCRIPTION). */
export function streetTypes(autRows: { code: string; name: string }[]): StreetTypes {
  const toCode = new Map<string, string>();
  const codes = new Set<string>();
  for (const r of autRows) {
    codes.add(r.code);
    toCode.set(r.code, r.code);
    toCode.set(r.name, r.code);
  }
  for (const [abbr, code] of Object.entries(EXTRA_STREET_TYPES)) if (!toCode.has(abbr)) toCode.set(abbr, code);
  return { toCode, codes };
}

export const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Split a Valuer General street ("MOUNT BAKER RD", "PACIFIC HWY W") into name, type code, suffix. */
export function splitStreet(street: string, types: StreetTypes): { name: string; type: string; suffix: string } {
  const tokens = clean(street).split(' ').filter(Boolean);
  let suffix = '';
  if (tokens.length > 2 && SUFFIXES[tokens.at(-1)!]) suffix = SUFFIXES[tokens.pop()!]!;
  let type = '';
  if (tokens.length > 1 && types.toCode.has(tokens.at(-1)!)) type = types.toCode.get(tokens.pop()!)!;
  return { name: tokens.join(' '), type, suffix };
}

/** "12", "12A", "12-14" -> { first: "12", suffix: "A" } (first number of a range). */
export function houseNumber(raw: string): { first: string; suffix: string } {
  const m = clean(raw).match(/^(\d+)\s*([A-Z]?)/);
  return m ? { first: m[1]!, suffix: m[2] ?? '' } : { first: '', suffix: '' };
}

export const flatNumber = (raw: string) => clean(raw).replace(/^0+(?=\d)/, '');

export type AddressParts = { flat: string; number: string; numberSuffix: string; street: string; type: string; streetSuffix: string; locality: string };

export function addressKey(a: AddressParts, opts: { withType?: boolean; withFlat?: boolean } = {}): string {
  const withType = opts.withType ?? true;
  const withFlat = opts.withFlat ?? true;
  return [withFlat ? a.flat : '', a.number + a.numberSuffix, a.street, withType ? a.type : '', a.streetSuffix, a.locality].join('|');
}

/**
 * Lot/plan keys from a Valuer General legal description. "102/1014574" and "1/SP108284" match
 * G-NAF LEGAL_PARCEL_ID exactly. Multi-lot forms ("5, 6/23137", "5/664132 4/7/758357") yield one key
 * per lot so any of them can match.
 */
export function legalKeys(legal: string): string[] {
  const out: string[] = [];
  // Split only at spaces that follow a lot/plan token ("5/664132 4/7/758357"), not inside "5, 6/23137".
  for (const part of legal.toUpperCase().split(/(?<=\/[\w/]*)\s+/)) {
    const m = part.trim().match(/^([\w ,]+?)\/((?:[A-Z0-9]+\/)?(?:SP)?\d+)$/);
    if (!m) continue;
    for (const lot of m[1]!.split(',').map((x) => x.trim()).filter(Boolean)) out.push(`${lot}/${m[2]}`);
  }
  return [...new Set(out)];
}

/** Strata plan from a legal description ("6/SP10062" -> "SP10062"), for building-level matches. */
export function strataPlan(legal: string): string | null {
  return legal.toUpperCase().match(/\bSP\d+\b/)?.[0] ?? null;
}
