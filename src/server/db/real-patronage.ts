/**
 * Replace the synthetic demo patronage with TfNSW station entries and exits
 * (data/derived/patronage.csv from `npm run ingest:patronage`).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { STATION_IDS } from '@/lib/contracts';

import type { Db } from './client';
import { DERIVED_DIR } from './real-sales';

export const REAL_PATRONAGE_DATASET = 'tfnsw_entries_exits';

export function realPatronageAvailable(dir = DERIVED_DIR): boolean {
  return existsSync(path.join(dir, 'patronage.csv'));
}

export async function loadRealPatronage(db: Db, dir = DERIVED_DIR): Promise<{ rows: number; asOf: string }> {
  const lines = readFileSync(path.join(dir, 'patronage.csv'), 'utf8').split(/\r?\n/).filter(Boolean).slice(1);
  const ids = new Set<string>(STATION_IDS);
  const values: string[] = [];
  let last = '';
  for (const l of lines) {
    const [id, month, entries, exits] = l.split(',');
    if (!id || !ids.has(id) || !/^\d{4}-\d{2}$/.test(month ?? '') || !/^\d+$/.test(entries ?? '') || !/^\d+$/.test(exits ?? '')) continue;
    values.push(`('${REAL_PATRONAGE_DATASET}','${id}','${month}-01',${entries},${exits})`);
    if (month! > last) last = month!;
  }
  if (!values.length) throw new Error('patronage.csv has no usable rows');
  const first = lines.map((l) => l.split(',')[1] ?? '').filter((m) => /^\d{4}-\d{2}$/.test(m)).sort()[0];
  // Month-end of the last month, as the as-of date.
  const asOf = new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)), 0)).toISOString().slice(0, 10);

  await db.exec(`
    delete from patronage;
    delete from datasets where id in ('demo_patronage', '${REAL_PATRONAGE_DATASET}');
  `);
  await db.admin(
    `insert into datasets (id, name, description, source_url, licence, as_of, coverage, is_demo) values ($1,$2,$3,$4,$5,$6,$7,false)`,
    [
      REAL_PATRONAGE_DATASET,
      'Train station entries and exits (Transport for NSW)',
      'Monthly Opal tap-on (entries) and tap-off (exits) at each station. Station rows only: nearby light rail stops and separate metro stations are not included.',
      'https://opendata.transport.nsw.gov.au/',
      'CC BY 4.0, Transport for NSW',
      asOf,
      `10 stations, ${first} to ${last}`,
    ],
  );
  await db.exec(`insert into patronage (dataset_id, station_id, month, entries, exits) values ${values.join(',')};`);
  return { rows: values.length, asOf };
}
