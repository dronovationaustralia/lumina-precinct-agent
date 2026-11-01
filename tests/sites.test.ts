/**
 * SAM opportunity sites: polygon geometry unit tests and the GeoJSON loader test.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { runAgent } from '@/server/agent/graph';
import { planCalls } from '@/server/agent/offline';
import { createTestDb, type Db } from '@/server/db/client';
import { loadRealSites } from '@/server/db/real-sites';
import { FactStore } from '@/server/facts';
import { buildTools, type ToolContext } from '@/server/tools';

import { createStationProjection, douglasPeucker, labelComponents, lonLatFromMerc, mercFromLonLat, ringArea, traceOutline } from '../scripts/sam/polygons';

describe('site polygons', () => {
  test('labels 8-connected components', () => {
    const w = 5, h = 5;
    const grid = new Uint8Array(w * h);
    grid[0] = grid[1] = grid[5] = grid[6] = 1; // 2x2 block
    grid[2 * w + 2] = 1; // touches the block diagonally
    grid[4 * w + 4] = 1; // isolated
    const { sizes } = labelComponents(grid, w, h);
    expect([...sizes].sort((a, b) => a - b)).toEqual([1, 5]);
  });

  test('traces a rectangle outline with the right area', () => {
    const w = 10, h = 10;
    const grid = new Uint8Array(w * h);
    for (let y = 2; y <= 5; y++) for (let x = 3; x <= 7; x++) grid[y * w + x] = 1;
    const { labels, starts } = labelComponents(grid, w, h);
    expect(starts).toHaveLength(1);
    const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === 1;
    const outline = traceOutline(at, starts[0]![0], starts[0]![1], 1000);
    expect(outline.length).toBeGreaterThan(8);
    // Pixel centres span 4 by 3.
    expect(Math.abs(ringArea(outline))).toBeCloseTo(12, 6);
  });

  test('douglas-peucker straightens near-straight edges', () => {
    const pts: Array<[number, number]> = [[0, 0], [1, 0.1], [2, 0], [2, 2], [0, 2]];
    expect(douglasPeucker(pts, 0.5)).toEqual([[0, 0], [2, 0], [2, 2], [0, 2]]);
  });

  test('mercator round-trips', () => {
    const { x, y } = mercFromLonLat(-33.86, 151.2);
    const { lat, lon } = lonLatFromMerc(x, y);
    expect(lat).toBeCloseTo(-33.86, 8);
    expect(lon).toBeCloseTo(151.2, 8);
  });

  test("a pixel at a chip's edge lands 256 m from the chip centre", () => {
    // At the equator (cos = 1) with 0.5 m per pixel over 512 px, the outer edge of
    // an edge pixel is exactly half a chip (256 m) from the chip centre on the ground.
    const { toMetres } = createStationProjection({ lat: 0, lon: 0 }, 1, 1024, 0.5);
    const [ex, ey] = toMetres(-0.5, 511.5);
    expect(Math.hypot(ex, ey)).toBeCloseTo(256, 8);
    expect(ex).toBeCloseTo(-256, 8);
    expect(ey).toBeCloseTo(0, 8);
    // The edge pixel's centre is within half a pixel of that.
    const [cx, cy] = toMetres(0, 511.5);
    expect(Math.abs(Math.hypot(cx, cy) - 256)).toBeLessThanOrEqual(0.25);
  });
});

describe('SAM opportunity sites load', () => {
  let db: Db;
  beforeAll(async () => { db = await createTestDb(); }, 120_000);
  afterAll(async () => { await db.close(); });

  test('loads site polygons and serves them per station', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sam-sites-'));
    const poly = (lon: number, lat: number, d: number) => ({
      type: 'Polygon',
      coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]],
    });
    writeFileSync(path.join(dir, 'sam_sites.geojson'), JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { station_id: 'chatswood', class: 'car_park', area_m2: 1200, distance_m: 250, method: 'sam-3.1' }, geometry: poly(151.19, -33.8, 0.001) },
        { type: 'Feature', properties: { station_id: 'chatswood', class: 'construction_site', area_m2: 800, distance_m: 500, method: 'sam-3.1' }, geometry: poly(151.2, -33.81, 0.001) },
        { type: 'Feature', properties: { station_id: 'nowhere', class: 'car_park', area_m2: 500, distance_m: 100, method: 'sam-3.1' }, geometry: poly(151.2, -33.81, 0.001) },
      ],
    }));
    expect(await loadRealSites(db, dir)).toEqual({ sites: 2, stations: 1 });
    const rows = await db.readOnly<{ station_id: string; class: string; area_m2: number; distance_m: number; dataset_id: string; geojson: string }>(
      "select station_id, class, area_m2, distance_m, dataset_id, geojson from v_sam_sites where station_id = 'chatswood' order by area_m2 desc");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ station_id: 'chatswood', class: 'car_park', area_m2: 1200, distance_m: 250, dataset_id: 'sam_sites' });
    expect(JSON.parse(rows[0]!.geojson).type).toBe('MultiPolygon');
    expect(rows[1]!.class).toBe('construction_site');
  });

  test('find_sites returns facts for count, area and the largest, plus a layer action', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sam-sites-tool-'));
    const poly = (lon: number, lat: number, d: number) => ({
      type: 'Polygon',
      coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]],
    });
    writeFileSync(path.join(dir, 'sam_sites.geojson'), JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { station_id: 'chatswood', class: 'car_park', area_m2: 1200, distance_m: 250, method: 'sam-3.1' }, geometry: poly(151.19, -33.8, 0.001) },
        { type: 'Feature', properties: { station_id: 'chatswood', class: 'construction_site', area_m2: 800, distance_m: 500, method: 'sam-3.1' }, geometry: poly(151.2, -33.81, 0.001) },
      ],
    }));
    await loadRealSites(db, dir);
    const facts = new FactStore();
    const ctx: ToolContext = { db, facts, trace: [], notes: [] };
    const tool = buildTools(ctx).find((t) => t.name === 'find_sites')!;
    const out = JSON.parse(String(await tool.invoke({ station: 'chatswood' })));
    expect(out.count).toBe(2);
    expect(out.map_action).toEqual({ type: 'show_layer', layer: 'places', classes: ['opportunity_sites'], visible: true });
    expect(ctx.notes).toContain('candidate sites for further investigation; zoning and ownership not checked');
    const stored: Array<import('@/lib/contracts').Fact> = out.facts.map((f: { fact_id: string }) => facts.get(f.fact_id)!);
    expect(stored.map((f) => [f.metric, f.value])).toEqual([
      ['site_count', 2],
      ['site_total_area', 2000],
      ['site_area', 1200],
      ['site_distance', 250],
      ['site_area', 800],
      ['site_distance', 500],
    ]);
  });

  test('offline planner routes site questions to find_sites', () => {
    const calls = planCalls('Find candidate development sites near Parramatta station.');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: 'find_sites', args: { station: 'parramatta' } });
    const filtered = planCalls('Show me construction sites larger than 500 m² near Chatswood.');
    expect(filtered[0]).toMatchObject({ name: 'find_sites', args: { station: 'chatswood', class: 'construction_site', min_area_m2: 500 } });
  });

  test('agent answers a site question with a verified candidate-sites line', async () => {
    const r = await runAgent(db, { question: 'Find candidate development sites near Chatswood station.' }, { provider: 'offline' });
    expect(r.verification.status).toBe('verified');
    expect(r.meta.tool_calls.map((t) => t.tool)).toContain('find_sites');
    expect(r.lines.join(' ')).toMatch(/Candidate sites near Chatswood/);
  }, 120_000);
});
