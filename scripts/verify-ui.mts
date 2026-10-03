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
import { existsSync, readFileSync } from 'node:fs';
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

// --- an uploaded font joins the font list and survives a reload ---
{
  const fontFile = 'node_modules/.cache/panel-verify/Inter-700.ttf';
  if (!existsSync(fontFile)) {
    console.log('  skip  no font file cached (run npm run verify once to fetch one)');
  } else {
    const { page, problems } = await open();
    await page.getByRole('button', { name: 'Text & art', exact: true }).click();
    await page.getByRole('button', { name: 'Text label', exact: true }).click();
    await page.waitForTimeout(300);

    // Named so it cannot be mistaken for a built-in family.
    await page.locator('input[type="file"][accept*=".ttf"]').setInputFiles({
      name: 'Panel Grotesk.ttf', mimeType: 'font/ttf', buffer: readFileSync(fontFile),
    });
    await page.waitForTimeout(500);

    const fontSelect = page.getByRole('combobox').filter({ has: page.locator('option[value="Panel Grotesk"]') }).first();
    if (await fontSelect.count()) pass('an uploaded font appears in the font list');
    else fail('the uploaded font is not in the font list');
    if ((await fontSelect.inputValue().catch(() => '')) === 'Panel Grotesk') pass('and the label is set in it');
    else fail('the label was not switched to the uploaded font');

    // The file has to outlive the page, or every label set in it is looked
    // for on Google Fonts after a reload, and is not there.
    await page.waitForTimeout(400);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Text & art', exact: true }).click();
    await page.getByRole('button', { name: 'Text label', exact: true }).click();
    await page.waitForTimeout(300);
    if (await page.locator('option[value="Panel Grotesk"]').count()) pass('and is still offered after a reload');
    else fail('the uploaded font was gone after a reload');

    const body = await page.locator('body').innerText();
    if (problems.length === 0 && !/Could not load font/i.test(body)) {
      pass('lettering in an uploaded font loads without asking Google for it');
    } else {
      fail(`uploaded font: ${[...new Set(problems)].join(' | ') || 'a font error is showing'}`);
    }

    // A panel file has to bring the font with it: imported into a browser
    // that has never seen it, the lettering must still find its font.
    await page.getByLabel('Panel name').fill('Own lettering');
    await page.getByRole('button', { name: 'Save to library' }).click();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTitle('Export this panel to a file').first().click(),
    ]);
    const file = readFileSync((await download.path())!, 'utf8');
    await page.close();

    const fresh = await open();
    await fresh.page.getByRole('button', { name: 'Library', exact: true }).click();
    await fresh.page.locator('input[type="file"][accept*=".json"]').setInputFiles({
      name: 'own.panel.json', mimeType: 'application/json', buffer: Buffer.from(file),
    });
    await fresh.page.waitForTimeout(800);
    if (/1 font added/.test(await fresh.page.locator('body').innerText())) pass('the import says it added the font');
    else fail('the import report does not mention the font');
    await fresh.page.getByRole('button', { name: 'Open', exact: true }).first().click();
    await fresh.page.waitForTimeout(1200);
    const freshBody = await fresh.page.locator('body').innerText();
    if (fresh.problems.length === 0 && !/Could not load font|Waiting for/i.test(freshBody)) {
      pass('a panel file brings its uploaded font to another browser');
    } else {
      fail(`importing a panel with its font: ${[...new Set(fresh.problems)].join(' | ') || 'lettering is missing its font'}`);
    }
    await fresh.page.getByRole('button', { name: 'Text & art', exact: true }).click();
    await fresh.page.getByRole('button', { name: 'Text label', exact: true }).click();
    await fresh.page.waitForTimeout(300);
    if (await fresh.page.locator('option[value="Panel Grotesk"]').count()) pass('and offers it in the font list');
    else fail('the imported font is not in the font list');
    await fresh.page.close();
  }
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

// --- keyboard: shapes, labels, undo, save ---
{
  const { page, problems } = await open();
  const cutouts = () => page.evaluate(() =>
    +(document.body.innerText.match(/· (\d+) cutouts/)?.[1] ?? -1));
  const decor = () => page.locator('[data-decor]').count();
  const place = async (key: string, mx: number, my: number) => {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
    const at = await page.evaluate(([x, y]) => {
      const el = document.querySelector('[data-panel-canvas]') as SVGSVGElement;
      const q = new DOMPoint(x, y).matrixTransform(el.getScreenCTM()!);
      return { x: q.x, y: q.y };
    }, [mx, my] as [number, number]);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(250);
  };

  // A letter from each shape's own name, so they can be guessed.
  await place('c', 12, 20);
  await place('r', 12, 45);
  await place('u', 12, 70);
  await place('s', 12, 95);
  if ((await cutouts()) === 4) pass('c, r, u and s each arm their own shape');
  else fail(`the four shape keys produced ${await cutouts()} cutouts`);

  await page.keyboard.press('t');
  if ((await decor()) === 1) pass('t drops in a text label');
  else fail(`t produced ${await decor()} pieces of decor`);

  // Typing into a label where it sits, rather than going to the sidebar. The
  // outlines only exist once the font has arrived, so wait for them rather
  // than for a guess at how long that takes.
  const hit = page.locator(':is([data-decor="text"], [data-decor-grab="text"]) rect[fill="transparent"]').first();
  await hit.waitFor({ timeout: 30000 });
  if ((await hit.evaluate((e) => getComputedStyle(e).cursor)) === 'move') {
    pass('and hovering it offers to move it, not to type');
  } else {
    fail('a label advertises a text cursor when a single drag moves it');
  }
  await hit.dblclick();
  await page.waitForTimeout(400);
  const editor = page.locator('input[aria-label="Label text"]');
  if ((await editor.count()) === 1) pass('double-clicking it opens an editor over the label');
  else fail('double-clicking a label did not open an editor');
  if ((await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Label text') {
    pass('with the caret already in it');
  } else {
    fail('the editor opened without the caret, so nothing typed would reach it');
  }

  await page.keyboard.type('CV IN');
  await page.waitForTimeout(300);
  const named = async () => (await page.locator('aside').last().locator('li').first().innerText()).split('\n')[0];
  if ((await named()) === 'CV IN') pass('and what is typed goes straight onto the panel');
  else fail(`the label says ${JSON.stringify(await named())} after typing`);

  // Both ways out keep the typing, and both actually leave.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if ((await editor.count()) === 0 && (await named()) === 'CV IN') pass('Escape leaves, keeping it');
  else fail('Escape did not close the editor');
  await hit.dblclick();
  await page.waitForTimeout(300);
  await page.mouse.click(1100, 700);
  await page.waitForTimeout(300);
  if ((await editor.count()) === 0) pass('and so does clicking away');
  else fail('the editor stayed open after a click elsewhere');

  // Handles on a label: four to scale, one to turn. Scaling a label means its
  // cap height, which is the number panels are specified in.
  await page.locator(':is([data-decor="text"], [data-decor-grab="text"]) rect[fill="transparent"]').first().click();
  await page.waitForTimeout(350);
  const capHeight = () =>
    page.locator('aside').last().locator('input[inputmode="decimal"]').first().inputValue();
  const scaleHandles = () =>
    page.locator('[data-panel-canvas] rect[style*="nwse-resize"]').count();
  if ((await scaleHandles()) === 4) pass('a selected label carries corner handles');
  else fail(`a label showed ${await scaleHandles()} scale handles, expected 4`);

  const before = Number(await capHeight());
  const corner = await page.evaluate(() => {
    const r = [...document.querySelectorAll('[data-panel-canvas] rect[style*="nwse-resize"]')][2];
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 60, corner.y + 40, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  const after = Number(await capHeight());
  if (after > before * 1.2) pass(`and dragging one sets the cap height (${before} to ${after} mm)`);
  else fail(`cap height went ${before} to ${after}`);

  // Turning it, from the knob above the box.
  const knob = await page.evaluate(() => {
    const c = document.querySelector('[data-panel-canvas] circle[style*="grab"]');
    if (!c) return null;
    const b = c.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  if (knob) {
    await page.mouse.move(knob.x, knob.y);
    await page.mouse.down();
    await page.mouse.move(knob.x + 90, knob.y + 90, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(350);
    const turned = await page.locator('aside').last().innerText();
    if (/ROTATION\s*\n?\s*-?\d{1,3}°/.test(turned) && !/ROTATION\s*\n?\s*0°/.test(turned)) {
      pass('and the knob above it turns it');
    } else {
      fail('the rotation handle did not turn the label');
    }
  } else {
    fail('no rotation handle appeared on the label');
  }

  // Arrow keys moved cutouts but not decor, which is the same operation on
  // the same kind of thing.
  await page.locator(':is([data-decor="text"], [data-decor-grab="text"]) rect[fill="transparent"]').first().click();
  await page.waitForTimeout(250);
  const boxBefore = await page.locator('[data-decor="text"]').first().boundingBox();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  const boxAfter = await page.locator('[data-decor="text"]').first().boundingBox();
  if (boxBefore && boxAfter && boxAfter.x > boxBefore.x + 0.5) pass('arrow keys nudge a label too');
  else fail(`the label did not move: ${boxBefore?.x} -> ${boxAfter?.x}`);

  // Undo, redo, save. A cutout of its own to step back over, placed after a
  // pause: edits close together are deliberately one step, so without the wait
  // this would be undoing the label edits above and the count would not move.
  await page.waitForTimeout(600);
  await place('c', 30, 110);
  const had = await cutouts();
  await page.waitForTimeout(600);
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(400);
  const undone = await cutouts();
  await page.keyboard.press('Meta+Shift+z');
  await page.waitForTimeout(400);
  if (undone === had - 1 && (await cutouts()) === had) pass('Cmd-Z steps back and Cmd-Shift-Z forward');
  else fail(`undo went ${had} -> ${undone} -> ${await cutouts()}`);

  await page.getByLabel('Panel name').fill('Keyboard panel');
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(700);
  const save = (await page.getByRole('button', { name: /^Save/ }).first().innerText()).trim();
  if (save === 'Saved') pass('and Cmd-S saves from wherever you are');
  else fail(`the save button reads "${save}" after Cmd-S`);

  // All of it is listed somewhere, on its own shortcut, rather than spread
  // through the interface.
  // Out of the name field first: a question mark typed into a box is a
  // question mark, which is the whole point of the guard.
  await page.locator('[data-panel-canvas]').click({ position: { x: 600, y: 60 } });
  await page.waitForTimeout(250);
  await page.keyboard.press('?');
  await page.waitForTimeout(350);
  const sheet = page.locator('[role="dialog"]');
  if ((await sheet.count()) === 1) pass('? brings up the list of shortcuts');
  else fail('? did not open the shortcuts');
  const listed = await sheet.innerText();
  const missing = ['Circle', 'Text label', 'Undo', 'Redo', 'Save'].filter((k) => !listed.includes(k));
  if (missing.length === 0) pass('and it has the shapes, the label and the panel keys in it');
  else fail(`the list is missing ${missing.join(', ')}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  if ((await sheet.count()) === 0) pass('and Escape puts it away');
  else fail('the shortcuts stayed up after Escape');

  if (problems.length === 0) pass('no uncaught errors from the keyboard');
  else fail(`keyboard: ${[...new Set(problems)].join(' | ')}`);

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

// --- selecting several things and moving them together ---
{
  const { page, problems } = await open();
  await page.getByRole('button', { name: 'Cutouts', exact: true }).click();
  const toScreen = (mx: number, my: number) =>
    page.evaluate(([x, y]) => {
      const el = document.querySelector('[data-panel-canvas]') as SVGSVGElement;
      const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM()!);
      return { x: p.x, y: p.y };
    }, [mx, my] as [number, number]);
  const place = async (mx: number, my: number) => {
    await page.getByRole('button', { name: 'Circle', exact: true }).click();
    const at = await toScreen(mx, my);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(200);
  };
  /** Which rows the inspector shows as selected, as a string of 1s and 0s. */
  const chosen = () => page.evaluate(() =>
    [...document.querySelectorAll('aside:last-of-type li button')]
      .map((r) => (r.className.includes('bg-accent') ? '1' : '0')).join(''));
  // The cutouts themselves, not the dot a selected one carries at its centre.
  const columns = () => page.locator('[data-panel-canvas] circle:not([pointer-events="none"])').evaluateAll((els) =>
    els.map((e) => Number(e.getAttribute('cx'))).filter((v) => v > 5 && v < 60));
  // Playwright's click modifiers do not reach pointerdown, so the key is held
  // the long way round.
  const clickWith = async (key: 'Shift' | 'Meta', mx: number, my: number) => {
    const at = await toScreen(mx, my);
    await page.keyboard.down(key);
    await page.mouse.click(at.x, at.y);
    await page.keyboard.up(key);
    await page.waitForTimeout(250);
  };

  await place(12, 25);
  await place(12, 45);
  await place(12, 65);

  const first = await toScreen(12, 25);
  await page.mouse.click(first.x, first.y);
  await page.waitForTimeout(250);
  if ((await chosen()) === '100') pass('a plain click selects one thing');
  else fail(`a plain click gave ${await chosen()}`);

  await clickWith('Shift', 12, 45);
  if ((await chosen()) === '110') pass('Shift adds to the selection');
  else fail(`after Shift-click the selection was ${await chosen()}`);

  await clickWith('Meta', 12, 65);
  if ((await chosen()) === '111') pass('and so does Cmd');
  else fail(`after Cmd-click the selection was ${await chosen()}`);

  // The point of selecting several: moving them as one.
  const from = await toScreen(12, 45);
  const to = await toScreen(24, 45);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const cols = await columns();
  if (cols.length === 3 && cols.every((c) => Math.abs(c - 24) < 0.01)) {
    pass('dragging one of them moves all of them');
  } else {
    fail(`columns after the group drag: ${cols.map((c) => c.toFixed(1)).join(', ')}`);
  }

  // A modifier-click on something already selected takes it back out — but
  // only on a click, or a modifier-drag would drop a member as it started.
  await clickWith('Meta', 24, 25);
  if ((await chosen()) === '011') pass('and a modifier-click takes one back out');
  else fail(`after deselecting one the selection was ${await chosen()}`);

  await page.keyboard.down('Shift');
  const grab = await toScreen(24, 45);
  const dest = await toScreen(24, 80);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(dest.x, dest.y, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(400);
  if ((await chosen()) === '011') pass('while a modifier-drag keeps the selection whole');
  else fail(`a Shift-drag changed the selection to ${await chosen()}`);

  if (problems.length === 0) pass('no uncaught errors selecting several things');
  else fail(`multi-select: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- tracing part of an image ---
{
  const { page, problems } = await open();
  await page.getByRole('button', { name: 'Text & art', exact: true }).click();
  await page.waitForTimeout(300);

  // A picture with two separate shapes in it, made here rather than kept as a
  // fixture: cropping to one half should trace one of them, not both.
  const input = page.locator('aside').last().locator('input[type="file"]').first();
  await input.evaluate(async (el: HTMLInputElement) => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 200;
    const x = c.getContext('2d')!;
    x.fillStyle = '#fff';
    x.fillRect(0, 0, 400, 200);
    x.fillStyle = '#000';
    x.beginPath();
    x.arc(100, 100, 70, 0, Math.PI * 2);
    x.fill();
    x.fillRect(240, 60, 120, 80);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'two-shapes.png', { type: 'image/png' }));
    el.files = dt.files;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(600);

  const outlines = async () =>
    Number((await page.locator('aside').last().innerText()).match(/Traced artwork: (\d+) outline/)?.[1] ?? 0);

  await page.getByRole('button', { name: 'Trace to relief' }).click();
  await page.waitForTimeout(3000);
  if ((await outlines()) === 2) pass('tracing the whole picture finds both shapes');
  else fail(`the whole picture traced to ${await outlines()} outlines, expected 2`);

  // Draw a box over the left half and trace again.
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(400);
  const area = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('aside img')];
    const b = imgs[imgs.length - 1].getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  await page.mouse.move(area.x + area.w * 0.03, area.y + area.h * 0.05);
  await page.mouse.down();
  await page.mouse.move(area.x + area.w * 0.48, area.y + area.h * 0.95, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  if ((await page.locator('aside').last().innerText()).includes('Only the boxed part')) {
    pass('dragging across the preview draws a crop');
  } else {
    fail('no crop was drawn by dragging across the preview');
  }

  await page.getByRole('button', { name: 'Trace to relief' }).click();
  await page.waitForTimeout(3000);
  if ((await outlines()) === 1) pass('and only what is boxed gets traced');
  else fail(`the cropped half traced to ${await outlines()} outlines, expected 1`);

  if (problems.length === 0) pass('no uncaught errors while tracing');
  else fail(`while tracing: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- a cutout shortcut draws the cutout at the size dragged ---
{
  const { page, problems } = await open();
  const toScreen = (mx: number, my: number) =>
    page.evaluate(([x, y]) => {
      const el = document.querySelector('[data-panel-canvas]') as SVGSVGElement;
      const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM()!);
      return { x: p.x, y: p.y };
    }, [mx, my] as [number, number]);
  const drag = async (a: [number, number], b: [number, number], during?: () => Promise<void>) => {
    const p = await toScreen(...a), q = await toScreen(...b);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(q.x, q.y, { steps: 10 });
    if (during) await during();
    await page.mouse.up();
    await page.waitForTimeout(250);
  };
  const svg = page.locator('[data-panel-canvas]');
  await svg.hover();

  await page.keyboard.press('r');
  await page.waitForTimeout(150);
  let shown = '';
  await drag([8, 30], [28, 40], async () => {
    shown = (await page.locator('[data-draw-preview] text').textContent()) ?? '';
  });
  if (shown.includes('20 × 10 mm')) pass('R and a drag show the rectangle and its size while drawing');
  else fail(`while drawing a rectangle the preview said "${shown}"`);
  if (await page.locator('[data-panel-canvas] rect[x="8"][y="30"][width="20"][height="10"]').count() === 1) {
    pass('and it is cut at the size dragged');
  } else fail('the drawn rectangle was not 20 × 10 mm where it was drawn');
  if (await page.locator('[data-draw-layer]').count() === 0) pass('after which the tool is put away');
  else fail('the tool stayed on after drawing one');

  // A click with the tool still places the usual size.
  await page.keyboard.press('c');
  const c = await toScreen(20, 100);
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(250);
  if (await page.locator('[data-panel-canvas] circle[cx="20"][cy="100"][r="3"]').count() === 1) pass('a click instead of a drag places the usual 6 mm circle');
  else fail('a click with the circle tool did not place a 6 mm circle');

  // Over an existing cutout: a crosshair, and the drag draws rather than moves it.
  await page.keyboard.press('c');
  await page.waitForTimeout(150);
  await page.mouse.move(c.x, c.y);
  const cursor = await page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)!).cursor, [c.x, c.y] as [number, number]);
  if (cursor === 'crosshair') pass('with a tool, the cursor is a crosshair even over a cutout');
  else fail(`with a tool, the cursor over a cutout is "${cursor}"`);
  await drag([20, 100], [27, 103]);
  const old = await page.locator('[data-panel-canvas] circle[cx="20"][cy="100"][r="3"]').count();
  const drawn = await page.locator('[data-panel-canvas] circle[cx="23.5"][cy="103.5"][r="3.5"]').count();
  if (old === 1 && drawn === 1) pass('a drag that starts on a cutout draws a new one and leaves that one put');
  else fail(`drawing from a cutout: original still there ${old}, new 7 mm circle ${drawn}`);

  // Esc mid-drag draws nothing. Counted from the readout, since selection
  // handles are circles too.
  const cutouts = () => page.evaluate(() => +(document.body.innerText.match(/· (\d+) cutouts/)?.[1] ?? -1));
  const count = await cutouts();
  await page.keyboard.press('c');
  await drag([10, 60], [16, 66], async () => { await page.keyboard.press('Escape'); });
  if ((await cutouts()) === count && count > 0) pass('Esc while drawing draws nothing');
  else fail(`Esc while drawing: ${count} cutouts before, ${await cutouts()} after`);

  if (problems.length === 0) pass('no uncaught errors drawing cutouts');
  else fail(`drawing cutouts: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- a line is drawn end to end ---
{
  const { page, problems } = await open();
  const toScreen = (mx: number, my: number) =>
    page.evaluate(([x, y]) => {
      const el = document.querySelector('[data-panel-canvas]') as SVGSVGElement;
      const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM()!);
      return { x: p.x, y: p.y };
    }, [mx, my] as [number, number]);
  await page.locator('[data-panel-canvas]').hover();
  await page.keyboard.press('l');
  await page.waitForTimeout(150);
  if (await page.locator('[data-draw-layer]').count() === 1) pass('L picks up the line tool rather than dropping a line');
  else fail('L did not start drawing a line');

  const a = await toScreen(8, 40), b = await toScreen(32, 40);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  const shown = (await page.locator('[data-draw-preview] text').textContent()) ?? '';
  await page.mouse.up();
  await page.waitForTimeout(250);
  if (shown.trim() === '24 mm') pass('the line shows its length while it is drawn');
  else fail(`while drawing, the line was labelled "${shown}"`);
  const line = await page.locator('[data-decor="shape"] path').first().boundingBox();
  if (line && Math.abs(line.x - a.x) < 4 && Math.abs(line.x + line.width - b.x) < 4) pass('and runs from where the drag began to where it ended');
  else fail(`the drawn line spans ${line ? `${Math.round(line.x)}–${Math.round(line.x + line.width)}` : 'nothing'}, the drag ${Math.round(a.x)}–${Math.round(b.x)}`);

  // From the button, a click lays the usual rule where clicked.
  await page.getByRole('button', { name: 'Text & art', exact: true }).click();
  await page.getByRole('button', { name: 'Line / shape', exact: true }).click();
  const c = await toScreen(20, 100);
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(250);
  const rules = await page.locator('[data-decor="shape"] path').count();
  const rule = await page.locator('[data-decor="shape"] path').last().boundingBox();
  if (rules === 2 && rule && Math.abs(rule.x + rule.width / 2 - c.x) < 4 && Math.abs(rule.y + rule.height / 2 - c.y) < 4) {
    pass('the Line button draws too, and a click lays a rule centred where clicked');
  } else fail(`after a click with the line tool: ${rules} lines, the last centred at ${rule ? `${Math.round(rule.x + rule.width / 2)},${Math.round(rule.y + rule.height / 2)}` : 'nowhere'}`);
  if (await page.locator('[data-draw-layer]').count() === 0) pass('after which the tool is put away');
  else fail('the line tool stayed on');

  if (problems.length === 0) pass('no uncaught errors drawing lines');
  else fail(`drawing lines: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- the rotation slider catches on the right angles ---
{
  const { page, problems } = await open();
  await page.getByRole('button', { name: 'Text & art', exact: true }).click();
  await page.getByRole('button', { name: 'Text label', exact: true }).click();
  await page.waitForTimeout(300);
  const field = page.locator('[data-detents]').first();
  const slider = field.locator('input[type="range"]');
  const value = async () => Number(await slider.inputValue());
  const labels = await field.locator('button').allTextContents();
  if (['-180', '-90', '0', '90', '180'].every((v) => labels.includes(v))) pass('the rotation slider has notches at -180, -90, 0, 90 and 180');
  else fail(`rotation notches: ${JSON.stringify(labels)}`);

  await field.getByRole('button', { name: 'Set to 90', exact: true }).click();
  if ((await value()) === 90) pass('clicking a notch turns it straight there');
  else fail(`clicking 90 left the rotation at ${await value()}`);

  // Dragged to 87°: caught at 90. With Alt: left at 87.
  const box = (await slider.boundingBox())!;
  const xFor = (v: number) => box.x + 6.5 + ((v + 180) / 360) * (box.width - 13);
  const y = box.y + box.height / 2;
  const dragTo = async (v: number, alt = false) => {
    await page.mouse.move(xFor(await value()), y);
    if (alt) await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.move(xFor(v), y, { steps: 8 });
    await page.mouse.up();
    if (alt) await page.keyboard.up('Alt');
    await page.waitForTimeout(100);
  };
  await field.getByRole('button', { name: 'Set to 0', exact: true }).click();
  await dragTo(87);
  if ((await value()) === 90) pass('dragged near 90°, it catches there');
  else fail(`dragged to about 87°, the rotation is ${await value()}`);
  await field.getByRole('button', { name: 'Set to 0', exact: true }).click();
  await dragTo(87, true);
  const free = await value();
  if (free >= 85 && free <= 89) pass(`with Alt held it goes where it is put (${free}°)`);
  else fail(`Alt-dragging to about 87° gave ${free}`);

  // Arrow keys step out of a notch rather than being pulled back into it.
  await field.getByRole('button', { name: 'Set to 0', exact: true }).click();
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  if ((await value()) === 1) pass('arrow keys still step one degree at a time');
  else fail(`an arrow key from 0 gave ${await value()}`);

  if (problems.length === 0) pass('no uncaught errors turning things');
  else fail(`rotation slider: ${[...new Set(problems)].join(' | ')}`);
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

  // Lining two things up is half of placing them; how far apart they are is
  // the other half, and it is a figure panels are built to.
  // SVG text has no innerText, so read the content.
  const dim = await page.locator('[data-panel-canvas] text').allTextContents();
  if (dim.some((d) => /^80 mm$/.test((d ?? '').trim()))) pass('and the guide is labelled with the distance');
  else fail(`the guide showed ${JSON.stringify(dim)}, expected the 80 mm between them`);
  if (/80 mm/.test(status)) pass('which the status line repeats');
  else fail('the status line does not give the distance');

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
  if ((await page.locator('[data-panel-canvas] text').count()) === 0) pass('and so does the distance');
  else fail('the distance was left on screen after the drag');

  if (problems.length === 0) pass('no uncaught errors while aligning');
  else fail(`while aligning: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- the next in a row is offered the same spacing ---
{
  const { page, problems } = await open();
  await page.getByRole('button', { name: 'Cutouts', exact: true }).click();
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

  // Two 8 mm apart, and a third to bring in after them.
  await place(6, 80);
  await place(14, 80);
  await place(30, 100);

  const from = await toScreen(30, 100);
  const to = await toScreen(22.3, 80.2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.waitForTimeout(300);
  const marks = await page.locator('[data-spacing-hint="8"]').count();
  const status = await page.locator('body').innerText();
  if (marks === 1) pass('dragging the third into the row marks the 8 mm spacing of the first two');
  else fail(`spacing marks while dragging: ${marks}`);
  if (/equal spacing 8 mm/.test(status)) pass('and the status line names it');
  else fail('the status line did not mention the spacing');
  await page.mouse.up();
  await page.waitForTimeout(300);

  const xs = await page.locator('[data-panel-canvas] circle').evaluateAll((els) =>
    [...new Set(els.map((e) => +(e.getAttribute('cx') ?? 0)))].sort((a, b) => a - b));
  if (xs.some((v) => Math.abs(v - 22) < 0.01)) pass('and it lands 8 mm on from the second');
  else fail(`after the drag the circles sit at x ${xs.join(', ')}`);
  if ((await page.locator('[data-spacing-hint]').count()) === 0) pass('the marks go when the drag ends');
  else fail('spacing marks were left on screen');

  if (problems.length === 0) pass('no uncaught errors spacing');
  else fail(`spacing: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- dragging a big icon over flush labels keeps up with the pointer ---
{
  const { page, problems } = await open();
  await page.getByRole('button', { name: 'Text & art', exact: true }).click();
  for (let i = 0; i < 6; i++) {
    await page.getByRole('button', { name: 'Text label', exact: true }).click();
    await page.waitForTimeout(100);
  }
  await page.locator('[data-icon-picker] [data-icon="mdi:skull"]').click();
  await page.waitForTimeout(1500);
  const art = page.locator('[data-decor="art"] path').first();
  if (await art.count() === 0) {
    skip('icon drag: Iconify is unreachable right now');
  } else {
    // Three times the size, so it lies across the labels it is flush with.
    await page.locator('input[type="range"]').first().evaluate((el: HTMLInputElement) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '300');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(600);
    const triangles = async () => (await page.getByText(/[\d,]+ triangles$/).first().innerText()).trim();
    const box = (await art.boundingBox())!;
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const before = await triangles();
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    const seen = new Set<string>();
    for (let i = 1; i <= 25; i++) {
      await page.mouse.move(cx + i * 3, cy + i * 6);
      seen.add(await triangles());
    }
    // The pointer holds still: the model catches up with where it is.
    await page.waitForTimeout(600);
    const after = await triangles();
    await page.mouse.up();
    // Rebuilding the whole panel on every pointer move is what made this
    // drag crawl; the model waits for the pointer to stop instead.
    if (seen.size === 1 && seen.has(before)) pass('the 3D model waits while an icon is dragged over flush labels');
    else fail(`the model rebuilt during the drag: ${[...seen].join(', ')}`);
    if (after !== before) pass(`and catches up when the pointer stops (${before} → ${after})`);
    else fail(`the model did not follow the drag (${before} before and after)`);
  }
  if (problems.length === 0) pass('no uncaught errors dragging an icon');
  else fail(`dragging an icon: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- a new icon over a cutout is the thing that gets dragged ---
{
  const { page, problems } = await open();
  const toScreen = (mx: number, my: number) =>
    page.evaluate(([x, y]) => {
      const el = document.querySelector('[data-panel-canvas]') as SVGSVGElement;
      const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM()!);
      return { x: p.x, y: p.y };
    }, [mx, my] as [number, number]);
  // A rectangle cutout in the middle of the panel, where new icons land.
  const W = 8 * 5.08 - 0.3, H = 128.5;
  await page.getByRole('button', { name: 'Cutouts', exact: true }).click();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const mid = await toScreen(W / 2, H / 2);
  await page.mouse.click(mid.x, mid.y);
  await page.waitForTimeout(200);
  const cutout = page.locator('[data-panel-canvas] rect[width="20"][height="10"]').first();
  const cutoutBefore = await cutout.boundingBox();

  await page.getByRole('button', { name: 'Text & art', exact: true }).click();
  await page.locator('[data-icon-picker] [data-icon="mdi:circle"]').click();
  await page.waitForFunction(() => document.querySelector('[data-decor="art"] path'), undefined, { timeout: 15000 }).catch(() => {});
  const art = page.locator('[data-decor="art"] path').first();
  if (await art.count() === 0 || !cutoutBefore) {
    skip('icon over a cutout: Iconify is unreachable, or the cutout was not placed');
  } else {
    const artBefore = (await art.boundingBox())!;
    // Grabbed right where it landed, on top of the cutout.
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(mid.x + 40, mid.y + 120, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const artAfter = (await art.boundingBox())!;
    const cutoutAfter = (await cutout.boundingBox())!;
    const artMoved = Math.hypot(artAfter.x - artBefore.x, artAfter.y - artBefore.y) > 20;
    const cutoutStayed = Math.hypot(cutoutAfter.x - cutoutBefore.x, cutoutAfter.y - cutoutBefore.y) < 1;
    if (artMoved && cutoutStayed) pass('a new icon dropped on a cutout is what gets dragged');
    else fail(`dragging the new icon: icon moved ${artMoved}, cutout stayed ${cutoutStayed}`);
  }
  if (problems.length === 0) pass('no uncaught errors dragging an icon off a cutout');
  else fail(`icon over a cutout: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- new things go where the pointer is on the panel ---
{
  const { page, problems } = await open();
  const toScreen = (mx: number, my: number) =>
    page.evaluate(([x, y]) => {
      const el = document.querySelector('[data-panel-canvas]') as SVGSVGElement;
      const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM()!);
      return { x: p.x, y: p.y };
    }, [mx, my] as [number, number]);
  const centre = async (sel: string) => {
    const b = (await page.locator(sel).last().boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const near = (a: { x: number; y: number }, b: { x: number; y: number }, px: number) =>
    Math.hypot(a.x - b.x, a.y - b.y) < px;

  // T with the pointer over the panel: the label lands under it.
  const spot = await toScreen(12, 90);
  await page.mouse.move(spot.x - 20, spot.y - 20);
  await page.mouse.move(spot.x, spot.y, { steps: 4 });
  await page.keyboard.press('t');
  await page.waitForTimeout(400);
  const label = await centre('[data-decor="text"] path, [data-decor="text"] text');
  if (near(label, spot, 12)) pass('T over the panel puts the label under the pointer');
  else fail(`the label landed at ${Math.round(label.x)},${Math.round(label.y)}, the pointer was at ${Math.round(spot.x)},${Math.round(spot.y)}`);

  // From the sidebar, an icon goes where the pointer rested on the panel,
  // not where it crossed the edge on the way over.
  const there = await toScreen(28, 40);
  await page.mouse.move(there.x, there.y, { steps: 4 });
  await page.waitForTimeout(400);
  const tile = page.locator('[data-icon-picker] [data-icon="mdi:circle"]');
  await tile.scrollIntoViewIfNeeded();
  const tb = (await tile.boundingBox())!;
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 25 });
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('[data-decor="art"] path'), undefined, { timeout: 15000 }).catch(() => {});
  if (await page.locator('[data-decor="art"] path').count() === 0) {
    skip('icon at the pointer: Iconify is unreachable right now');
  } else {
    const icon = await centre('[data-decor="art"] path');
    if (near(icon, there, 12)) pass('an icon picked in the sidebar goes where the pointer rested on the panel');
    else fail(`the icon landed at ${Math.round(icon.x)},${Math.round(icon.y)}, the pointer left the panel at ${Math.round(there.x)},${Math.round(there.y)}`);
  }
  if (problems.length === 0) pass('no uncaught errors adding at the pointer');
  else fail(`adding at the pointer: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- an SVG is used as its own outlines, not traced ---
{
  const { page, problems } = await open();
  await page.getByRole('button', { name: 'Text & art', exact: true }).click();
  // A stylesheet class for the fill, a group transform, a white knockout,
  // and the two things a panel cannot use: a stroke and live text.
  const svgText = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">
    <style>.dark { fill: #222 }</style>
    <g transform="translate(10 5)">
      <rect class="dark" width="80" height="40"/>
      <circle cx="20" cy="20" r="10" fill="#fff"/>
    </g>
    <line x1="0" y1="0" x2="100" y2="50" stroke="#000"/>
    <text x="5" y="45">Hi</text>
  </svg>`;
  await page.locator('input[type="file"][accept="image/*"]').last().setInputFiles({
    name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svgText),
  });
  await page.waitForTimeout(300);
  const use = page.getByRole('button', { name: 'Use its outlines', exact: true });
  if (await use.count() === 1) pass('an SVG offers its own outlines instead of tracing');
  else fail('picking an SVG did not offer to use its outlines');
  if (await page.getByRole('button', { name: /Trace to relief/ }).count() === 0) pass('without the tracing controls in the way');
  else fail('the tracing controls showed for an SVG');

  await use.click();
  await page.waitForTimeout(500);
  const art = page.locator('[data-decor="art"] path').first();
  const d = (await art.getAttribute('d')) ?? '';
  const rings = (d.match(/M/g) ?? []).length;
  if (rings === 2) pass('its filled shapes become the outline, the white circle a hole in it');
  else fail(`the SVG came in as ${rings} rings, expected the rectangle and its hole`);
  const b = await art.boundingBox();
  if (b && Math.abs(b.width / b.height - 2) < 0.05) pass('in its own proportions, through the group transform');
  else fail(`the imported art is ${b ? (b.width / b.height).toFixed(2) : '?'} to 1, expected 2 to 1`);
  const body = await page.locator('body').innerText();
  if (/Left out 1 stroked line, 1 piece of live text/.test(body)) pass('and says what it left out: the stroke and the text');
  else fail('nothing said the stroke and text were left out');

  // Cropped to its left half: the rectangle's left half, with the hole in it.
  const picker = page.locator('[data-crop-picker]');
  const pb = (await picker.boundingBox())!;
  const ib = (await picker.locator('img').boundingBox())!;
  if (Math.abs(pb.width - ib.width) < 3 && Math.abs(pb.height - ib.height) < 3 && Math.abs(pb.width / pb.height - 2) < 0.05) {
    pass('the crop box sits exactly over the picture, with no letterboxing around it');
  } else fail(`crop picker ${Math.round(pb.width)}×${Math.round(pb.height)}, picture ${Math.round(ib.width)}×${Math.round(ib.height)}`);
  await page.mouse.move(pb.x + 1, pb.y + 1);
  await page.mouse.down();
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height - 1, { steps: 8 });
  await page.mouse.up();
  await use.click();
  await page.waitForTimeout(500);
  const half = page.locator('[data-decor="art"] path').last();
  const hd = (await half.getAttribute('d')) ?? '';
  const hb = await half.boundingBox();
  if ((hd.match(/M/g) ?? []).length === 2 && hb && Math.abs(hb.width / hb.height - 1) < 0.06) {
    pass('a crop over half the SVG brings in just that half, square, with its hole');
  } else fail(`cropped SVG: ${(hd.match(/M/g) ?? []).length} rings, ${hb ? (hb.width / hb.height).toFixed(2) : '?'} to 1`);

  // Tracing is still there for an SVG that is really a picture.
  await page.getByRole('button', { name: 'Trace it as a picture instead', exact: true }).click();
  if (await page.getByRole('button', { name: /Trace to relief/ }).count() === 1) pass('and it can still be traced as a picture instead');
  else fail('could not switch to tracing the SVG');

  if (problems.length === 0) pass('no uncaught errors importing an SVG');
  else fail(`importing an SVG: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- an icon picked from the list lands on the panel ---
{
  const { page, problems } = await open();
  const iconify: string[] = [];
  page.on('request', (r) => { if (r.url().includes('api.iconify.design')) iconify.push(r.url()); });
  await page.getByRole('button', { name: 'Text & art', exact: true }).click();
  const picker = page.locator('[data-icon-picker]');
  const quick = await picker.locator('[data-icon]').count();
  if (quick >= 20) pass(`the icon picker offers ${quick} common icons before anything is typed`);
  else fail(`the icon picker shows ${quick} icons with nothing typed`);

  await picker.locator('[data-icon="mdi:sine-wave"]').click();
  // Waited for rather than timed: Iconify answers in a moment usually, and
  // in seconds when it is busy.
  await page.waitForFunction(
    () => /Icon: Sine wave|Could not load the icon|Failed to fetch/i.test(document.body.innerText),
    undefined, { timeout: 15000 },
  ).catch(() => {});
  const body = await page.locator('body').innerText();
  if (/Icon: Sine wave/.test(body)) {
    pass('picking an icon adds it to the panel');
    // It is outlines on the canvas, like traced artwork, not a picture.
    const drawn = await page.locator('[data-panel-canvas] path').count();
    if (drawn > 0) pass('and it is drawn as outlines');
    else fail('the icon was added but nothing was drawn');

    await picker.locator('input').fill('power');
    await page.waitForTimeout(2500);
    const found = await picker.locator('[data-icon]').count();
    const shown = await picker.locator('[data-icon]').evaluateAll((els) => els.map((e) => e.getAttribute('data-icon')));
    if (found > 0 && shown.every((id) => !/-(thin|light|duotone)$/.test(id ?? ''))) {
      pass(`searching finds icons (${found} for "power"), none too thin or shaded to print`);
    } else {
      fail(`search for "power" gave ${found} icons: ${shown.slice(0, 5).join(', ')}`);
    }
    // Iconify turns away a visitor who calls too often, so the picker asks
    // for a set's icons at once rather than one preview at a time.
    if (iconify.length <= 8) pass(`the quick icons, one pick and a search took ${iconify.length} requests to Iconify`);
    else fail(`the icon picker made ${iconify.length} requests to Iconify`);
  } else if (/Could not load the icon|Failed to fetch|Icon search failed/i.test(body)) {
    skip('icons: Iconify is unreachable right now');
  } else {
    fail('picking an icon did not add it');
  }

  if (problems.length === 0) pass('no uncaught errors picking icons');
  else fail(`picking icons: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- several labels edited at once ---
{
  const { page, problems } = await open();
  await page.getByRole('button', { name: 'Text & art', exact: true }).click();
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Text label', exact: true }).click();
    await page.waitForTimeout(150);
  }
  await page.getByRole('button', { name: 'Select all text' }).click();
  await page.waitForTimeout(200);
  const editor = page.locator('[data-batch-editor]');
  if (await editor.count()) pass('selecting several labels shows the batch editor');
  else fail('no batch editor with several labels selected');

  const capHeight = page.locator('label', { hasText: 'Cap height' }).locator('input');
  await capHeight.fill('6');
  await capHeight.press('Enter');
  await page.getByRole('combobox').filter({ has: page.locator('option[value="Space Mono"]') }).first().selectOption('Space Mono');
  await page.waitForTimeout(800);

  // Open each one and read it back from its own editor.
  const rows = page.locator('ul li button', { hasText: 'LABEL' });
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) {
    await rows.nth(i).click();
    await page.waitForTimeout(150);
    const size = await page.locator('label', { hasText: 'Cap height' }).locator('input').inputValue();
    const font = await page.getByRole('combobox').filter({ has: page.locator('option[value="Space Mono"]') }).first().inputValue();
    seen.push(`${size}/${font}`);
  }
  if (seen.every((v) => v === '6/Space Mono')) pass('cap height and font were set on every label');
  else fail(`labels after the batch edit: ${seen.join(', ')}`);

  // Shift-click in the list builds a selection too.
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ['Shift'] });
  await page.waitForTimeout(150);
  if ((await editor.innerText()).startsWith('2 labels')) pass('Shift-clicking in the list picks several');
  else fail(`after a Shift-click the editor says ${JSON.stringify(await editor.innerText().catch(() => ''))}`);

  if (problems.length === 0) pass('no uncaught errors editing labels together');
  else fail(`batch editing: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- a sweep across labels opens their tab ---
{
  const { page, problems } = await open();
  const toScreen = (mx: number, my: number) =>
    page.evaluate(([x, y]) => {
      const el = document.querySelector('[data-panel-canvas]') as SVGSVGElement;
      const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM()!);
      return { x: p.x, y: p.y };
    }, [mx, my] as [number, number]);
  const sweep = async (x0: number, y0: number, x1: number, y1: number) => {
    const a = await toScreen(x0, y0);
    const b = await toScreen(x1, y1);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  };

  // Two labels and two cutouts, kept apart so a box can take either pair.
  await page.getByRole('button', { name: 'Text & art', exact: true }).click();
  await page.getByRole('button', { name: 'Text label', exact: true }).click();
  await page.getByRole('button', { name: 'Text label', exact: true }).click();
  await page.getByRole('button', { name: 'Cutouts', exact: true }).click();
  for (const y of [80, 100]) {
    await page.getByRole('button', { name: 'Circle', exact: true }).click();
    const at = await toScreen(20, y);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(200);
  }

  await page.getByRole('button', { name: 'Panel', exact: true }).click();
  await sweep(2, 4, 38, 20);
  if (await page.locator('[data-batch-editor]').count()) pass('sweeping across labels opens Text & art on their batch editor');
  else fail('a sweep across labels did not open Text & art');

  await page.getByRole('button', { name: 'Panel', exact: true }).click();
  await sweep(2, 70, 38, 110);
  if (await page.locator('[data-batch-cutouts]').count()) pass('sweeping across cutouts opens Cutouts');
  else fail('a sweep across cutouts did not open Cutouts');

  if (problems.length === 0) pass('no uncaught errors following the selection');
  else fail(`tab follows selection: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- several cutouts sized at once ---
{
  const { page, problems } = await open();
  await page.getByRole('button', { name: 'Cutouts', exact: true }).click();
  const toScreen = (mx: number, my: number) =>
    page.evaluate(([x, y]) => {
      const el = document.querySelector('[data-panel-canvas]') as SVGSVGElement;
      const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM()!);
      return { x: p.x, y: p.y };
    }, [mx, my] as [number, number]);
  for (const y of [25, 50, 75]) {
    await page.getByRole('button', { name: 'Circle', exact: true }).click();
    const at = await toScreen(20, y);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(200);
  }

  // Picked from the list, Shift-click by Shift-click.
  const rows = page.locator('aside:last-of-type li button');
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ['Shift'] });
  await rows.nth(2).click({ modifiers: ['Meta'] });
  await page.waitForTimeout(200);
  const batch = page.locator('[data-batch-cutouts]');
  if (await batch.count()) pass('selecting several cutouts offers to size them together');
  else fail('no sizing controls with several cutouts selected');

  const diameter = batch.locator('label', { hasText: 'Diameter' }).locator('input');
  await diameter.fill('8');
  await diameter.press('Enter');
  await page.waitForTimeout(300);
  const radii = await page.locator('[data-panel-canvas] circle:not([pointer-events="none"])').evaluateAll((els) =>
    els.map((e) => ({ cx: Number(e.getAttribute('cx')), r: Number(e.getAttribute('r')) }))
      .filter((c) => Math.abs(c.cx - 20) < 0.01));
  if (radii.length === 3 && radii.every((c) => Math.abs(c.r - 4) < 0.01)) pass('setting a diameter makes every selected circle that size');
  else fail(`circle radii after the batch resize: ${radii.map((c) => c.r).join(', ')}`);

  if (problems.length === 0) pass('no uncaught errors sizing cutouts together');
  else fail(`batch sizing: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- a trackpad pinch zooms about the fingers, as far as they spread ---
{
  const { page, problems } = await open();
  const svg = page.locator('[data-panel-canvas]');
  const width = async () => Number((await svg.getAttribute('viewBox'))!.split(' ')[2]);
  const toScreen = (mx: number, my: number) =>
    page.evaluate(([x, y]) => {
      const el = document.querySelector('[data-panel-canvas]') as SVGSVGElement;
      const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM()!);
      return { x: p.x, y: p.y };
    }, [mx, my] as [number, number]);
  const toMm = (sx: number, sy: number) =>
    page.evaluate(([x, y]) => {
      const el = document.querySelector('[data-panel-canvas]') as SVGSVGElement;
      const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM()!.inverse());
      return { x: p.x, y: p.y };
    }, [sx, sy] as [number, number]);

  // Chrome and Firefox: a pinch is a run of small Ctrl-scrolls, sized so
  // that e^(-delta/100) is the spread. 25 steps of -2 spread the fingers by
  // e^0.5, about 1.65 times.
  const at = await toScreen(14, 45);
  const mmBefore = await toMm(at.x, at.y);
  const w0 = await width();
  const prevented = await page.evaluate(([x, y]) => {
    const el = document.querySelector('[data-panel-canvas]')!;
    let all = true;
    for (let i = 0; i < 25; i++) {
      const e = new WheelEvent('wheel', { ctrlKey: true, deltaY: -2, deltaMode: 0, clientX: x, clientY: y, bubbles: true, cancelable: true });
      el.dispatchEvent(e);
      all = all && e.defaultPrevented;
    }
    return all;
  }, [at.x, at.y] as [number, number]);
  await page.waitForTimeout(250);
  const ratio = w0 / (await width());
  const mmAfter = await toMm(at.x, at.y);
  if (Math.abs(ratio - Math.exp(0.5)) < 0.03) pass(`a pinch zooms as far as the fingers spread (×${ratio.toFixed(2)})`);
  else fail(`a pinch spreading ×${Math.exp(0.5).toFixed(2)} zoomed ×${ratio.toFixed(2)}`);
  if (Math.hypot(mmAfter.x - mmBefore.x, mmAfter.y - mmBefore.y) < 0.2) pass('about the point between the fingers');
  else fail(`the point under the pinch drifted ${Math.hypot(mmAfter.x - mmBefore.x, mmAfter.y - mmBefore.y).toFixed(2)} mm`);
  if (prevented) pass('and the page itself is not zoomed');
  else fail('a pinch on the canvas was left to zoom the page');

  // Safari: gesture events, whose scale is the spread since the start.
  const at2 = await toScreen(30, 90);
  const mm2 = await toMm(at2.x, at2.y);
  const w1 = await width();
  await page.evaluate(([x, y]) => {
    const el = document.querySelector('[data-panel-canvas]')!;
    const steps: Array<[string, number]> = [
      ['gesturestart', 1], ['gesturechange', 1.1], ['gesturechange', 1.25], ['gesturechange', 1.5], ['gestureend', 1.5],
    ];
    for (const [type, scale] of steps) {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(e, { scale: { value: scale }, clientX: { value: x }, clientY: { value: y } });
      el.dispatchEvent(e);
    }
  }, [at2.x, at2.y] as [number, number]);
  await page.waitForTimeout(250);
  const r2 = w1 / (await width());
  const mm2After = await toMm(at2.x, at2.y);
  if (Math.abs(r2 - 1.5) < 0.02 && Math.hypot(mm2After.x - mm2.x, mm2After.y - mm2.y) < 0.2) {
    pass(`a Safari pinch zooms the same way (×${r2.toFixed(2)}, about the fingers)`);
  } else fail(`a Safari pinch of ×1.5 zoomed ×${r2.toFixed(2)}, drifting ${Math.hypot(mm2After.x - mm2.x, mm2After.y - mm2.y).toFixed(2)} mm`);

  if (problems.length === 0) pass('no uncaught errors pinching');
  else fail(`pinching: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- moving around a zoomed-in panel ---
{
  const { page, problems } = await open();
  const svg = page.locator('[data-panel-canvas]');
  const viewBox = async () => (await svg.getAttribute('viewBox'))!.split(' ').map(Number);
  const toScreen = (mx: number, my: number) =>
    page.evaluate(([x, y]) => {
      const el = document.querySelector('[data-panel-canvas]') as SVGSVGElement;
      const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM()!);
      return { x: p.x, y: p.y };
    }, [mx, my] as [number, number]);
  const toMm = (sx: number, sy: number) =>
    page.evaluate(([x, y]) => {
      const el = document.querySelector('[data-panel-canvas]') as SVGSVGElement;
      const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM()!.inverse());
      return { x: p.x, y: p.y };
    }, [sx, sy] as [number, number]);

  // Something to grab, so Space can be shown to pan over a part too.
  await page.getByRole('button', { name: 'Cutouts', exact: true }).click();
  await page.getByRole('button', { name: 'Circle', exact: true }).click();
  const jack = await toScreen(20, 60);
  await page.mouse.click(jack.x, jack.y);
  await page.waitForTimeout(200);
  const jackX = () => page.locator('[data-panel-canvas] circle:not([pointer-events="none"])').evaluateAll((els) =>
    els.map((e) => Number(e.getAttribute('cx'))).find((v) => Math.abs(v - 20) < 15));
  const cxBefore = await jackX();

  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '+', exact: true }).click();
  await page.waitForTimeout(200);

  // Zoom has to be about the pointer, or zooming in takes you away from
  // what you were looking at.
  const at = await toScreen(25, 40);
  const mmBefore = await toMm(at.x, at.y);
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Meta');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Meta');
  await page.waitForTimeout(250);
  const mmAfter = await toMm(at.x, at.y);
  if (Math.hypot(mmAfter.x - mmBefore.x, mmAfter.y - mmBefore.y) < 0.2) pass('Cmd-scroll zooms about the pointer');
  else fail(`the point under the pointer drifted by ${Math.hypot(mmAfter.x - mmBefore.x, mmAfter.y - mmBefore.y).toFixed(2)} mm`);

  // Plain scrolling moves the view.
  let v0 = await viewBox();
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(250);
  let v1 = await viewBox();
  if (v1[1] > v0[1] + 1 && Math.abs(v1[2] - v0[2]) < 1e-6) pass('scrolling moves around a zoomed-in panel');
  else fail(`scrolling: view box went from ${v0.join(' ')} to ${v1.join(' ')}`);

  // Cmd-drag on empty panel drags the view along with the pointer.
  const empty = await toScreen(30, 90);
  v0 = await viewBox();
  await page.mouse.move(empty.x, empty.y);
  await page.keyboard.down('Meta');
  await page.mouse.down();
  await page.mouse.move(empty.x + 120, empty.y + 60, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Meta');
  await page.waitForTimeout(250);
  v1 = await viewBox();
  const grabbed = await toMm(empty.x + 120, empty.y + 60);
  if (v1[0] < v0[0] - 1 && v1[1] < v0[1] - 1 && Math.hypot(grabbed.x - 30, grabbed.y - 90) < 0.5) {
    pass('Cmd-drag on the panel moves the view, keeping the grabbed spot under the pointer');
  } else {
    fail(`Cmd-drag: view box ${v0.join(' ')} -> ${v1.join(' ')}, grabbed spot now at ${grabbed.x.toFixed(1)}, ${grabbed.y.toFixed(1)}`);
  }

  // Space-drag pans even when it starts on a part, and leaves the part be.
  const onJack = await toScreen(20, 60);
  v0 = await viewBox();
  await page.mouse.move(onJack.x, onJack.y);
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(onJack.x - 80, onJack.y - 40, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await page.waitForTimeout(250);
  v1 = await viewBox();
  if (v1[0] > v0[0] + 1 && cxBefore !== undefined && (await jackX()) === cxBefore) pass('Space-drag pans from on top of a part without moving it');
  else fail(`Space-drag: view box ${v0.join(' ')} -> ${v1.join(' ')}, cutout at ${await jackX()} (was ${cxBefore})`);

  // However far it is pushed, some of the panel stays in view.
  for (let i = 0; i < 40; i++) await page.mouse.wheel(4000, 4000);
  await page.waitForTimeout(250);
  const far = await viewBox();
  if (far[0] < 40.3 && far[1] < 128.5) pass('the panel cannot be scrolled out of sight');
  else fail(`after scrolling far away the view box is ${far.join(' ')}`);

  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await page.waitForTimeout(200);
  const fit = await viewBox();
  if (fit[0] === -8 && fit[1] === -8) pass('Fit brings it back');
  else fail(`Fit left the view box at ${fit.join(' ')}`);

  if (problems.length === 0) pass('no uncaught errors moving around the canvas');
  else fail(`moving around: ${[...new Set(problems)].join(' | ')}`);
  await page.close();
}

// --- a new panel starts dark ---
{
  const { page, problems } = await open();
  const fill = await page.locator('[data-panel-canvas] rect[fill="#121418"]').count();
  if (fill > 0) pass('a new panel starts on the dark colour');
  else fail('a new panel did not start dark');
  if (problems.length === 0) pass('no uncaught errors opening a new panel');
  else fail(`new panel: ${[...new Set(problems)].join(' | ')}`);
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
  if (controls.length === 3) pass('a panel in the rack offers zoom, edit and remove');
  else fail(`found ${controls.length} controls on the panel, expected 3`);
  if (controls.every((c) => c.w >= 24 && c.h >= 24)) pass('and they are big enough to hit');
  else fail(`controls measure ${controls.map((c) => `${c.w}x${c.h}`).join(', ')}`);
  // They must not hang over the neighbouring panel, whose controls they are not.
  if (controls.every((c) => c.inside)) pass('and stay on the panel they belong to');
  else fail('a control overhangs its panel');

  // The zoom button shows the panel large, to read it without opening it.
  const peek = page.locator('[data-rack-peek="Rack me"]');
  const small = (await panel.boundingBox())!;
  await page.locator('button[aria-label^="Zoom in on Rack me"]').click();
  await page.waitForTimeout(200);
  const big = await peek.locator('svg').boundingBox();
  if (big && big.height > small.height * 1.5) {
    pass(`the zoom button shows the panel zoomed in (${Math.round(small.height)} → ${Math.round(big.height)} px tall)`);
  } else fail(`the zoom button did not zoom in (${big ? Math.round(big.height) : 'nothing'} shown)`);
  await page.mouse.click(5, 5);
  await page.waitForTimeout(150);
  if ((await peek.count()) === 0) pass('and a click closes it');
  else { fail('a click left the zoomed view open'); await page.keyboard.press('Escape'); }
  await panel.hover();
  await page.waitForTimeout(250);
  await page.locator('button[aria-label^="Zoom in on Rack me"]').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  if ((await peek.count()) === 0) pass('Esc closes it too');
  else fail('Esc left the zoomed view open');
  // Only the button: a Z key over a panel was taken out.
  await panel.hover();
  await page.keyboard.press('z');
  await page.waitForTimeout(150);
  if ((await page.locator('[data-rack-peek]').count()) === 0) pass('Z over a panel does nothing');
  else { fail('Z over a panel still opened a zoomed view'); await page.keyboard.press('Escape'); }

  // Double-clicking a panel opens it for editing; a single click must not,
  // since that is also how a drag starts.
  const box = (await panel.boundingBox())!;
  const at = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.7 };
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(500);
  if (/Add row/i.test(await page.locator('body').innerText())) pass('a single click leaves you in the rack');
  else fail('a single click on a rack panel left the rack');
  await page.mouse.dblclick(at.x, at.y);
  await page.waitForTimeout(500);
  const opened = !/Add row/i.test(await page.locator('body').innerText())
    && (await page.getByLabel('Panel name').inputValue()) === 'Rack me';
  if (opened) pass('double-clicking a panel in the rack opens it for editing');
  else fail('double-clicking a rack panel did not open it');
  await page.getByRole('button', { name: 'Rack', exact: true }).click();
  await page.waitForTimeout(400);
  await panel.hover();
  await page.waitForTimeout(250);

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

  // Hovering enlarges the shot, and the enlargement must not be able to get
  // in the way of anything: not the row it belongs to, not the canvas.
  await page.locator('aside li button').nth(1).hover();
  await page.waitForTimeout(700);
  const shot = await page.evaluate(() => {
    const pv = document.querySelector('[role="presentation"]');
    if (!pv) return null;
    const r = pv.getBoundingClientRect();
    const list = document.querySelector('aside ul')!.getBoundingClientRect();
    return {
      transparent: getComputedStyle(pv).pointerEvents === 'none',
      clearOfList: r.left >= list.right,
      onScreen: r.top >= 0 && r.bottom <= window.innerHeight,
      // Whatever is under its middle should be the page, not the preview.
      underneath: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.tagName ?? '',
      bigger: r.width > 200,
    };
  });
  if (shot) pass('hovering a result enlarges its panel shot');
  else fail('no preview appeared on hover');
  if (shot?.bigger && shot.clearOfList && shot.onScreen) pass('beside the list, in full, on screen');
  else fail(`preview sat wrong: ${JSON.stringify(shot)}`);
  if (shot?.transparent && shot.underneath !== '') pass('and the pointer goes straight through it');
  else fail('the preview intercepts the pointer');

  await page.locator('header').hover();
  await page.waitForTimeout(500);
  if ((await page.locator('[role="presentation"]').count()) === 0) pass('and it goes as soon as you look away');
  else fail('the preview stayed after the pointer left');

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
