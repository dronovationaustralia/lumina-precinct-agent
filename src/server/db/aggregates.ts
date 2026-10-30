/** Recompute the materialized sales aggregates after sales or stations change. */
import type { Db } from './client';

export const AGGREGATES = ['v_sales_period', 'v_sales_monthly', 'v_affordable_share', 'v_sales_hex'] as const;

export async function refreshAggregates(db: Db): Promise<void> {
  for (const v of AGGREGATES) await db.exec(`refresh materialized view ${v};`);
}
