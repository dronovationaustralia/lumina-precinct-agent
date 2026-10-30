/** Hexagon geometry for v_sales_hex (pointy-top, axial q/r, 300 m circumradius on a local plane). */
export const HEX_SIZE_M = 300;
const KX = 111_320 * Math.cos((-33.85 * Math.PI) / 180);
const KY = 111_320;

export function hexPolygon(q: number, r: number, size = HEX_SIZE_M): [number, number][] {
  const cx = size * Math.sqrt(3) * (q + r / 2);
  const cy = size * 1.5 * r;
  const ring: [number, number][] = [];
  for (let i = 0; i <= 6; i++) {
    const a = ((60 * (i % 6) - 30) * Math.PI) / 180;
    ring.push([Number(((cx + size * Math.cos(a)) / KX).toFixed(6)), Number(((cy + size * Math.sin(a)) / KY).toFixed(6))]);
  }
  return ring;
}
