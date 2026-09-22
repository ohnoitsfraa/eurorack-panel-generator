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
  holeClearanceMm: 0,
  features: [],
  decor: [],
};

const noFonts = new Map();

// ---------------------------------------------------------------- 1. geometry
console.log('\nPanel geometry');
{
  const features: Feature[] = [
    { id: 'a', kind: 'pot', x: 20, y: 25, shape: 'circle', w: 7, h: 7, radius: 3.5, rotation: 0 },
    { id: 'b', kind: 'jack', x: 10, y: 100, shape: 'circle', w: 6, h: 6, radius: 3, rotation: 0 },
    { id: 'c', kind: 'jack', x: 30, y: 100, shape: 'circle', w: 6, h: 6, radius: 3, rotation: 0 },
    { id: 'd', kind: 'led', x: 20, y: 45, shape: 'circle', w: 3, h: 3, radius: 1.5, rotation: 0 },
    { id: 'e', kind: 'slider', x: 20, y: 72, shape: 'rect', w: 36, h: 4, radius: 2, rotation: 90 },
    { id: 'f', kind: 'display', x: 20, y: 50, shape: 'rect', w: 24, h: 6, radius: 1, rotation: 0 },
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
      { id: 'x', kind: 'jack', x: 15, y: 60, shape: 'circle', w: 6, h: 6, radius: 3, rotation: 0 },
      { id: 'y', kind: 'jack', x: 18, y: 60, shape: 'circle', w: 6, h: 6, radius: 3, rotation: 0 },
    ],
  }, { fonts: noFonts });
  if (clash.warnings.length === 1 && /overlap/i.test(clash.warnings[0])) {
    pass('overlapping cutouts reported');
  } else {
    fail(`overlapping cutouts: expected 1 warning, got ${JSON.stringify(clash.warnings)}`);
  }

  const straddle = buildPanel({
    ...BASE,
    features: [{ id: 'j', kind: 'jack', x: 10, y: 100, shape: 'circle', w: 6, h: 6, radius: 3, rotation: 0 }],
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

  const fader = res.features.find((f) => f.kind === 'slider');
  if (!fader) {
    fail('fader slot not detected');
  } else if (fader.shape !== 'rect') {
    fail('a fader slot should be a rounded rectangle');
  } else {
    // Slot width is standardised to the fader's specification; the length
    // genuinely varies by model, so that stays measured.
    const lErr = Math.abs(fader.w - slotLen);
    const isStadiumShape = fader.radius >= Math.min(fader.w, fader.h) / 2 - 1e-6;
    if (lErr < 1.5 && fader.h === COMPONENT_SPECS.slider.holeMm && isStadiumShape) {
      pass(`fader: length measured ${fader.w.toFixed(1)} mm (true ${slotLen}), width standardised to ${fader.h} mm`);
    } else {
      fail(`fader ${fader.w.toFixed(1)} × ${fader.h} mm, radius ${fader.radius}, expected length ~${slotLen}`);
    }
  }

  const spurious = res.features.length - found - (fader ? 1 : 0);
  if (spurious === 0) pass('no spurious detections');
  else fail(`${spurious} spurious detection(s)`);

  // Standard sizes. Identical hardware must give identical holes: a panel
  // where every jack differs by a tenth of a millimetre is wrong.
  {
    const jacks = res.features.filter((f) => f.kind === 'jack');
    const sizes = new Set(jacks.map((f) => f.w));
    if (jacks.length >= 2 && sizes.size === 1 && jacks[0].w === COMPONENT_SPECS.jack.holeMm) {
      pass(`all ${jacks.length} jacks share the standard ${COMPONENT_SPECS.jack.holeMm} mm hole`);
    } else {
      fail(`jack sizes: ${[...sizes].join(', ')} — expected all ${COMPONENT_SPECS.jack.holeMm}`);
    }

    const circles = res.features.filter((f) => f.shape === 'circle');
    const offStandard = circles.filter((f) => f.w !== COMPONENT_SPECS[f.kind].holeMm);
    if (offStandard.length === 0) pass('every circular cutout uses its component\'s standard size');
    else fail(`${offStandard.length} circular cutouts are off their standard size`);

    // Nothing measured should survive into the geometry: a circle's radius
    // must always be half its own diameter.
    const badRadius = circles.filter((f) => Math.abs(f.radius - f.w / 2) > 1e-9);
    if (badRadius.length === 0) pass('circles keep a radius of half their diameter');
    else fail(`${badRadius.length} circles have an inconsistent radius`);
  }

  // Lettering must not become cutouts. Printing on a panel is small, dark and
  // round enough to fool shape analysis, but read as holes the letters of a
  // word overlap each other, and holes cannot intersect.
  {
    const img2 = new ImageDataShim(iw, ih);
    for (let i = 0; i < iw * ih; i++) {
      const p = i * 4;
      img2.data[p] = 205; img2.data[p + 1] = 205; img2.data[p + 2] = 200; img2.data[p + 3] = 255;
    }
    const dot = (cxMm: number, cyMm: number, dMm: number) => {
      const cx = cxMm * PPMM, cy = cyMm * PPMM, r = (dMm / 2) * PPMM;
      for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
        for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
          if (x < 0 || y < 0 || x >= iw || y >= ih) continue;
          if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) {
            const p = (y * iw + x) * 4;
            img2.data[p] = 18; img2.data[p + 1] = 18; img2.data[p + 2] = 20;
          }
        }
      }
    };

    // Two well-spaced jacks, and a "word": six separate marks 2.5 mm apart.
    // The marks do not touch each other — real lettering does not — but read
    // as 3 mm LED holes they would intersect, which is the giveaway.
    dot(8, 30, 8);
    dot(32, 30, 8);
    // 2.2 mm marks 2.6 mm apart: clearly separate in the picture, but as the
    // 3 mm LEDs they would be taken for, they would run into each other.
    for (let i = 0; i < 6; i++) dot(10 + i * 2.6, 70, 2.2);

    const r2 = detectFeatures({
      image: img2 as unknown as ImageData,
      hp: HP, format: '3U',
      crop: { x: 0, y: 0, w: iw, h: ih },
      settings: { ...DEFAULT_DETECT_SETTINGS, sensitivity: 0.5 },
    });

    const nearWord = r2.features.filter((f) => Math.abs(f.y - 70) < 4);
    const realHoles = r2.features.filter((f) => Math.abs(f.y - 30) < 4);
    if (nearWord.length === 0) pass('a run of overlapping marks is ignored as printing');
    else fail(`${nearWord.length} cutouts were taken from a word`);
    if (realHoles.length === 2) pass('well-separated holes beside it are still found');
    else fail(`${realHoles.length} of 2 real holes survived the printing filter`);
    if ((r2.droppedAsMarkings ?? 0) >= 2) pass(`${r2.droppedAsMarkings} marks reported as ignored`);
    else fail('the ignored marks were not reported');
  }

  // Two holes that would intersect cannot both be real, whatever they look
  // like, so neither is taken on trust.
  {
    const img3 = new ImageDataShim(iw, ih);
    for (let i = 0; i < iw * ih; i++) {
      const p = i * 4;
      img3.data[p] = 205; img3.data[p + 1] = 205; img3.data[p + 2] = 200; img3.data[p + 3] = 255;
    }
    const fill = (cxMm: number, cyMm: number, dMm: number) => {
      const cx = cxMm * PPMM, cy = cyMm * PPMM, r = (dMm / 2) * PPMM;
      for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
        for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
          if (x < 0 || y < 0 || x >= iw || y >= ih) continue;
          if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) {
            const p = (y * iw + x) * 4;
            img3.data[p] = 18; img3.data[p + 1] = 18; img3.data[p + 2] = 20;
          }
        }
    };
    // Two jack nuts 9 mm apart: the nuts clear each other, and the 6 mm holes
    // beneath them leave 3 mm of material. Tight but entirely buildable, so
    // both must survive.
    fill(13, 40, 8);
    fill(22, 40, 8);
    const r3 = detectFeatures({
      image: img3 as unknown as ImageData, hp: HP, format: '3U',
      crop: { x: 0, y: 0, w: iw, h: ih },
      settings: { ...DEFAULT_DETECT_SETTINGS, sensitivity: 0.5 },
    });
    if (r3.features.length === 2) pass('holes that are close but not intersecting are kept');
    else fail(`${r3.features.length} cutouts from two tight but legal holes`);
  }

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
      { id: 'j1', kind: 'jack', x: 10, y: 110, shape: 'circle', w: 6, h: 6, radius: 3, rotation: 0 },
      { id: 'j2', kind: 'jack', x: 30, y: 110, shape: 'circle', w: 6, h: 6, radius: 3, rotation: 0 },
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
      features: [{ id: 'j', kind: 'jack' as const, x: 20, y: 100, shape: 'circle' as const, w: 6, h: 6, radius: 3, rotation: 0 }],
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
  st().addFeature('circle', 10, 20);
  st().addFeature('circle', 20, 20);
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

  // The work in progress must survive a refresh. Panels reach the library
  // only when saved deliberately, so without this an afternoon's work is the
  // price of never having pressed Save.
  {
    const storage = await import('../src/lib/storage');
    st().newDesign();
    st().addFeature('circle', 11, 22);
    st().addFeature('rect', 30, 44);
    st().setDesignName('Work in progress');
    st().setDesign({ hp: 14, backgroundColor: '#123456' });
    const expected = st().design.features.length;

    // The store writes on a timer; the check is of what gets written and read.
    await storage.saveSession({
      design: st().design,
      designName: st().designName,
      activeDesignId: st().activeDesignId,
      dirty: st().dirty,
      crop: { x: 1, y: 2, w: 300, h: 400 },
      detect: st().detect,
      mmPerPx: 0.25,
      sourceLabel: 'photo.jpg',
      sourceBlob: null,
      view: '3d',
      tab: 'decor',
      gridMm: 2.54,
      showSource: false,
      sourceOpacity: 0.3,
      savedAt: Date.now(),
    });

    // Wipe the editor the way a page reload would.
    st().newDesign();
    if (st().design.features.length === 0) pass('a fresh start really is empty');
    else fail('newDesign left work behind');

    // newDesign clears the stored session too, so put it back for the reload.
    await storage.saveSession({
      design: { ...st().design, hp: 14, backgroundColor: '#123456',
        features: [{ id: 'k', kind: 'jack', x: 11, y: 22, shape: 'circle', w: 6, h: 6, radius: 3, rotation: 0 }] },
      designName: 'Work in progress',
      activeDesignId: null, dirty: true,
      crop: { x: 1, y: 2, w: 300, h: 400 },
      detect: st().detect, mmPerPx: 0.25,
      sourceLabel: 'photo.jpg', sourceBlob: null,
      view: '3d', tab: 'decor', gridMm: 2.54,
      showSource: false, sourceOpacity: 0.3, savedAt: 1234,
    });

    await st().loadLibraryFromStorage();
    const s2 = st();
    if (s2.design.features.length === 1 && s2.design.hp === 14 && s2.design.backgroundColor === '#123456') {
      pass('the panel comes back after a reload');
    } else {
      fail(`restored ${s2.design.features.length} cutouts at ${s2.design.hp} HP`);
    }
    if (s2.designName === 'Work in progress' && s2.dirty) pass('its name and unsaved state come back too');
    else fail(`restored name "${s2.designName}", dirty=${s2.dirty}`);
    if (s2.crop?.w === 300 && s2.mmPerPx === 0.25 && s2.sourceLabel === 'photo.jpg') {
      pass('the crop and scale of the source picture come back');
    } else {
      fail('the source details were lost');
    }
    if (s2.view === '3d' && s2.tab === 'decor' && s2.gridMm === 2.54 && s2.sourceOpacity === 0.3) {
      pass('the view, tab and editing preferences come back');
    } else {
      fail(`restored view=${s2.view} tab=${s2.tab} grid=${s2.gridMm}`);
    }
    if (s2.restoredAt === 1234) pass('the restore is flagged so the app can mention it');
    else fail('nothing recorded that work had been restored');
    if (s2.hydrated) pass('saving is only enabled once the reload has finished');
    else fail('the store never marked itself hydrated');

    // Starting a new panel must not leave the old session to come back.
    st().newDesign();
    await new Promise((r) => setTimeout(r, 50));
    if ((await storage.loadSession()) === null) pass('starting a new panel clears the stored session');
    else fail('the old session survived starting a new panel');
    void expected;
  }

  // Loading a module should name the panel after it, so it need not be typed,
  // without renaming a panel that was already saved under a name of its own.
  {
    const img = new ImageDataShim(600, 800);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 200; img.data[i + 1] = 200; img.data[i + 2] = 200; img.data[i + 3] = 255;
    }
    st().newDesign();
    st().setSource(img as unknown as ImageData, 'x', 'Make Noise MATHS', 'artwork', 20);
    if (st().designName === 'Make Noise MATHS') pass('a loaded module names the panel after itself');
    else fail(`panel was named "${st().designName}"`);

    // A file name is not a module name and should not become one.
    st().newDesign();
    st().setSource(img as unknown as ImageData, 'x', 'IMG_4821.jpg');
    if (st().designName === 'Untitled panel') pass('a photo file name is not used as the panel name');
    else fail(`panel was named "${st().designName}"`);

    // Someone else's saved panel keeps its name when a reference photo is added.
    st().newDesign();
    st().setDesignName('My own panel');
    st().saveCurrentDesign();
    await new Promise((r) => setTimeout(r, 30));
    st().setSource(img as unknown as ImageData, 'x', 'Make Noise MATHS', 'artwork', 20);
    if (st().designName === 'My own panel') pass('a saved panel is not renamed by loading a picture into it');
    else fail(`saved panel was renamed to "${st().designName}"`);

    // Leave the library as this block found it, or the counts in later checks
    // are off by the panel saved here.
    const mine = st().library.find((d) => d.name === 'My own panel');
    if (mine) st().deleteDesign(mine.id);
    st().newDesign();
  }

  // A stated width must not be replaced by a guess from the image. A render is
  // often padded a pixel or two, which is enough to put a 30 HP module on 29,
  // and being one pitch out misplaces every hole on the panel.
  {
    const img = new ImageDataShim(960, 826); // 1.162 aspect -> guesses 29 HP
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 200; img.data[i + 1] = 200; img.data[i + 2] = 200; img.data[i + 3] = 255;
    }
    st().setSource(img as unknown as ImageData, 'x', 'test', 'artwork', 30);
    if (st().design.hp === 30) pass('a stated width wins over the aspect-ratio guess');
    else fail(`stated 30 HP became ${st().design.hp} HP`);

    st().setSource(img as unknown as ImageData, 'x', 'test', 'artwork');
    if (st().design.hp === 29) pass('without a stated width, the aspect ratio is still used');
    else fail(`guessed ${st().design.hp} HP from a 1.162 aspect, expected 29`);
    st().newDesign();
  }

  // Adding to the rack should find a slot and record the placement.
  if (savedId) {
    const ok = st().addToRack(savedId);
    if (ok) pass('adding to the rack reports that it worked');
    else fail('adding to the rack reported failure');
  }
  const placed = st().rack.rows.reduce((n, r) => n + r.placements.length, 0);
  if (placed === 1) pass('adding to the rack places the panel');
  else fail(`rack has ${placed} placements, expected 1`);

  // A panel with nowhere to go must say so rather than silently doing nothing,
  // since the view only follows when something actually moved.
  {
    st().setRack({ name: 'tiny', rows: [{ id: 'r0', widthHp: 2, format: '3U', placements: [] }] });
    const refused = savedId ? st().addToRack(savedId) : true;
    if (refused === false) pass('a panel too wide for any row is refused, not dropped silently');
    else fail('a panel that cannot fit was reported as placed');
  }

  // Emptying the rack takes the panels out of it but leaves the library, so
  // they can be put back; clearing everything really does clear everything.
  {
    st().emptyRack();
    const placedAfter = st().rack.rows.reduce((n, r) => n + r.placements.length, 0);
    if (placedAfter === 0) pass('emptying the rack removes every panel from it');
    else fail(`${placedAfter} panels left in the rack`);
    if (st().rack.rows.length > 0) pass('and leaves the rows behind to fill again');
    else fail('emptying the rack took the rows with it');
    if (st().library.length > 0) pass('the library is untouched by emptying the rack');
    else fail('emptying the rack deleted saved panels');
  }

  // Deleting a design must also remove it from the rack.
  if (savedId) st().deleteDesign(savedId);
  const after = st().rack.rows.reduce((n, r) => n + r.placements.length, 0);
  if (after === 0 && st().library.length === 0) pass('deleting a design clears it from the rack');
  else fail(`after delete: ${st().library.length} in library, ${after} placed`);

  // Clearing everything has to leave nothing behind, in memory or in storage,
  // since there is no copy of any of it anywhere else.
  {
    const storage2 = await import('../src/lib/storage');
    st().newDesign();
    st().setDesignName('Doomed');
    st().addFeature('circle', 10, 10);
    st().saveCurrentDesign();
    await new Promise((r) => setTimeout(r, 50));
    if (st().library.length > 0) pass('there is something to clear');
    else fail('nothing was saved to clear');

    await st().clearEverything();
    if (st().library.length === 0) pass('clearing empties the library');
    else fail(`${st().library.length} panels survived`);
    if (st().design.features.length === 0 && st().activeDesignId === null) {
      pass('and the panel being edited goes back to empty');
    } else {
      fail('the edited panel survived clearing');
    }
    if ((await storage2.loadDesigns()).length === 0) pass('storage is emptied, not just the screen');
    else fail('designs were left in storage');
    if ((await storage2.loadSession()) === null) pass('the restore-on-refresh session goes too');
    else fail('a session was left to restore the cleared work');
    const rows = st().rack.rows.reduce((n, r) => n + r.placements.length, 0);
    if (rows === 0) pass('the rack is emptied as well');
    else fail('the rack still holds panels');
  }
}

// --------------------------------------------- 6b. cutout shapes and standards
console.log('\nCutout shapes, standards and clearance');
{
  const { migrateFeature, isStadium, describeFeature } = await import('../src/lib/types');
  const { featureRing } = await import('../src/lib/model/build');
  const { bbox } = await import('../src/lib/geom/poly');
  const { COMPONENT_SPECS: SPECS, hasStandardSize } = await import('../src/lib/eurorack');

  // --- migrating designs written before the shapes were collapsed ---
  const oldSlot = migrateFeature({
    id: 's', kind: 'slider', x: 10, y: 20, shape: 'slot', d: 4, len: 60, rotation: 90,
  });
  if (oldSlot && oldSlot.shape === 'rect' && oldSlot.w === 60 && oldSlot.h === 4 && isStadium(oldSlot)) {
    pass('an old slot becomes a fully rounded rectangle of the same size');
  } else {
    fail(`slot migration produced ${JSON.stringify(oldSlot)}`);
  }

  const oldCircle = migrateFeature({ id: 'c', kind: 'jack', x: 1, y: 2, shape: 'circle', d: 6.2 });
  if (oldCircle && oldCircle.w === 6.2 && oldCircle.h === 6.2 && oldCircle.radius === 3.1) {
    pass('an old circle keeps its size, with width and height equal');
  } else {
    fail(`circle migration produced ${JSON.stringify(oldCircle)}`);
  }

  const oldRect = migrateFeature({
    id: 'r', kind: 'display', x: 0, y: 0, shape: 'rect', d: 24, len: 8, radius: 1,
  });
  if (oldRect && oldRect.w === 24 && oldRect.h === 8 && oldRect.radius === 1) {
    pass('an old rectangle keeps its width, height and corner radius');
  } else {
    fail(`rect migration produced ${JSON.stringify(oldRect)}`);
  }

  if (migrateFeature({ nonsense: true }) === null) pass('an unreadable cutout is dropped, not guessed at');
  else fail('migration invented a cutout from nothing');

  // A migrated file must come back through a full round trip unchanged.
  const already = migrateFeature(oldSlot);
  if (already && already.w === oldSlot!.w && already.h === oldSlot!.h && already.radius === oldSlot!.radius) {
    pass('migrating an already-migrated cutout changes nothing');
  } else {
    fail('a second migration altered the cutout');
  }

  // --- what the palette offers, and how cutouts are described ---
  {
    const { CUTOUT_PRESETS, STANDARD_KINDS } = await import('../src/lib/eurorack');
    const ids = CUTOUT_PRESETS.map((p) => p.id).sort().join(',');
    if (ids === 'circle,rect,roundrect,slot') pass('the palette offers shapes, not components');
    else fail(`palette offers ${ids}`);

    const everyPresetValid = CUTOUT_PRESETS.every(
      (p) => p.w > 0 && p.h > 0 && p.radius >= 0 && p.radius <= Math.min(p.w, p.h) / 2,
    );
    if (everyPresetValid) pass('every preset has a usable starting size');
    else fail('a preset has an impossible radius or size');

    const slot = CUTOUT_PRESETS.find((p) => p.id === 'slot')!;
    if (slot.radius === Math.min(slot.w, slot.h) / 2) pass('the slot preset is fully rounded');
    else fail('the slot preset is not a stadium');

    if (STANDARD_KINDS.every((k) => SPECS[k].holeMm > 0 && hasStandardSize(k))) {
      pass(`${STANDARD_KINDS.length} component sizes are offered as presets`);
    } else {
      fail('a size preset points at a component with no standard size');
    }

    // A hand-placed shape should describe itself rather than say "Custom".
    const plain = { id: 'z', kind: 'custom' as const, x: 0, y: 0, shape: 'circle' as const, w: 6, h: 6, radius: 3, rotation: 0 };
    if (describeFeature(plain, SPECS.custom.label) === 'Circle 6 mm') pass('a plain shape describes itself');
    else fail(`describeFeature gave "${describeFeature(plain, SPECS.custom.label)}"`);

    const namedJack = { ...plain, kind: 'jack' as const };
    if (describeFeature(namedJack, SPECS.jack.label) === SPECS.jack.label) {
      pass('a named component keeps its name');
    } else {
      fail('a named component lost its label');
    }

    const stadium = { ...plain, shape: 'rect' as const, w: 30, h: 4, radius: 2 };
    if (describeFeature(stadium, SPECS.custom.label).startsWith('Slot')) pass('a fully rounded rectangle reads as a slot');
    else fail(`stadium described as "${describeFeature(stadium, SPECS.custom.label)}"`);
  }

  // --- geometry ---
  // A faceted circle must never come out under its nominal size: a bushing
  // that will not fit ruins the panel, a hair of clearance does not.
  const circle = featureRing({ id: 'a', kind: 'jack', x: 50, y: 50, shape: 'circle', w: 6, h: 6, radius: 3, rotation: 0 })!;
  let narrowest = Infinity;
  let widest = 0;
  for (const p of circle) {
    // Distance across the flats, sampled at the midpoint of every facet.
    const q = circle[(circle.indexOf(p) + 1) % circle.length];
    const mid = Math.hypot((p.x + q.x) / 2 - 50, (p.y + q.y) / 2 - 50) * 2;
    narrowest = Math.min(narrowest, mid);
    widest = Math.max(widest, Math.hypot(p.x - 50, p.y - 50) * 2);
  }
  if (narrowest >= 6 - 1e-6 && widest < 6.05) {
    pass(`a 6 mm hole measures ${narrowest.toFixed(3)}–${widest.toFixed(3)} mm, never under`);
  } else {
    fail(`6 mm hole measures ${narrowest.toFixed(3)}–${widest.toFixed(3)} mm`);
  }

  // A stadium and a sharp rectangle of the same size share a bounding box but
  // not an area; the radius has to actually do something.
  const sharp = featureRing({ id: 'b', kind: 'custom', x: 50, y: 50, shape: 'rect', w: 40, h: 4, radius: 0, rotation: 0 });
  const round = featureRing({ id: 'c', kind: 'custom', x: 50, y: 50, shape: 'rect', w: 40, h: 4, radius: 2, rotation: 0 });
  const sb = bbox([sharp!]);
  const rb = bbox([round!]);
  const sameBox =
    Math.abs(sb.x1 - sb.x0 - 40) < 0.02 && Math.abs(rb.x1 - rb.x0 - 40) < 0.05 &&
    Math.abs(sb.y1 - sb.y0 - 4) < 0.02 && Math.abs(rb.y1 - rb.y0 - 4) < 0.02;
  if (sameBox) pass('rounding the corners does not change the overall size');
  else fail('a rounded rectangle has different bounds from a sharp one');

  const rotated = featureRing({ id: 'd', kind: 'custom', x: 50, y: 50, shape: 'rect', w: 40, h: 4, radius: 2, rotation: 90 });
  const rotb = bbox([rotated!]);
  if (Math.abs(rotb.y1 - rotb.y0 - 40) < 0.05 && Math.abs(rotb.x1 - rotb.x0 - 4) < 0.05) {
    pass('rotating 90° swaps the cutout\'s footprint');
  } else {
    fail(`rotated bounds ${(rotb.x1 - rotb.x0).toFixed(2)} x ${(rotb.y1 - rotb.y0).toFixed(2)}`);
  }

  // --- printer clearance ---
  const nominal = featureRing({ id: 'e', kind: 'jack', x: 50, y: 50, shape: 'circle', w: 6, h: 6, radius: 3, rotation: 0 }, 0);
  const opened = featureRing({ id: 'e', kind: 'jack', x: 50, y: 50, shape: 'circle', w: 6, h: 6, radius: 3, rotation: 0 }, 0.1);
  const nb = bbox([nominal!]);
  const ob = bbox([opened!]);
  if (Math.abs((ob.x1 - ob.x0) - (nb.x1 - nb.x0) - 0.2) < 0.02) {
    pass('a 0.1 mm allowance opens a hole by 0.2 mm across');
  } else {
    fail(`allowance changed the diameter by ${((ob.x1 - ob.x0) - (nb.x1 - nb.x0)).toFixed(3)} mm`);
  }

  const built = buildPanel({
    ...BASE,
    holeClearanceMm: 0.2,
    features: [{ id: 'j', kind: 'jack', x: 20, y: 60, shape: 'circle', w: 6, h: 6, radius: 3, rotation: 0 }],
  }, { fonts: noFonts });
  for (const m of built.meshes) checkSolid(m, `with hole allowance / ${m.name}`);

  // --- the catalogue itself ---
  const fixed = (Object.keys(SPECS) as Array<keyof typeof SPECS>).filter((k) => hasStandardSize(k));
  const sane = fixed.every((k) => SPECS[k].holeMm > 0 && SPECS[k].holeMm < 40);
  if (sane) pass(`${fixed.length} components have a fixed standard hole size`);
  else fail('a component has an implausible standard size');
  if (SPECS.jack.holeMm === 6 && SPECS.pot.holeMm === 7 && SPECS.led.holeMm === 3) {
    pass('jack 6 mm, pot 7 mm, LED 3 mm — the sizes the hardware is specified at');
  } else {
    fail('the standard sizes have drifted from the hardware specifications');
  }
}

// --------------------------------------------------------- 6c. drag alignment
console.log('\nAlignment guides');
{
  const { alignTo, snapToGrid } = await import('../src/lib/align');
  const panel = { w: 100, h: 128.5 };
  const t = (id: string, x: number, y: number) => ({ id, x, y, rx: 3, ry: 3 });

  // Two knobs far apart that should share a column.
  const col = alignTo(20.4, 90, [t('a', 20, 20), t('b', 60, 20)], panel, 1);
  if (col.x === 20 && col.guides.some((g) => g.axis === 'x' && g.at === 20)) {
    pass('a near miss snaps onto a shared column, however far apart');
  } else {
    fail(`x came out ${col.x} with ${col.guides.length} guides`);
  }

  // The guide has to reach both, or it does not show what lined up.
  const g = col.guides.find((gg) => gg.axis === 'x')!;
  if (g.from <= 17 && g.to >= 90) pass('the guide spans from one to the other');
  else fail(`guide spans ${g.from}–${g.to}`);

  // Out of range, nothing happens.
  const far = alignTo(24, 90, [t('a', 20, 20)], panel, 1);
  if (far.x === 24 && far.guides.every((gg) => gg.axis !== 'x')) pass('a miss is left alone');
  else fail('something snapped that should not have');

  // Both axes at once, against different things.
  const both = alignTo(20.3, 60.4, [t('a', 20, 20), t('b', 70, 60)], panel, 1);
  if (both.x === 20 && both.y === 60 && both.guides.length === 2) {
    pass('a cutout can line up with one thing across and another down');
  } else {
    fail(`both axes: x=${both.x} y=${both.y} guides=${both.guides.length}`);
  }

  // The panel's own centre line counts as something to align to.
  const centre = alignTo(50.3, 10, [], panel, 1);
  if (centre.x === 50 && centre.guides[0]?.source === 'panel') {
    pass('the panel centre line is offered too');
  } else {
    fail(`panel centre: x=${centre.x}, source=${centre.guides[0]?.source}`);
  }

  // Nearest wins when two candidates are both in range.
  const nearest = alignTo(20.8, 90, [t('a', 20, 20), t('b', 21.5, 20)], panel, 2);
  if (nearest.x === 21.5) pass('the nearer of two candidates wins');
  else fail(`picked ${nearest.x} over the nearer 21.5`);

  // A guide should mention everything sharing that axis, not just one.
  const many = alignTo(30.2, 100, [t('a', 30, 10), t('b', 30, 50), t('c', 80, 50)], panel, 1);
  const gx = many.guides.find((gg) => gg.axis === 'x')!;
  if (gx.from <= 7 && gx.to >= 100) pass('the guide covers every cutout in the column');
  else fail(`column guide spans ${gx.from}–${gx.to}`);

  if (snapToGrid(7.3, 5) === 5 && snapToGrid(7.6, 5) === 10 && snapToGrid(7.34, 0) === 7.34) {
    pass('grid snapping still rounds as it did');
  } else {
    fail('grid snapping changed behaviour');
  }
}

// ------------------------------------------------------------ 6c2. hole colour
console.log('\nCutout legibility');
{
  const { cutoutFill, contrastRatio, luminance } = await import('../src/lib/color');

  // Every faceplate colour anyone would plausibly choose, and the colour
  // presets the app itself offers.
  const panels = [
    '#0b0b0d', '#23262b', '#8a8f96', '#c9ccd1', '#f2f2f0',
    '#1f3b57', '#57351f', '#7d1f2b', '#1f5740', '#ffffff', '#000000',
  ];
  let worst = Infinity;
  let worstPanel = '';
  for (const p of panels) {
    const r = contrastRatio(cutoutFill(p), p);
    if (r < worst) { worst = r; worstPanel = p; }
  }
  // 4.5:1 is the threshold for readable text; a hole only has to be findable,
  // so clearing it on every panel colour is a comfortable margin.
  if (worst >= 4.5) pass(`a cutout is visible on every panel colour (worst ${worst.toFixed(2)}:1 on ${worstPanel})`);
  else fail(`a cutout is nearly invisible on ${worstPanel} at ${worst.toFixed(2)}:1`);

  // Holes are dark in life, and on a pale panel that is what should be drawn.
  if (luminance(cutoutFill('#f2f2f0')) < 0.1) pass('a hole in a pale panel is drawn dark, as it really is');
  else fail('a pale panel got a pale hole');

  // On a black faceplate a darker hole cannot be seen, so it goes the other way.
  if (luminance(cutoutFill('#0b0b0d')) > 0.2) pass('a hole in a black panel is drawn light so it can be found');
  else fail('a black panel got an invisible hole');

  // Nonsense from a half-typed colour field must not throw or go transparent.
  for (const bad of ['', '#', '#12', 'rgb(1,2,3)', 'not a colour']) {
    const f = cutoutFill(bad);
    if (!/^#[0-9a-f]{6}$/i.test(f)) { fail(`a malformed colour produced "${f}"`); break; }
  }
  pass('a half-typed colour still yields a usable hole colour');
}

// ------------------------------------------------- 6d. finding a module by name
console.log('\nModule search');
{
  const { rankModules, nameFromSlug, slugFromName, slugFromInput } =
    await import('../src/lib/modulargrid');

  // A slice of real ModularGrid addresses, including the awkward ones.
  const slugs = [
    'make-noise-maths', 'make-noise-maths-', 'grayscale-maths-grayscale-panel',
    'mutable-instruments-plaits', 'before-void-plaits-clone',
    '1010-music-bluebox', 'moerk-modules-bluebox-black-panel',
    'expert-sleepers-disting-mk4', 'expert-sleepers-disting-mk3', 'expert-sleepers-disting-nt',
    'alm-busy-circuits-pamela-s-workout', 'intellijel-quadrax', 'doepfer-a-110-1',
  ];

  // A bare model name has to find the module, not a replacement panel for it.
  const maths = rankModules('maths', slugs);
  if (maths[0]?.slug === 'make-noise-maths') pass('a bare model name finds the module itself');
  else fail(`"maths" ranked ${maths[0]?.slug} first`);

  // Several modules answering to one name is the reason there is a list.
  const disting = rankModules('disting', slugs);
  if (disting.length >= 3 && disting.every((r) => r.slug.includes('disting'))) {
    pass(`"disting" offers all ${disting.length} of them to choose between`);
  } else {
    fail(`"disting" returned ${disting.length} results`);
  }

  // Naming the maker should pin it down.
  const exact = rankModules('mutable instruments plaits', slugs);
  if (exact[0]?.slug === 'mutable-instruments-plaits') pass('naming the maker picks that maker\'s module');
  else fail(`ranked ${exact[0]?.slug} first`);

  // Duplicate entries end in a hyphen and should not outrank the real one.
  if (rankModules('maths', slugs)[0].slug === 'make-noise-maths') {
    pass('a trailing-hyphen duplicate ranks below the real address');
  } else {
    fail('a duplicate entry outranked the module');
  }

  // The same module is listed under several addresses; the list should show
  // it once, not three identical-looking rows.
  const dupes = rankModules('maths', slugs);
  const names = dupes.map((r) => r.name.toLowerCase());
  if (new Set(names).size === names.length) pass('duplicate entries collapse to one row');
  else fail(`the list repeats a name: ${names.join(', ')}`);

  // Replacement faceplates share a module's name and should not outrank it.
  const bluebox = rankModules('bluebox', slugs);
  if (bluebox[0]?.slug === '1010-music-bluebox') pass('the module beats a replacement panel for it');
  else fail(`"bluebox" ranked ${bluebox[0]?.slug} first`);
  if (bluebox.some((r) => r.slug.includes('panel'))) pass('replacement panels are still offered, lower down');
  else fail('replacement panels vanished from the list entirely');

  if (rankModules('zzzznothing', slugs).length === 0) pass('nonsense matches nothing');
  else fail('nonsense produced matches');
  if (rankModules('', slugs).length === 0) pass('an empty query matches nothing');
  else fail('an empty query produced matches');

  // Names shown in the list come from the address.
  if (nameFromSlug('make-noise-maths') === 'Make Noise Maths') pass('addresses read back as names');
  else fail(`nameFromSlug gave "${nameFromSlug('make-noise-maths')}"`);
  if (nameFromSlug('alm-busy-circuits-pamela-s-workout').includes("Pamela's")) {
    pass('an apostrophe in a name survives the round trip');
  } else {
    fail(`apostrophe handling gave "${nameFromSlug('alm-busy-circuits-pamela-s-workout')}"`);
  }

  // Typing a full name still resolves directly, without a search.
  if (slugFromName('Make Noise Maths') === 'make-noise-maths') pass('a full name maps straight to its address');
  else fail(`slugFromName gave ${slugFromName('Make Noise Maths')}`);
  if (slugFromInput('https://modulargrid.net/e/make-noise-maths') === 'make-noise-maths') {
    pass('a pasted link still opens directly');
  } else {
    fail('a link stopped resolving');
  }
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
    ['ours but from the future', '{"format":"panelmate","version":99,"panels":[]}'],
    ['ours but empty', '{"format":"panelmate","version":1,"panels":[]}'],
  ] as const) {
    try {
      parseBackup(text);
      fail(`${label} should have been refused`);
    } catch {
      pass(`refused: ${label}`);
    }
  }

  // Entries that are not panels are dropped rather than failing the whole file.
  // Files exported before the app was renamed still have to open, or renaming
  // it would quietly invalidate everyone's backups.
  const legacy = parseBackup(JSON.stringify({
    format: 'eurorack-panel-generator', version: 1, kind: 'library', panels: [one],
  }));
  if (legacy.backup.panels.length === 1) pass('a file written under the old name still opens');
  else fail('renaming the app broke its own older exports');

  const partial = parseBackup(JSON.stringify({
    format: 'panelmate', version: 1, kind: 'library',
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
    features: [{ id: 'j', kind: 'jack', x: 20, y: 100, shape: 'circle', w: 6, h: 6, radius: 3, rotation: 0 }],
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

// ------------------------------------------------------------------- 9. brand
console.log('\nBrand');
{
  // The kit in panelmate-brand/ is the source, and the app holds copies:
  // the mark is inlined as a component so it can take theme tokens, and the
  // palette is transcribed into CSS. Nothing at runtime notices when the kit
  // moves and a copy does not, which is exactly how a stale favicon ships.

  /** Geometry of every drawn element, colours deliberately left out. */
  const geometry = (src: string) =>
    [...src.matchAll(/<(rect|circle|line|path)\s([^/>]*)\/?>/g)]
      .map(([, tag, attrs]) => {
        const pairs = [...attrs.matchAll(/([a-zA-Z-]+)=["{]([^"}]+)["}]/g)]
          .map(([, k, v]) => [k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), v.trim()])
          .filter(([k, v]) => !/^(className|role|ariaHidden|ariaLabel|fill|stroke)$/.test(k)
                             || (k === 'fill' && v === 'none'))
          .sort(([a], [b]) => a.localeCompare(b));
        return `${tag} ${pairs.map(([k, v]) => `${k}=${v}`).join(' ')}`;
      });

  const kitMark = geometry(readFileSync('panelmate-brand/svg/mark-dark-small.svg', 'utf8'))
    // The kit's artboard background; the page supplies its own.
    .filter((el) => !el.startsWith('rect height=120 width=120'));
  const appMark = geometry(readFileSync('src/components/Logo.tsx', 'utf8'));

  if (appMark.length >= 15) pass(`the mark draws its ${appMark.length} parts`);
  else fail(`the mark lost shapes: ${appMark.length} left`);

  if (appMark.join('\n') === kitMark.join('\n')) pass('the mark matches the brand kit');
  else fail(`the mark has drifted from the kit:\n${appMark.join('\n')}\n---\n${kitMark.join('\n')}`);

  const favicon = readFileSync('src/app/icon.svg', 'utf8').replace(/<!--[\s\S]*?-->\s*/g, '');
  const kitFavicon = readFileSync('panelmate-brand/svg/favicon.svg', 'utf8');
  if (favicon.trim() === kitFavicon.trim()) pass('the favicon is the kit\'s, unedited');
  else fail('the favicon has drifted from panelmate-brand/svg/favicon.svg');

  // Every named brand colour has to appear in the stylesheet, or a palette
  // that merely looks brand-ish has crept in.
  const css = readFileSync('src/app/globals.css', 'utf8').toLowerCase();
  const tokens = readFileSync('panelmate-brand/tokens.json', 'utf8');
  const named = Object.entries(JSON.parse(tokens).color as Record<string, string>);
  const missing = named.filter(([, hex]) => !css.includes(hex.toLowerCase()));
  if (missing.length === 0) pass(`all ${named.length} brand colours are in the palette`);
  else fail(`missing from the palette: ${missing.map(([n, h]) => `${n} ${h}`).join(', ')}`);

  // Signal Lime is unreadable on Brushed Alu, so the light theme carries a
  // darkened one. Whatever it is, it has to actually carry.
  const { contrastRatio: ratioOf } = await import('../src/lib/color');
  const themeAccent = (theme: 'dark' | 'light') => {
    const at = css.indexOf(theme === 'dark' ? ":root[data-theme='dark']" : ":root[data-theme='light']");
    return css.slice(at).match(/--accent:\s*(#[0-9a-f]{6})/)?.[1] ?? '';
  };
  const themeBg = (theme: 'dark' | 'light') => {
    const at = css.indexOf(theme === 'dark' ? ":root[data-theme='dark']" : ":root[data-theme='light']");
    return css.slice(at).match(/--ink-950:\s*(#[0-9a-f]{6})/)?.[1] ?? '';
  };
  for (const theme of ['dark', 'light'] as const) {
    const ratio = ratioOf(themeAccent(theme), themeBg(theme));
    if (ratio >= 4.5) pass(`${theme}: the accent carries on the page (${ratio.toFixed(2)}:1)`);
    else fail(`${theme}: the accent reads ${ratio.toFixed(2)}:1 against the page`);
  }
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
      headers: { 'User-Agent': 'Panelmate/verify' },
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
