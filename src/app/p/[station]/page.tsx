/**
 * Public precinct card: no sign-in. The station name, lines, the Muse Image
 * illustration (cached; generated if missing) and the verified figures with
 * sources and dates, plus an Explore button to the sign-in page.
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { StationId } from '@/lib/contracts';
import { STATION_BY_ID } from '@/lib/stations';
import { LineBadges } from '@/components/portal/LineBadges';
import { briefingFacts, briefingIllustration, briefingPrompt } from '@/server/briefing';
import { getDb } from '@/server/db/client';
import { rateLimit } from '@/server/http';
import { publicBaseUrl } from '@/server/share-url';

export const instant = false;

export async function generateMetadata({ params }: { params: Promise<{ station: string }> }): Promise<Metadata> {
  const { station } = await params;
  const parsed = StationId.safeParse(station);
  if (!parsed.success || !STATION_BY_ID.has(parsed.data)) return { title: 'Not found · Lumina Precinct Agent' };
  const info = STATION_BY_ID.get(parsed.data)!;
  const base = await publicBaseUrl();
  const title = `${info.name} precinct · Lumina Precinct Agent`;
  const description = `Verified figures for the ${info.name} station precinct: prices, patronage and land use.`;
  const image = `${base}/p/${info.id}/opengraph-image`;
  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630, alt: `${info.name} precinct briefing` }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default async function PrecinctPage({ params }: { params: Promise<{ station: string }> }) {
  const { station } = await params;
  const parsed = StationId.safeParse(station);
  if (!parsed.success || !STATION_BY_ID.has(parsed.data)) notFound();
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
  const info = STATION_BY_ID.get(parsed.data)!;
  const db = await getDb();
  const figures = await briefingFacts(db, parsed.data);
  const prompt = briefingPrompt(
    info,
    figures.filter((f) => f.category).map((f) => ({ category: f.category!, share_pct: f.share_pct! })),
  );
  let image: string | null = null;
  try {
    image = (await briefingIllustration(parsed.data, prompt)).image;
  } catch {
    image = null;
  }
  return (
    <main className="share-page">
      <div className="share-card">
        <p className="kicker">Precinct briefing</p>
        <h1>{info.name}</h1>
        <LineBadges lines={info.lines} />
        {image ? (
          <figure className="brief-figure">
            {/* eslint-disable-next-line @next/next/no-img-element -- data-URL illustration, not optimizable */}
            <img src={image} alt={`AI-generated illustration of the ${info.name} precinct`} />
            <figcaption>Illustration: AI-generated (Muse Image)</figcaption>
          </figure>
        ) : (
          <p className="notice">The illustration is unavailable right now; the figures below are current.</p>
        )}
        <ul className="brief-tiles">
          {figures.map((f) => (
            <li key={f.label} className="brief-tile">
              <span className="brief-value">{f.display}</span>
              <span className="brief-label">{f.label}</span>
              <span className="brief-source">
                {f.demo ? 'Demo data' : f.source} · {f.as_of}
              </span>
            </li>
          ))}
        </ul>
        <p className="brief-foot">Figures: governed NSW open data, checked. Not financial advice.</p>
        <div className="share-actions">
          <Link className="ask-button share-cta" href="/signin">
            Explore in Lumina
          </Link>
        </div>
      </div>
    </main>
  );
}
