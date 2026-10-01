'use client';

import { useMemo } from 'react';
import { useStore } from './store';
import { buildPanel, buildPanelSafe, type BuildResult } from './model/build';
import { fontsSettled } from './model/text';
import type { Mesh } from './types';

/**
 * Build the panel mesh from current state.
 *
 * Memoised on the design and the loaded font set, because a rebuild
 * re-triangulates every cutout and is not something to do on a mouse move
 * that only changed the selection.
 */
export function usePanelBuild(): { result: BuildResult } {
  const design = useStore((s) => s.design);
  const fonts = useStore((s) => s.fonts);
  const fontVersion = useStore((s) => s.fontVersion);

  const result = useMemo(
    () => buildPanelSafe(design, { fonts }),
    // fontVersion changes identity when a font finishes loading, which is what
    // should trigger text geometry to appear.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [design, fontVersion],
  );

  return { result };
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
