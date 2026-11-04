/**
 * Cut the raw demo recording to the submission video.
 *
 *   npm run demo:edit                                  # latest recording
 *   npm run demo:edit -- --run 20261104-1540           # a specific run in data/derived/demo/runs/
 *   npm run demo:edit -- --target 170                  # aim for 170 s (default 175)
 *
 * Uses the marks written by record.mjs: typing plays 3x, waiting for a model plays 6x with a
 * "6x waiting for the model" badge (nothing hidden), a failed scene is cut, the blank first
 * second is trimmed, and the rest is sped up evenly (at most 1.3x) only if needed to fit.
 *
 * Writes, next to the recording, data/derived/demo/lumina-demo-<recorded date-time>[-vN].mp4
 * (silent H.264, 1920x1080, 30 fps) and a matching -timings.txt with the start of every scene in
 * the cut, for recording the narration. ffmpeg comes from the ffmpeg-static package; no install.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import sharp from 'sharp';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const DEMO = path.resolve('data/derived/demo');
const runId = arg('run', null);
const dir = runId ? path.join(DEMO, 'runs', runId) : DEMO;
const SRC = path.join(dir, 'walkthrough.webm');
const EVENTS = path.join(dir, 'events.json');
const TARGET = Number(arg('target', '175'));
if (!existsSync(SRC) || !existsSync(EVENTS)) { console.error(`No recording at ${dir}. Run npm run demo:record first.`); process.exit(1); }

const meta = JSON.parse(readFileSync(EVENTS, 'utf8'));
const ev = meta.events;
const sydney = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  .format(d).replace(/[^0-9]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
const stamp = meta.stamp ?? sydney(new Date(meta.recorded_at));

function run(bin, args, { quiet = true } = {}) {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 && !quiet) throw new Error(`${path.basename(bin)} failed:\n${(r.stderr || '').slice(-2000)}`);
  return r;
}
const ffmpeg = (args, opts) => run(ffmpegPath, ['-hide_banner', ...args], opts);

// Output name: lumina-demo-<stamp>.mp4, then -v2, -v3 … if it exists already.
let OUT = path.join(DEMO, `lumina-demo-${stamp}.mp4`);
for (let v = 2; existsSync(OUT); v++) OUT = path.join(DEMO, `lumina-demo-${stamp}-v${v}.mp4`);
const work = path.join(DEMO, `.edit-${process.pid}`);
mkdirSync(work, { recursive: true });

// Playwright's WebM has no seek index; remux once (no re-encode) so every cut lands exactly.
const src = path.join(work, 'src.mkv');
ffmpeg(['-v', 'error', '-y', '-i', SRC, '-c', 'copy', src], { quiet: false });
const dur = Number(run(ffprobe.path, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).stdout.trim());

// Leading blank frames: flat dark grey with no bright pixels before the first paint.
let lead = 0;
{
  const st = ffmpeg(['-t', '15', '-i', src, '-vf', 'fps=10,signalstats,metadata=print:key=lavfi.signalstats.YMAX', '-an', '-f', 'null', '-']).stderr;
  let t = null;
  for (const line of st.split(/\r?\n/)) {
    const pt = line.match(/pts_time:([\d.]+)/); if (pt) t = Number(pt[1]);
    const ym = line.match(/YMAX=([\d.]+)/);
    if (ym && t !== null && Number(ym[1]) > 200) { lead = t + 0.15; break; }
  }
}

// Scenes, failed scenes, and the fast spans.
const SKIP = new Set(['type', 'wait']);
const starts = {}, ends = {};
for (const e of ev) {
  const m = e.name.match(/^(.+):(start|end)$/);
  if (m && !SKIP.has(m[1])) (m[2] === 'start' ? starts : ends)[m[1]] = e.t;
}
const failed = ev.filter((e) => e.name.endsWith(':failed')).map((e) => e.name.slice(0, -7));
const cuts = failed.map((n) => [starts[n], Math.min(...Object.values(starts).filter((t) => t > starts[n]), dur)]);
const fast = [];
const open = {};
for (const e of ev) {
  for (const [kind, speed] of [['type', 3], ['wait', 6]]) {
    if (e.name === `${kind}:start`) open[kind] = e.t;
    else if (e.name === `${kind}:end` && open[kind] !== undefined) { fast.push({ s: open[kind], e: e.t, speed, badge: kind === 'wait' }); delete open[kind]; }
  }
}
const inside = (t, spans) => spans.some(([s, e]) => s <= t && t < e);

const points = [...new Set([lead, dur, ...cuts.flat(), ...fast.flatMap((f) => [f.s, f.e]), ...Object.values(starts), ...Object.values(ends)])].filter((p) => p >= lead && p <= dur).sort((a, b) => a - b);
const segs = [];
for (let i = 0; i + 1 < points.length; i++) {
  const s = points[i], e = points[i + 1];
  if (e - s < 0.05 || inside((s + e) / 2, cuts)) continue;
  const f = fast.find((x) => x.s <= s && e <= x.e);
  segs.push({ s, e, speed: f ? f.speed : 1, badge: Boolean(f?.badge), fast: Boolean(f) });
}
const fixed = segs.filter((g) => g.fast).reduce((a, g) => a + (g.e - g.s) / g.speed, 0);
const normal = segs.filter((g) => !g.fast).reduce((a, g) => a + (g.e - g.s), 0);
// --scale signin=0.7,tour=1.4 sets a scene's speed by hand (below 1 slows it, to fit narration);
// fast spans inside it keep their own speed times that factor. Without --scale, the normal parts
// are sped up evenly (at most 1.3x) only if needed to fit --target.
const SCALE = Object.fromEntries((arg('scale', '') || '').split(',').filter(Boolean).map((kv) => { const [n, v] = kv.split('='); return [n, Number(v)]; }));
const sceneOf = (t) => Object.keys(starts).find((n) => starts[n] <= t && t < (ends[n] ?? Infinity));
const manual = Object.keys(SCALE).length > 0;
const k = manual ? 1 : Math.min(1.3, Math.max(1, normal / Math.max(1, TARGET - fixed)));
for (const g of segs) {
  if (!g.fast) g.speed = k;
  const f = SCALE[sceneOf((g.s + g.e) / 2)];
  if (f) g.speed *= f;
}
const total = segs.reduce((a, g) => a + (g.e - g.s) / g.speed, 0);
const cutTime = (t) => segs.reduce((a, g) => a + (t >= g.e ? (g.e - g.s) / g.speed : t > g.s ? (t - g.s) / g.speed : 0), 0);

// The "6x waiting for the model" badge, drawn once as an image (works with any ffmpeg build).
const badgePng = path.join(work, 'badge.png');
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="52">
  <rect width="400" height="52" rx="10" fill="#1f5fad" fill-opacity="0.92"/>
  <text x="200" y="35" text-anchor="middle" font-family="Segoe UI, DejaVu Sans, Arial, sans-serif" font-size="25" font-weight="700" fill="#fff">6× waiting for the model</text>
</svg>`)).png().toFile(badgePng);

// Playwright records the page (viewport) in the top-left of a larger frame and pads the rest
// with grey; crop to the page and scale it to full HD.
const [vw, vh] = meta.viewport ?? [1920, 1080];
const [fw, fh] = meta.size ?? [1920, 1080];
const fill = vw < fw || vh < fh ? `crop=${vw}:${vh}:0:0,scale=1920:1080:flags=lanczos,` : '';

const eventMap = ev.map((e) => ({ ...e, cut: Math.round(cutTime(e.t) * 100) / 100 }));
if (process.argv.includes('--plan-only')) {
  console.log(JSON.stringify({ total: Math.round(total * 10) / 10, scenes: Object.keys(starts).map((n) => [n, Math.round(cutTime(starts[n]) * 10) / 10, Math.round(cutTime(ends[n] ?? starts[n]) * 10) / 10]), events: eventMap.filter((e) => !/^(type|wait):/.test(e.name)).map((e) => [e.cut, e.name, e.label ?? e.question ?? '']) }, null, 1));
  rmSync(work, { recursive: true, force: true });
  process.exit(0);
}
console.log(`Cutting ${segs.length} segments from ${path.relative(process.cwd(), SRC)} …`);
const parts = [];
segs.forEach((g, i) => {
  const pre = Math.max(0, g.s - 2);
  const base = `trim=start=${(g.s - pre).toFixed(3)}:duration=${(g.e - g.s).toFixed(3)},setpts=(PTS-STARTPTS)/${g.speed.toFixed(4)},${fill}fps=30,format=yuv420p`;
  const part = path.join(work, `p${String(i).padStart(3, '0')}.mp4`);
  const args = g.badge
    ? ['-i', badgePng, '-filter_complex', `[0:v]${base}[v];[v][1:v]overlay=W-w-40:56,format=yuv420p[o]`, '-map', '[o]']
    : ['-vf', base];
  ffmpeg(['-v', 'error', '-y', '-ss', pre.toFixed(3), '-i', src, ...args, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', part], { quiet: false });
  parts.push(part);
  process.stdout.write(`  ${i + 1}/${segs.length}\r`);
});
writeFileSync(path.join(work, 'list.txt'), parts.map((p) => `file '${path.basename(p)}'\n`).join(''));
ffmpeg(['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(work, 'list.txt'), '-c', 'copy', '-movflags', '+faststart', OUT], { quiet: false });
rmSync(work, { recursive: true, force: true });

// Scene timings for the narration.
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const LABEL = { signin: '1 · Opening', models: '2 · Meta models', screen: '3 · Screening', sam: '4 · SAM 3.1', sites: '5 · Opportunity sites', voice: '6 · Voice', brief: '7 · Brief me', share: '8 · Share', tour: '9 · Tour', end: '10 · Closing' };
const scenes = Object.keys(starts).filter((n) => !failed.includes(n)).sort((a, b) => starts[a] - starts[b])
  .map((n) => ({ scene: n, from: cutTime(starts[n]), to: cutTime(ends[n] ?? starts[n]) }));
const timings = [
  `Lumina demo ${stamp}: ${fmt(total)} total (${path.basename(OUT)})`,
  `Story: ${meta.story?.name ?? '?'} (#${meta.story?.rank ?? '?'} of ${meta.story?.pool ?? '?'} by ${meta.story?.label ?? '?'})`,
  failed.length ? `Cut (failed): ${failed.join(', ')}` : 'No failed scenes',
  '',
  ...scenes.map((s) => `${fmt(s.from).padStart(6)} – ${fmt(s.to).padStart(6)}  ${LABEL[s.scene] ?? s.scene}  (${(s.to - s.from).toFixed(1)} s)`),
].join('\n');
writeFileSync(OUT.replace(/\.mp4$/, '-timings.txt'), `${timings}\n`);
writeFileSync(OUT.replace(/\.mp4$/, '-events.json'), JSON.stringify(eventMap, null, 1));
console.log(`\n${timings}\n\nSaved ${OUT}${total > 180 ? '\nWarning: over 3:00. Try --target 165.' : ''}`);
