/**
 * Valuer General parser on a hand-made fixture (invented addresses and dealings; no real records
 * are committed). Field layout matches the 2024 to 2026 bulk files.
 */
import { describe, expect, test } from 'vitest';

import { cleanSales, parseDat } from '../scripts/ingest/vg-parse';

const B = (id: string, counter: string, dl: string, unit: string, house: string, street: string, loc: string, pc: string,
  area: string, areaType: string, contract: string, price: string, nature: string, purpose: string, strata: string, pct: string, dealing: string) =>
  `B;999;${id};${counter};${dl};;${unit};${house};${street};${loc};${pc};${area};${areaType};${contract};20261020;${price};R2;${nature};${purpose};${strata};;;${pct};${dealing};`;

const DAT = [
  'A;RTSALEDATA;999;20261026 01:00;VALNET;',
  B('100', '1', '20261019 01:00', '', '12', 'EXAMPLE ST', 'TESTVILLE', '2999', '650', 'M', '20260901', '1500000', 'R', 'RESIDENCE', '', '', 'XX000001'),
  'C;999;100;1;20261019 01:00;1/123456;',
  // Same sale reported again a week later: keep the later download.
  B('100', '1', '20261026 01:00', '', '12', 'EXAMPLE ST', 'TESTVILLE', '2999', '650', 'M', '20260901', '1510000', 'R', 'RESIDENCE', '', '', 'XX000001'),
  // A unit (strata lot).
  B('200', '1', '20261026 01:00', '5', '8', 'SAMPLE AVE', 'TESTVILLE', '2999', '', '', '20260815', '780000', 'R', 'RESIDENCE', '5', '0', 'XX000002'),
  'C;999;200;1;20261026 01:00;5/SP99999;',
  // Hectares, converted to m².
  B('300', '1', '20261026 01:00', '', '1', 'FARM RD', 'TESTVILLE', '2999', '1.5', 'H', '20260701', '2100000', 'R', 'RESIDENCE', '', '', 'XX000003'),
  // Part interest (50%): dropped.
  B('400', '1', '20261026 01:00', '', '2', 'EXAMPLE ST', 'TESTVILLE', '2999', '500', 'M', '20260801', '600000', 'R', 'RESIDENCE', '', '50', 'XX000004'),
  // Two properties in one dealing (one price): both dropped.
  B('500', '1', '20261026 01:00', '', '3', 'EXAMPLE ST', 'TESTVILLE', '2999', '500', 'M', '20260801', '3000000', 'R', 'RESIDENCE', '', '', 'XX000005'),
  B('501', '1', '20261026 01:00', '', '5', 'EXAMPLE ST', 'TESTVILLE', '2999', '500', 'M', '20260801', '3000000', 'R', 'RESIDENCE', '', '', 'XX000005'),
  // Commercial: dropped. Nominal price: dropped. Outside 24 months: dropped.
  B('600', '1', '20261026 01:00', '', '9', 'MAIN ST', 'TESTVILLE', '2999', '300', 'M', '20260801', '2000000', '3', 'COMMERCIAL', '', '', 'XX000006'),
  B('700', '1', '20261026 01:00', '', '7', 'EXAMPLE ST', 'TESTVILLE', '2999', '500', 'M', '20260801', '10', 'R', 'RESIDENCE', '', '', 'XX000007'),
  B('800', '1', '20261026 01:00', '', '8', 'EXAMPLE ST', 'TESTVILLE', '2999', '500', 'M', '20240101', '900000', 'R', 'RESIDENCE', '', '', 'XX000008'),
  'Z;12;',
].join('\r\n');

describe('Valuer General parser', () => {
  const parsed = parseDat(DAT);

  test('parses B records and joins the C legal description', () => {
    expect(parsed).toHaveLength(10);
    const first = parsed[0]!;
    expect(first).toMatchObject({ property_id: '100', contract_date: '2026-09-01', price: 1_500_000, area_m2: 650, legal: '1/123456', property_type: 'house' });
  });

  test('classifies strata lots as units and converts hectares', () => {
    expect(parsed.find((s) => s.property_id === '200')).toMatchObject({ property_type: 'unit', legal: '5/SP99999', area_m2: null });
    expect(parsed.find((s) => s.property_id === '300')?.area_m2).toBe(15_000);
  });

  test('cleans: dedupe (latest wins), drop part-interest, multi-property, non-residential, nominal and old sales', () => {
    const { sales, asOf, stats } = cleanSales(parsed, 24);
    expect(asOf).toBe('2026-09-01');
    expect(sales.map((s) => s.property_id).sort()).toEqual(['100', '200', '300']);
    expect(sales.find((s) => s.property_id === '100')?.price).toBe(1_510_000);
    expect(stats).toMatchObject({ b_records: 10, after_dedupe: 9, after_multi_property: 7, in_window: 3, units: 1, houses: 2 });
  });
});
