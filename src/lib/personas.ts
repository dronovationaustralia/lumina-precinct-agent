/** User types the product is shaped around. Shared by the sign-in page, the portal and the agent. */
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
  },
} as const;
