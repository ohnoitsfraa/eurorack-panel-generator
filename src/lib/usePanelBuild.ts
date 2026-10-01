'use client';

import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { buildPanel, buildPanelSafe, type BuildResult } from './model/build';
import { fontsSettled } from './model/text';
import type { Mesh, PanelDesign } from './types';

/**
 * Build the panel mesh from current state.
 *
 * A rebuild re-triangulates every cutout and joins every flush label into
 * the face, which on a busy panel takes longer than a frame. So it follows
 * the design once the design holds still, not on every pointer move of a
 * drag: the 2D canvas keeps up with the pointer and the 3D view, the counts
 * and the warnings catch up when it stops. An edit made after a pause, such
 * as a typed value, is built straight away.
 *
 * The result is shared, so the status bar, the 3D view and the export tab
 * reading the same design cost one build between them, not one each.
 */
export function usePanelBuild(): { result: BuildResult } {
  const design = useSettled(useStore((s) => s.design), SETTLE_MS);
  const fonts = useStore((s) => s.fonts);
  const fontVersion = useStore((s) => s.fontVersion);

  // fontVersion changes identity when a font finishes loading, which is what
  // should trigger text geometry to appear.
  if (shared?.design !== design || shared.fontVersion !== fontVersion) {
    shared = { design, fontVersion, result: buildPanelSafe(design, { fonts }) };
  }
  return { result: shared.result };
}

const SETTLE_MS = 150;

let shared: { design: PanelDesign; fontVersion: unknown; result: BuildResult } | null = null;

/**
 * The value, once it has stopped changing for a moment. A change after a
 * quiet spell comes through at once; changes in quick succession wait until
 * they stop, and then the latest one comes through.
 */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  const lastChange = useRef(0);
  useEffect(() => {
    if (Object.is(value, settled)) return;
    const now = performance.now();
    const quiet = now - lastChange.current > ms;
    lastChange.current = now;
    const t = setTimeout(() => setSettled(value), quiet ? 0 : ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return settled;
}

/**
 * Meshes for export, with any font still in flight waited out first.
 *
 * The on-screen build uses whatever is loaded, because a preview that blocks
 * on the network is worse than one missing a label for a moment. A download is
 * the opposite case: the file is the thing being made, and a panel that
 * reaches the printer without its lettering is a wasted print discovered an
 * hour later. State is read fresh afterwards rather than closed over, since
 * the await is exactly the window in which it changes.
 */
export async function meshesForExport(): Promise<Mesh[]> {
  await fontsSettled();
  const s = useStore.getState();
  return buildPanel(s.design, { fonts: s.fonts }).meshes;
}
