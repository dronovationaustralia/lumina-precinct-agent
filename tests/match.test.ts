import { describe, expect, test } from 'vitest';

import { houseNumber, legalKeys, splitStreet, streetTypes, strataPlan } from '../scripts/ingest/address-normalise';
import { GnafIndex, isGreaterSydneyPostcode, type GnafRow } from '../scripts/ingest/match';

// G-NAF authority rows as published (CODE|NAME): AVENUE -> AV, CRESCENT -> CR.
const TYPES = streetTypes([
  { code: 'ROAD', name: 'RD' }, { code: 'STREET', name: 'ST' }, { code: 'AVENUE', name: 'AV' }, { code: 'CRESCENT', name: 'CR' },
  { code: 'HIGHWAY', name: 'HWY' }, { code: 'COURT', name: 'CT' }, { code: 'WAY', name: 'WAY' },
]);

const g = (o: Partial<GnafRow>): GnafRow => ({
  pid: 'GANSW1', alias: 'P', flat: '', number: '', number_suffix: '', street: '', type: '', street_suffix: '', locality: '',
  postcode: '2067', legal: '', lon: '151.18', lat: '-33.79', ...o,
});

describe('address normalisation', () => {
  test('maps Valuer General abbreviations to G-NAF street type codes', () => {
    expect(splitStreet('VICTORIA AVE', TYPES)).toEqual({ name: 'VICTORIA', type: 'AVENUE', suffix: '' });
    expect(splitStreet('ARCHER CRES', TYPES)).toEqual({ name: 'ARCHER', type: 'CRESCENT', suffix: '' });
    expect(splitStreet('PACIFIC HWY W', TYPES)).toEqual({ name: 'PACIFIC', type: 'HIGHWAY', suffix: 'W' });
    expect(splitStreet('MOUNT BAKER RD', TYPES)).toEqual({ name: 'MOUNT BAKER', type: 'ROAD', suffix: '' });
    expect(splitStreet('KINGSWAY', TYPES)).toEqual({ name: 'KINGSWAY', type: '', suffix: '' });
  });

  test('house numbers, legal descriptions and strata plans', () => {
    expect(houseNumber('12-14')).toEqual({ first: '12', suffix: '' });
    expect(houseNumber('7A')).toEqual({ first: '7', suffix: 'A' });
    expect(legalKeys('102/1014574')).toEqual(['102/1014574']);
    expect(legalKeys('5/SP108284')).toEqual(['5/SP108284']);
    expect(legalKeys('5, 6/23137')).toEqual(['5/23137', '6/23137']);
    expect(legalKeys('5/664132 4/7/758357')).toEqual(['5/664132', '4/7/758357']);
    expect(strataPlan('6/SP10062')).toBe('SP10062');
    expect(isGreaterSydneyPostcode('2067')).toBe(true);
    expect(isGreaterSydneyPostcode('2325')).toBe(false);
  });
});

describe('matching sales to G-NAF', () => {
  const index = new GnafIndex([
    g({ pid: 'A', number: '10', street: 'ALBERT', type: 'AVENUE', locality: 'CHATSWOOD', legal: '3/1234', lon: '151.181', lat: '-33.797' }),
    g({ pid: 'B', flat: '6', number: '15', street: 'ARCHER', type: 'STREET', locality: 'CHATSWOOD', legal: '6/SP10062', lon: '151.182', lat: '-33.796' }),
    g({ pid: 'C', flat: '7', number: '15', street: 'ARCHER', type: 'STREET', locality: 'CHATSWOOD', legal: '7/SP10062', lon: '151.182', lat: '-33.796' }),
    g({ pid: 'D', number: '2', street: 'ANDERSON', type: 'STREET', locality: 'CHATSWOOD', lon: '151.183', lat: '-33.795' }),
    g({ pid: 'E', alias: 'A', number: '2', street: 'ANDERSON', type: 'STREET', locality: 'CHATSWOOD', lon: '0', lat: '0' }),
  ]);
  const sale = (o: Record<string, string>) => ({ property_type: 'house', unit_number: '', house_number: '', street_name: '', locality: 'CHATSWOOD', legal: '', ...o });

  test('lot/plan first', () => {
    expect(index.match(sale({ legal: '3/1234', street_name: 'WRONG ST', house_number: '99' }), TYPES)).toEqual({ point: [151.181, -33.797], method: 'legal' });
  });
  test('then the full address, abbreviations normalised', () => {
    expect(index.match(sale({ house_number: '10', street_name: 'ALBERT AVE' }), TYPES)?.method).toBe('address');
  });
  test('then the address without the street type', () => {
    expect(index.match(sale({ house_number: '10', street_name: 'ALBERT RD' }), TYPES)?.method).toBe('no_type');
  });
  test('units fall back to the building (strata plan)', () => {
    expect(index.match(sale({ property_type: 'unit', unit_number: '6', house_number: '15', street_name: 'ARCHER ST' }), TYPES)?.method).toBe('address');
    expect(index.match(sale({ property_type: 'unit', unit_number: '99', house_number: '15', street_name: 'ARCHER ST', legal: '99/SP10062' }), TYPES)?.method).toBe('building');
    expect(index.match(sale({ property_type: 'unit', unit_number: '99', house_number: '1', street_name: 'NOWHERE ST', legal: '99/SP10062' }), TYPES)?.method).toBe('building');
  });
  test('principal addresses win over aliases; unknown addresses do not match', () => {
    expect(index.match(sale({ house_number: '2', street_name: 'ANDERSON ST' }), TYPES)?.point).toEqual([151.183, -33.795]);
    expect(index.match(sale({ house_number: '1', street_name: 'NOWHERE ST' }), TYPES)).toBeNull();
  });
});
