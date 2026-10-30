/**
 * Class concepts for the SAM batch: short, literal noun phrases work best for SAM 3;
 * a class can union several prompts ("house" catches the detached roofs "building"
 * misses; "tree" finds single crowns and "forest" the continuous canopy of bushland
 * and parks; "parking lot" beats "car park").
 *
 * `tile`: the largest area sent in one request, in chip pixels. Dense, small objects
 * (roofs, tree crowns) start at 512 px quarters: on whole 1024 px chips SAM sometimes
 * returned almost nothing for streets of 300 houses. Large objects (car parks,
 * construction sites) use whole chips.
 *
 * Shared by batch.ts (queries) and check.ts (cache diagnostics) so both always agree
 * on prompts and tiling. Changing prompts or tiling changes the cache key, so the
 * next run re-asks SAM for the affected tiles.
 */
export const CHIP_PX = 1024;

export const CONCEPTS = [
  { cls: 'building', prompts: ['building', 'house'], tile: 512 },
  { cls: 'tree_canopy', prompts: ['tree', 'forest'], tile: 512 },
  { cls: 'car_park', prompts: ['parking lot'], tile: 1024 },
  { cls: 'construction_site', prompts: ['construction site'], tile: 1024 },
] as const;

export type ConceptClass = (typeof CONCEPTS)[number]['cls'];

// Excess-green vegetation reference for check.ts: the fraction of chip pixels scoring
// above EXG_THRESHOLD. Calibrated on Chatswood chips (dark eucalypt canopy windows
// average 4-7, grey roofs ~0, CBD concrete negative). Shadowed canopy scores ~0, so
// check.ts treats this as a lower bound on vegetation, not the full share.
export const EXG_THRESHOLD = 10;

export function isVegetationPixel(r: number, g: number, b: number): boolean {
  return 2 * g - r - b > EXG_THRESHOLD;
}
