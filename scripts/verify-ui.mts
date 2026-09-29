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
async function open(colorScheme: 'light' | 'dark' = 'dark') {
  const ctx = await browser.newContext({ colorScheme });
  const page = await ctx.newPage();
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
  if (/^panelmate$/i.test(title.trim())) pass('the app loads');
  else fail(`unexpected heading: ${title}`);

  // The kit sets the wordmark lowercase, and it is real lowercase text rather
  // than a CSS transform over something else, so it stays lowercase to anyone
  // reading the page rather than looking at it.
  const spoken = (await page.locator('h1').first().textContent())?.trim();
  if (spoken === 'panelmate') pass('the wordmark carries the brand spelling');
  else fail(`heading text is ${JSON.stringify(spoken)}`);

  // Live text, so the brand face has to have actually arrived.
  const face = await page.locator('h1 span').first().evaluate(async (el) => {
    await document.fonts.ready;
    return getComputedStyle(el).fontFamily;
  });
  if (/Bricolage/i.test(face)) pass('the wordmark is set in Bricolage Grotesque');
  else fail(`the wordmark fell back to ${face}`);
  if (problems.length === 0) pass('no uncaught errors on load');
  else fail(`on load: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- placing a cutout by hand ---
{
  const { page, problems } = await open();
  await page.getByRole('button', { name: 'Cutouts', exact: true }).click();
  await page.getByRole('button', { name: 'Circle', exact: true }).click();
  const canvas = page.locator('[data-panel-canvas]');
  await canvas.click({ position: { x: 200, y: 200 } });
  await page.waitForTimeout(300);

  const body = await page.locator('body').innerText();
  if (/Circle 6 mm/.test(body)) pass('a circle can be placed, and is listed by its shape and size');
  else fail('placing a circle did not produce a listed cutout');
  if (/1 cutouts|· 1 cutout/.test(body)) pass('the canvas counts the new cutout');

  // Handles only appear for a single selection.
  const handles = await page.locator('[data-panel-canvas] rect[style*="cursor"]').count();
  if (handles > 0) pass('the selected cutout has drag handles');
  else fail('no handles appeared on the selected cutout');

  // Save, then edit: the button has to notice. Every kind of edit but a
  // rename used to leave the panel looking saved, so deleting a cutout left
  // the Save button greyed out with the deletion unrecorded.
  const save = page.getByRole('button', { name: /^Save/ }).first();
  await page.getByLabel('Panel name').fill('Edited');
  await save.click();
  await page.waitForTimeout(600);
  if (await save.isDisabled()) pass('saving settles the button');
  else fail('the save button stayed live after saving');

  await canvas.click({ position: { x: 200, y: 200 } });
  await page.waitForTimeout(200);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(400);
  if (/0 cutouts|· 0 cutout/.test(await page.locator('body').innerText())) {
    pass('the cutout can be deleted');
  } else {
    fail('the cutout was not deleted');
  }
  if (await save.isEnabled()) pass('and deleting it offers the save again');
  else fail('the save button stayed greyed out after a deletion');

  if (problems.length === 0) pass('no uncaught errors while editing');
  else fail(`while editing: ${[...new Set(problems)].join(' | ')}`);

  await page.getByRole('button', { name: /^Clear/ }).first().click().catch(() => {});
  await page.waitForTimeout(200);
  const gone = page.getByRole('button', { name: /clear everything/i }).first();
  if (await gone.count()) await gone.click();
  await page.waitForTimeout(500);
  await page.close();
}

// --- Alt-drag duplicates, and does so visibly ---
{
  const { page, problems } = await open();
  await page.getByRole('button', { name: 'Cutouts', exact: true }).click();
  await page.getByRole('button', { name: 'Circle', exact: true }).click();
  const svg = page.locator('[data-panel-canvas]');
  await svg.click({ position: { x: 300, y: 300 } });
  await page.waitForTimeout(300);

  const box = await svg.boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.move(box!.x + 300, box!.y + 300);
  await page.mouse.down();
  await page.mouse.move(box!.x + 380, box!.y + 360, { steps: 12 });
  await page.waitForTimeout(250);

  // The copy has to be visibly in hand during the drag, not only after it.
  // It used to be created and then sit motionless under the original, so the
  // duplication was invisible until the pointer was released.
  const midBody = await page.locator('body').innerText();
  const badges = await page.locator('[data-panel-canvas] text', { hasText: '+1' }).count();
  if (/Duplicating/i.test(midBody)) pass('the canvas says a copy is being dragged');
  else fail('nothing indicated a duplicate was in progress');
  if (badges > 0) pass('the copy is badged while it moves');
  else fail('no badge on the copy during the drag');

  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForTimeout(300);

  const positions = await page.locator('[data-panel-canvas] circle').evaluateAll((els) =>
    els.map((e) => `${(+(e.getAttribute('cx') ?? 0)).toFixed(1)},${(+(e.getAttribute('cy') ?? 0)).toFixed(1)}`));
  const distinct = new Set(positions);
  const after = (await page.locator('body').innerText()).match(/·\s*(\d+)\s*cutouts?/);
  if (after && after[1] === '2') pass('the drag leaves two cutouts behind');
  else fail(`after an Alt-drag there are ${after?.[1] ?? '?'} cutouts, expected 2`);
  // Two cutouts in two places. (This used to expect three, because the count
  // swept up the header logo's circles as well as the canvas's.)
  if (distinct.size >= 2) pass('the copy ended up somewhere else, not on top of the original');
  else fail(`the copy landed on the original (${distinct.size} distinct position)`);

  if (problems.length === 0) pass('no uncaught errors during Alt-drag');
  else fail(`during Alt-drag: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- a refresh must not cost the work in progress ---
{
  const { page, problems } = await open();
  const toScreen = (mx: number, my: number) =>
    page.evaluate(([x, y]) => {
      const el = document.querySelector('[data-panel-canvas]') as SVGSVGElement;
      const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM()!);
      return { x: p.x, y: p.y };
    }, [mx, my] as [number, number]);

  await page.getByRole('button', { name: 'Cutouts', exact: true }).click();
  for (const [x, y] of [[12, 30], [28, 30], [12, 60], [28, 60]] as const) {
    await page.getByRole('button', { name: 'Circle', exact: true }).click();
    const p = await toScreen(x, y);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(150);
  }
  const positionsBefore = await page.locator('[data-panel-canvas] circle').evaluateAll((els) =>
    [...new Set(els.map((e) => `${(+(e.getAttribute('cx') ?? 0)).toFixed(1)},${(+(e.getAttribute('cy') ?? 0)).toFixed(1)}`))]);

  // The session is written on a timer; give it a moment to land.
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const after = await page.locator('body').innerText();
  const count = after.match(/·\s*(\d+)\s*cutouts?/);
  if (count && count[1] === '4') pass('a refresh keeps the cutouts that were on the panel');
  else fail(`after a refresh there are ${count?.[1] ?? '?'} cutouts, expected 4`);

  const positionsAfter = await page.locator('[data-panel-canvas] circle').evaluateAll((els) =>
    [...new Set(els.map((e) => `${(+(e.getAttribute('cx') ?? 0)).toFixed(1)},${(+(e.getAttribute('cy') ?? 0)).toFixed(1)}`))]);
  const kept = positionsBefore.every((p) => positionsAfter.includes(p));
  if (kept) pass('they come back in the same places, not just the same number');
  else fail('cutout positions changed across the refresh');

  if (/Picked up where you left off/i.test(after)) pass('the app says it restored the work');
  else fail('nothing told the user their work had been restored');

  if (problems.length === 0) pass('no uncaught errors across the refresh');
  else fail(`across the refresh: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- alignment guides ---
{
  const { page, problems } = await open();
  await page.getByRole('button', { name: 'Cutouts', exact: true }).click();
  const svg = page.locator('[data-panel-canvas]');

  /** Panel millimetres to viewport pixels, through the SVG's own transform. */
  const toScreen = (mx: number, my: number) =>
    page.evaluate(([x, y]) => {
      const el = document.querySelector('[data-panel-canvas]') as SVGSVGElement;
      const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM()!);
      return { x: p.x, y: p.y };
    }, [mx, my] as [number, number]);

  const place = async (mx: number, my: number) => {
    await page.getByRole('button', { name: 'Circle', exact: true }).click();
    const p = await toScreen(mx, my);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(200);
  };

  // Well clear of the panel's own centre line, which would otherwise be the
  // nearer thing to snap to and would not test alignment between cutouts.
  await place(31, 25);
  await place(32.2, 105);

  const from = await toScreen(32.2, 105);
  const to = await toScreen(31.6, 105);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.waitForTimeout(300);

  const lines = await page.locator('[data-panel-canvas] line').count();
  const status = await page.locator('body').innerText();
  if (lines > 0) pass('a guide line appears while dragging into alignment');
  else fail('no guide appeared');
  if (/Aligned/i.test(status)) pass('the status line says it is aligned');
  else fail('nothing said the cutout had aligned');

  await page.mouse.up();
  await page.waitForTimeout(300);

  const xs = await page.locator('[data-panel-canvas] circle').evaluateAll((els) =>
    [...new Set(els.map((e) => +(e.getAttribute('cx') ?? 0)).filter((v) => v > 25 && v < 60))]);
  if (xs.length === 1 && Math.abs(xs[0] - 31) < 0.01) {
    pass('the dragged cutout snaps onto the other one\'s column');
  } else {
    fail(`columns after the drag: ${xs.map((v) => v.toFixed(2)).join(', ')}, expected just 31`);
  }
  if ((await page.locator('[data-panel-canvas] line').count()) === 0) pass('guides disappear once the drag ends');
  else fail('guides were left on screen after the drag');

  if (problems.length === 0) pass('no uncaught errors while aligning');
  else fail(`while aligning: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- putting a panel in the rack shows you the rack ---
{
  const { page, problems } = await open();
  await page.getByRole('button', { name: 'Cutouts', exact: true }).click();
  await page.getByRole('button', { name: 'Circle', exact: true }).click();
  const pt = await page.evaluate(() => {
    const el = document.querySelector('[data-panel-canvas]') as SVGSVGElement;
    const p = new DOMPoint(20, 60).matrixTransform(el.getScreenCTM()!);
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(300);

  await page.getByLabel('Panel name').fill('Rack me');
  await page.getByRole('button', { name: 'Save to library' }).click();
  await page.waitForTimeout(600);

  // Back to the layout, so the navigation is actually being tested.
  await page.getByRole('button', { name: 'Layout', exact: true }).click();
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'To rack', exact: true }).first().click();
  await page.waitForTimeout(800);
  const after = await page.locator('body').innerText();
  if (/HP used/i.test(after) && /Add row/i.test(after)) pass('adding to the rack takes you to the rack');
  else fail('the view did not follow the panel into the rack');
  if ((await page.locator('[title*="Rack me"]').count()) > 0) pass('and the panel is there when you arrive');
  else fail('the panel was not visible in the rack');

  // The per-panel controls were 11px text, which is a hard thing to hit with
  // a mouse and an easy thing to shave down again by accident.
  // Addressed by the rack's own attribute: the title alone also matches the
  // library row, and hovering that reveals nothing.
  const panel = page.locator('[data-rack-panel="Rack me"]').first();
  await panel.hover();
  await page.waitForTimeout(250);
  const controls = await page.evaluate(() => {
    const panelBox = document.querySelector('[data-rack-panel="Rack me"]')!.getBoundingClientRect();
    return [...document.querySelectorAll('button[aria-label]')]
      .filter((e) => (e.getAttribute('aria-label') ?? '').includes('Rack me'))
      .map((e) => {
        const r = e.getBoundingClientRect();
        return {
          w: Math.round(r.width), h: Math.round(r.height),
          inside: r.left >= panelBox.left - 0.5 && r.right <= panelBox.right + 0.5,
        };
      });
  });
  if (controls.length === 2) pass('a panel in the rack offers edit and remove');
  else fail(`found ${controls.length} controls on the panel, expected 2`);
  if (controls.every((c) => c.w >= 24 && c.h >= 24)) pass('and they are big enough to hit');
  else fail(`controls measure ${controls.map((c) => `${c.w}x${c.h}`).join(', ')}`);
  // They must not hang over the neighbouring panel, whose controls they are not.
  if (controls.every((c) => c.inside)) pass('and stay on the panel they belong to');
  else fail('a control overhangs its panel');

  await page.locator('button[aria-label*="Remove Rack me"]').first().click();
  await page.waitForTimeout(400);
  if ((await page.locator('[data-rack-panel="Rack me"]').count()) === 0) pass('remove takes the panel out of the rack');
  else fail('the panel was still in the rack after remove');

  if (problems.length === 0) pass('no uncaught errors putting a panel in the rack');
  else fail(`putting a panel in the rack: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- racking from the header waits until the panel is in the library ---
{
  const { page, problems } = await open();
  // The rack holds a reference to a saved panel, so there is nothing to point
  // at until this one has been saved.
  const rackIt = page.getByRole('button', { name: /Add this panel to the rack|Save this panel first/ });
  if (await rackIt.isDisabled()) pass('a panel that has never been saved cannot be racked');
  else fail('the rack button was live on an unsaved panel');
  const why = await rackIt.getAttribute('aria-label');
  if (/save this panel first/i.test(why ?? '')) pass('and says why rather than just greying out');
  else fail(`the disabled button is labelled ${JSON.stringify(why)}`);

  await page.getByLabel('Panel name').fill('Straight to the rack');
  await page.getByRole('button', { name: 'Save to library' }).click();
  await page.waitForTimeout(700);

  if (await rackIt.isEnabled()) pass('saving turns it on');
  else fail('the rack button stayed disabled after saving');

  await rackIt.click();
  await page.waitForTimeout(1000);
  if ((await page.locator('[data-rack-panel="Straight to the rack"]').count()) > 0) {
    pass('and then it places the panel and shows you the rack');
  } else {
    fail('the panel did not reach the rack from the header');
  }

  if (problems.length === 0) pass('no uncaught errors racking from the header');
  else fail(`racking from the header: ${[...new Set(problems)].join(' | ')}`);

  await page.getByRole('button', { name: /^Clear/ }).first().click();
  await page.waitForTimeout(200);
  const confirm = page.getByRole('button', { name: /clear everything/i }).first();
  if (await confirm.count()) await confirm.click();
  await page.waitForTimeout(600);
  await page.close();
}

// --- a panel in the rack gets its font loaded, not just the open one ---
{
  const { page, problems } = await open();
  const fontRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/font')) fontRequests.push(new URL(r.url()).searchParams.get('family') ?? '');
  });

  // Lettering in a font the open design will not be using afterwards, so the
  // only thing that can ask for it is the panel sitting in the rack.
  await page.getByRole('button', { name: 'Text & art', exact: true }).click();
  await page.getByRole('button', { name: 'Text label', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('combobox').filter({ hasText: 'Inter' }).first().selectOption('Space Mono');
  await page.waitForTimeout(1200);

  await page.getByLabel('Panel name').fill('Lettered');
  await page.getByRole('button', { name: 'Save to library' }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'To rack', exact: true }).first().click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'New blank panel' }).click();
  await page.waitForTimeout(600);

  // A reload clears the loaded fonts, leaving the rack panel as the only
  // reason to want this one. Fonts used to be requested by the 2D canvas, for
  // the open design alone, so this is where the lettering went missing.
  fontRequests.length = 0;
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Rack', exact: true }).first().click();
  await page.waitForTimeout(1200);

  if (fontRequests.includes('Space Mono')) pass('a rack panel\'s font is fetched after a reload');
  else fail(`no request for the rack panel's font; asked for ${JSON.stringify(fontRequests)}`);

  const body = await page.locator('body').innerText();
  if (!/Waiting for/i.test(body)) pass('and the rack has its lettering, with nothing left pending');
  else fail('the rack is still waiting on a font it should have asked for');

  if (problems.length === 0) pass('no uncaught errors loading a rack panel\'s font');
  else fail(`rack fonts: ${[...new Set(problems)].join(' | ')}`);

  // Leave nothing behind for the checks that follow.
  await page.getByRole('button', { name: /^Clear/ }).first().click();
  await page.waitForTimeout(200);
  const confirm = page.getByRole('button', { name: /clear everything/i }).first();
  if (await confirm.count()) await confirm.click();
  await page.waitForTimeout(600);
  await page.close();
}

// --- light and dark ---
{
  for (const scheme of ['dark', 'light'] as const) {
    const { page } = await open(scheme);
    const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (applied === scheme) pass(`a ${scheme} machine gets the ${scheme} theme`);
    else fail(`system ${scheme} produced data-theme=${applied}`);
    await page.close();
  }

  const { page, problems } = await open('dark');
  await page.getByRole('button', { name: 'Light' }).click();
  await page.waitForTimeout(300);
  const forced = await page.evaluate(() => ({
    attr: document.documentElement.getAttribute('data-theme'),
    bg: getComputedStyle(document.body).backgroundColor,
  }));
  if (forced.attr === 'light' && forced.bg !== 'rgb(12, 13, 16)') pass('light can be chosen on a dark machine');
  else fail(`forcing light gave ${JSON.stringify(forced)}`);

  // The theme is applied before the first paint, or every load of a light
  // theme flashes dark for a frame.
  await page.reload({ waitUntil: 'domcontentloaded' });
  const early = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (early === 'light') pass('the choice is applied before anything is drawn, so there is no flash');
  else fail(`before hydration the theme was ${early}`);

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Match the system' }).click();
  await page.waitForTimeout(400);
  const back = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (back === 'dark') pass('handing it back to the system follows the machine again');
  else fail(`back on system the theme was ${back}`);

  if (problems.length === 0) pass('no uncaught errors switching theme');
  else fail(`switching theme: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- searching for a module by name ---
{
  const { page, problems } = await open();
  await page.getByRole('button', { name: 'ModularGrid', exact: true }).click();
  await page.getByPlaceholder('Maths, Plaits, Disting…').fill('disting');

  // A bare name searches; only a link opens one module directly.
  const button = page.getByRole('button', { name: 'Search', exact: true });
  if (await button.count()) pass('a typed name offers to search rather than to open');
  else fail('typing a name did not offer a search');

  await button.click();
  await page.waitForTimeout(10000);

  const options = await page.locator('aside li button').allInnerTexts();
  const said = await page.locator('body').innerText();
  if (/switched off|Too many/i.test(said)) {
    skip('search: ModularGrid lookup is off or throttled right now');
  } else if (options.length >= 3 && options.every((o) => /disting/i.test(o))) {
    pass(`a name with several modules behind it lists all ${options.length}`);
  } else {
    fail(`search returned ${options.length} options`);
  }

  // Twelve Distings that differ only in a version number are hard to tell
  // apart by name, which is the reason for the pictures.
  await page.waitForFunction(() => document.querySelectorAll('aside li img').length > 0, null,
    { timeout: 40000 }).catch(() => {});
  const shots = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('aside li img')] as HTMLImageElement[];
    return { shown: imgs.length, loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length };
  });
  if (shots.shown > 0) pass(`each result carries a panel shot (${shots.shown})`);
  else fail('no panel shots appeared beside the results');
  if (shots.loaded === shots.shown) pass('and every one of them loaded');
  else fail(`${shots.shown - shots.loaded} of ${shots.shown} panel shots failed to load`);
  if (/\d+ HP/.test(await page.locator('aside ul').innerText())) pass('and its width, to tell the versions apart');
  else fail('the results do not say how wide each module is');

  await page.locator('aside li button').first().click();
  await page.waitForTimeout(16000);
  const body = await page.locator('body').innerText();
  if (/Loaded[^\n]*isting/i.test(body)) pass('picking one loads that module');
  else fail('picking a result did not load it');

  if (problems.length === 0) pass('no uncaught errors while searching');
  else fail(`while searching: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- a ModularGrid link, pasted in either place ---
for (const [tab, placeholder, button] of [
  ['ModularGrid', 'Maths, Plaits, Disting…', 'Open'],
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

    // Only worth doing once, and only where there is a real module loaded to
    // do it with: save the panel, walk away from it, and come back.
    if (tab === 'ModularGrid') {
      const hasPhoto = () => page.evaluate(() =>
        (document.querySelector('[data-panel-canvas] image')?.getAttribute('href') ?? '').length > 100);

      await page.getByLabel('Panel name').fill('Reference kept');
      await page.getByRole('button', { name: 'Save to library' }).click();
      await page.waitForTimeout(700);
      await page.getByRole('button', { name: 'New blank panel' }).click();
      await page.waitForTimeout(600);
      if (!(await hasPhoto())) pass('starting a new panel clears the photo');
      else fail('the previous panel\'s photo was left underneath the new one');

      await page.getByRole('button', { name: 'Library', exact: true }).click();
      await page.locator('aside').last().getByRole('button', { name: 'Open', exact: true }).first().click();
      await page.waitForTimeout(6000);
      if (await hasPhoto()) pass('reopening the design brings its photo back');
      else fail('the reference photo did not come back with the design');

      // The controls for the photo have to come back with it. They used to
      // sit at the bottom of the Detection section, which you have no reason
      // to open when you are editing a panel you saved yesterday.
      const source = await page.locator('aside').first().innerText();
      const opacityAt = source.toUpperCase().indexOf('UNDERLAY OPACITY');
      const detectAt = source.toUpperCase().indexOf('DETECTION');
      if (opacityAt > 0 && opacityAt < detectAt) pass('and its opacity control, beside the photo');
      else fail(`underlay opacity at ${opacityAt}, detection at ${detectAt}`);

      // The module's own width, as something to compare the panel against.
      if (/·\s*30 HP/.test(source)) pass('and says the module is 30 HP');
      else fail('the module\'s stated width was not shown with the source');
      await page.getByRole('button', { name: 'Panel', exact: true }).click();
      await page.waitForTimeout(300);
      if (/the module is 30 hp/i.test(await page.locator('aside').last().innerText())) {
        pass('and repeats it next to the panel width');
      } else {
        fail('the panel width has nothing to compare against');
      }

      await page.getByRole('button', { name: /^Clear/ }).first().click().catch(() => {});
      await page.waitForTimeout(200);
      const confirm = page.getByRole('button', { name: /clear everything/i }).first();
      if (await confirm.count()) await confirm.click();
      await page.waitForTimeout(500);
    }
  } else {
    fail(`${tab} tab: the module did not load`);
  }
  await page.close();
}

await browser.close();
console.log(failures === 0 ? '\n  all browser checks passed\n' : `\n  ${failures} browser checks failed\n`);
process.exit(failures === 0 ? 0 : 1);
