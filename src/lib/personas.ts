/** User types the product is shaped around. Shared by the sign-in page, the portal and the agent. */

/** Optional capabilities a playbook relies on; every tag must resolve to shipped code. */
export type PlaybookFeature = 'screener' | 'sites' | 'tours';

export type Playbook = {
  title: string;
  why: string;
  /** Question templates with a {station} slot, except TOUR_STEP. */
  steps: string[];
  uses: PlaybookFeature[];
};

/** A playbook step that opens the guided-tour picker instead of asking a question. */
export const TOUR_STEP = 'Take a guided tour of this corridor';

/** Fill a playbook step's {station} slot with the station name. */
export function fillStep(step: string, stationName: string): string {
  return step.replaceAll('{station}', stationName);
}

export const PERSONA_INFO = {
  developer: {
    label: 'Development and site acquisition',
    short: 'Developer',
    blurb: 'Screen station precincts for sites, prices and momentum before a feasibility study.',
    questions: [
      'Compare Chatswood and St Leonards on unit price momentum within 800 m',
      'How do unit prices within 800 m of Parramatta compare with 2 to 5 km away?',
      'Which is busier, Macquarie Park or Epping, and how have unit prices moved near each?',
    ],
    playbooks: [
      {
        title: 'Screen for opportunity',
        why: 'Rank stations by momentum under a price cap, then check the top result for sites.',
        steps: [
          'Which stations have the strongest unit price momentum under $1,000,000?',
          'Find candidate development sites near {station}.',
        ],
        uses: ['screener', 'sites'],
      },
      {
        title: 'Precinct due diligence',
        why: 'Price, momentum, premium, land use and sites for one precinct.',
        steps: [
          'What is the median unit price within 800 m of {station}, and how has it moved?',
          'What is the transit premium for units at {station}?',
          'What is the land use within 800 m of {station}?',
          'Find candidate development sites near {station}.',
        ],
        uses: ['sites'],
      },
      {
        title: 'Compare two precincts',
        why: 'Put two stations side by side on price and momentum.',
        steps: [
          'Compare Chatswood and St Leonards on unit price momentum within 800 m',
          'Compare {station} and Parramatta on unit prices within 800 m',
        ],
        uses: [],
      },
    ] as Playbook[],
  },
  lender: {
    label: 'Lending and valuation',
    short: 'Lender',
    blurb: 'Check that a price is supported by enough comparable sales, and how a precinct is trending.',
    questions: [
      'How many unit sales support the median near Granville, and how has it moved?',
      'Is the house median within 800 m of Hornsby supported by at least 10 sales?',
      'Compare 12-month unit price change near Burwood and Strathfield',
    ],
    playbooks: [
      {
        title: 'Is the median supported?',
        why: 'The sales depth behind the headline price.',
        steps: [
          'How many unit sales support the median near {station}, and how has it moved?',
          'Is the house median within 800 m of {station} supported by at least 10 sales?',
        ],
        uses: [],
      },
      {
        title: 'Trend check',
        why: 'Twelve-month change and monthly sales.',
        steps: [
          'How have unit prices near {station} changed over 12 months?',
          'How many unit sales were there each month near {station}?',
        ],
        uses: [],
      },
      {
        title: 'Comparable precincts',
        why: 'Rank stations by price to find comparables.',
        steps: [
          'Rank stations by unit median price within 800 m, cheapest first.',
          'Rank stations by unit price momentum within 800 m.',
        ],
        uses: ['screener'],
      },
    ] as Playbook[],
  },
  planner: {
    label: 'Planning and policy',
    short: 'Planner',
    blurb: 'Track housing, transport use and land use around centres, with a source on every figure.',
    questions: [
      'How busy is North Sydney station compared with a year earlier?',
      'What is the land use within 800 m of Chatswood?',
      'Which is more affordable for units, Auburn or Lidcombe?',
    ],
    playbooks: [
      {
        title: 'Centre health check',
        why: 'Patronage, land use and cover in one pass.',
        steps: [
          'How busy is {station} station compared with a year earlier?',
          'What is the land use within 800 m of {station}?',
          'How much tree canopy is there within 800 m of {station}?',
        ],
        uses: [],
      },
      {
        title: 'Corridor review',
        why: 'Check the centre, then fly the line station by station.',
        steps: [
          'How has patronage at {station} changed over the last year?',
          TOUR_STEP,
        ],
        uses: ['tours'],
      },
      {
        title: 'Housing near transport',
        why: 'Sales activity close in versus further out.',
        steps: [
          'How many unit sales were there within 400 m of {station} in the last 12 months?',
          'How many unit sales were there within 800 m of {station} in the last 12 months?',
        ],
        uses: [],
      },
    ] as Playbook[],
  },
} as const;
