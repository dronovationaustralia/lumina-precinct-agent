/**
 * Films the demo-video walkthrough of Lumina in a real browser and logs when each step happens,
 * so the footage can be cut and captioned afterwards. Run it on a machine that can reach the
 * site, Meta's models and the map tiles (your laptop):
 *
 *   npx playwright install chromium          # once
 *   npm run demo:record                      # live site
 *   npm run demo:record -- --base http://localhost:3000 --headed
 *
 * Output (gitignored): data/derived/demo/walkthrough.webm and data/derived/demo/events.json.
 * Each step is wrapped so one failure (for example a slow model call) is logged and the
 * recording carries on.
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { chromium } from 'playwright';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg('base', 'https://lumina.dronovation.com.au').replace(/\/$/, '');
const HEADED = process.argv.includes('--headed');
const OUT = path.join('data', 'derived', 'demo');
mkdirSync(OUT, { recursive: true });

// The page is laid out at 1536×864 and filmed at 1920×1080 (1.25×), so text stays readable in the video.
const W = 1536, H = 864;
const VW = 1920, VH = 1080;
const browser = await chromium.launch({ headless: !HEADED, args: ['--window-size=1920,1080', '--force-device-scale-factor=1'] });
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  recordVideo: { dir: OUT, size: { width: VW, height: VH } },
  permissions: ['clipboard-read', 'clipboard-write'],
  colorScheme: 'dark',
});

// A visible cursor (recordings do not show the real one) and a soft click ripple.
await context.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.id = '__demo_cursor';
    Object.assign(c.style, {
      position: 'fixed', left: '-40px', top: '-40px', width: '22px', height: '22px', borderRadius: '50%', zIndex: 2147483647,
      background: 'rgba(255,255,255,0.92)', border: '2px solid #1f5fad', boxShadow: '0 1px 6px rgba(0,0,0,0.45)',
      transform: 'translate(-50%,-50%)', pointerEvents: 'none', transition: 'width .12s, height .12s',
    });
    document.body.appendChild(c);
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
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: Math.max(12, Math.round(Math.hypot(x - mouse.x, y - mouse.y) / 25)) });
  mouse = { x, y };
  await pause(250);
}
async function click(locator) { await moveTo(locator); await locator.click({ timeout: 10_000 }); await pause(400); }
async function type(locator, text) { await click(locator); await locator.pressSequentially(text, { delay: 38 }); await pause(300); }
async function step(name, fn) {
  mark(`${name}:start`);
  try { await fn(); mark(`${name}:end`); } catch (e) { mark(`${name}:failed`, { error: String(e?.message ?? e).slice(0, 200) }); }
}
const answers = () => page.locator('article.answer-card');
async function ask(question) {
  const before = await answers().count();
  await type(page.locator('#q'), question);
  await page.keyboard.press('Enter');
  mark('asked', { question });
  // An answer card is done when it shows "How this answer was made" (or an error).
  await page.waitForFunction((n) => {
    const cards = document.querySelectorAll('article.answer-card');
    if (cards.length <= n) return false;
    const last = cards[cards.length - 1];
    return Boolean(last.querySelector('section.made') || last.querySelector('.turn-error'));
  }, before, { timeout: 90_000 });
  mark('answered');
}

// 1. Sign-in page: the pitch, the Meta models, the any-city story.
await step('signin', async () => {
  await page.goto(`${BASE}/signin`, { waitUntil: 'networkidle', timeout: 60_000 });
  await pause(3500);
  await page.mouse.wheel(0, 700); await pause(2500);
  await page.mouse.wheel(0, -700); await pause(1000);
  await click(page.getByRole('button', { name: /Try the demo/ }));
  await page.waitForURL(`${BASE}/`, { timeout: 30_000 });
});

// 2. Home: playbooks for the developer persona.
await step('home', async () => {
  await pause(3000);
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await click(gotIt);
  await pause(2500);
});

// 3. Screener across all 185 stations.
await step('screener', async () => {
  await ask('Which stations under $900k unit median had the strongest unit price growth?');
  await pause(7000);
});

// 4. Chatswood and what SAM 3.1 saw.
await step('sam', async () => {
  await type(page.locator('.station-search input'), 'Chatswood');
  await page.keyboard.press('Enter');
  await pause(4500);
  await click(page.getByRole('button', { name: 'Open the land-use breakdown' }));
  await pause(2500);
  await click(page.getByRole('button', { name: 'Show what SAM 3.1 saw' }).first());
  await pause(11_000);
});

// 5. Opportunity sites near Parramatta, and how the answer was made.
await step('sites', async () => {
  await ask('Show me large car parks near Parramatta');
  await pause(5000);
  const show = answers().last().getByRole('button', { name: 'Show checks and queries' });
  await click(show);
  await pause(4500);
});

// 6. Brief me: Muse Image precinct card.
await step('briefme', async () => {
  await type(page.locator('.station-search input'), 'Parramatta');
  await page.keyboard.press('Enter');
  await pause(3000);
  await click(page.getByRole('button', { name: /Brief me/ }).first());
  await page.locator('.drawer img').first().waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});
  mark('briefme:image');
  await pause(5000);
  await click(page.getByRole('button', { name: 'Close' }).last());
});

// 7. Corridor tour: three stops on the North Shore.
await step('tour', async () => {
  await click(page.getByRole('button', { name: 'Tour', exact: true }));
  await pause(1500);
  await click(page.getByRole('button', { name: /North Shore/ }));
  await pause(23_000);
  await click(page.getByRole('button', { name: 'Exit tour' }));
});

// 8. Share an answer and open the public link.
await step('share', async () => {
  await click(answers().last().getByRole('button', { name: 'Share' }));
  await pause(1500);
  const url = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  if (!/\/a\//.test(url)) throw new Error(`no share link on the clipboard (${url.slice(0, 60)})`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await pause(6000);
});

mark('end');
await page.close();
const video = await page.video()?.path();
await context.close();
await browser.close();
if (video) renameSync(video, path.join(OUT, 'walkthrough.webm'));
writeFileSync(path.join(OUT, 'events.json'), JSON.stringify({ base: BASE, recorded_at: new Date().toISOString(), size: [VW, VH], viewport: [W, H], events }, null, 2));
console.log(`\nSaved ${path.join(OUT, 'walkthrough.webm')} and events.json (${events.filter((e) => e.name.endsWith(':failed')).length} failed steps).`);
