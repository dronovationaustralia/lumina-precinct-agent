/**
 * Films the demo video of Lumina as one story, in a real browser, and logs every step so the
 * footage can be cut and sped up afterwards. Run it where the site, Meta's models and the map
 * tiles are reachable (your laptop):
 *
 *   npx playwright install chromium          # once
 *   npm run demo:record                      # live site
 *   npm run demo:record -- --base http://localhost:3000 --headed
 *
 * The story: a site-acquisition analyst screens all 185 stations, the screener points to one
 * featured precinct, and everything after (what SAM 3.1 saw, opportunity sites, a voice question,
 * the Muse Image briefing, sharing it, a corridor tour) stays on that precinct. The precinct is
 * chosen from the live data before filming, so the story follows what the data actually shows.
 *
 * Highlights (red boxes with labels), captions, the title and end cards and the "Built 27 Oct –
 * 4 Nov" label are drawn in the page, so they line up with what is on screen.
 *
 * Voice: `npm run demo:voice` (Windows) speaks "How busy is this station, and is patronage
 * growing?" into data/derived/demo/voice.wav with the built-in speech synthesiser; the browser's
 * microphone plays it, so Muse Voice transcribes it live. Without the file the scene is skipped.
 *
 * Output (gitignored): data/derived/demo/walkthrough.webm, events.json, story.json.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { chromium, request as apiRequest } from 'playwright';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg('base', 'https://lumina.dronovation.com.au').replace(/\/$/, '');
const HEADED = process.argv.includes('--headed');
const OUT = path.join('data', 'derived', 'demo');
mkdirSync(OUT, { recursive: true });
const VOICE = path.resolve(OUT, 'voice.wav');
const hasVoice = existsSync(VOICE);

// Laid out at 1536×864 and filmed at 1920×1080 (1.25×), so text stays readable.
const W = 1536, H = 864;
const VW = 1920, VH = 1080;

// ---------------------------------------------------------------------------------------------
// 1. Choose the story precinct from the live data (not filmed).
// ---------------------------------------------------------------------------------------------
const money = (v) => (v >= 1_000_000 ? `$${String(+(v / 1_000_000).toFixed(2))}m` : `$${Math.round(v / 1000)}k`);

async function chooseStory() {
  const api = await apiRequest.newContext({ baseURL: BASE });
  try {
    const demo = await api.post('/api/auth/demo', { data: { persona: 'developer' } });
    if (!demo.ok()) throw new Error(`demo sign-in failed (HTTP ${demo.status()})`);
    // The API rate-limits each visitor per minute (RATE_LIMIT_PER_MIN); wait and retry on 429.
    const get = async (p) => {
      for (let i = 0; ; i++) {
        const r = await api.get(p);
        if (r.ok()) return r.json();
        if (r.status() === 429 && i < 5) {
          const wait = Math.min(65, Number(r.headers()['retry-after'] ?? 20)) + 1;
          console.log(`  (rate limited; waiting ${wait} s)`);
          await new Promise((res) => setTimeout(res, wait * 1000));
          continue;
        }
        throw new Error(`${p}: HTTP ${r.status()}`);
      }
    };
    const list = await get('/api/v1/stations').then((r) => (Array.isArray(r) ? r : r.stations));
    const layer = async (q) => new Map((await get(`/api/v1/layers/station-metric?${q}&ring=0-800m`)).stations.map((s) => [s.id, s.value]));
    const featured = list.filter((s) => s.featured);
    console.log(`Story picker: ${list.length} stations, ${featured.length} featured (${featured.map((f) => f.id).join(', ')})`);
    // Several screening angles; the story uses the one where a mapped (featured) station ranks best,
    // so the "stands out" line is true on whatever data is live.
    const angles = [
      { key: 'unit', label: 'unit price growth', metric: 'metric=price_change_12m&property_type=unit', cap: 'metric=median_price&property_type=unit',
        question: (c) => `Which stations under ${money(c)} unit median had the strongest unit price growth?` },
      { key: 'house', label: 'house price growth', metric: 'metric=price_change_12m&property_type=house', cap: 'metric=median_price&property_type=house',
        question: (c) => `Which stations under ${money(c)} house median had the strongest house price growth?` },
      { key: 'trips', label: 'growth in station trips', metric: 'metric=patronage_change_12m&property_type=all', cap: null,
        question: () => 'Which stations had the strongest growth in station trips over the last 12 months?' },
    ];
    const scored = [];
    for (const angle of angles) {
      const skip = (e) => { console.log(`  (skipping ${angle.label}: ${e.message})`); return null; };
      const chg = await layer(angle.metric).catch(skip);
      if (!chg) continue;
      const med = angle.cap ? await layer(angle.cap).catch(skip) : null;
      if (angle.cap && !med) continue;
      const ids = [...chg.keys()].filter((id) => !med || med.has(id));
      const mine = featured.filter((f) => chg.has(f.id) && (!med || med.has(f.id))).map((f) => f.id);
      console.log(`  ${angle.label}: ${chg.size} stations with a value, featured with data: ${mine.join(', ') || 'none'}`);
      for (const s of featured) {
        if (!chg.has(s.id) || (med && !med.has(s.id))) continue;
        const step = med && med.get(s.id) >= 1_000_000 ? 250_000 : 50_000;
        const cap = med ? Math.ceil(med.get(s.id) / step) * step : null;
        const pool = ids.filter((id) => cap === null || med.get(id) <= cap);
        const rank = 1 + pool.filter((id) => chg.get(id) > chg.get(s.id)).length;
        scored.push({ id: s.id, name: s.name, angle: angle.key, label: angle.label, cap, rank, pool: pool.length,
          median: med ? med.get(s.id) : null, change: chg.get(s.id), question: angle.question(cap) });
      }
    }
    // Best rank; a capped pool must still hold at least 8 stations so "#1" means something.
    scored.sort((x, y) => (x.pool < 8) - (y.pool < 8) || x.rank - y.rank || y.pool - x.pool);
    const best = scored[0];
    for (const c of scored.slice(0, 5)) console.log(`  candidate: ${c.name}, #${c.rank} of ${c.pool} by ${c.label}`);
    if (!best) throw new Error('no featured station has a ranked metric');
    const northShore = ['wynyard', 'milsons_point', 'north_sydney', 'st_leonards', 'chatswood'];
    return {
      ...best,
      tour: northShore.includes(best.id) ? 'North Shore' : 'Parramatta corridor',
      others: scored.filter((c) => c.angle === best.angle && c.id !== best.id).sort((x, y) => x.rank - y.rank).slice(0, 3),
    };
  } finally {
    await api.dispose();
  }
}

const story = await chooseStory();
writeFileSync(path.join(OUT, 'story.json'), JSON.stringify(story, null, 2));
console.log(`Story precinct: ${story.name} (#${story.rank} of ${story.pool} stations${story.cap ? ` under ${money(story.cap)}` : ''} by ${story.label})`);
console.log(`Question: ${story.question}${hasVoice ? '' : '\n(No data/derived/demo/voice.wav: the voice scene will be skipped.)'}\n`);
if (process.argv.includes('--story-only')) process.exit(0);

// ---------------------------------------------------------------------------------------------
// 2. Browser, overlays and helpers.
// ---------------------------------------------------------------------------------------------
const browser = await chromium.launch({
  headless: !HEADED,
  args: [
    `--window-size=${W},${H}`, '--force-device-scale-factor=1',
    ...(hasVoice ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${VOICE}%noloop`] : []),
  ],
});
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  recordVideo: { dir: OUT, size: { width: VW, height: VH } },
  permissions: ['clipboard-read', 'clipboard-write', ...(hasVoice ? ['microphone'] : [])],
  colorScheme: 'dark',
});

// Cursor, overlay layer and the hackathon label, injected into every page.
await context.addInitScript(() => {
  const css = `
    #__demo_cursor{position:fixed;left:-40px;top:-40px;width:22px;height:22px;border-radius:50%;z-index:2147483647;background:rgba(255,255,255,.92);border:2px solid #1f5fad;box-shadow:0 1px 6px rgba(0,0,0,.45);transform:translate(-50%,-50%);pointer-events:none;transition:width .12s,height .12s}
    #__demo_layer{position:fixed;inset:0;z-index:2147483646;pointer-events:none;font-family:Inter,"Segoe UI",system-ui,sans-serif}
    #__demo_label{position:fixed;right:14px;top:10px;z-index:2147483646;pointer-events:none;padding:4px 10px;border-radius:999px;background:rgba(10,22,20,.78);color:#dfe9e4;font:600 12px/1.4 Inter,"Segoe UI",system-ui,sans-serif;letter-spacing:.02em;box-shadow:0 0 0 1px rgba(255,255,255,.12)}
    .__spot{position:fixed;border:3px solid #ff3b3b;border-radius:10px;box-shadow:0 0 0 9999px rgba(0,0,0,.42),0 0 18px rgba(255,59,59,.55);transition:all .35s ease;opacity:0}
    .__spot.on{opacity:1}
    .__spot-tag{position:absolute;left:-3px;bottom:calc(100% + 8px);white-space:nowrap;padding:6px 12px;border-radius:8px;background:#ff3b3b;color:#fff;font-weight:700;font-size:15px;box-shadow:0 4px 14px rgba(0,0,0,.35)}
    .__spot-tag.below{bottom:auto;top:calc(100% + 8px)}
    .__cap{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);max-width:min(1100px,calc(100% - 60px));padding:12px 20px;border-radius:12px;background:rgba(8,18,17,.88);color:#fff;box-shadow:0 8px 30px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.1);display:flex;gap:14px;align-items:center;opacity:0;transition:opacity .35s}
    .__cap.on{opacity:1}
    .__cap b{display:block;font-size:20px;line-height:1.3}
    .__cap span{display:block;font-size:14px;color:#c7d6d0;margin-top:2px}
    .__chip{flex:none;display:inline-flex;align-items:center;gap:7px;padding:6px 11px;border-radius:999px;background:#1f5fad;color:#fff;font-weight:700;font-size:14px}
    .__chip i{width:9px;height:9px;border-radius:50%;background:#7fd0ff;box-shadow:0 0 8px #7fd0ff}`;
  addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    const c = document.createElement('div'); c.id = '__demo_cursor'; document.body.appendChild(c);
    const layer = document.createElement('div'); layer.id = '__demo_layer'; document.body.appendChild(layer);
    const label = document.createElement('div'); label.id = '__demo_label'; label.textContent = 'Built 27 Oct – 4 Nov 2026 · Meta Global AI Developer Hackathon'; document.body.appendChild(label);
    addEventListener('mousemove', (e) => { c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px`; }, true);
    addEventListener('mousedown', () => { c.style.width = '14px'; c.style.height = '14px'; }, true);
    addEventListener('mouseup', () => { c.style.width = '22px'; c.style.height = '22px'; }, true);
  });
});

const page = await context.newPage();
const t0 = Date.now();
const events = [];
const mark = (name, extra = {}) => { const t = (Date.now() - t0) / 1000; events.push({ name, t: Math.round(t * 100) / 100, ...extra }); console.log(`${t.toFixed(1).padStart(6)} s  ${name}`); };
const pause = (ms) => page.waitForTimeout(ms);

let mouse = { x: W / 2, y: H / 2 };
async function moveTo(locator) {
  await locator.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
  const box = await locator.boundingBox({ timeout: 10_000 });
  if (!box) throw new Error('element not visible');
  const x = box.x + box.width / 2, y = box.y + Math.min(box.height / 2, 40);
  await page.mouse.move(x, y, { steps: Math.max(10, Math.round(Math.hypot(x - mouse.x, y - mouse.y) / 30)) });
  mouse = { x, y };
  await pause(200);
}
async function click(locator) { await moveTo(locator); await locator.click({ timeout: 10_000 }); await pause(350); }
async function type(locator, text) {
  await click(locator);
  mark('type:start');
  await locator.pressSequentially(text, { delay: 18 });
  mark('type:end');
  await pause(250);
}

/** A caption at the bottom: a title, a line of detail and, optionally, the Meta model at work. */
async function caption(title, sub = '', model = '') {
  await page.evaluate(({ title, sub, model }) => {
    const layer = document.getElementById('__demo_layer'); if (!layer) return;
    layer.querySelector('.__cap')?.remove();
    if (!title) return;
    const el = document.createElement('div'); el.className = '__cap';
    if (model) { const chip = document.createElement('div'); chip.className = '__chip'; chip.innerHTML = '<i></i>'; chip.append(model); el.append(chip); }
    const txt = document.createElement('div');
    const b = document.createElement('b'); b.textContent = title; txt.append(b);
    if (sub) { const s = document.createElement('span'); s.textContent = sub; txt.append(s); }
    el.append(txt); layer.append(el);
    requestAnimationFrame(() => el.classList.add('on'));
  }, { title, sub, model }).catch(() => {});
}

/** A red box around an element, with a label, held for `ms` (then removed). */
async function spotlight(locator, label, ms = 3500, { below = false, pad = 8 } = {}) {
  await locator.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
  const box = await locator.boundingBox({ timeout: 10_000 }).catch(() => null);
  if (!box) { mark('spotlight:missed', { label }); return; }
  mark('spotlight', { label });
  await page.evaluate(({ box, label, below, pad }) => {
    const layer = document.getElementById('__demo_layer'); if (!layer) return;
    const s = document.createElement('div'); s.className = '__spot';
    const x = Math.max(4, box.x - pad), y = Math.max(4, box.y - pad);
    Object.assign(s.style, { left: `${x}px`, top: `${y}px`, width: `${Math.min(innerWidth - x - 4, box.width + pad * 2)}px`, height: `${Math.min(innerHeight - y - 4, box.height + pad * 2)}px` });
    const tag = document.createElement('div'); tag.className = `__spot-tag${below || y < 60 ? ' below' : ''}`; tag.textContent = label;
    s.append(tag); layer.append(s);
    requestAnimationFrame(() => s.classList.add('on'));
  }, { box, label, below, pad });
  await pause(ms);
  await page.evaluate(() => document.querySelectorAll('#__demo_layer .__spot').forEach((n) => n.remove())).catch(() => {});
}

/** Length of a PCM WAV in seconds, reading the chunks (the fmt chunk is 16 or 18 bytes). */
function wavSeconds(buf) {
  let byteRate = 0;
  for (let o = 12; o + 8 <= buf.length; ) {
    const id = buf.toString('ascii', o, o + 4), size = buf.readUInt32LE(o + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(o + 16);
    if (id === 'data' && byteRate) return size / byteRate;
    o += 8 + size + (size % 2);
  }
  return 5;
}

async function step(name, fn) {
  mark(`${name}:start`);
  try { await fn(); mark(`${name}:end`); } catch (e) { mark(`${name}:failed`, { error: String(e?.message ?? e).slice(0, 200) }); }
}
const answers = () => page.locator('article.answer-card');
async function waitForAnswer(before) {
  mark('wait:start');
  await page.waitForFunction((n) => {
    const cards = document.querySelectorAll('article.answer-card');
    if (cards.length <= n) return false;
    const last = cards[cards.length - 1];
    return Boolean(last.querySelector('section.made') || last.querySelector('.turn-error'));
  }, before, { timeout: 120_000 });
  mark('wait:end');
}
async function ask(question, { spotProgress = true } = {}) {
  const before = await answers().count();
  await type(page.locator('#q'), question);
  await page.keyboard.press('Enter');
  mark('asked', { question });
  if (spotProgress) {
    await page.locator('article.answer-card ol.progress').last().waitFor({ timeout: 10_000 }).catch(() => {});
    await spotlight(page.locator('article.answer-card ol.progress').last(), 'Muse Spark plans the data calls, live', 3000);
  }
  await waitForAnswer(before);
}
async function selectStation(name) {
  await type(page.locator('.station-search input'), name);
  await page.keyboard.press('Enter');
  await pause(2500);
}
async function card(html, ms) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 30% 20%,#173a5c,#0b1716 60%);color:#fff;font-family:Inter,"Segoe UI",system-ui,sans-serif}
    .w{max-width:1100px;padding:0 60px} .k{color:#8fb8f5;font-weight:700;letter-spacing:.14em;font-size:16px;text-transform:uppercase}
    h1{font-size:58px;line-height:1.1;margin:14px 0 18px} p{font-size:24px;line-height:1.45;color:#c7d6d0;margin:0 0 14px}
    .row{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px} .c{display:inline-flex;gap:8px;align-items:center;padding:8px 14px;border-radius:999px;background:#1f5fad;font-weight:700;font-size:17px}
    .c i{width:9px;height:9px;border-radius:50%;background:#7fd0ff;box-shadow:0 0 8px #7fd0ff} ul{font-size:22px;color:#dfe9e4;line-height:1.6;padding-left:22px;margin:8px 0}
    a{color:#8fb8f5;text-decoration:none;font-weight:700}</style></head><body><div class="w">${html}</div></body></html>`);
  await pause(ms);
}

// ---------------------------------------------------------------------------------------------
// 3. The story.
// ---------------------------------------------------------------------------------------------
const S = story.name;
const BEFORE_LINE = arg('before', 'Before 27 Oct: Lumina Spatial, an earlier Dronovation XR prototype (separate codebase; no code reused)');
const BUILT_LINE = arg('built', 'Built 27 Oct – 4 Nov: everything in this video: the agent, data pipeline, SAM 3.1 layers, voice, briefings and the app');

await step('signin', async () => {
  await page.goto(`${BASE}/signin`, { waitUntil: 'networkidle', timeout: 60_000 });
  // The rules ask the video to open with one line on what existed before and what was built.
  await caption(BEFORE_LINE, BUILT_LINE);
  await pause(4500);
  await caption("Where near Sydney's stations is the next site worth a feasibility study?", 'Site teams answer that with spreadsheets and days of digging. Lumina answers it in seconds, for all 185 stations, every figure checked.');
  await pause(4000);
  await caption('Built for the people who decide where homes go', 'Developers and site analysts first; lenders and planners too');
  await pause(2000);
  await spotlight(page.locator('.signin-models'), 'Meta models behind every answer', 3000);
  await caption('Live for Sydney, built to work for any city', 'Transit, map and imagery adapters: GTFS, OpenStreetMap, SAM 3.1 on any aerial or drone imagery');
  await page.mouse.wheel(0, 600); await pause(3000); await page.mouse.wheel(0, -600); await pause(600);
  await caption('');
  await click(page.getByRole('button', { name: /Try the demo/ }));
  await page.waitForURL(`${BASE}/`, { timeout: 30_000 });
});

await step('models', async () => {
  await pause(1500);
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await click(gotIt);
  await click(page.getByRole('button', { name: /^Meta AI/ }));
  await pause(800);
  await spotlight(page.locator('.model-list'), 'Where each Meta model is used, with its live status', 4500, { pad: 4 });
  await click(page.getByRole('button', { name: 'Close' }).last());
});

await step('screen', async () => {
  await caption('Step 1 · Screen every station at once', story.question, 'Muse Spark');
  await ask(story.question);
  await caption(`All 185 stations recoloured by ${story.label}`, 'The leaders pulse on the map; every figure links to its source and date', 'Muse Spark');
  await pause(3500);
  await spotlight(answers().last().locator('ol.tiles'), 'Every figure: governed NSW data, with source and date', 3500);
  await spotlight(answers().last().locator('section.made'), 'How this answer was made: Muse Spark planned and wrote; a checker verified every number', 5000);
  const within = `${story.pool} stations${story.cap ? ` under ${money(story.cap)}` : ''}`;
  await caption(story.rank <= 3 ? `${S} stands out` : `A closer look at ${S}`,
    story.rank <= 3 ? `#${story.rank} of ${within} for ${story.label}, and SAM 3.1 has mapped it` : `One of ${within}, and one of the stations SAM 3.1 has mapped`, '');
  await pause(3500);
});

await step('sam', async () => {
  await selectStation(S);
  await caption(`Step 2 · What is actually on the ground at ${S}?`, 'SAM 3.1 segmented NSW aerial imagery around the station', 'SAM 3.1');
  await click(page.getByRole('button', { name: 'Open the land-use breakdown' }));
  await pause(1500);
  await click(page.getByRole('button', { name: 'Show what SAM 3.1 saw' }).first());
  await pause(1000);
  const closeLanduse = page.getByRole('button', { name: 'Close land use' });
  if (await closeLanduse.isVisible().catch(() => false)) await click(closeLanduse);
  // Full-width map so the segmentation fills the screen.
  const mapView = page.getByRole('button', { name: 'Map', exact: true });
  if (await mapView.isVisible().catch(() => false)) await click(mapView);
  await pause(4000);
  // Zoom out to show the whole area SAM 3.1 segmented, then back in.
  const canvas = page.locator('.maplibregl-canvas').first();
  const box = await canvas.boundingBox().catch(() => null);
  const wheel = async (dy, n) => { for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dy); await pause(260); } };
  if (box) {
    const x = box.x + box.width * 0.42, y = box.y + box.height * 0.5;
    await page.mouse.move(x, y, { steps: 14 }); mouse = { x, y };
    await caption('Every building, tree, car park and construction site', `SAM 3.1 on 0.5 m NSW aerial imagery: the whole area around ${S}`, 'SAM 3.1');
    await wheel(250, 3);
    await pause(3500);
  }
  // Before and after: hold to see the photo alone, release to bring the masks back.
  const hold = page.getByRole('button', { name: /Hold to see the photo alone/ });
  if (await hold.isVisible().catch(() => false)) {
    await caption('The photo alone, then what SAM 3.1 found', 'Hold to compare; the masks are real polygons, counted and measured', 'SAM 3.1');
    await moveTo(hold);
    await page.mouse.down(); await pause(2200); await page.mouse.up();
    await pause(1500);
  }
  await spotlight(page.locator('.sam-keys'), 'SAM 3.1: every building, tree, car park and construction site it found', 4000);
  if (box) { await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.5, { steps: 12 }); await wheel(-250, 3); await pause(1200); }
  await click(page.getByRole('button', { name: 'Back to the normal map' }));
  const split = page.getByRole('button', { name: 'Split', exact: true });
  if (await split.isVisible().catch(() => false)) await click(split);
  await pause(600);
});

await step('sites', async () => {
  await caption(`Step 3 · Where is the land near ${S}?`, 'Car parks and construction sites found by SAM 3.1, ranked by size', 'SAM 3.1 + Muse Spark');
  await ask(`Show me the largest car parks near ${S}`);
  await pause(3500);
  await click(answers().last().getByRole('button', { name: 'Show checks and queries' }));
  await pause(800);
  await spotlight(answers().last().locator('.details'), 'Every check passed; the exact data calls are shown', 4500);
});

if (hasVoice) {
  await step('voice', async () => {
    await caption('Step 4 · Ask by voice', 'The question is spoken by a synthesised voice; Muse Voice Transcribe turns it into text, live', 'Muse Voice');
    const mic = page.getByRole('button', { name: 'Ask by voice' });
    await click(mic);
    const seconds = wavSeconds(readFileSync(VOICE));
    await pause(Math.min(20_000, Math.round(seconds * 1000) + 600));
    await click(mic);
    await page.waitForFunction(() => (document.querySelector('#q')?.value ?? '').trim().length > 5, null, { timeout: 30_000 });
    await spotlight(page.locator('#q'), 'Transcribed by Muse Voice', 2500);
    // Click Ask: after clicking the mic, Enter would press the focused mic button and record again.
    const before = await answers().count();
    await click(page.locator('button.ask-button'));
    mark('asked', { question: await page.locator('#q').inputValue() });
    await waitForAnswer(before);
    await pause(3000);
  });
}

await step('brief', async () => {
  await caption(`Step ${hasVoice ? 5 : 4} · Brief me on ${S}`, 'An illustration by Muse Image, with the verified figures drawn by our code', 'Muse Image');
  await click(page.getByRole('button', { name: /Brief me/ }).first());
  mark('wait:start');
  await page.locator('.brief-figure img').first().waitFor({ state: 'visible', timeout: 120_000 }).catch(() => {});
  mark('wait:end');
  await pause(1500);
  await spotlight(page.locator('.brief-figure'), 'Muse Image: no text or numbers in the picture, labelled AI-generated', 4000);
  await spotlight(page.locator('.brief-tiles'), 'Figures come from governed data, never from the image model', 3500);
});

await step('share', async () => {
  await caption('Share it', 'A public link anyone can open; the figures are signed by the server', '');
  await click(page.locator('.brief-drawer').getByRole('button', { name: 'Share' }));
  await pause(1200);
  const url = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  if (!/\/p\//.test(url)) throw new Error(`no precinct link on the clipboard (${url.slice(0, 60)})`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await caption(`The shared ${S} briefing`, 'No sign-in needed; rich preview on X and LinkedIn', '');
  await pause(4500);
  await page.goBack({ waitUntil: 'networkidle' });
  await pause(2000);
});

await step('tour', async () => {
  await caption(`Step ${hasVoice ? 6 : 5} · Tour the corridor`, `Station by station, with verified figures and Muse Spark headlines`, 'Muse Spark');
  await click(page.getByRole('button', { name: 'Tour', exact: true }));
  await pause(1000);
  await click(page.getByRole('button', { name: new RegExp(story.tour) }));
  await pause(2500);
  await spotlight(page.locator('.tour-card'), 'Headline by Muse Spark; every number checked', 3500);
  await pause(9000);
  await click(page.getByRole('button', { name: 'Exit tour' }));
});

await step('end', async () => {
  await caption('');
  await card(`<div class="k">Lumina Precinct Agent · Dronovation Labs</div>
    <h1>From question to verified, mapped answer in seconds</h1>
    <ul>
      <li>26 of 26 evaluation questions answered and verified on real NSW data</li>
      <li>Muse Code built 10 of the features you just saw, each reviewed before merge</li>
      <li>Live for Sydney. Next: London, New York and Singapore, and the same answers in Lumina Spatial XR</li>
    </ul>
    <div class="row"><span class="c"><i></i>Muse Spark</span><span class="c"><i></i>SAM 3.1</span><span class="c"><i></i>Muse Voice</span><span class="c"><i></i>Muse Image</span><span class="c"><i></i>Muse Code</span></div>
    <p style="margin-top:26px"><a>lumina.dronovation.com.au</a> · Try the demo, no account needed</p>`, 8000);
});

mark('end');
await page.close();
const video = await page.video()?.path();
await context.close();
await browser.close();
if (video) renameSync(video, path.join(OUT, 'walkthrough.webm'));
writeFileSync(path.join(OUT, 'events.json'), JSON.stringify({ base: BASE, recorded_at: new Date().toISOString(), size: [VW, VH], viewport: [W, H], story, events }, null, 2));
const failed = events.filter((e) => e.name.endsWith(':failed'));
console.log(`\nSaved ${path.join(OUT, 'walkthrough.webm')} (${failed.length} failed steps${failed.length ? `: ${failed.map((f) => f.name).join(', ')}` : ''}).`);
