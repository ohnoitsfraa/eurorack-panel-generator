/**
 * Browser smoke test against a running dev server.
 *
 * Separate from `npm run verify` because it needs a browser and a server. The
 * headless suite covers geometry and logic thoroughly but cannot see the
 * things that only go wrong in a page: a handler wired to the wrong element,
 * state clobbered between steps, a request that fails only from the browser.
 *
 *   npm run dev
 *   npm run verify:ui
 *
 * Drives an already-installed Chrome rather than downloading one, and skips
 * cleanly when there is none. Network-dependent checks are skipped rather than
 * failed when the service is unreachable, so a flaky connection does not read
 * as a broken app.
 */
import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

const CHROMES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

let failures = 0;
const pass = (m: string) => console.log(`  ok    ${m}`);
const fail = (m: string) => { console.log(`  FAIL  ${m}`); failures++; };
const skip = (m: string) => console.log(`  skip  ${m}`);

const exe = process.env.CHROME_PATH ?? CHROMES.find((p) => existsSync(p));
if (!exe) {
  console.log('\n  skip  no Chrome or Chromium found (set CHROME_PATH to point at one)\n');
  process.exit(0);
}

let ok = false;
try {
  ok = (await fetch(BASE, { signal: AbortSignal.timeout(4000) })).ok;
} catch { /* handled below */ }
if (!ok) {
  console.log(`\n  skip  nothing answering at ${BASE} — start it with \`npm run dev\`\n`);
  process.exit(0);
}

console.log(`\nBrowser checks against ${BASE}`);
const browser: Browser = await chromium.launch({ executablePath: exe, headless: true });

/** Open a page that reports anything the browser complains about. */
async function open() {
  const page = await browser.newPage();
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().includes('/api/')) problems.push(`${r.status()} ${r.url().slice(0, 70)}`);
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  return { page, problems };
}

// --- the app renders and runs ---
{
  const { page, problems } = await open();
  const title = await page.locator('h1').first().innerText();
  if (title.includes('Eurorack')) pass('the app loads');
  else fail(`unexpected heading: ${title}`);
  if (problems.length === 0) pass('no uncaught errors on load');
  else fail(`on load: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- placing a cutout by hand ---
{
  const { page, problems } = await open();
  await page.getByRole('button', { name: 'Cutouts', exact: true }).click();
  await page.getByRole('button', { name: 'Circle', exact: true }).click();
  const canvas = page.locator('svg').first();
  await canvas.click({ position: { x: 200, y: 200 } });
  await page.waitForTimeout(300);

  const body = await page.locator('body').innerText();
  if (/Circle 6 mm/.test(body)) pass('a circle can be placed, and is listed by its shape and size');
  else fail('placing a circle did not produce a listed cutout');
  if (/1 cutouts|· 1 cutout/.test(body)) pass('the canvas counts the new cutout');

  // Handles only appear for a single selection.
  const handles = await page.locator('svg rect[style*="cursor"]').count();
  if (handles > 0) pass('the selected cutout has drag handles');
  else fail('no handles appeared on the selected cutout');

  if (problems.length === 0) pass('no uncaught errors while editing');
  else fail(`while editing: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- a ModularGrid link, pasted in either place ---
for (const [tab, placeholder, button] of [
  ['ModularGrid', 'Paste a link, or type a name', 'Load'],
  ['url', 'https://…/module.jpg', 'Open module'],
] as const) {
  const { page, problems } = await open();
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.getByPlaceholder(placeholder).fill('https://modulargrid.net/e/1010-music-bluebox');
  await page.getByRole('button', { name: button, exact: true }).click();
  await page.waitForTimeout(15000);

  const body = await page.locator('body').innerText();
  if (/switched off|Too many/i.test(body)) {
    skip(`${tab} tab: ModularGrid is off or throttled right now`);
  } else if (/Loaded[^\n]*bluebox/i.test(body)) {
    // The module page states 30 HP. Guessing it from the render's aspect ratio
    // lands on 29, and being one pitch out misplaces every hole on the panel.
    const m = body.match(/(\d+)\s*HP\s*·/);
    if (m && m[1] === '30') pass(`${tab} tab: module loads at its stated 30 HP, not a guess`);
    else fail(`${tab} tab: panel came out at ${m?.[1] ?? '?'} HP, expected 30`);
    if (problems.length === 0) pass(`${tab} tab: no errors`);
    else fail(`${tab} tab: ${[...new Set(problems)].join(' | ')}`);
  } else {
    fail(`${tab} tab: the module did not load`);
  }
  await page.close();
}

await browser.close();
console.log(failures === 0 ? '\n  all browser checks passed\n' : `\n  ${failures} browser checks failed\n`);
process.exit(failures === 0 ? 0 : 1);
