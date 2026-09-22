/**
 * Eurorack mechanical standards.
 *
 * Sources: Doepfer A-100 "Construction Details / Mechanical Specs", and the
 * de-facto conventions every module maker follows. All values are millimetres.
 */

/** One horizontal pitch unit. 0.2 inch. */
export const HP_MM = 5.08;

/** Rail-to-rail height of a standard 3U panel. */
export const U3_HEIGHT_MM = 128.5;

/** Intellijel-format 1U tile height. */
export const U1_INTELLIJEL_MM = 39.65;

/** Pulp Logic-format 1U tile height (1.5 inch). */
export const U1_PULPLOGIC_MM = 38.1;

export type PanelFormat = '3U' | '1U-intellijel' | '1U-pulplogic';

export const PANEL_HEIGHTS: Record<PanelFormat, number> = {
  '3U': U3_HEIGHT_MM,
  '1U-intellijel': U1_INTELLIJEL_MM,
  '1U-pulplogic': U1_PULPLOGIC_MM,
};

/**
 * Nominal panel width for a given HP.
 *
 * The full HP pitch is `hp * 5.08`, but panels are cut slightly narrow so that
 * neighbouring modules do not bind against each other in the rack. Doepfer's
 * published widths (2HP = 9.8, 4HP = 20.0, 8HP = 40.3, 12HP = 60.6) all follow
 * `hp * 5.08 - 0.3` to within a rounding step.
 */
export const PANEL_CLEARANCE_MM = 0.3;

export function panelWidthMm(hp: number, clearance = PANEL_CLEARANCE_MM): number {
  return hp * HP_MM - clearance;
}

export function panelHeightMm(format: PanelFormat): number {
  return PANEL_HEIGHTS[format];
}

/** Mounting slot geometry: an M3 oval that allows lateral adjustment on the rail. */
export const MOUNT_SLOT = {
  /** Total length of the oval, including both end caps. */
  lengthMm: 5.3,
  /** Height of the oval == M3 clearance diameter. */
  heightMm: 3.2,
  /** Centre distance from the top (and bottom) panel edge. */
  edgeInsetMm: 3.0,
  /** Centre distance from the left (and right) panel edge. */
  sideInsetMm: 7.5,
} as const;

/**
 * Where the mounting slots go for a panel of the given width.
 *
 * Narrow panels get a single centred column of slots because there is no room
 * for two; anything wider gets one column inset from each edge.
 */
export function mountSlotPositions(
  widthMm: number,
  heightMm: number,
): Array<{ x: number; y: number }> {
  const { edgeInsetMm, sideInsetMm } = MOUNT_SLOT;
  const yTop = edgeInsetMm;
  const yBottom = heightMm - edgeInsetMm;

  // Two columns need 2 * sideInset plus a slot length of breathing room.
  const canFitTwo = widthMm >= sideInsetMm * 2 + MOUNT_SLOT.lengthMm;
  const xs = canFitTwo ? [sideInsetMm, widthMm - sideInsetMm] : [widthMm / 2];

  return xs.flatMap((x) => [
    { x, y: yTop },
    { x, y: yBottom },
  ]);
}

/** Panel thickness range that is both printable and rack-legal. */
export const THICKNESS = { min: 1.2, max: 4.0, default: 2.0 } as const;

/**
 * Catalogue of the through-holes a Eurorack panel actually needs, keyed by the
 * component that sits in them. `holeMm` is the panel cutout; `visualMm` is the
 * diameter of the part as it appears in a photo of an assembled module (a nut,
 * a knob, a cap), which is what blob detection actually measures.
 */
export interface ComponentSpec {
  kind: FeatureKind;
  label: string;
  /**
   * The nominal panel cutout for this component, in mm — the size a
   * manufacturer's drawing gives, before any allowance for your printer.
   *
   * Detection measures a hole to work out *what* it is, then throws the
   * measurement away and uses this. A photograph will never measure twenty
   * jacks at exactly the same size, and a panel where every jack differs by a
   * tenth of a millimetre is wrong: they take identical hardware, so they take
   * identical holes.
   */
  holeMm: number;
  /** For a rectangular cutout, the nominal height. Width comes from holeMm. */
  holeHeightMm?: number;
  /**
   * Plausible measured diameter in a photograph of an assembled module, where
   * you see the fitted hardware: a jack's nut, a knob, an LED lens.
   */
  visualRangeMm: [number, number];
  /**
   * Plausible measured diameter in flat panel artwork, such as a ModularGrid
   * render. Drawings show the socket aperture rather than the nut around it,
   * so a 3.5 mm jack measures about 4 mm here against about 8 mm in a photo.
   * Measured against real ModularGrid renders.
   */
  artworkRangeMm: [number, number];
  shape: 'circle' | 'slot' | 'rect';
  /** Slot length in mm, for slider-type features. */
  slotLengthMm?: number;
}

export type FeatureKind =
  | 'jack'
  | 'led'
  | 'led5'
  | 'pot'
  | 'trimmer'
  | 'encoder'
  | 'button'
  | 'buttonLarge'
  | 'toggle'
  | 'slider'
  | 'display'
  | 'mount'
  | 'custom';

/**
 * The catalogue.
 *
 * Nominal cutouts come from the hardware nearly every module uses: a 3.5 mm
 * jack is a Thonkiconn-style PJ301M/PJ398SM with a 6 mm threaded bushing; a
 * panel pot is an Alpha 9 mm with a 7 mm bushing; sub-miniature toggles are
 * M6. Those are the sizes the parts are specified at, so those are the sizes
 * stored. Allowance for a particular printer is a separate, adjustable setting
 * rather than something baked into every hole — see `holeClearanceMm`.
 */
export const COMPONENT_SPECS: Record<FeatureKind, ComponentSpec> = {
  jack: { kind: 'jack', label: '3.5 mm jack', holeMm: 6.0, visualRangeMm: [5.2, 9.8], artworkRangeMm: [3.2, 5.4], shape: 'circle' },
  led: { kind: 'led', label: 'LED 3 mm', holeMm: 3.0, visualRangeMm: [2.4, 3.9], artworkRangeMm: [1.6, 3.2], shape: 'circle' },
  led5: { kind: 'led5', label: 'LED 5 mm', holeMm: 5.0, visualRangeMm: [4.4, 5.9], artworkRangeMm: [4.6, 5.8], shape: 'circle' },
  pot: { kind: 'pot', label: 'Potentiometer', holeMm: 7.0, visualRangeMm: [9.0, 24.0], artworkRangeMm: [8.0, 26.0], shape: 'circle' },
  trimmer: { kind: 'trimmer', label: 'Trimmer', holeMm: 4.0, visualRangeMm: [3.9, 5.2], artworkRangeMm: [2.8, 4.4], shape: 'circle' },
  encoder: { kind: 'encoder', label: 'Rotary encoder', holeMm: 7.0, visualRangeMm: [9.0, 22.0], artworkRangeMm: [8.0, 22.0], shape: 'circle' },
  button: { kind: 'button', label: 'Tact button', holeMm: 5.0, visualRangeMm: [3.5, 8.0], artworkRangeMm: [5.0, 9.0], shape: 'circle' },
  buttonLarge: { kind: 'buttonLarge', label: 'Large button', holeMm: 12.0, visualRangeMm: [9.5, 17.0], artworkRangeMm: [9.0, 17.0], shape: 'circle' },
  toggle: { kind: 'toggle', label: 'Toggle switch', holeMm: 6.0, visualRangeMm: [4.2, 7.0], artworkRangeMm: [3.0, 5.0], shape: 'circle' },
  // A fader's travel slot is the one component whose length genuinely varies
  // by model, so the measured length is kept and only the width standardised.
  slider: { kind: 'slider', label: 'Slider / fader', holeMm: 4.0, holeHeightMm: 60, visualRangeMm: [2.0, 7.0], artworkRangeMm: [1.5, 7.0], shape: 'rect' },
  display: { kind: 'display', label: 'Display cutout', holeMm: 26, holeHeightMm: 15, visualRangeMm: [10, 80], artworkRangeMm: [10, 80], shape: 'rect' },
  mount: { kind: 'mount', label: 'Mounting slot', holeMm: MOUNT_SLOT.lengthMm, holeHeightMm: MOUNT_SLOT.heightMm, visualRangeMm: [3, 6], artworkRangeMm: [3, 6], shape: 'rect' },
  custom: { kind: 'custom', label: 'Custom', holeMm: 5, visualRangeMm: [1, 100], artworkRangeMm: [1, 100], shape: 'circle' },
};

/**
 * Extra diameter added to every cutout when the model is built.
 *
 * Printers undershoot holes: plastic squeezes inward as it cools and a hole
 * comes out a little smaller than drawn. Rather than inflating every nominal
 * size and losing track of what the real specification was, the allowance is
 * kept separate and applied at the end, so it can be dialled in for a printer
 * without editing a single panel.
 */
export const HOLE_CLEARANCE = { min: 0, max: 0.6, default: 0.2 } as const;

/** Whether a component's size is fixed by its hardware or genuinely varies. */
export function hasStandardSize(kind: FeatureKind): boolean {
  return kind !== 'custom' && kind !== 'display' && kind !== 'slider';
}

/**
 * What kind of picture we are looking at.
 *
 * It changes which size ranges apply, and it matters a lot: a jack measures
 * about 8 mm in a photo of a built module and about 4 mm in a panel drawing.
 */
export type SourceKind = 'photo' | 'artwork';

export function rangeFor(spec: ComponentSpec, source: SourceKind): [number, number] {
  return source === 'artwork' ? spec.artworkRangeMm : spec.visualRangeMm;
}

/**
 * What the palette offers.
 *
 * Shapes, not components. Placing a cutout is placing a shape; which part
 * eventually goes through it is a property of that shape, set afterwards from
 * the standard sizes, not a decision needed before you can draw anything.
 *
 * A rounded rectangle and a slot are both rectangles with a corner radius —
 * they are separate entries because reaching for "a slot" is common enough to
 * be worth one click rather than a rectangle plus a radius drag.
 */
export type CutoutShapeId = 'circle' | 'rect' | 'roundrect' | 'slot';

export interface CutoutPreset {
  id: CutoutShapeId;
  label: string;
  /** Starting geometry, in mm. */
  w: number;
  h: number;
  radius: number;
  shape: 'circle' | 'rect';
}

export const CUTOUT_PRESETS: CutoutPreset[] = [
  // 6 mm is the commonest hole on any Eurorack panel by a wide margin, so a
  // fresh circle starts there rather than at an arbitrary round number.
  { id: 'circle', label: 'Circle', shape: 'circle', w: 6, h: 6, radius: 3 },
  { id: 'rect', label: 'Rectangle', shape: 'rect', w: 20, h: 10, radius: 0 },
  { id: 'roundrect', label: 'Rounded rectangle', shape: 'rect', w: 20, h: 10, radius: 2 },
  { id: 'slot', label: 'Slot', shape: 'rect', w: 30, h: 4, radius: 2 },
];

/** Components whose hole size is fixed by the hardware, for the size presets. */
export const STANDARD_KINDS: FeatureKind[] = [
  'jack', 'pot', 'encoder', 'led', 'led5', 'button', 'buttonLarge', 'toggle', 'trimmer',
];

/** Infer HP from a panel width in mm (inverse of panelWidthMm), rounded to the grid. */
export function hpFromWidthMm(widthMm: number): number {
  return Math.max(1, Math.round((widthMm + PANEL_CLEARANCE_MM) / HP_MM));
}
