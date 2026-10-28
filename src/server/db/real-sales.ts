/**
 * Replace the synthetic demo sales with real NSW Valuer General sales located via G-NAF.
 *
 * Input files come from the ingest scripts (data/derived, gitignored):
 *   sales_geocoded.csv, reference_medians.csv, geocode_summary.json
 * Street addresses are never loaded: only date, price, type, land area and the point.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Db } from './client';

export const REAL_SALES_DATASET = 'nsw_vg_sales';
export const DERIVED_DIR = path.join(process.cwd(), 'data', 'derived');

export function realSalesAvailable(dir = DERIVED_DIR): boolean {
  return existsSync(path.join(dir, 'sales_geocoded.csv')) && existsSync(path.join(dir, 'geocode_summary.json'));
}

function rows(text: string): string[][] {
  return text.split(/\r?\n/).filter(Boolean).slice(1).map((l) => l.split(','));
}

const num = (s: string | undefined) => (s && Number.isFinite(Number(s)) ? Number(s) : null);
const date = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

export async function loadRealSales(db: Db, dir = DERIVED_DIR, log: (m: string) => void = () => {}): Promise<{ sales: number; asOf: string }> {
  const summary = JSON.parse(readFileSync(path.join(dir, 'geocode_summary.json'), 'utf8')) as { as_of: string; matched: number };
  const sales = rows(readFileSync(path.join(dir, 'sales_geocoded.csv'), 'utf8'));
  const refs = existsSync(path.join(dir, 'reference_medians.csv')) ? rows(readFileSync(path.join(dir, 'reference_medians.csv'), 'utf8')) : [];
  const start = new Date(`${summary.as_of}T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - 24);

  await db.exec(`
    delete from sale_station;
    delete from sales;
    delete from reference_medians;
    delete from datasets where id in ('demo_sales', '${REAL_SALES_DATASET}');
  `);
  await db.admin(
    `insert into datasets (id, name, description, source_url, licence, as_of, coverage, is_demo) values ($1,$2,$3,$4,$5,$6,$7,false)`,
    [
      REAL_SALES_DATASET,
      'NSW property sales (Valuation NSW)',
      'Residential sales from the NSW Valuer General bulk sales files, located with G-NAF. Whole-property, arm\'s-length sales only; multi-property dealings removed.',
      'https://www.valuergeneral.nsw.gov.au/',
      'CC BY (Valuation NSW). Locations: G-NAF © Geoscape Australia, Open G-NAF EULA',
      summary.as_of,
      `Residential sales within 5 km of the 10 stations, ${start.toISOString().slice(0, 10)} to ${summary.as_of}`,
    ],
  );

  // Batched literal VALUES: every field is validated as a number, a date or a known type.
  let loaded = 0;
  for (let i = 0; i < sales.length; i += 1000) {
    const values: string[] = [];
    for (const [d, price, type, area, lon, lat] of sales.slice(i, i + 1000)) {
      const dd = date(d), p = num(price), lo = num(lon), la = num(lat), a = num(area);
      if (!dd || !p || lo === null || la === null || (type !== 'house' && type !== 'unit')) continue;
      values.push(`('${REAL_SALES_DATASET}','${dd}',${p},'${type}',${a ?? 'null'},st_setsrid(st_makepoint(${lo},${la}),4326)::geography)`);
    }
    if (values.length) await db.exec(`insert into sales (dataset_id, contract_date, price, property_type, land_area_m2, geom) values ${values.join(',')};`);
    loaded += values.length;
    if (i % 20_000 === 0) log(`  sales ${loaded.toLocaleString()}`);
  }
  for (const [region, type, period, median, count] of refs) {
    if (!median) continue;
    await db.admin(
      'insert into reference_medians (dataset_id, region, property_type, period, median_price, sales_count) values ($1,$2,$3,$4,$5,$6)',
      [REAL_SALES_DATASET, region, type, period, Number(median), Number(count)],
    );
  }
  await db.exec(`
    insert into sale_station (sale_id, station_id, distance_m)
    select s.id, st.id, st_distance(s.geom, st.geom)
    from sales s join stations st on st_dwithin(s.geom, st.geom, 5000);
  `);
  return { sales: loaded, asOf: summary.as_of };
}
