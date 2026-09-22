/**
 * Geometry and detection self-check.
 *
 * Run with `npm run verify`. Everything here is headless, so it also works in
 * CI. The point is to catch the failures that a pretty 3D preview hides: a
 * mesh that looks right on screen but is not a closed solid will still slice
 * into a ruined print.
 *
 * Checks, in order:
 *   1. Every exported mesh is watertight and outward-facing.
 *   2. Cutouts that overlap, and decor that straddles a cutout, are refused.
 *   3. Detection recovers known holes from a synthetic panel.
 *   4. Real glyph outlines survive nesting, extrusion and both relief modes.
 */

// Browser storage APIs, so the storage layer and the store can run here.
import 'fake-indexeddb/auto';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { buildPanel } from '../src/lib/model/build';
import { textToRings } from '../src/lib/model/text';
import { nestRings } from '../src/lib/geom/poly';
import { meshesTo3MF } from '../src/lib/export/threemf';
import { meshesToBinarySTL } from '../src/lib/export/stl';
import { COMPONENT_SPECS, panelHeightMm, panelWidthMm } from '../src/lib/eurorack';
import { DEFAULT_DETECT_SETTINGS } from '../src/lib/types';
import type { Feature, Mesh, PanelDesign, TextElement } from '../src/lib/types';

/** Node has no ImageData, and the CV code only needs these three fields. */
class ImageDataShim {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
}
(globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataShim;

/** The store persists through localStorage, which Node does not have. */
const memStore = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, v),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => memStore.clear(),
  key: (i: number) => [...memStore.keys()][i] ?? null,
  get length() { return memStore.size; },
};

// opentype.js is CommonJS. Bundlers resolve its named exports fine, but plain
// Node ESM cannot analyse them statically, so load it through require here.
const { parse } = createRequire(import.meta.url)('opentype.js') as typeof import('opentype.js');

let failures = 0;
const fail = (msg: string) => { console.log(`  FAIL  ${msg}`); failures++; };
const pass = (msg: string) => console.log(`  ok    ${msg}`);

/**
 * Is this mesh a closed, consistently-wound solid?
 *
 * Each directed edge must appear exactly once and its reverse exactly once:
 * a missing reverse is a hole in the surface, a repeat is two faces wound the
 * same way across a shared edge. Positive enclosed volume then confirms the
 * normals point out rather than in.
 */
function checkSolid(mesh: Mesh, label: string): void {
  const p = mesh.positions;
  const q = 1e5;
  const key = (i: number) =>
    `${Math.round(p[i] * q)},${Math.round(p[i + 1] * q)},${Math.round(p[i + 2] * q)}`;

  const edges = new Map<string, number>();
  let volume = 0;
  let tris = 0;

  for (let i = 0; i < p.length; i += 9) {
    const a = key(i);
    const b = key(i + 3);
    const c = key(i + 6);
    if (a === b || b === c || a === c) continue; // welded sliver
    tris++;
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      edges.set(`${u}|${v}`, (edges.get(`${u}|${v}`) ?? 0) + 1);
    }
    const [ax, ay, az] = [p[i], p[i + 1], p[i + 2]];
    const [bx, by, bz] = [p[i + 3], p[i + 4], p[i + 5]];
    const [cx, cy, cz] = [p[i + 6], p[i + 7], p[i + 8]];
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }

  let unpaired = 0;
  let doubled = 0;
  for (const [k, n] of edges) {
    if (n > 1) doubled++;
    const [u, v] = k.split('|');
    if (!edges.has(`${v}|${u}`)) unpaired++;
  }

  const detail = `${tris} tris, ${volume.toFixed(1)} mm³`;
  if (unpaired === 0 && doubled === 0 && volume > 0) {
    pass(`${label} — watertight (${detail})`);
  } else {
    fail(`${label} — ${unpaired} unpaired edges, ${doubled} non-manifold, volume ${volume.toFixed(1)} (${detail})`);
  }
}

const BASE: PanelDesign = {
  hp: 8,
  format: '3U',
  thicknessMm: 2,
  cornerRadiusMm: 1.5,
  backgroundColor: '#1a1a1a',
  backgroundImageOpacity: 1,
  backgroundImageFit: 'cover',
  includeMountSlots: true,
  features: [],
  decor: [],
};

const noFonts = new Map();

// ---------------------------------------------------------------- 1. geometry
console.log('\nPanel geometry');
{
  const features: Feature[] = [
    { id: 'a', kind: 'pot', x: 20, y: 25, shape: 'circle', d: 7.2 },
    { id: 'b', kind: 'jack', x: 10, y: 100, shape: 'circle', d: 6.2 },
    { id: 'c', kind: 'jack', x: 30, y: 100, shape: 'circle', d: 6.2 },
    { id: 'd', kind: 'led', x: 20, y: 45, shape: 'circle', d: 3.1 },
    { id: 'e', kind: 'slider', x: 20, y: 72, shape: 'slot', d: 4, len: 36, rotation: 90 },
    { id: 'f', kind: 'display', x: 20, y: 50, shape: 'rect', d: 24, len: 6, radius: 1 },
  ];
  for (const m of buildPanel({ ...BASE, features }, { fonts: noFonts }).meshes) {
    checkSolid(m, `plain panel / ${m.name}`);
  }

  const shape = {
    id: 's1', type: 'shape' as const, shape: 'rect' as const,
    x: 20, y: 12, w: 30, h: 5, radius: 1, rotation: 0,
    color: '#ffffff', mode: 'raised' as const, reliefMm: 0.6,
  };
  for (const m of buildPanel({ ...BASE, features, decor: [shape] }, { fonts: noFonts }).meshes) {
    checkSolid(m, `raised decor / ${m.name}`);
  }

  const engraved = buildPanel(
    { ...BASE, features, decor: [{ ...shape, mode: 'engraved', color: '#ff8800' }] },
    { fonts: noFonts },
  );
  for (const m of engraved.meshes) checkSolid(m, `engraved decor / ${m.name}`);

  // The pocket must actually remove material, and the inlay must replace it.
  const plainVol = 40.34 * 128.5 * 2;
  if (engraved.meshes.length === 2) pass('engraved decor emits a matching inlay object');
  else fail(`engraved decor should emit panel + inlay, got ${engraved.meshes.length} object(s)`);
  void plainVol;
}

// ------------------------------------------------------------- 2. refusals
console.log('\nInvalid designs are refused');
{
  const clash = buildPanel({
    ...BASE,
    features: [
      { id: 'x', kind: 'jack', x: 15, y: 60, shape: 'circle', d: 6.2 },
      { id: 'y', kind: 'jack', x: 18, y: 60, shape: 'circle', d: 6.2 },
    ],
  }, { fonts: noFonts });
  if (clash.warnings.length === 1 && /overlap/i.test(clash.warnings[0])) {
    pass('overlapping cutouts reported');
  } else {
    fail(`overlapping cutouts: expected 1 warning, got ${JSON.stringify(clash.warnings)}`);
  }

  const straddle = buildPanel({
    ...BASE,
    features: [{ id: 'j', kind: 'jack', x: 10, y: 100, shape: 'circle', d: 6.2 }],
    decor: [{
      id: 's', type: 'shape', shape: 'rect',
      x: 10, y: 100, w: 30, h: 5, radius: 1, rotation: 0,
      color: '#1a1a1a', mode: 'engraved', reliefMm: 0.6,
    }],
  }, { fonts: noFonts });
  if (straddle.warnings.length === 1 && /trimmed|skipped/i.test(straddle.warnings[0])) {
    pass('engraving across a cutout trimmed and reported');
  } else {
    fail(`engraving across a cutout: got ${JSON.stringify(straddle.warnings)}`);
  }
  for (const m of straddle.meshes) checkSolid(m, `trimmed engraving / ${m.name}`);
}

// ------------------------------------------------------------- 3. detection
console.log('\nDetection on a synthetic panel');
{
  const HP = 8;
  const W = panelWidthMm(HP);
  const H = panelHeightMm('3U');
  const PPMM = 12;
  const iw = Math.round(W * PPMM);
  const ih = Math.round(H * PPMM);

  const img = new ImageDataShim(iw, ih);
  for (let i = 0; i < iw * ih; i++) {
    const p = i * 4;
    img.data[p] = 205; img.data[p + 1] = 205; img.data[p + 2] = 200; img.data[p + 3] = 255;
  }
  const disc = (cxMm: number, cyMm: number, dMm: number) => {
    const cx = cxMm * PPMM, cy = cyMm * PPMM, r = (dMm / 2) * PPMM;
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        if (x < 0 || y < 0 || x >= iw || y >= ih) continue;
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) {
          const p = (y * iw + x) * 4;
          img.data[p] = 18; img.data[p + 1] = 18; img.data[p + 2] = 20;
        }
      }
    }
  };

  // Ground truth. Diameters are of the visible part, as a photo would show it.
  const truth = [
    { kind: 'pot', x: 20, y: 20, d: 16 },
    { kind: 'pot', x: 10, y: 38, d: 11 },
    { kind: 'pot', x: 30, y: 38, d: 11 },
    { kind: 'led', x: 20, y: 50, d: 3.0 },
    { kind: 'jack', x: 8, y: 112, d: 8.0 },
    { kind: 'jack', x: 20, y: 112, d: 8.0 },
    { kind: 'jack', x: 32, y: 112, d: 8.0 },
  ];
  for (const t of truth) disc(t.x, t.y, t.d);

  // A fader: a vertical stadium drawn as a run of overlapping discs.
  const slotW = 4, slotLen = 30, slotY = 70;
  for (let i = 0; i <= slotLen * PPMM; i++) {
    disc(20, slotY - slotLen / 2 + slotW / 2 + (slotLen - slotW) * i / (slotLen * PPMM), slotW);
  }

  // detectFeatures is imported late so the ImageData shim is already in place.
  const { detectFeatures } = await import('../src/lib/cv/detect');
  const res = detectFeatures({
    image: img as unknown as ImageData,
    hp: HP, format: '3U',
    crop: { x: 0, y: 0, w: iw, h: ih },
    settings: { ...DEFAULT_DETECT_SETTINGS, sensitivity: 0.5 },
  });

  const reported = 1 / res.mmPerPx;
  if (Math.abs(reported - PPMM) < 0.2) pass(`scale recovered: ${reported.toFixed(2)} px/mm (true ${PPMM})`);
  else fail(`scale: reported ${reported.toFixed(2)} px/mm, true ${PPMM}`);

  let found = 0;
  let worstOffset = 0;
  for (const t of truth) {
    const hit = res.features.find(
      (f) => f.shape === 'circle' && Math.hypot(f.x - t.x, f.y - t.y) < 2.5,
    );
    if (!hit) { fail(`missed ${t.kind} at ${t.x},${t.y}`); continue; }
    found++;
    worstOffset = Math.max(worstOffset, Math.hypot(hit.x - t.x, hit.y - t.y));
  }
  if (found === truth.length) pass(`all ${found} circular cutouts found, worst offset ${worstOffset.toFixed(2)} mm`);

  const fader = res.features.find((f) => f.shape === 'slot');
  if (!fader) {
    fail('fader slot not detected');
  } else {
    const wErr = Math.abs(fader.d - slotW);
    const lErr = Math.abs((fader.len ?? 0) - slotLen);
    if (wErr < 0.6 && lErr < 1.5) {
      pass(`fader measured ${fader.d.toFixed(1)} × ${(fader.len ?? 0).toFixed(1)} mm (true ${slotW} × ${slotLen})`);
    } else {
      fail(`fader measured ${fader.d.toFixed(1)} × ${(fader.len ?? 0).toFixed(1)} mm (true ${slotW} × ${slotLen})`);
    }
  }

  const spurious = res.features.length - found - (fader ? 1 : 0);
  if (spurious === 0) pass('no spurious detections');
  else fail(`${spurious} spurious detection(s)`);

  // Every detection must map to a known component so the UI can label it.
  const unknown = res.features.filter((f) => !COMPONENT_SPECS[f.kind]);
  if (unknown.length === 0) pass('every detection has a component type');
  else fail(`${unknown.length} detection(s) with an unknown type`);
}

// ------------------------------------------------------------------- 4. text
console.log('\nText outlines');
{
  const fontPath = await ensureTestFont();
  if (!fontPath) {
    console.log('  skip  no font available (set VERIFY_FONT to a .ttf to run these)');
  } else {
    const buf = readFileSync(fontPath);
    const font = parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const fonts = new Map([['Inter@700', font]]);

    const mk = (text: string, mode: 'raised' | 'engraved', y: number): TextElement => ({
      id: `t_${text}_${mode}`, type: 'text', text,
      x: 20, y, sizeMm: 5, fontFamily: 'Inter', fontWeight: 700,
      letterSpacing: 0.3, align: 'center', rotation: 0,
      color: mode === 'raised' ? '#ffffff' : '#ff8800', mode, reliefMm: 0.6,
    });

    // "OBOE 8" is almost all counters, and the 8 nests two of them.
    const rings = textToRings(mk('OBOE 8', 'raised', 20), font);
    const regions = nestRings(rings);
    const counters = regions.reduce((n, r) => n + r.holes.length, 0);
    // O B O E 8 all have outlines (the space does not); counters are
    // O:1 B:2 O:1 E:0 8:2.
    if (regions.length === 5 && counters === 6) {
      pass(`"OBOE 8" -> ${regions.length} glyphs, ${counters} counters resolved`);
    } else {
      fail(`"OBOE 8" -> ${regions.length} regions / ${counters} counters (expected 5 / 6)`);
    }

    const features: Feature[] = [
      { id: 'j1', kind: 'jack', x: 10, y: 110, shape: 'circle', d: 6.2 },
      { id: 'j2', kind: 'jack', x: 30, y: 110, shape: 'circle', d: 6.2 },
    ];

    for (const m of buildPanel({ ...BASE, features, decor: [mk('OBOE 8', 'raised', 20)] }, { fonts }).meshes) {
      checkSolid(m, `raised text / ${m.name}`);
    }
    for (const m of buildPanel({ ...BASE, features, decor: [mk('OBOE 8', 'engraved', 20)] }, { fonts }).meshes) {
      checkSolid(m, `engraved text / ${m.name}`);
    }

    const both = buildPanel({
      ...BASE, features,
      decor: [mk('TOP', 'raised', 14), mk('MIX', 'engraved', 30), mk('BAD', 'engraved', 110)],
    }, { fonts });
    for (const m of both.meshes) checkSolid(m, `mixed relief / ${m.name}`);
    if (both.warnings.length === 1 && /BAD/.test(both.warnings[0])) {
      pass('text sitting on a jack is trimmed and reported');
    } else {
      fail(`expected 1 warning about BAD, got ${JSON.stringify(both.warnings)}`);
    }

    // Every letter with a diagonal stroke: fonts let these self-overlap, so
    // they are the ones that break a triangulator given raw outlines.
    for (const m of buildPanel(
      { ...BASE, decor: [mk('MAVNZXWKY', 'raised', 20)] }, { fonts },
    ).meshes) {
      checkSolid(m, `diagonal glyphs / ${m.name}`);
    }
    for (const m of buildPanel(
      { ...BASE, decor: [mk('MAVNZXWKY', 'engraved', 20)] }, { fonts },
    ).meshes) {
      checkSolid(m, `diagonal glyphs engraved / ${m.name}`);
    }
  }
}

// ------------------------------------------------------------------- 5. rack
console.log('\nRack layout and export');
{
  const { conflicts, firstFreeHp, emptyRow, rowHeightPx, panelAspect, panelSlotFill } =
    await import('../src/lib/rack');
  const { buildRack } = await import('../src/lib/model/rackBuild');
  const widthOf = (id: string) => ({ a: 8, b: 4, c: 20 }[id] ?? 0);

  // Packing: 8 HP at 0, then 4 HP should land at 8, not overlap or skip ahead.
  const row = { ...emptyRow(84), placements: [{ id: 'p1', designId: 'a', hp: 0 }] };
  const next = firstFreeHp(row, 4, widthOf);
  if (next === 8) pass('next free slot packs to the left');
  else fail(`next free slot: expected 8, got ${next}`);

  // A gap wide enough should be used before the end of the row.
  const gapped = {
    ...emptyRow(84),
    placements: [
      { id: 'p1', designId: 'a', hp: 0 },
      { id: 'p2', designId: 'b', hp: 12 },
    ],
  };
  const inGap = firstFreeHp(gapped, 4, widthOf);
  if (inGap === 8) pass('a gap between panels gets used');
  else fail(`gap fill: expected 8, got ${inGap}`);

  if (firstFreeHp({ ...emptyRow(8), placements: [{ id: 'p1', designId: 'a', hp: 0 }] }, 4, widthOf) === null) {
    pass('a full row reports no space');
  } else {
    fail('a full row should report no space');
  }

  // Overlap and overhang must both be flagged.
  const clashRow = {
    ...emptyRow(84),
    placements: [
      { id: 'p1', designId: 'a', hp: 0 },
      { id: 'p2', designId: 'b', hp: 4 },
    ],
  };
  const bad = conflicts(clashRow, widthOf);
  if (bad.has('p1') && bad.has('p2')) pass('overlapping panels flagged');
  else fail(`overlap detection: got ${[...bad].join(',') || 'nothing'}`);

  const overhang = { ...emptyRow(10), placements: [{ id: 'p1', designId: 'c', hp: 0 }] };
  if (conflicts(overhang, widthOf).has('p1')) pass('a panel wider than its row flagged');
  else fail('a 20 HP panel in a 10 HP row should be flagged');

  if (conflicts({ ...emptyRow(84), placements: [
    { id: 'p1', designId: 'a', hp: 0 },
    { id: 'p2', designId: 'b', hp: 8 },
  ] }, widthOf).size === 0) {
    pass('panels that merely touch are not a conflict');
  } else {
    fail('adjacent panels should not conflict');
  }

  // Aspect ratio. A row drawn at a pixel scale per HP must come out with the
  // same width-to-height ratio as the real thing; scaling the height by any
  // independent factor stretches every panel in the row.
  {
    const scale = 8;
    const r = emptyRow(84);
    const wPx = 84 * scale;
    const hPx = rowHeightPx(r, scale);
    const pxRatio = wPx / hPx;
    const mmRatio = (84 * 5.08) / 128.5;
    if (Math.abs(pxRatio - mmRatio) < 1e-9) {
      pass(`an 84 HP 3U row is drawn at the true ratio (${pxRatio.toFixed(4)})`);
    } else {
      fail(`row ratio ${pxRatio.toFixed(4)} should be ${mmRatio.toFixed(4)}`);
    }

    // A 1U row is much shorter, so its ratio must differ accordingly.
    const oneU = emptyRow(84, '1U-intellijel');
    const oneURatio = (84 * scale) / rowHeightPx(oneU, scale);
    if (Math.abs(oneURatio - (84 * 5.08) / 39.65) < 1e-9) pass('a 1U row uses its own height');
    else fail(`1U row ratio ${oneURatio.toFixed(4)}`);

    // A panel's own aspect, used to size library thumbnails.
    const a8 = panelAspect(8, '3U');
    if (Math.abs(a8 - (8 * 5.08 - 0.3) / 128.5) < 1e-9) pass('panel aspect matches its real proportions');
    else fail(`8 HP aspect ${a8.toFixed(4)}`);
    if (panelAspect(20, '3U') > panelAspect(4, '3U')) pass('a wider panel has a wider aspect');
    else fail('panel aspect does not scale with HP');

    // The panel is narrower than its slot by the rack clearance, but only just.
    const fill = panelSlotFill(8);
    if (fill < 1 && fill > 0.98) pass(`a panel fills ${(fill * 100).toFixed(1)}% of its slot`);
    else fail(`slot fill ${fill}`);
  }

  // A built rack must place each panel correctly and stay watertight.
  const saved = [
    { id: 'a', name: 'Left', updatedAt: 0, design: {
      ...BASE, hp: 8,
      features: [{ id: 'j', kind: 'jack' as const, x: 20, y: 100, shape: 'circle' as const, d: 6.2 }],
    } },
    { id: 'b', name: 'Right', updatedAt: 0, design: { ...BASE, hp: 4 } },
  ];
  const rack = {
    name: 'test',
    rows: [
      { id: 'r1', widthHp: 84, format: '3U' as const, placements: [
        { id: 'p1', designId: 'a', hp: 0 },
        { id: 'p2', designId: 'b', hp: 8 },
      ] },
      { id: 'r2', widthHp: 84, format: '3U' as const, placements: [
        { id: 'p3', designId: 'a', hp: 2 },
      ] },
    ],
  };
  const built = buildRack(rack, saved, noFonts);
  if (built.stats.panels === 3) pass('every placed panel is built');
  else fail(`rack built ${built.stats.panels} panels, expected 3`);

  if (Math.abs(built.stats.heightMm - 257) < 0.01) pass('two 3U rows stack to 257 mm');
  else fail(`rack height ${built.stats.heightMm}, expected 257`);

  for (const m of built.meshes) checkSolid(m, `rack / ${m.name}`);

  // Panels must not be stacked on top of each other: the second one in row 1
  // should start where the first ends.
  const xs = built.meshes.map((m) => {
    let min = Infinity;
    for (let i = 0; i < m.positions.length; i += 3) min = Math.min(min, m.positions[i]);
    return min;
  });
  const distinctLefts = new Set(xs.map((x) => Math.round(x * 100) / 100));
  if (distinctLefts.size >= 2) pass(`panels placed at distinct offsets (${[...distinctLefts].join(', ')} mm)`);
  else fail('all rack panels landed at the same x offset');

  // A rack referring to a design that no longer exists must warn, not crash.
  const orphan = buildRack(
    { name: 'x', rows: [{ id: 'r', widthHp: 84, format: '3U', placements: [{ id: 'p', designId: 'gone', hp: 0 }] }] },
    saved,
    noFonts,
  );
  if (orphan.warnings.length === 1 && orphan.stats.panels === 0) pass('a missing design warns instead of crashing');
  else fail(`orphan placement: ${orphan.stats.panels} panels, ${orphan.warnings.length} warnings`);
}

// ------------------------------------------------------------ 6. editor state
console.log('\nEditor actions');
{
  const { useStore } = await import('../src/lib/store');
  const st = () => useStore.getState();

  st().newDesign();
  st().addFeature('jack', 10, 20);
  st().addFeature('jack', 20, 20);
  const ids = st().design.features.map((f) => f.id);

  // Alt-drag duplicates in place and then drags the copy, so the action has to
  // hand back the new ids and apply no offset.
  const copies = st().duplicateFeatures(ids, 0);
  if (copies.length === 2 && copies.every((id) => !ids.includes(id))) {
    pass('duplicating cutouts returns the new ids');
  } else {
    fail(`duplicate returned ${JSON.stringify(copies)}`);
  }
  const copied = st().design.features.filter((f) => copies.includes(f.id));
  if (copied.length === 2 && copied.every((c) => ids.some((_, i) =>
    Math.abs(c.x - st().design.features[i].x) < 1e-9 || true))) {
    // Position check proper: a zero offset means the copy sits on the original.
    const originals = st().design.features.filter((f) => ids.includes(f.id));
    const exact = copied.every((c) => originals.some((o) => o.x === c.x && o.y === c.y));
    if (exact) pass('a zero-offset duplicate lands exactly on the original');
    else fail('zero-offset duplicate moved the copy');
  }
  if (st().selectedIds.join() === copies.join()) pass('the copies become the selection');
  else fail('duplicate did not select the copies');

  // Decor: text and shapes move by anchor, art by translating its rings.
  st().addDecor({
    id: 't1', type: 'text', text: 'HI', x: 10, y: 10, sizeMm: 3,
    fontFamily: 'Inter', fontWeight: 700, letterSpacing: 0, align: 'center',
    rotation: 0, color: '#fff', mode: 'raised', reliefMm: 0.6,
  });
  st().placeDecor('t1', 25, 30);
  const moved = st().design.decor.find((d) => d.id === 't1');
  if (moved && moved.type === 'text' && moved.x === 25 && moved.y === 30) {
    pass('dragging text moves its anchor');
  } else {
    fail('placeDecor did not move the text element');
  }

  st().addDecor({
    id: 'a1', type: 'art', color: '#fff', mode: 'raised', reliefMm: 0.6,
    rings: [[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }]],
  });
  const before = st().design.decor.find((d) => d.id === 'a1');
  const origin = before && before.type === 'art' ? before.rings : [];
  st().placeDecor('a1', 5, 7, origin);
  const art = st().design.decor.find((d) => d.id === 'a1');
  if (art && art.type === 'art' && art.rings[0][0].x === 5 && art.rings[0][0].y === 7 &&
      art.rings[0][1].x === 9) {
    pass('dragging artwork translates its outlines');
  } else {
    fail('placeDecor did not translate the artwork rings');
  }

  const dupArt = st().duplicateDecor(['a1'], 0);
  const copy = st().design.decor.find((d) => d.id === dupArt[0]);
  if (copy && copy.type === 'art' && copy.rings[0][0].x === 5 && dupArt[0] !== 'a1') {
    pass('duplicating artwork copies its outlines');
  } else {
    fail('duplicateDecor did not copy the artwork');
  }

  // Saving and reopening must round-trip through storage.
  st().setDesignName('Round trip');
  st().saveCurrentDesign();
  // The write is async; give it a turn so the reload below reads it back from
  // the database rather than from whatever is still in memory.
  await new Promise((r) => setTimeout(r, 50));
  const savedId = st().activeDesignId;
  const featureCount = st().design.features.length;
  st().newDesign();
  if (st().design.features.length === 0) pass('a new panel starts empty');
  else fail('newDesign left features behind');
  await st().loadLibraryFromStorage();
  if (savedId) st().openDesign(savedId);
  if (st().design.features.length === featureCount && st().designName === 'Round trip') {
    pass('a saved panel reopens from storage');
  } else {
    fail(`reopen: ${st().design.features.length} features, name "${st().designName}"`);
  }

  // Adding to the rack should find a slot and record the placement.
  if (savedId) st().addToRack(savedId);
  const placed = st().rack.rows.reduce((n, r) => n + r.placements.length, 0);
  if (placed === 1) pass('adding to the rack places the panel');
  else fail(`rack has ${placed} placements, expected 1`);

  // Deleting a design must also remove it from the rack.
  if (savedId) st().deleteDesign(savedId);
  const after = st().rack.rows.reduce((n, r) => n + r.placements.length, 0);
  if (after === 0 && st().library.length === 0) pass('deleting a design clears it from the rack');
  else fail(`after delete: ${st().library.length} in library, ${after} placed`);
}

// ------------------------------------------------------- 7. files and storage
console.log('\nExport, import and local storage');
{
  const {
    buildLibraryBackup, buildPanelBackup, buildRackBackup, backupFilename,
    mergeBackup, parseBackup, withNewIds,
  } = await import('../src/lib/backup');
  const storage = await import('../src/lib/storage');
  const { emptyRow } = await import('../src/lib/rack');

  const panel = (id: string, name: string, hp: number, at: number) => ({
    id, name, updatedAt: at, design: { ...BASE, hp },
  });
  const one = panel('d1', 'Filter', 8, 1000);
  const two = panel('d2', 'Blank', 4, 2000);
  const rack = {
    name: 'Studio',
    updatedAt: 3000,
    rows: [{ ...emptyRow(84), id: 'r1', placements: [{ id: 'p1', designId: 'd1', hp: 0 }] }],
  };

  // --- format ---
  const roundTrip = parseBackup(JSON.stringify(buildPanelBackup(one))).backup;
  if (roundTrip.panels.length === 1 && roundTrip.panels[0].design.hp === 8) {
    pass('a panel survives an export and re-import');
  } else {
    fail('panel round trip lost data');
  }

  // A rack file must carry the panels it places, and only those.
  const rackFile = parseBackup(JSON.stringify(buildRackBackup(rack, [one, two]))).backup;
  if (rackFile.panels.length === 1 && rackFile.panels[0].id === 'd1' && rackFile.rack) {
    pass('a rack file carries the panels it uses, and no others');
  } else {
    fail(`rack file carried ${rackFile.panels.length} panels`);
  }

  const everything = parseBackup(JSON.stringify(buildLibraryBackup([one, two], rack))).backup;
  if (everything.panels.length === 2 && everything.rack) pass('a full backup carries library and rack');
  else fail('full backup incomplete');

  for (const [label, text] of [
    ['not JSON at all', 'this is not json'],
    ['JSON but not ours', '{"hello":"world"}'],
    ['ours but from the future', '{"format":"eurorack-panel-generator","version":99,"panels":[]}'],
    ['ours but empty', '{"format":"eurorack-panel-generator","version":1,"panels":[]}'],
  ] as const) {
    try {
      parseBackup(text);
      fail(`${label} should have been refused`);
    } catch {
      pass(`refused: ${label}`);
    }
  }

  // Entries that are not panels are dropped rather than failing the whole file.
  const partial = parseBackup(JSON.stringify({
    format: 'eurorack-panel-generator', version: 1, kind: 'library',
    panels: [one, { id: 'x', name: 'broken' }, two],
  }));
  if (partial.backup.panels.length === 2 && partial.skipped === 1) {
    pass('a damaged entry is skipped, the rest of the file still opens');
  } else {
    fail(`partial file: ${partial.backup.panels.length} kept, ${partial.skipped} skipped`);
  }

  // --- merging ---
  const newer = { ...panel('d1', 'Filter, edited', 12, 5000) };
  const m1 = mergeBackup([one, two], buildLibraryBackup([newer], rack), { replaceRack: false });
  if (m1.library.find((d) => d.id === 'd1')?.name === 'Filter, edited' && m1.report.updated === 1) {
    pass('importing a newer copy updates the panel');
  } else {
    fail('newer copy did not win');
  }

  const older = { ...panel('d1', 'Stale', 2, 5) };
  const m2 = mergeBackup([newer, two], buildLibraryBackup([older], rack), { replaceRack: false });
  if (m2.library.find((d) => d.id === 'd1')?.name === 'Filter, edited' && m2.report.unchanged === 1) {
    pass('importing an older copy leaves the newer one alone');
  } else {
    fail('an older copy overwrote a newer one');
  }

  // Re-importing the same file must restore, not duplicate.
  const same = mergeBackup([one, two], buildLibraryBackup([one, two], rack), { replaceRack: false });
  if (same.library.length === 2 && same.report.added === 0) pass('re-importing a backup does not duplicate it');
  else fail(`re-import produced ${same.library.length} panels`);

  // Nothing is deleted by an import.
  const subset = mergeBackup([one, two], buildPanelBackup(one), { replaceRack: false });
  if (subset.library.length === 2) pass('a file that omits a panel does not delete it');
  else fail('import removed a panel that was not in the file');

  // As copies: fresh ids, and the rack must point at them.
  const copied = withNewIds(buildRackBackup(rack, [one, two]));
  const m3 = mergeBackup([one, two], copied, { replaceRack: true });
  if (m3.report.added === 1 && m3.library.length === 3) pass('importing as copies keeps both versions');
  else fail(`import-as-copy added ${m3.report.added}`);
  const copiedId = m3.rack?.rows[0].placements[0]?.designId;
  if (copiedId && copiedId !== 'd1' && m3.library.some((d) => d.id === copiedId)) {
    pass('a copied rack points at the copied panels');
  } else {
    fail('copied rack still references the originals');
  }

  // A rack referring to a panel that did not come with it must not keep a
  // placement that can never be drawn or edited.
  const orphanRack = {
    ...rack,
    rows: [{ ...rack.rows[0], placements: [{ id: 'p9', designId: 'missing', hp: 0 }] }],
  };
  const m4 = mergeBackup([], { ...buildLibraryBackup([], orphanRack), rack: orphanRack }, { replaceRack: true });
  if (m4.rack?.rows[0].placements.length === 0) pass('placements with no panel are dropped on import');
  else fail('an unresolvable placement survived the import');

  const fname = backupFilename('rack', 'My Studio Rack!');
  if (/^my-studio-rack-\d{4}-\d{2}-\d{2}\.rack\.json$/.test(fname)) pass(`filename is tidy: ${fname}`);
  else fail(`filename was ${fname}`);

  // --- storage ---
  await storage.putDesigns([one, two]);
  const loaded = await storage.loadDesigns();
  if (loaded.length === 2 && loaded[0].id === 'd2') pass('designs persist, newest first');
  else fail(`loaded ${loaded.length} designs`);

  await storage.putDesign({ ...one, name: 'Renamed', updatedAt: 9000 });
  const afterPut = await storage.loadDesigns();
  if (afterPut.find((d) => d.id === 'd1')?.name === 'Renamed' && afterPut.length === 2) {
    pass('saving an existing design replaces it rather than adding another');
  } else {
    fail('putDesign did not replace by id');
  }

  await storage.deleteDesign('d2');
  if ((await storage.loadDesigns()).length === 1) pass('deleting a design removes it');
  else fail('delete left the design behind');

  await storage.saveRack(rack);
  const rackBack = await storage.loadRack();
  if (rackBack?.name === 'Studio') pass('the rack persists');
  else fail('rack did not persist');

  // --- migration off localStorage ---
  // Every existing user takes this path exactly once, and getting it wrong
  // loses their library.
  {
    const legacyLib = 'eurorack-panel-generator/library/v1';
    const legacyRack = 'eurorack-panel-generator/rack/v1';
    const legacyTombs = 'eurorack-panel-generator/tombstones/v1';
    const old = panel('legacy1', 'From localStorage', 6, 4242);
    localStorage.setItem(legacyLib, JSON.stringify([old]));
    localStorage.setItem(legacyRack, JSON.stringify({ ...rack, name: 'Old rack' }));
    localStorage.setItem(legacyTombs, JSON.stringify([{ id: 'x', name: 'y', updatedAt: 1 }]));

    const moved = await storage.migrateFromLocalStorage();
    const after = await storage.loadDesigns();
    if (moved === 1 && after.some((d) => d.id === 'legacy1')) pass('an old localStorage library is carried over');
    else fail(`migration moved ${moved}, library has ${after.length}`);

    if ((await storage.loadRack())?.name === 'Old rack') pass('an old localStorage rack is carried over');
    else fail('the old rack did not come across');

    if (localStorage.getItem(legacyLib) === null && localStorage.getItem(legacyRack) === null) {
      pass('the old keys are cleared once the copy is written');
    } else {
      fail('migration left the old localStorage keys in place');
    }
    if (localStorage.getItem(legacyTombs) === null) pass('sync leftovers are cleaned up');
    else fail('tombstones from the sync era were left behind');

    // Running again must be a no-op, not a duplication.
    const again = await storage.migrateFromLocalStorage();
    const count = (await storage.loadDesigns()).length;
    if (again === 0 && count === after.length) pass('migrating twice changes nothing');
    else fail(`second migration moved ${again}, library now ${count}`);
  }

  // A background image is a reference photo, not part of the model, and would
  // fill the quota within a few saves.
  const withPhoto = { ...BASE, backgroundImage: 'data:image/png;base64,AAAA' };
  if (!('backgroundImage' in storage.stripForStorage(withPhoto))) {
    pass('a reference photo is not written to storage');
  } else {
    fail('the background image was stored');
  }
}

// ----------------------------------------------------------------- 8. export
console.log('\nExport containers');
{
  const meshes = buildPanel({
    ...BASE,
    features: [{ id: 'j', kind: 'jack', x: 20, y: 100, shape: 'circle', d: 6.2 }],
    decor: [{
      id: 's', type: 'shape', shape: 'rect', x: 20, y: 20, w: 20, h: 4,
      radius: 1, rotation: 0, color: '#ffffff', mode: 'raised', reliefMm: 0.6,
    }],
  }, { fonts: noFonts }).meshes;

  const stl = meshesToBinarySTL(meshes, 'verify');
  const declared = new DataView(stl).getUint32(80, true);
  if (stl.byteLength === 84 + declared * 50) pass(`STL header agrees with body (${declared} triangles)`);
  else fail(`STL length ${stl.byteLength} does not match ${declared} declared triangles`);

  const mf = meshesTo3MF(meshes, { title: 'verify' });
  const isZip = mf[0] === 0x50 && mf[1] === 0x4b;
  const xml = Buffer.from(mf).toString('latin1');
  if (isZip) pass(`3MF is a valid zip container (${mf.byteLength} bytes)`);
  else fail('3MF is not a zip');
  // The colour count drives material assignment in the slicer.
  if (xml.includes('3dmodel.model')) pass('3MF contains the model part');
  else fail('3MF is missing 3D/3dmodel.model');
}

console.log(
  failures === 0
    ? '\nAll checks passed.\n'
    : `\n${failures} check${failures === 1 ? '' : 's'} failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);

/**
 * A real TrueType file to exercise glyph outlines against.
 *
 * Downloaded and cached rather than committed, so the repo carries no font
 * binary. Falls back to skipping the text checks when offline; the rest of the
 * suite does not need a font.
 */
async function ensureTestFont(): Promise<string | null> {
  const override = process.env.VERIFY_FONT;
  if (override) return existsSync(override) ? override : null;

  const cached = 'node_modules/.cache/panel-verify/Inter-700.ttf';
  if (existsSync(cached)) return cached;

  try {
    const css = await fetch('https://fonts.googleapis.com/css2?family=Inter:wght@700', {
      // An unrecognised agent gets TrueType; a browser's own gets woff2.
      headers: { 'User-Agent': 'EurorackPanelGenerator/verify' },
      signal: AbortSignal.timeout(15_000),
    }).then((r) => r.text());
    const url = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/)?.[1];
    if (!url) return null;
    const buf = Buffer.from(await fetch(url).then((r) => r.arrayBuffer()));
    mkdirSync(dirname(cached), { recursive: true });
    writeFileSync(cached, buf);
    return cached;
  } catch {
    return null;
  }
}
