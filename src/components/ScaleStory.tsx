/** The "works for any city" story, shared by the sign-in page and /about. Pure render. */

export const SCALE_LINE = 'Live for Sydney. The same engine runs anywhere with open transit, map and imagery data.';

export const ADAPTERS = [
  { title: 'Stations and lines', body: 'GTFS, published by 1,000+ transit agencies worldwide.' },
  { title: 'Places and land use', body: 'OpenStreetMap, global.' },
  {
    title: 'Aerial cover and sites',
    body: 'SAM 3.1 on any aerial or drone imagery; your own drone surveys replace public imagery.',
  },
  {
    title: 'Prices and rents',
    body: 'Pluggable: NSW Valuer General today; UK Land Registry, NYC rolling sales and similar registries next.',
  },
];

/** Rough continent outlines on a 360×180 equirectangular grid (x = lon + 180, y = 90 − lat). Schematic. */
const CONTINENTS = [
  'M12,24 L40,20 L70,18 L95,20 L115,28 L125,40 L115,46 L106,51 L100,59 L90,61 L83,64 L75,68 L68,61 L58,53 L56,42 L45,33 L25,32 Z',
  'M102,83 L120,82 L130,90 L140,98 L140,110 L130,120 L122,128 L115,135 L110,142 L107,130 L110,115 L105,102 L100,90 Z',
  'M171,47 L178,54 L183,48 L190,52 L195,50 L200,50 L208,49 L210,45 L220,42 L220,35 L210,30 L200,25 L190,20 L185,28 L180,35 L175,40 Z',
  'M163,70 L170,60 L180,55 L190,53 L200,58 L210,59 L215,62 L220,70 L225,78 L230,80 L225,88 L215,95 L215,110 L213,118 L205,124 L198,123 L194,115 L192,105 L190,95 L185,85 L175,85 L165,78 Z',
  'M190,60 L200,53 L230,45 L260,30 L300,20 L340,25 L350,40 L340,55 L320,60 L310,75 L300,85 L290,80 L285,65 L270,60 L260,70 L250,75 L240,65 L230,60 L220,65 L215,80 L210,95 L200,90 L195,75 Z',
  'M293,102 L310,100 L325,105 L333,115 L330,125 L320,128 L305,128 L295,122 L290,112 Z',
];

const NEXT_CITIES = [
  { name: 'London', x: 179.9, y: 38.5, anchor: 'start' as const, dx: 5, dy: -2 },
  { name: 'New York', x: 106, y: 49.3, anchor: 'end' as const, dx: -5, dy: 1 },
  { name: 'Singapore', x: 283.8, y: 88.7, anchor: 'start' as const, dx: 5, dy: 3 },
];
const SYDNEY = { x: 331.2, y: 123.9 };

const TONES = {
  dark: { land: '#ffffff', landOpacity: 0.16, grid: '#ffffff', gridOpacity: 0.08, live: '#8fb8f5', liveText: '#ffffff', next: '#9fb7c9', nextText: '#9fb7c9' },
  light: { land: '#1f5fad', landOpacity: 0.14, grid: '#1f5fad', gridOpacity: 0.12, live: '#1f5fad', liveText: '#142220', next: '#7a8a86', nextText: '#5a6865' },
};

/** Small static world map: Sydney live, London, New York and Singapore planned. Inline SVG, no tiles. */
export function ScaleMap({ tone }: { tone: 'dark' | 'light' }) {
  const c = TONES[tone];
  return (
    <svg viewBox="0 0 360 180" className="scale-map" role="img" aria-label="Schematic world map: Sydney live; London, New York and Singapore next">
      <title>Live for Sydney; London, New York and Singapore next</title>
      {[60, 120, 180, 240, 300].map((x) => (
        <line key={x} x1={x} y1={0} x2={x} y2={180} stroke={c.grid} strokeOpacity={c.gridOpacity} strokeWidth={0.5} />
      ))}
      {[30, 60, 90, 120, 150].map((y) => (
        <line key={y} x1={0} y1={y} x2={360} y2={y} stroke={c.grid} strokeOpacity={c.gridOpacity} strokeWidth={0.5} />
      ))}
      {CONTINENTS.map((d) => (
        <path key={d} d={d} fill={c.land} fillOpacity={c.landOpacity} />
      ))}
      {NEXT_CITIES.map((city) => (
        <g key={city.name}>
          <circle cx={city.x} cy={city.y} r={3} fill="none" stroke={c.next} strokeWidth={1.5} />
          <text x={city.x + city.dx} y={city.y + city.dy} textAnchor={city.anchor} fontSize={8.5} fill={c.nextText}>
            {city.name} · Next
          </text>
        </g>
      ))}
      <circle cx={SYDNEY.x} cy={SYDNEY.y} r={3.5} fill={c.live} />
      <text x={SYDNEY.x - 6} y={SYDNEY.y - 3} textAnchor="end" fontSize={8.5} fontWeight={700} fill={c.liveText}>
        Sydney · Live
      </text>
    </svg>
  );
}

export function AdapterTiles({ tone }: { tone: 'dark' | 'light' }) {
  return (
    <ul className="adapters" data-tone={tone}>
      {ADAPTERS.map((a) => (
        <li key={a.title} className="adapter">
          <strong>{a.title}</strong>
          <span>{a.body}</span>
        </li>
      ))}
    </ul>
  );
}
