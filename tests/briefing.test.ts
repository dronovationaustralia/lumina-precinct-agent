/**
 * Briefing card: the image prompt never carries text or numbers (figures are rendered
 * by our code), and briefingFacts returns only figures present in the database.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { LAND_USE_CATEGORIES } from '@/lib/landuse';
import { STATIONS } from '@/lib/stations';
import { briefingFacts, briefingPrompt, type LandUseSlice } from '@/server/briefing';
import { createTestDb, type Db } from '@/server/db/client';
import { FactStore } from '@/server/facts';
import { METRIC_BY_ID } from '@/server/metrics/catalogue';
import { computeMetric, listDatasets, metricFact } from '@/server/metrics/query';

const MIXES: LandUseSlice[][] = [
  [],
  [
    { category: 'residential', share_pct: 42.1 },
    { category: 'commercial', share_pct: 12.4 },
    { category: 'natural', share_pct: 9.8 },
  ],
  [{ category: 'not_a_category', share_pct: 50 }],
];

describe('briefingPrompt', () => {
  test('always carries the no-text rule and never a digit (every station)', () => {
    for (const station of STATIONS) {
      for (const mix of MIXES) {
        const prompt = briefingPrompt(station, mix);
        expect(prompt).toContain('No text, no letters, no numbers');
        expect(prompt).not.toMatch(/\d/);
      }
    }
  });
});

const QUERIES = [
  ['median_price', '0-800m', 'unit'],
  ['price_change_12m', '0-800m', 'unit'],
  ['median_price', '0-800m', 'house'],
  ['patronage_12m', '0-800m', 'all'],
  ['patronage_change_12m', '0-800m', 'all'],
] as const;

describe('briefingFacts (demo data)', () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db?.close();
  });

  test.each(['chatswood', 'parramatta'])('returns only figures present in the database: %s', async (station) => {
    const figures = await briefingFacts(db, station);
    expect(figures.length).toBeGreaterThan(0);

    // Metric figures equal the governed query results; suppressed ones are left out.
    const datasets = await listDatasets(db);
    const store = new FactStore();
    const expected = [];
    for (const [metric, ring, pt] of QUERIES) {
      const res = await computeMetric(db, METRIC_BY_ID.get(metric)!, station, ring, pt);
      const fact = metricFact(store, res, datasets);
      if (!fact.suppressed && fact.value !== null) expected.push(fact);
    }
    const metricFigures = figures.filter((f) => !f.category);
    expect(metricFigures.length).toBe(expected.length);
    for (const fact of expected) {
      const got = metricFigures.find((f) => f.label === fact.label);
      expect(got).toBeDefined();
      expect(got!.value).toBe(fact.value);
      expect(got!.display).toBe(fact.display);
      expect(got!.source).toBe(fact.source);
      expect(got!.as_of).toBe(fact.as_of);
    }

    // Land-use figures are the top three mix rows, unchanged.
    const rows = (
      await db.readOnly<{ category: string; share_pct: number }>(
        'select category, share_pct from v_land_use_mix where station_id = $1 and ring_id = $2 order by share_pct desc limit 3',
        [station, '0-800m'],
      )
    ).filter((r) => r.category in LAND_USE_CATEGORIES);
    const landUseFigures = figures.filter((f) => f.category);
    expect(landUseFigures.length).toBe(rows.length);
    for (const fig of landUseFigures) {
      const row = rows.find((r) => r.category === fig.category);
      expect(row).toBeDefined();
      expect(fig.share_pct).toBeCloseTo(Number(row!.share_pct), 6);
      expect(fig.display).toBe(`${Number(row!.share_pct).toFixed(1)}%`);
    }

    for (const fig of figures) {
      expect(fig.value).not.toBeNull();
      expect(fig.display).not.toBe('');
      expect(fig.source).not.toBe('');
      expect(fig.as_of).not.toBe('');
    }
  });

  test('returns the top three land-use categories from the mix table', async () => {
    // The demo seed leaves land_use_mix empty (real data fills it), so this branch
    // gets labelled fixture rows instead of staying untested.
    await db.admin(
      `insert into datasets (id, name, description, source_url, licence, as_of, coverage, is_demo)
       values ('test_landuse', 'Test land-use mix', 'fixture for briefing tests', null, 'test', '2024-06-30', 'test', true)`,
    );
    await db.admin(
      `insert into land_use_mix (dataset_id, station_id, ring_id, category, share_pct) values
       ('test_landuse', 'central', '0-800m', 'residential', 40.5),
       ('test_landuse', 'central', '0-800m', 'commercial', 22.3),
       ('test_landuse', 'central', '0-800m', 'natural', 10.0),
       ('test_landuse', 'central', '0-800m', 'water', 2.5)`,
    );
    const landUse = (await briefingFacts(db, 'central')).filter((f) => f.category);
    expect(landUse.map((f) => f.category)).toEqual(['residential', 'commercial', 'natural']);
    expect(landUse[0]).toMatchObject({
      label: 'Residential share, within 800 m',
      display: '40.5%',
      source: 'NSW Landuse 2017 v1.5',
      dataset_id: 'test_landuse',
      as_of: '2024-06-30',
    });
    expect(landUse[0]!.share_pct).toBeCloseTo(40.5, 6);
    expect(landUse[1]!.display).toBe('22.3%');
  });
});
