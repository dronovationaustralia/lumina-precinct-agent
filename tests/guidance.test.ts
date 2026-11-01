/**
 * Guidance and scale: playbook templates fill {station} and never reference a missing
 * feature; the "What can I ask?" drawer and /about render; /about is public while other
 * pages still need a session.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import AboutPage from '@/app/about/page';
import { AskDrawer } from '@/components/portal/AskDrawer';
import { CoachMarks } from '@/components/portal/CoachMarks';
import { PERSONA_INFO, TOUR_STEP, fillStep, type PlaybookFeature } from '@/lib/personas';
import { TOURABLE_LINES, resolveTour } from '@/lib/tours';
import { isPublicPath } from '@/server/auth/session';
import { TOOL_ARG_SCHEMAS } from '@/server/tools/index';

/** Features a step's wording implies it relies on. */
const IMPLIED: { re: RegExp; feature: PlaybookFeature }[] = [
  { re: /\brank\b|\bstrongest\b|\bcheapest\b/i, feature: 'screener' },
  { re: /\bsites?\b|\bcar parks?\b|\bconstruction\b/i, feature: 'sites' },
  { re: /\btours?\b/i, feature: 'tours' },
];

const shipped: Record<PlaybookFeature, boolean> = {
  screener: 'rank_stations' in TOOL_ARG_SCHEMAS,
  sites: 'find_sites' in TOOL_ARG_SCHEMAS,
  tours: typeof resolveTour === 'function' && TOURABLE_LINES.length > 0,
};

describe('playbooks', () => {
  test('fillStep fills the {station} slot', () => {
    expect(fillStep('What is the land use within 800 m of {station}?', 'Chatswood')).toBe(
      'What is the land use within 800 m of Chatswood?',
    );
    expect(fillStep('Rank stations by unit median.', 'Chatswood')).toBe('Rank stations by unit median.');
  });

  test('every persona has 3–4 playbooks of askable steps', () => {
    for (const [persona, info] of Object.entries(PERSONA_INFO)) {
      expect(info.playbooks.length, persona).toBeGreaterThanOrEqual(3);
      expect(info.playbooks.length, persona).toBeLessThanOrEqual(4);
      for (const book of info.playbooks) {
        expect(book.title.length, `${persona}/${book.title}`).toBeGreaterThan(0);
        expect(book.why.length, `${persona}/${book.title}`).toBeGreaterThan(0);
        expect(book.steps.length, `${persona}/${book.title}`).toBeGreaterThan(0);
        // Starting a playbook always asks a question; the tour step only continues one.
        expect(book.steps[0], `${persona}/${book.title}`).not.toBe(TOUR_STEP);
        for (const step of book.steps) {
          expect(step.trim().length, `${persona}/${book.title}`).toBeGreaterThan(0);
          expect(step.length, `${persona}/${book.title}`).toBeLessThanOrEqual(500);
        }
      }
    }
  });

  test('playbooks never reference a missing feature', () => {
    for (const [persona, info] of Object.entries(PERSONA_INFO)) {
      for (const book of info.playbooks) {
        for (const feature of book.uses) expect(shipped[feature], `${persona}/${book.title} needs ${feature}`).toBe(true);
        const implied = new Set(IMPLIED.filter((k) => book.steps.some((s) => k.re.test(s))).map((k) => k.feature));
        for (const feature of implied) {
          expect(book.uses, `${persona}/${book.title} mentions ${feature}`).toContain(feature);
        }
      }
    }
  });
});

describe('guidance renders', () => {
  test('the "What can I ask?" drawer shows types, examples, data dates and limits', () => {
    const html = renderToStaticMarkup(
      AskDrawer({
        datasets: [{ id: 'nsw_vg_sales', name: 'NSW Valuer General sales', as_of: '2026-07-31', licence: 'CC BY 4.0', demo: false }],
        onClose: () => {},
        onAsk: () => {},
      }),
    );
    for (const type of ['Prices', 'Momentum', 'Sales depth', 'Transit premium', 'Patronage', 'Land use and aerial cover', 'Sites', 'Screening', 'Tours']) {
      expect(html).toContain(type);
    }
    expect(html).toContain('What is the median unit price within 800 m of Chatswood?');
    expect(html).toContain('NSW Valuer General sales (as of 2026-07-31)');
    expect(html).toContain('What Lumina won');
    expect(html).toContain('No forecasts');
    expect(html).toContain('No individual property records');
  });

  test('the drawer says so when data is not loaded', () => {
    const html = renderToStaticMarkup(AskDrawer({ datasets: [], onClose: () => {}, onAsk: () => {} }));
    expect(html).toContain('Data not loaded yet.');
  });

  test('first-visit tips list three steps and dismiss', () => {
    const html = renderToStaticMarkup(CoachMarks({ onDone: () => {} }));
    expect(html).toContain('Pick a station');
    expect(html).toContain('start a playbook');
    expect(html).toContain('How this answer was made');
    expect(html).toContain('Got it');
  });

  test('/about tells the any-city story without overclaiming', () => {
    const html = renderToStaticMarkup(AboutPage());
    expect(html).toContain('About Lumina Precinct Agent');
    expect(html).toContain('Built to work for any city');
    expect(html).toContain('Live for Sydney. The same engine runs anywhere with open transit, map and imagery data.');
    for (const city of ['Sydney · Live', 'London · Next', 'New York · Next', 'Singapore · Next']) {
      expect(html).toContain(city);
    }
    expect(html).toContain('Only Sydney works today; other cities are planned.');
    expect(html).toContain('How every figure is checked');
    expect(html).toContain('Muse Spark');
    expect(html).toContain('SAM 3.1');
    expect(html).toContain('https://github.com/dronovationaustralia/lumina-precinct-agent');
    for (const persona of Object.values(PERSONA_INFO)) expect(html).toContain(persona.label);
  });
});

describe('/about access', () => {
  test('/about is public; other pages still need a session', () => {
    expect(isPublicPath('/about')).toBe(true);
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('/api/v1/ask')).toBe(false);
  });

  test('existing public paths are unchanged', () => {
    expect(isPublicPath('/a/abc')).toBe(true);
    expect(isPublicPath('/p/chatswood')).toBe(true);
    expect(isPublicPath('/api/v1/health')).toBe(false);
  });
});
