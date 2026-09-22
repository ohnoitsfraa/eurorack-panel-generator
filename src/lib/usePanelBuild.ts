'use client';

import { useMemo } from 'react';
import { useStore } from './store';
import { buildPanel, type BuildResult } from './model/build';

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
    () => buildPanel(design, { fonts }),
    // fontVersion changes identity when a font finishes loading, which is what
    // should trigger text geometry to appear.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [design, fontVersion],
  );

  return { result };
}
