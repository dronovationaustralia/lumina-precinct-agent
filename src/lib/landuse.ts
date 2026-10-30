/**
 * Land-use categories: NSW Landuse 2017 v1.5 (ALUM classification) grouped into ten classes a
 * precinct analyst reads at a glance. Shared by the ingest, the database load, the API and the map.
 */
export const LAND_USE_CATEGORIES = {
  residential: { label: 'Residential', colour: '#f0c26a' },
  commercial: { label: 'Commercial services', colour: '#e07a6a' },
  public_services: { label: 'Public services', colour: '#a68bd0' },
  recreation: { label: 'Recreation and culture', colour: '#7fc48e' },
  industrial: { label: 'Industrial and utilities', colour: '#8f92ad' },
  transport: { label: 'Roads and rail', colour: '#c4c4bf' },
  in_transition: { label: 'Land in transition', colour: '#d9822b' },
  natural: { label: 'Bushland and conservation', colour: '#3f8a57' },
  water: { label: 'Water', colour: '#7db3d8' },
  rural_other: { label: 'Rural and other', colour: '#cdd6a5' },
} as const;
export type LandUseCategory = keyof typeof LAND_USE_CATEGORIES;

/** ALUM tertiary/secondary code (e.g. "5.4.1 Urban residential") to a category. */
export function categoryFor(alum: string): LandUseCategory {
  const code = alum.trim().split(' ')[0] ?? '';
  const [a, b, c] = code.split('.').map(Number);
  if (a === 5) {
    if (b === 4) return 'residential';
    if (b === 5) return c === 1 || c === 0 ? 'commercial' : c === 3 ? 'recreation' : 'public_services';
    if (b === 7) return 'transport';
    if (b === 3 || b === 6 || b === 8 || b === 9) return 'industrial';
    return 'rural_other'; // 5.1 intensive horticulture, 5.2 intensive animal production
  }
  if (a === 3 && b === 6) return 'in_transition';
  if (a === 1 || a === 2) return 'natural';
  if (a === 6) return 'water';
  return 'rural_other';
}

export const LAND_USE_SOURCE = {
  dataset_id: 'nsw_landuse_2017',
  name: 'NSW Landuse 2017 v1.5 (NSW DCCEEW)',
  url: 'https://data.nsw.gov.au/data/dataset/nsw-landuse-2017-v1p5-f0ed-clone-a95d',
  licence: 'CC BY 4.0, NSW Department of Climate Change, Energy, the Environment and Water',
  as_of: '2017-09-30',
};
