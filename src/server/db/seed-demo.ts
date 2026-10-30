/**
 * Synthetic DEMO data, generated fresh in this repo.
 *
 * Used only until the real NSW Valuer General, TfNSW and SAM 3.1 data is ingested.
 * Every dataset row is flagged is_demo = true and every fact and answer built from it is
 * labelled "Demo data". The numbers are plausible in shape but are NOT real figures.
 */
import { RINGS } from '@/lib/contracts';
import { STATIONS, type Station } from '@/lib/stations';

import { refreshAggregates } from './aggregates';

import type { Db } from './client';

export const DEMO_AS_OF = '2026-09-30';
const MONTHS = 24;

export const DEMO_DATASETS = [
  {
    id: 'demo_sales',
    name: 'Demo data: synthetic property sales',
    description: 'Synthetic sales around the 10 stations, 24 months. Placeholder for NSW Valuer General bulk sales.',
    source_url: null,
    licence: 'Synthetic, generated in this repo',
    coverage: '10 stations, within 5 km, Oct 2024 to Sep 2026',
  },
  {
    id: 'demo_patronage',
    name: 'Demo data: synthetic station patronage',
    description: 'Synthetic monthly entries and exits. Placeholder for Transport for NSW Open Data.',
    source_url: null,
    licence: 'Synthetic, generated in this repo',
    coverage: '10 stations, Oct 2024 to Sep 2026',
  },
  {
    id: 'demo_land_use',
    name: 'Demo data: synthetic land-use cover',
    description: 'Synthetic % cover per ring. Placeholder for SAM 3.1 on NSW Spatial Services imagery.',
    source_url: null,
    licence: 'Synthetic, generated in this repo',
    coverage: '10 stations, rings to 2 km',
  },
] as const;

/** Deterministic PRNG (mulberry32) so demo numbers are stable across runs. */
function rng(seedText: string) {
  let a = 0;
  for (const c of seedText) a = (Math.imul(a ^ c.charCodeAt(0), 2654435761) >>> 0);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(r: () => number) {
  return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
}

type Profile = { house: number; unit: number; growth: number; patronage: number; canopy: number; carpark: number; build: number; construct: number };

const PROFILES: Record<string, Profile> = {
  wynyard: { house: 4_200_000, unit: 1_350_000, growth: 0.002, patronage: 2_600_000, canopy: 9, carpark: 3, build: 62, construct: 3 },
  milsons_point: { house: 4_600_000, unit: 1_500_000, growth: 0.004, patronage: 380_000, canopy: 18, carpark: 4, build: 44, construct: 1.5 },
  north_sydney: { house: 3_900_000, unit: 1_250_000, growth: 0.003, patronage: 1_150_000, canopy: 16, carpark: 5, build: 50, construct: 4 },
  st_leonards: { house: 3_300_000, unit: 1_050_000, growth: 0.006, patronage: 720_000, canopy: 17, carpark: 7, build: 46, construct: 6 },
  chatswood: { house: 3_100_000, unit: 1_100_000, growth: 0.005, patronage: 1_250_000, canopy: 21, carpark: 9, build: 43, construct: 5 },
  westmead: { house: 1_350_000, unit: 640_000, growth: 0.004, patronage: 420_000, canopy: 19, carpark: 14, build: 35, construct: 4 },
  parramatta: { house: 1_500_000, unit: 700_000, growth: 0.007, patronage: 1_400_000, canopy: 13, carpark: 11, build: 47, construct: 7 },
  harris_park: { house: 1_300_000, unit: 600_000, growth: 0.005, patronage: 260_000, canopy: 14, carpark: 8, build: 44, construct: 3 },
  granville: { house: 1_200_000, unit: 560_000, growth: 0.003, patronage: 380_000, canopy: 11, carpark: 10, build: 45, construct: 4 },
  auburn: { house: 1_150_000, unit: 540_000, growth: 0.002, patronage: 450_000, canopy: 10, carpark: 12, build: 46, construct: 3 },
};

function monthStart(offset: number): Date {
  const d = new Date(Date.UTC(2026, 8, 1)); // Sep 2026
  d.setUTCMonth(d.getUTCMonth() - offset);
  return d;
}

function salesFor(station: Station) {
  const p = PROFILES[station.id]!;
  const r = rng(`sales:${station.id}`);
  const rows: { date: string; price: number; type: 'house' | 'unit'; land: number | null; lat: number; lon: number }[] = [];
  const n = 1400;
  const latScale = 111_320;
  const lonScale = 111_320 * Math.cos((station.lat * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    // Sales concentrate near stations (r = R * u^0.75).
    const dist = 5000 * Math.pow(r(), 0.75);
    const theta = 2 * Math.PI * r();
    const lat = station.lat + (dist * Math.sin(theta)) / latScale;
    const lon = station.lon + (dist * Math.cos(theta)) / lonScale;
    // Units dominate near the station, houses further out.
    const unitProb = dist < 800 ? 0.82 : dist < 2000 ? 0.6 : 0.35;
    const type = r() < unitProb ? 'unit' : 'house';
    const monthsAgo = Math.floor(r() * MONTHS);
    const day = 1 + Math.floor(r() * 27);
    const d = monthStart(monthsAgo);
    d.setUTCDate(day);
    const trend = Math.pow(1 + p.growth, MONTHS - monthsAgo);
    const near = dist < 800 ? 1.08 : dist < 2000 ? 1.0 : 0.93;
    let price: number;
    let land: number | null = null;
    if (type === 'house') {
      land = Math.round(380 + (dist / 5000) * 420 + Math.abs(gaussian(r)) * 120);
      const perM2 = (p.house / 600) * near * (dist < 800 ? 1.12 : 1);
      price = perM2 * land * Math.exp(gaussian(r) * 0.18) * trend;
    } else {
      price = p.unit * near * Math.exp(gaussian(r) * 0.22) * trend;
    }
    rows.push({ date: d.toISOString().slice(0, 10), price: Math.round(price / 1000) * 1000, type, land, lat, lon });
  }
  return rows;
}

export async function seedDemo(db: Db): Promise<void> {
  const existing = await db.admin<{ n: number }>('select count(*)::int as n from datasets');
  if ((existing[0]?.n ?? 0) > 0) return;

  for (const d of DEMO_DATASETS) {
    await db.admin(
      'insert into datasets (id, name, description, source_url, licence, as_of, coverage, is_demo) values ($1,$2,$3,$4,$5,$6,$7,true)',
      [d.id, d.name, d.description, d.source_url, d.licence, DEMO_AS_OF, d.coverage],
    );
  }
  for (const [id, ring] of Object.entries(RINGS)) {
    await db.admin('insert into rings (id, min_m, max_m, label) values ($1,$2,$3,$4) on conflict do nothing', [id, ring.min_m, ring.max_m, ring.label]);
  }
  for (const s of STATIONS) {
    await db.admin(
      'insert into stations (id, name, corridor, geom, coord_source) values ($1,$2,$3, st_setsrid(st_makepoint($4,$5),4326)::geography, $6)',
      [s.id, s.name, s.corridor, s.lon, s.lat, s.coord_source],
    );
  }

  // Demo data covers the ten featured stations only; the rest of the registry has no demo figures.
  const demoStations = STATIONS.filter((x) => PROFILES[x.id]);
  // Sales, inserted in batches of literal VALUES (generated numbers only, no user input).
  for (const s of demoStations) {
    const rows = salesFor(s);
    for (let i = 0; i < rows.length; i += 500) {
      const values = rows.slice(i, i + 500).map((x) =>
        `('demo_sales','${x.date}',${x.price},'${x.type}',${x.land ?? 'null'},st_setsrid(st_makepoint(${x.lon.toFixed(6)},${x.lat.toFixed(6)}),4326)::geography)`,
      );
      await db.exec(`insert into sales (dataset_id, contract_date, price, property_type, land_area_m2, geom) values ${values.join(',')};`);
    }
  }
  await db.exec(`
    insert into sale_station (sale_id, station_id, distance_m)
    select s.id, st.id, st_distance(s.geom, st.geom)
    from sales s join stations st on st_dwithin(s.geom, st.geom, 5000);
  `);

  // Patronage: seasonal monthly totals with a station-specific trend.
  for (const s of demoStations) {
    const p = PROFILES[s.id]!;
    const r = rng(`patronage:${s.id}`);
    const trend = 0.001 + (r() - 0.3) * 0.006;
    const values: string[] = [];
    for (let m = 0; m < MONTHS; m++) {
      const d = monthStart(MONTHS - 1 - m);
      const season = d.getUTCMonth() === 0 || d.getUTCMonth() === 11 ? 0.82 : 1;
      const total = p.patronage * season * Math.pow(1 + trend, m) * (1 + gaussian(r) * 0.03);
      const entries = Math.round(total / 2);
      values.push(`('demo_patronage','${s.id}','${d.toISOString().slice(0, 10)}',${entries},${Math.round(total - entries)})`);
    }
    await db.exec(`insert into patronage (dataset_id, station_id, month, entries, exits) values ${values.join(',')};`);
  }

  // Land use per ring (to 2 km): cover falls or rises with distance.
  const shape: Record<string, Record<string, number>> = {
    '0-400m': { building: 1.15, tree_canopy: 0.75, car_park: 1.25, construction_site: 1.4 },
    '0-800m': { building: 1.0, tree_canopy: 1.0, car_park: 1.0, construction_site: 1.0 },
    '800m-2km': { building: 0.85, tree_canopy: 1.3, car_park: 0.8, construction_site: 0.6 },
  };
  for (const s of demoStations) {
    const p = PROFILES[s.id]!;
    const r = rng(`landuse:${s.id}`);
    const base: Record<string, number> = { building: p.build, tree_canopy: p.canopy, car_park: p.carpark, construction_site: p.construct };
    const values: string[] = [];
    for (const [ring, mult] of Object.entries(shape)) {
      for (const cls of Object.keys(base)) {
        const v = Math.min(95, Math.max(0.2, base[cls]! * mult[cls]! * (1 + gaussian(r) * 0.05)));
        values.push(`('demo_land_use','${s.id}','${ring}','${cls}',${v.toFixed(1)},'${DEMO_AS_OF}','demo')`);
      }
    }
    await db.exec(`insert into land_use_ring (dataset_id, station_id, ring_id, class, cover_pct, capture_date, method) values ${values.join(',')};`);
  }
  await refreshAggregates(db);
}
