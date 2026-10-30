/**
 * GET /api/v1/summary: one line per station for the line strip and scorecard:
 * unit median within 800 m (last 12 months), its sale count, and 12-month station patronage.
 */
import { connection } from 'next/server';

import { STATIONS } from '@/lib/stations';
import { getDb } from '@/server/db/client';
import { json, preflight } from '@/server/http';

export function OPTIONS() {
  return preflight();
}

export async function GET() {
  await connection();
  const db = await getDb();
  const prices = await db.readOnly<{ station_id: string; property_type: string; sales_count: number; median_price: number | null; as_of: string }>(
    `select station_id, property_type, sales_count, median_price, as_of from v_sales_period
     where ring_id = '0-800m' and period = 'last_12m' and property_type in ('unit', 'house')`,
  );
  const trips = await db.readOnly<{ station_id: string; total: number; last: string }>(
    `with b as (select max(month) as last from v_patronage_monthly)
     select station_id, sum(total)::float8 as total, max(b.last) as last from v_patronage_monthly, b
     where month > to_char(to_date(b.last, 'YYYY-MM') - interval '12 months', 'YYYY-MM') group by station_id`,
  );
  const ds = await db.readOnly<{ dataset_id: string; is_demo: boolean }>('select dataset_id, is_demo from v_datasets');
  return json({
    stations: STATIONS.map((s) => {
      const unit = prices.find((p) => p.station_id === s.id && p.property_type === 'unit');
      const house = prices.find((p) => p.station_id === s.id && p.property_type === 'house');
      const t = trips.find((p) => p.station_id === s.id);
      return {
        id: s.id,
        unit_median_800m: unit?.median_price == null ? null : Math.round(Number(unit.median_price)),
        unit_sales_800m: unit?.sales_count ?? 0,
        house_median_800m: house?.median_price == null ? null : Math.round(Number(house.median_price)),
        house_sales_800m: house?.sales_count ?? 0,
        trips_12m: t ? Number(t.total) : null,
      };
    }),
    as_of: { sales: prices[0]?.as_of ?? null, patronage: trips[0]?.last ?? null },
    demo: Object.fromEntries(ds.map((d) => [d.dataset_id, d.is_demo])),
  });
}
