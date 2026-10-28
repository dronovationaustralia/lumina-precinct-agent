import { describe, expect, test } from 'vitest';

import { guardSql, MAX_ROWS } from '@/server/tools/sql-guard';

describe('run_sql guard', () => {
  test('accepts SELECTs over governed views, with CTEs, and wraps a row limit', async () => {
    const r = await guardSql(`with p as (select * from v_sales_period where period = 'last_12m')
      select station_id, max(median_price) from p join v_stations using (station_id) group by 1;`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sql.endsWith(`limit ${MAX_ROWS}`)).toBe(true);
      expect(r.views.sort()).toEqual(['v_sales_period', 'v_stations']);
    }
  });

  test.each([
    ['delete from sales', /only SELECT/],
    ['update stations set name = 1', /only SELECT/],
    ['select 1; select 2', /exactly one statement/],
    ['select * from sales', /relation sales is not allowed/],
    ['select * from v_stations, sale_station', /relation sale_station is not allowed/],
    ['select * from pg_catalog.pg_roles', /schema pg_catalog/],
    ['select pg_sleep(10) from v_stations', /pg_sleep/],
    ['select current_setting(\'role\') from v_stations', /current_setting/],
    ['select * into t2 from v_stations', /INTO/],
    ['select * from v_stations for update', /locking|LockingClause/],
    ['select * from generate_series(1, 10)', /RangeFunction/],
    ['select 1', /at least one governed view/],
    ['selec * from v_stations', /does not parse/],
    ['with x as (delete from sales returning *) select * from x', /DeleteStmt/],
  ])('rejects %s', async (sql, re) => {
    const r = await guardSql(sql);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(re);
  });
});
