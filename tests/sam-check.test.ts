import { describe, expect, test } from 'vitest';

import { EXG_THRESHOLD, isVegetationPixel } from '../scripts/sam/concepts';

describe('SAM checker vegetation reference', () => {
  test('excess-green threshold stays at its calibrated value', () => {
    expect(EXG_THRESHOLD).toBe(10);
  });

  const cases: { rgb: [number, number, number]; veg: boolean; why: string }[] = [
    { rgb: [20, 200, 30], veg: true, why: 'bright lawn is vegetation' },
    { rgb: [40, 55, 35], veg: true, why: 'sunlit eucalypt canopy is vegetation' },
    { rgb: [128, 128, 128], veg: false, why: 'neutral grey roof is not' },
    { rgb: [250, 252, 248], veg: false, why: 'near-white roof is not' },
    { rgb: [150, 80, 70], veg: false, why: 'terracotta roof is not' },
    { rgb: [25, 30, 25], veg: false, why: 'shadowed canopy misses (known undercount)' },
  ];
  test.each(cases)('$why', ({ rgb, veg }) => {
    expect(isVegetationPixel(...rgb)).toBe(veg);
  });
});
