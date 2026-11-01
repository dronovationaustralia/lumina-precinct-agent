/**
 * Polygon geometry for the SAM opportunity-sites export (scripts/sam/sites.ts).
 * Pure functions over mask rasters: connected components, boundary tracing,
 * simplification and Web Mercator projection. No SAM calls, no database.
 */

export type Point = [number, number];

/** Label 8-connected components of a binary grid. Labels start at 1. */
export function labelComponents(grid: Uint8Array, w: number, h: number): { labels: Int32Array; sizes: number[]; starts: Point[] } {
  const labels = new Int32Array(w * h);
  const sizes: number[] = [];
  const starts: Point[] = [];
  const queue = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (!grid[s] || labels[s]) continue;
    const id = sizes.length + 1;
    starts.push([s % w, Math.floor(s / w)]);
    let head = 0, tail = 0, n = 0;
    queue[tail++] = s;
    labels[s] = id;
    while (head < tail) {
      const c = queue[head++]!;
      n++;
      const cx = c % w, cy = Math.floor(c / w);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (grid[ni] && !labels[ni]) {
          labels[ni] = id;
          queue[tail++] = ni;
        }
      }
    }
    sizes.push(n);
  }
  return { labels, sizes, starts };
}

// 8-neighbourhood clockwise from west.
const DX = [-1, -1, 0, 1, 1, 1, 0, -1];
const DY = [0, -1, -1, -1, 0, 1, 1, 1];
const DIR_INDEX = new Map(DX.map((dx, i) => [`${dx},${DY[i]}`, i]));

/**
 * Moore boundary tracing from a topmost-leftmost pixel (`at` is true on the
 * component, false elsewhere including outside the grid). Stops when a
 * (pixel, entry side) state repeats, so narrow shapes terminate too.
 */
export function traceOutline(at: (x: number, y: number) => boolean, sx: number, sy: number, cap: number): Point[] {
  const outline: Point[] = [[sx, sy]];
  const seen = new Set([`${sx},${sy},0`]);
  let cx = sx, cy = sy, back = 0;
  for (let i = 0; i < cap; i++) {
    let found = -1;
    for (let k = 1; k <= 8; k++) {
      const ni = (back + k) % 8;
      if (at(cx + DX[ni]!, cy + DY[ni]!)) {
        found = ni;
        break;
      }
    }
    if (found === -1) break; // isolated pixel
    const prev = (found + 7) % 8;
    const key = `${DX[prev]! - DX[found]!},${DY[prev]! - DY[found]!}`;
    cx += DX[found]!;
    cy += DY[found]!;
    back = DIR_INDEX.get(key)!;
    // Done once the start is re-entered from the west (Jacob's criterion),
    // or any state repeats (one-cell-thick shapes would loop forever).
    if ((cx === sx && cy === sy && back === 0) || seen.has(`${cx},${cy},${back}`)) break;
    seen.add(`${cx},${cy},${back}`);
    outline.push([cx, cy]);
  }
  return outline;
}

function perpDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker simplification; keeps the endpoints. */
export function douglasPeucker(pts: Point[], tol: number): Point[] {
  if (pts.length <= 2) return [...pts];
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let worst = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDistance(pts[i]!, pts[s]!, pts[e]!);
      if (d > worst) {
        worst = d;
        idx = i;
      }
    }
    if (worst > tol && idx > 0) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Signed polygon area (positive when counter-clockwise). */
export function ringArea(pts: Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export const MERCATOR_R = 6378137;

export function mercFromLonLat(lat: number, lon: number): { x: number; y: number } {
  return { x: (MERCATOR_R * lon * Math.PI) / 180, y: MERCATOR_R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) };
}

export function lonLatFromMerc(x: number, y: number): { lat: number; lon: number } {
  return { lon: ((x / MERCATOR_R) * 180) / Math.PI, lat: (Math.atan(Math.sinh(y / MERCATOR_R)) * 180) / Math.PI };
}

/**
 * Georeferencing for one station's chip grid, shared by the SAM polygon exports
 * (sites.ts, cover-polygons.ts).
 *
 * Each chip was fetched as a Web Mercator box of RES / cos(lat) map units per pixel
 * around its centre (see fetchChip in batch.ts), so grid-pixel offsets are scaled by
 * that before converting back to ground metres. `toMetres` gives ground metres
 * (east, north) from the station for a grid pixel; `toLonLat` turns those back into
 * WGS84. Pixel coordinates may be fractional (pixel centres sit at half-integers
 * after the +0.5 convention below; pass -0.5 for a chip's outer edge).
 */
export function createStationProjection(
  station: { lat: number; lon: number },
  gridN: number,
  chipPx: number,
  resM: number,
): {
  chipCentre: (gx: number, gy: number) => { lat: number; lon: number };
  toMetres: (px: number, py: number) => Point;
  toLonLat: (e: number, m: number) => Point;
} {
  const chipM = chipPx * resM;
  const mPerDegLat = 111_320, mPerDegLon = 111_320 * Math.cos((station.lat * Math.PI) / 180);
  const chipCentre = (gx: number, gy: number) => {
    const ex = (gx - (gridN - 1) / 2) * chipM, ny = ((gridN - 1) / 2 - gy) * chipM;
    return { lat: station.lat + ny / mPerDegLat, lon: station.lon + ex / mPerDegLon };
  };
  const stationMerc = mercFromLonLat(station.lat, station.lon);
  const cosStation = Math.cos((station.lat * Math.PI) / 180);
  const toMetres = (px: number, py: number): Point => {
    const gx = Math.min(gridN - 1, Math.max(0, Math.floor(px / chipPx)));
    const gy = Math.min(gridN - 1, Math.max(0, Math.floor(py / chipPx)));
    const { lat, lon } = chipCentre(gx, gy);
    const c = mercFromLonLat(lat, lon);
    const unit = resM / Math.cos((lat * Math.PI) / 180);
    const mx = c.x + (px - gx * chipPx + 0.5 - chipPx / 2) * unit;
    const my = c.y + (gy * chipPx + chipPx / 2 - (py + 0.5)) * unit;
    return [(mx - stationMerc.x) * cosStation, (my - stationMerc.y) * cosStation];
  };
  const toLonLat = (e: number, m: number): Point => {
    const { lat, lon } = lonLatFromMerc(stationMerc.x + e / cosStation, stationMerc.y + m / cosStation);
    return [Number(lon.toFixed(7)), Number(lat.toFixed(7))];
  };
  return { chipCentre, toMetres, toLonLat };
}
