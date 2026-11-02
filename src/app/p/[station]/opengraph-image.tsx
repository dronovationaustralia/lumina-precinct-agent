/**
 * Open Graph image for a precinct card (1200×630): the illustration on one side,
 * the station name and three headline figures on the other. Rendered PNG bytes are
 * cached per station, in memory and a temp file.
 */
import { ImageResponse } from 'next/og';

import { StationId } from '@/lib/contracts';
import { STATION_BY_ID } from '@/lib/stations';
import { briefingFacts, briefingIllustration, briefingPrompt } from '@/server/briefing';
import { takeQuota } from '@/server/quota';
import { getDb } from '@/server/db/client';
import { cachedOgImage } from '@/server/share-url';

export const alt = 'Precinct briefing';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const ink = '#1e2d2b';
const muted = '#56645f';
const faint = '#7d8a85';
const harbour = '#1f5fad';

function Fallback() {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f2f4f1' }}>
      <div style={{ fontSize: 56, fontWeight: 700, color: ink }}>Lumina Precinct Agent</div>
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ station: string }> }) {
  const { station } = await params;
  const parsed = StationId.safeParse(station);
  if (!parsed.success || !STATION_BY_ID.has(parsed.data)) return new ImageResponse(<Fallback />, { ...size });
  const info = STATION_BY_ID.get(parsed.data)!;
  const png = await cachedOgImage(`p:${info.id}`, async () => {
    const db = await getDb();
    const figures = await briefingFacts(db, info.id);
    const prompt = briefingPrompt(
      info,
      figures.filter((f) => f.category).map((f) => ({ category: f.category!, share_pct: f.share_pct! })),
    );
    let image: string | null = null;
    try {
      image = (await briefingIllustration(info.id, prompt, () => takeQuota('image'))).image;
    } catch {
      image = null;
    }
    const heads = figures.filter((f) => !f.category).slice(0, 3);
    const res = new ImageResponse(
      (
        <div style={{ width: '100%', height: '100%', display: 'flex', background: '#ffffff' }}>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element -- OG render, not a page
            <img src={image} width={600} height={630} style={{ objectFit: 'cover' }} alt="" />
          ) : (
            <div style={{ width: 600, height: 630, display: 'flex', alignItems: 'center', justifyContent: 'center', background: harbour }}>
              <div style={{ fontSize: 64, fontWeight: 700, color: '#ffffff' }}>Lumina</div>
            </div>
          )}
          <div style={{ width: 600, height: 630, display: 'flex', flexDirection: 'column', padding: '56px 56px 40px' }}>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 2, color: muted }}>PRECINCT BRIEFING</div>
            <div style={{ fontSize: 64, fontWeight: 700, color: ink, marginTop: 8, lineHeight: 1.1 }}>{info.name}</div>
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 28, gap: 18 }}>
              {heads.map((f) => (
                <div key={f.label} style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: 44, fontWeight: 700, color: ink }}>{f.display}</div>
                  <div style={{ fontSize: 21, color: muted }}>{f.label.split(',')[0]}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', marginTop: 'auto', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 18, height: 18, borderRadius: 9, background: harbour }} />
              <div style={{ fontSize: 20, fontWeight: 700, color: ink }}>Lumina</div>
            </div>
            <div style={{ fontSize: 17, color: faint, marginTop: 6 }}>Illustration: AI-generated (Muse Image) · Figures: NSW open data, checked</div>
          </div>
        </div>
      ),
      { ...size },
    );
    return Buffer.from(await res.arrayBuffer());
  });
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
}
