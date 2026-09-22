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
  /** Cutout diameter (or width, for slots) in mm. */
  holeMm: number;
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

export const COMPONENT_SPECS: Record<FeatureKind, ComponentSpec> = {
  jack: { kind: 'jack', label: '3.5 mm jack', holeMm: 6.2, visualRangeMm: [5.2, 9.8], artworkRangeMm: [3.2, 5.4], shape: 'circle' },
  led: { kind: 'led', label: 'LED 3 mm', holeMm: 3.1, visualRangeMm: [2.4, 3.9], artworkRangeMm: [1.6, 3.2], shape: 'circle' },
  led5: { kind: 'led5', label: 'LED 5 mm', holeMm: 5.1, visualRangeMm: [4.4, 5.9], artworkRangeMm: [4.6, 5.8], shape: 'circle' },
  pot: { kind: 'pot', label: 'Potentiometer', holeMm: 7.2, visualRangeMm: [9.0, 24.0], artworkRangeMm: [8.0, 26.0], shape: 'circle' },
  trimmer: { kind: 'trimmer', label: 'Trimmer', holeMm: 4.0, visualRangeMm: [3.9, 5.2], artworkRangeMm: [2.8, 4.4], shape: 'circle' },
  encoder: { kind: 'encoder', label: 'Rotary encoder', holeMm: 7.2, visualRangeMm: [9.0, 22.0], artworkRangeMm: [8.0, 22.0], shape: 'circle' },
  button: { kind: 'button', label: 'Tact button', holeMm: 5.0, visualRangeMm: [3.5, 8.0], artworkRangeMm: [5.0, 9.0], shape: 'circle' },
  buttonLarge: { kind: 'buttonLarge', label: 'Large button', holeMm: 12.0, visualRangeMm: [9.5, 17.0], artworkRangeMm: [9.0, 17.0], shape: 'circle' },
  toggle: { kind: 'toggle', label: 'Toggle switch', holeMm: 6.1, visualRangeMm: [4.2, 7.0], artworkRangeMm: [3.0, 5.0], shape: 'circle' },
  slider: { kind: 'slider', label: 'Slider / fader', holeMm: 4.0, visualRangeMm: [2.0, 7.0], artworkRangeMm: [1.5, 7.0], shape: 'slot', slotLengthMm: 60 },
  display: { kind: 'display', label: 'Display cutout', holeMm: 0, visualRangeMm: [10, 80], artworkRangeMm: [10, 80], shape: 'rect' },
  mount: { kind: 'mount', label: 'Mounting slot', holeMm: MOUNT_SLOT.heightMm, visualRangeMm: [3, 6], artworkRangeMm: [3, 6], shape: 'slot', slotLengthMm: MOUNT_SLOT.lengthMm },
  custom: { kind: 'custom', label: 'Custom', holeMm: 5, visualRangeMm: [1, 100], artworkRangeMm: [1, 100], shape: 'circle' },
};

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

/** Kinds offered in the UI as manual "add a feature" options, in a sensible order. */
export const PLACEABLE_KINDS: FeatureKind[] = [
  'jack', 'pot', 'led', 'led5', 'button', 'buttonLarge',
  'toggle', 'slider', 'encoder', 'trimmer', 'display', 'custom',
];

/** Infer HP from a panel width in mm (inverse of panelWidthMm), rounded to the grid. */
export function hpFromWidthMm(widthMm: number): number {
  return Math.max(1, Math.round((widthMm + PANEL_CLEARANCE_MM) / HP_MM));
}
