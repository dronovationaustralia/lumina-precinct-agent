/** GET /api/v1/health: provider, database, data versions. */
import { connection } from 'next/server';

import { getModel } from '@/server/agent/providers';
import { getDb } from '@/server/db/client';
import { json, preflight } from '@/server/http';
import { listDatasets } from '@/server/metrics/query';


export function OPTIONS() {
  return preflight();
}

export async function GET() {
  await connection();
  const started = performance.now();
  let provider = 'unknown';
  let model = 'unknown';
  try {
    const m = getModel();
    provider = m.provider;
    model = m.model;
  } catch (e) {
    provider = `misconfigured: ${e instanceof Error ? e.message : String(e)}`;
  }
  try {
    const db = await getDb();
    const datasets = await listDatasets(db);
    return json({
      status: 'ok',
      provider,
      model,
      database: db.kind,
      demo_data: datasets.some((d) => d.is_demo),
      datasets: datasets.map((d) => ({ id: d.dataset_id, name: d.name, as_of: d.as_of, licence: d.licence, demo: d.is_demo })),
      latency_ms: Math.round(performance.now() - started),
    });
  } catch (e) {
    return json({ status: 'degraded', provider, model, error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
