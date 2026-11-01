/**
 * Corridor tours: fixed and line tour order, skipping stations without sales data,
 * and headlines that never contain a number outside the figures.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { resolveTour, TOURABLE_LINES } from '@/lib/tours';
import { createTestDb, type Db } from '@/server/db/client';
import { buildTour, templateHeadline, type StopFigures } from '@/server/tour';

describe('tour definitions (no database)', () => {
  test('fixed tours match the specified station order', () => {
    expect(resolveTour('north-shore')).toMatchObject({
      id: 'north-shore',
      stops: ['wynyard', 'milsons_point', 'north_sydney', 'st_leonards', 'chatswood'],
    });
    expect(resolveTour('parramatta-corridor')).toMatchObject({
      id: 'parramatta-corridor',
      stops: ['auburn', 'granville', 'harris_park', 'parramatta', 'westmead'],
    });
  });

  test('line tours resolve in track order; unknown tours are null', () => {
    expect(TOURABLE_LINES).toEqual(['M1', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9']);
    const t1 = resolveTour('line-T1')!;
    expect(t1.stops.length).toBeGreaterThan(8);
    const shore = ['wynyard', 'milsons_point', 'north_sydney', 'waverton', 'wollstonecraft', 'st_leonards', 'artarmon', 'chatswood', 'roseville', 'lindfield'];
    const idx = shore.map((s) => t1.stops.indexOf(s));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(resolveTour('line-L1')).toBeNull();
    expect(resolveTour('nope')).toBeNull();
  });

  test('template headlines degrade gracefully without inventing numbers', () => {
    const full: StopFigures = {
      median: { label: 'Median unit price', display: '$700k', value: 700000, unit: 'aud', source: 's', dataset_id: 'd', as_of: '2026-01-01' },
      change: { label: 'Change', display: '+3.2%', value: 3.2, unit: 'pct_change', source: 's', dataset_id: 'd', as_of: '2026-01-01' },
      trips: { label: 'Trips', display: '15.2m', value: 15200000, unit: 'trips', source: 's', dataset_id: 'd', as_of: '2026-01-01' },
      tripsChange: { label: 'Trips change', display: '+1.1%', value: 1.1, unit: 'pct_change', source: 's', dataset_id: 'd', as_of: '2026-01-01' },
    };
    expect(templateHeadline('Parramatta', full)).toBe(
      'Parramatta: units $700k within 800 m (+3.2% over 12 months); 15.2m station trips (+1.1% vs the year before).',
    );
    expect(templateHeadline('Parramatta', { change: full.change })).toBe('Parramatta: unit prices +3.2% over 12 months.');
    expect(templateHeadline('Parramatta', {})).toBe('Parramatta: no verified figures available right now.');
  });
});

describe('tour building (seeded database)', () => {
  let db: Db;
  beforeAll(async () => { db = await createTestDb(); }, 120_000);
  afterAll(async () => { await db.close(); });

  test('featured tours keep every stop', async () => {
    const t = await buildTour(db, 'north-shore', { headlines: 'template' });
    expect(t?.stops.map((s) => s.station_id)).toEqual(['wynyard', 'milsons_point', 'north_sydney', 'st_leonards', 'chatswood']);
    for (const s of t!.stops) {
      expect(s.name).toBeTruthy();
      expect(s.headline_model).toBe(false);
      expect(s.figures.length).toBeGreaterThan(0);
    }
  });

  test('line tours skip stations without sales data, keep order, cap at 8', async () => {
    const full = resolveTour('line-T5')!.stops;
    const t = await buildTour(db, 'line-T5', { headlines: 'template' });
    expect(t).not.toBeNull();
    expect(t!.stops.length).toBeLessThanOrEqual(8);
    const have = new Set(
      (await db.readOnly<{ station_id: string }>("select distinct station_id from v_sales_period where period = 'last_12m'")).map((r) => r.station_id),
    );
    const idx = t!.stops.map((s) => {
      expect(have.has(s.station_id)).toBe(true);
      return full.indexOf(s.station_id);
    });
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    // Tallawong is far from any demo sales, so the M1 tour skips it.
    const m1 = await buildTour(db, 'line-M1', { headlines: 'template' });
    expect(m1!.stops.map((s) => s.station_id)).not.toContain('tallawong');
  });

  test('headlines contain only numbers present in the figures', async () => {
    for (const id of ['north-shore', 'parramatta-corridor', 'line-T1']) {
      const t = await buildTour(db, id, { headlines: 'template' });
      for (const s of t!.stops) {
        const stripped = s.figures
          .map((f) => f.display)
          .reduce((acc, d) => acc.split(d).join(''), s.headline)
          .replace(/\b(800 m|12 months)\b/g, '');
        expect(stripped).not.toMatch(/\d/);
      }
    }
  });

  test('unknown tours return null', async () => {
    await expect(buildTour(db, 'nope', { headlines: 'template' })).resolves.toBeNull();
  });
});
