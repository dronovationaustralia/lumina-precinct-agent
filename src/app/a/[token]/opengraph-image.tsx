/**
 * Open Graph image for a shared answer (1200×630): the question and up to three
 * figures. No database: everything comes from the signed token. Rendered PNG bytes
 * are cached per token, in memory and a temp file.
 */
import { ImageResponse } from 'next/og';

import { verifyShare } from '@/server/share';
import { cachedOgImage } from '@/server/share-url';

export const alt = 'Shared verified answer';
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

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shared = verifyShare(token);
  if (!shared) return new ImageResponse(<Fallback />, { ...size });
  const png = await cachedOgImage(`a:${token}`, async () => {
    const facts = shared.facts.slice(0, 3);
    const question = shared.question.length > 140 ? `${shared.question.slice(0, 137)}…` : shared.question;
    const res = new ImageResponse(
      (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#ffffff', padding: '56px 64px 40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 18, height: 18, borderRadius: 9, background: harbour }} />
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 2, color: muted }}>VERIFIED ANSWER</div>
          </div>
          <div style={{ fontSize: 46, fontWeight: 700, color: ink, marginTop: 16, lineHeight: 1.2 }}>{question}</div>
          <div style={{ display: 'flex', marginTop: 28, gap: 40 }}>
            {facts.map((f) => (
              <div key={f.id} style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 52, fontWeight: 700, color: harbour }}>{f.display}</div>
                <div style={{ fontSize: 21, color: muted }}>{f.label.split(',')[0]}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', marginTop: 'auto', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: ink }}>Lumina Precinct Agent</div>
            <div style={{ fontSize: 17, color: faint }}>· Figures checked against NSW open data</div>
          </div>
        </div>
      ),
      { ...size },
    );
    return Buffer.from(await res.arrayBuffer());
  });
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
}
