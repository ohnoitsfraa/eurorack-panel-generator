'use client';

import { useMemo } from 'react';
import type { Font } from 'opentype.js';
import { MOUNT_SLOT, mountSlotPositions, panelHeightMm, panelWidthMm } from '@/lib/eurorack';
import type { DecorElement, PanelDesign } from '@/lib/types';
import { bbox, type Ring } from '@/lib/geom/poly';
import { textToRings } from '@/lib/model/text';
import { shapeRingsForPreview } from '@/lib/model/preview';
import { ringToPath } from './PanelCanvas2D';

/**
 * A read-only view of a panel, sized by its caller.
 *
 * Drawn from the same geometry the editor and the mesh builder use, so a panel
 * in the rack or the library looks like what will actually print rather than a
 * separate approximation that can drift.
 */
export function PanelThumb({
  design, fonts, className, style,
}: {
  design: PanelDesign;
  fonts: Map<string, Font>;
  className?: string;
  style?: React.CSSProperties;
}) {
  const W = panelWidthMm(design.hp);
  const H = panelHeightMm(design.format);

  const decorPaths = useMemo(
    () => design.decor.map((d) => ({ d, rings: decorRings(d, fonts) })),
    [design.decor, fonts],
  );

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      /*
        Letterbox rather than stretch. A container whose aspect does not match
        the panel is a bug in the caller, and quietly distorting the panel to
        fit hides it; centring the panel inside the box shows it instead.
      */
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={style}
      aria-label={`${design.hp} HP panel`}
    >
      <rect x={0} y={0} width={W} height={H} rx={design.cornerRadiusMm} fill={design.backgroundColor} />

      {decorPaths.map(({ d, rings }) =>
        rings.length ? (
          <path
            key={d.id}
            d={rings.map(ringToPath).join(' ')}
            fill={d.color}
            fillRule="evenodd"
            opacity={d.mode === 'engraved' ? 0.7 : 1}
          />
        ) : null,
      )}

      {design.features.map((f) =>
        f.shape === 'circle' ? (
          <circle key={f.id} cx={f.x} cy={f.y} r={f.w / 2} fill="#07080a" />
        ) : (
          <rect
            key={f.id}
            x={f.x - f.w / 2} y={f.y - f.h / 2} width={f.w} height={f.h}
            rx={Math.min(f.radius, Math.min(f.w, f.h) / 2)}
            transform={`rotate(${f.rotation} ${f.x} ${f.y})`}
            fill="#07080a"
          />
        ),
      )}

      {design.includeMountSlots &&
        mountSlotPositions(W, H).map((p, i) => (
          <rect
            key={`m${i}`}
            x={p.x - MOUNT_SLOT.lengthMm / 2}
            y={p.y - MOUNT_SLOT.heightMm / 2}
            width={MOUNT_SLOT.lengthMm}
            height={MOUNT_SLOT.heightMm}
            rx={MOUNT_SLOT.heightMm / 2}
            fill="#07080a"
          />
        ))}

      <rect
        x={0} y={0} width={W} height={H} rx={design.cornerRadiusMm}
        fill="none" stroke="#ffffff30" strokeWidth={0.25}
      />
    </svg>
  );
}

function decorRings(d: DecorElement, fonts: Map<string, Font>): Ring[] {
  if (d.type === 'text') {
    const font = fonts.get(`${d.fontFamily}@${d.fontWeight}`);
    return font ? textToRings(d, font) : [];
  }
  if (d.type === 'art') return d.rings;
  return shapeRingsForPreview(d);
}

export { bbox };
