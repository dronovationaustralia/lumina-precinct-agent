import { describe, expect, test } from 'vitest';

import { parsePatronage, stationIdFor } from '../scripts/ingest/patronage-parse';

const CSV = [
  '﻿MonthYear,Station,Station_Type,Entry_Exit,Trip',
  '2026-08-01 00:00:00.000,Chatswood  Station,Metro Shared,Entry,900000',
  '2026-08-01 00:00:00.000,Chatswood  Station,Metro Shared,Exit,880000',
  '2026-08-01 00:00:00.000,Wynyard  Station,Train,Entry,1200000',
  '2026-08-01 00:00:00.000,Wynyard  Station,Train,Exit,Less than 50',
  '2026-08-01 00:00:00.000,Wynyard Light Rail,Light rail,Entry,50000',
  '2026-08-01 00:00:00.000,Aberdeen  Station,Train,Entry,71',
  '2026-09-01 00:00:00.000,Parramatta  Station,Train,Entry,1000',
  '2026-09-01 00:00:00.000,Parramatta  Station,Train,Exit,1100',
].join('\r\n');

describe('TfNSW entries and exits', () => {
  test('maps station rows only (not light rail, not other stations)', () => {
    expect(stationIdFor('Chatswood  Station', 'Metro Shared')).toBe('chatswood');
    expect(stationIdFor('Harris Park  Station', 'Train')).toBe('harris_park');
    expect(stationIdFor('Wynyard Light Rail', 'Light rail')).toBeNull();
    expect(stationIdFor('Aberdeen  Station', 'Train')).toBeNull();
  });

  test('sums entries and exits per station and month', () => {
    const r = parsePatronage(CSV);
    expect(r.months).toEqual(['2026-08', '2026-09']);
    expect(r.small).toBe(1);
    expect(r.rows).toEqual([
      { station_id: 'chatswood', month: '2026-08', entries: 900000, exits: 880000 },
      { station_id: 'parramatta', month: '2026-09', entries: 1000, exits: 1100 },
      { station_id: 'wynyard', month: '2026-08', entries: 1200000, exits: 0 },
    ]);
  });
});
