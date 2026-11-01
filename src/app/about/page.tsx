/**
 * Public about page: no sign-in. What Lumina does, who it is for, how figures are
 * checked, the Meta models, the any-city adapters, data sources and the repository.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { PERSONA_INFO } from '@/lib/personas';

import { AdapterTiles, SCALE_LINE, ScaleMap } from '@/components/ScaleStory';

import { AboutDatasets } from './datasets';

export const metadata: Metadata = {
  title: 'About · Lumina Precinct Agent',
  description: 'What Lumina Precinct Agent does, who it is for, how every figure is checked, and how it scales to any city.',
};

const MODELS = [
  { name: 'Muse Spark', where: 'Plans which governed data calls answer each question, then writes the answer. Used in every answer; see “How this answer was made” under it.' },
  { name: 'SAM 3.1', where: 'Segments aerial imagery into building, tree canopy, car park and construction site. Used in the land-use breakdown, the “What SAM 3.1 sees” map layer and opportunity sites.' },
  { name: 'Muse Voice Transcribe', where: 'Turns spoken questions into text, biased to station names. Used by the microphone in the question box.' },
  { name: 'Muse Image', where: 'Renders shareable precinct briefing cards from verified figures. Used by “Brief me” on the precinct snapshot.' },
];

export default function AboutPage() {
  const personas = Object.values(PERSONA_INFO);
  return (
    <main className="about">
      <div className="about-inner">
        <p className="about-back"><Link href="/">← Back to Lumina</Link></p>
        <p className="kicker">Dronovation Labs</p>
        <h1>About Lumina Precinct Agent</h1>
        <p className="about-lead">
          Screen any of Sydney&apos;s 185 train and metro station precincts in minutes. Ask in plain
          English; every figure is computed from NSW open data, checked before you see it, and shown
          on the map.
        </p>

        <h2>Who it is for</h2>
        <ul className="about-personas">
          {personas.map((p) => (
            <li key={p.short}>
              <strong>{p.label}.</strong> {p.blurb}
            </li>
          ))}
        </ul>

        <h2>How every figure is checked</h2>
        <p>
          Meta models plan, read imagery and write, but they never invent a number: every figure
          comes from a governed SQL query over open data, and a deterministic checker rejects any
          answer whose numbers do not match the data. Each answer shows how it was made, the data
          calls behind it, and the source and date of every figure.
        </p>

        <h2>Where Meta AI is used</h2>
        <ul className="about-models">
          {MODELS.map((m) => (
            <li key={m.name}>
              <span className="meta-chip">{m.name}</span>
              <span>{m.where}</span>
            </li>
          ))}
        </ul>

        <h2>Built to work for any city</h2>
        <p>{SCALE_LINE}</p>
        <AdapterTiles tone="light" />
        <ScaleMap tone="light" />
        <p className="about-note">Schematic, not to scale. Only Sydney works today; other cities are planned.</p>

        <h2>Data sources</h2>
        <AboutDatasets />

        <h2>Repository</h2>
        <p>
          <a href="https://github.com/dronovationaustralia/lumina-precinct-agent">github.com/dronovationaustralia/lumina-precinct-agent</a>
        </p>
      </div>
    </main>
  );
}
