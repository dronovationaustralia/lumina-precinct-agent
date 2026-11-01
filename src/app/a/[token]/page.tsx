/**
 * Public shared answer: no sign-in, the agent never re-runs. The token carries the
 * question, templates, cited facts, sources and verification status, signed with HMAC;
 * anything with a bad signature is a 404.
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DISCLAIMER, type AskResponse } from '@/lib/contracts';
import { STATION_BY_ID } from '@/lib/stations';
import { fillPlaceholders } from '@/server/agent/verify';
import { rateLimit } from '@/server/http';
import { verifyShare } from '@/server/share';
import { publicBaseUrl } from '@/server/share-url';

import { SharedCard } from './card';

const shortQuestion = (q: string) => (q.length > 90 ? `${q.slice(0, 87)}…` : q);

export const instant = false;

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const shared = verifyShare(token);
  if (!shared) return { title: 'Shared answer · Lumina Precinct Agent' };
  const base = await publicBaseUrl();
  const title = `${shortQuestion(shared.question)} · Lumina Precinct Agent`;
  const description = 'A verified answer about a Sydney station precinct, with traceable figures and sources.';
  const image = `${base}/a/${token}/opengraph-image`;
  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630, alt: 'Shared verified answer' }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default async function SharedAnswerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shared = verifyShare(token);
  if (!shared) notFound();
  const limited = rateLimit({ headers: await headers() } as Request);
  if (limited) {
    return (
      <main className="share-page">
        <div className="share-card">
          <h1>Too many requests</h1>
          <p>Please wait a moment and try again.</p>
        </div>
      </main>
    );
  }
  const demo = shared.facts.some((f) => f.demo) || shared.sources.some((s) => s.demo);
  const answer: AskResponse = {
    lines: shared.templates.map((t) => fillPlaceholders(t, shared.facts)),
    templates: shared.templates,
    disclaimer: demo ? `${DISCLAIMER} Demo data: figures are synthetic, not real.` : DISCLAIMER,
    facts: shared.facts,
    sources: shared.sources,
    actions: [],
    followups: [],
    chart: null,
    verification: { status: shared.status, attempts: 1, checks: [], errors: [] },
    meta: {
      request_id: `shared-${shared.created_at}`,
      provider: shared.model.provider,
      model: shared.model.model,
      demo_data: demo,
      timings_ms: {},
      tokens: { input: 0, output: 0 },
      tool_calls: [],
    },
  };
  const stationName = shared.station ? STATION_BY_ID.get(shared.station)?.name : undefined;
  return (
    <main className="share-page">
      <div className="share-card">
        <SharedCard turn={{ id: 'shared', question: shared.question, station: shared.station, progress: [], answer }} stationName={stationName} />
        <div className="share-actions">
          <Link className="ask-button share-cta" href="/signin">
            Explore in Lumina
          </Link>
        </div>
        <p className="share-stamp">Shared {shared.created_at.slice(0, 10)} · Lumina Precinct Agent</p>
      </div>
    </main>
  );
}
