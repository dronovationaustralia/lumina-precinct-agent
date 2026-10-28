/**
 * NSW Valuer General bulk property sales: parsing.
 *
 * Files are zips of `.DAT` files (annual zips contain weekly zips). Each `.DAT` is
 * semicolon-separated with record types:
 *   A header, B sale, C legal description (lot/plan), D party type only (no names), Z trailer.
 *
 * B record fields (index: meaning), checked against the 2024 to 2026 files:
 *   1 district code, 2 property id, 3 sale counter, 4 download date-time, 5 property name,
 *   6 unit number, 7 house number, 8 street name, 9 locality, 10 postcode, 11 area,
 *   12 area type (M square metres, H hectares), 13 contract date YYYYMMDD,
 *   14 settlement date, 15 purchase price, 16 zoning, 17 nature (R residence, V vacant, 3 other),
 *   18 primary purpose, 19 strata lot number, 20 component code, 21 sale code,
 *   22 % interest of sale, 23 dealing number.
 *
 * Licence: Creative Commons Attribution (text bundled in each zip). Credit Valuation NSW.
 */
import { unzipSync } from 'fflate';

export type VgSale = {
  district: string;
  property_id: string;
  sale_counter: string;
  downloaded: string;
  unit_number: string;
  house_number: string;
  street_name: string;
  locality: string;
  postcode: string;
  area_m2: number | null;
  contract_date: string; // YYYY-MM-DD
  settlement_date: string;
  price: number;
  zoning: string;
  nature: string;
  purpose: string;
  strata_lot: string;
  percent_interest: string;
  dealing: string;
  legal: string; // from the C record, e.g. 102/1014574
  property_type: 'house' | 'unit';
};

const ymd = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '');

function areaM2(value: string, type: string): number | null {
  const v = Number(value);
  if (!value || !Number.isFinite(v) || v <= 0) return null;
  if (type === 'H') return v * 10_000;
  if (type === 'M') return v;
  return null;
}

/** Parse one .DAT file's text into sales (B records joined to their C record). */
export function parseDat(text: string): VgSale[] {
  const sales: VgSale[] = [];
  const legalByKey = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('C;')) {
      const f = line.split(';');
      const key = `${f[1]}|${f[2]}|${f[3]}`;
      if (!legalByKey.has(key)) legalByKey.set(key, (f[5] ?? '').trim());
    }
  }
  for (const line of lines) {
    if (!line.startsWith('B;')) continue;
    const f = line.split(';').map((x) => x.trim());
    if (f.length < 24) continue;
    const strata = f[19] ?? '';
    const unitNo = f[6] ?? '';
    sales.push({
      district: f[1]!,
      property_id: f[2]!,
      sale_counter: f[3]!,
      downloaded: f[4]!,
      unit_number: unitNo,
      house_number: f[7]!,
      street_name: f[8]!,
      locality: f[9]!,
      postcode: f[10]!,
      area_m2: areaM2(f[11]!, f[12]!),
      contract_date: ymd(f[13]!),
      settlement_date: ymd(f[14]!),
      price: Number(f[15]) || 0,
      zoning: f[16]!,
      nature: f[17]!,
      purpose: f[18]!,
      strata_lot: strata,
      percent_interest: f[22]!,
      dealing: f[23]!,
      legal: legalByKey.get(`${f[1]}|${f[2]}|${f[3]}`) ?? '',
      property_type: strata || unitNo ? 'unit' : 'house',
    });
  }
  return sales;
}

/** All .DAT texts inside a zip, recursing into nested zips (annual files). */
export function datTextsFromZip(bytes: Uint8Array, name = 'zip'): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  const files = unzipSync(bytes);
  for (const [n, data] of Object.entries(files)) {
    if (/\.zip$/i.test(n)) out.push(...datTextsFromZip(data, n));
    else if (/\.dat$/i.test(n)) out.push({ name: `${name}/${n}`, text: new TextDecoder('latin1').decode(data) });
  }
  return out;
}

export type FilterStats = Record<string, number>;

/**
 * Keep arm's-length residential sales in the window, one row per transfer.
 * - Deduplicate the same sale reported in several weekly files (latest download wins).
 * - Drop multi-property dealings (one price for several properties) and part-interest sales.
 * - Drop non-residential, prices under A$50,000 (typically not arm's length) and bad dates.
 */
/**
 * `lagMonths`: sales are lodged weeks to months after contract, so the latest months are incomplete.
 * The window ends at the last day of the month `lagMonths` before the latest contract date.
 */
export function cleanSales(all: VgSale[], months = 24, lagMonths = 0): { sales: VgSale[]; asOf: string; latestContract: string; stats: FilterStats } {
  const stats: FilterStats = { b_records: all.length };
  const byKey = new Map<string, VgSale>();
  for (const s of all) {
    const key = s.dealing ? `${s.property_id}|${s.dealing}` : `${s.property_id}|${s.contract_date}|${s.price}`;
    const prev = byKey.get(key);
    if (!prev || s.downloaded > prev.downloaded) byKey.set(key, s);
  }
  let rows = [...byKey.values()];
  stats.after_dedupe = rows.length;

  const propsPerDealing = new Map<string, Set<string>>();
  for (const s of rows) if (s.dealing) (propsPerDealing.get(s.dealing) ?? propsPerDealing.set(s.dealing, new Set()).get(s.dealing)!).add(s.property_id);
  rows = rows.filter((s) => !s.dealing || propsPerDealing.get(s.dealing)!.size === 1);
  stats.after_multi_property = rows.length;

  rows = rows.filter((s) => s.nature === 'R' && s.purpose === 'RESIDENCE');
  stats.after_residential = rows.length;
  // Part-interest sales carry 1 to 99. Blank, 0 (older files) and 100 mean the whole property.
  rows = rows.filter((s) => {
    const p = Number(s.percent_interest || 0);
    return !(p > 0 && p < 100);
  });
  stats.after_part_interest = rows.length;
  rows = rows.filter((s) => s.price >= 50_000 && s.contract_date);
  stats.after_price_and_date = rows.length;

  const latestContract = rows.reduce((m, s) => (s.contract_date > m ? s.contract_date : m), '');
  let asOf = latestContract;
  if (lagMonths > 0) {
    const d = new Date(`${latestContract.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - lagMonths + 1);
    d.setUTCDate(0); // last day of the month lagMonths before
    asOf = d.toISOString().slice(0, 10);
  }
  const start = new Date(`${asOf}T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - months);
  const startStr = start.toISOString().slice(0, 10);
  rows = rows.filter((s) => s.contract_date > startStr && s.contract_date <= asOf);
  stats.in_window = rows.length;
  stats.units = rows.filter((s) => s.property_type === 'unit').length;
  stats.houses = rows.filter((s) => s.property_type === 'house').length;
  return { sales: rows, asOf, latestContract, stats };
}
