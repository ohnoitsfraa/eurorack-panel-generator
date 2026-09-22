'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COMPONENT_SPECS, MOUNT_SLOT, mountSlotPositions, panelHeightMm, panelWidthMm } from '@/lib/eurorack';
import type { DecorElement, Feature } from '@/lib/types';
import { useStore } from '@/lib/store';
import { textToRings } from '@/lib/model/text';
import { bbox, type Ring } from '@/lib/geom/poly';
import type { Font as OpentypeFont } from 'opentype.js';
import { shapeRingsForPreview } from '@/lib/model/preview';

/**
 * The 2D editor.
 *
 * Rendered as SVG in panel millimetres, so the numbers in the inspector and
 * the shapes on screen are the same coordinate system with no conversion
 * layer. Decor is drawn from the very same ring geometry the mesh builder
 * extrudes, which is what makes the preview trustworthy rather than merely
 * suggestive.
 */

const HANDLE_PX = 9;

export function PanelCanvas2D() {
  const design = useStore((s) => s.design);
  const features = design.features;
  const selectedIds = useStore((s) => s.selectedIds);
  const select = useStore((s) => s.select);
  const updateFeature = useStore((s) => s.updateFeature);
  const addFeature = useStore((s) => s.addFeature);
  const removeFeatures = useStore((s) => s.removeFeatures);
  const duplicateFeatures = useStore((s) => s.duplicateFeatures);
  const duplicateDecor = useStore((s) => s.duplicateDecor);
  const placeDecor = useStore((s) => s.placeDecor);
  const removeDecor = useStore((s) => s.removeDecor);
  const decor = useStore((s) => s.design.decor);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const gridMm = useStore((s) => s.gridMm);
  const showSource = useStore((s) => s.showSource);
  const sourceOpacity = useStore((s) => s.sourceOpacity);
  const croppedUrl = useCroppedSourceUrl();

  const W = panelWidthMm(design.hp);
  const H = panelHeightMm(design.format);

  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  // Padding in mm so the panel never sits flush against the viewport edge.
  const pad = 8;
  const viewW = (W + pad * 2) / zoom;
  const viewH = (H + pad * 2) / zoom;
  const viewBox = `${-pad + pan.x} ${-pad + pan.y} ${viewW} ${viewH}`;

  /** Screen pixels -> panel millimetres. */
  const toMm = useCallback((e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: pt.x, y: pt.y };
  }, []);

  /** Millimetres per screen pixel, for sizing handles that must stay constant. */
  const mmPerPx = useMemo(() => {
    const svg = svgRef.current;
    if (!svg) return viewW / 800;
    return viewW / (svg.clientWidth || 800);
  }, [viewW, zoom]);

  const snap = useCallback(
    (v: number, off: boolean) => (gridMm > 0 && !off ? Math.round(v / gridMm) * gridMm : round2(v)),
    [gridMm],
  );

  // --- dragging ---

  /**
   * One drag handles cutouts and decor together.
   *
   * Each item remembers where it started rather than accumulating deltas, so a
   * long drag cannot drift, and snapping stays anchored to the original
   * position instead of compounding rounding on every pointer move.
   */
  type DragItem =
    | { kind: 'feature'; id: string; ox: number; oy: number }
    | { kind: 'decor'; id: string; ox: number; oy: number }
    | { kind: 'art'; id: string; rings: Ring[] };

  const drag = useRef<{ items: DragItem[]; start: { x: number; y: number }; moved: boolean } | null>(null);

  const dragItemsFor = useCallback(
    (ids: string[]): DragItem[] => {
      const out: DragItem[] = [];
      for (const id of ids) {
        const f = features.find((x) => x.id === id);
        if (f) { out.push({ kind: 'feature', id, ox: f.x, oy: f.y }); continue; }
        const d = decor.find((x) => x.id === id);
        if (!d) continue;
        if (d.type === 'art') out.push({ kind: 'art', id, rings: d.rings });
        else out.push({ kind: 'decor', id, ox: d.x, oy: d.y });
      }
      return out;
    },
    [features, decor],
  );

  /**
   * Begin dragging whatever was grabbed.
   *
   * Holding Alt duplicates first and drags the copy, which is the convention
   * everywhere else and reads as "pull a copy off this one". The duplicate is
   * made with no offset so it sits exactly under the cursor.
   */
  const beginDrag = (e: React.PointerEvent, id: string, isDecor: boolean) => {
    if (tool) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);

    const additive = e.shiftKey;
    const base = additive
      ? selectedIds.includes(id) ? selectedIds.filter((i) => i !== id) : [...selectedIds, id]
      : selectedIds.includes(id) ? selectedIds : [id];

    if (e.altKey && base.length) {
      const featureIds = base.filter((i) => features.some((f) => f.id === i));
      const decorIds = base.filter((i) => decor.some((d) => d.id === i));
      const copies = [...duplicateFeatures(featureIds, 0), ...duplicateDecor(decorIds, 0)];
      if (copies.length) {
        select(copies);
        drag.current = { items: dragItemsFor(copies), start: toMm(e), moved: false };
        return;
      }
    }

    select(base);
    drag.current = { items: dragItemsFor(base), start: toMm(e), moved: false };
    void isDecor;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d) {
      const now = toMm(e);
      const dx = now.x - d.start.x;
      const dy = now.y - d.start.y;
      if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) d.moved = true;
      // Cmd/Ctrl temporarily ignores the grid, for nudging something into a
      // spot the grid will not reach.
      const free = e.metaKey || e.ctrlKey;
      for (const item of d.items) {
        if (item.kind === 'art') {
          placeDecor(item.id, snap(dx, free), snap(dy, free), item.rings);
        } else if (item.kind === 'decor') {
          placeDecor(item.id, snap(item.ox + dx, free), snap(item.oy + dy, free));
        } else {
          updateFeature(item.id, { x: snap(item.ox + dx, free), y: snap(item.oy + dy, free) });
        }
      }
      return;
    }
    if (marquee) {
      const p = toMm(e);
      setMarquee((m) => (m ? { ...m, x1: p.x, y1: p.y } : null));
    }
  };

  const onPointerUp = () => {
    if (marquee) {
      const x0 = Math.min(marquee.x0, marquee.x1);
      const x1 = Math.max(marquee.x0, marquee.x1);
      const y0 = Math.min(marquee.y0, marquee.y1);
      const y1 = Math.max(marquee.y0, marquee.y1);
      // Ignore a click-sized box: that is a deselect, not a selection.
      if (x1 - x0 > 0.6 || y1 - y0 > 0.6) {
        const hitFeatures = features
          .filter((f) => f.x >= x0 && f.x <= x1 && f.y >= y0 && f.y <= y1)
          .map((f) => f.id);
        const hitDecor = decor
          .filter((d) => d.type !== 'art' && d.x >= x0 && d.x <= x1 && d.y >= y0 && d.y <= y1)
          .map((d) => d.id);
        select([...hitFeatures, ...hitDecor]);
      } else {
        select([]);
      }
      setMarquee(null);
    }
    drag.current = null;
  };

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    const p = toMm(e);
    if (tool) {
      const free = e.metaKey || e.ctrlKey;
      addFeature(tool, snap(p.x, free), snap(p.y, free));
      // Shift keeps the tool active for placing a run of jacks in one go.
      if (!e.shiftKey) setTool(null);
      return;
    }
    setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };

  // --- keyboard ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;

      if (e.key === 'Escape') { setTool(null); select([]); return; }
      if (!selectedIds.length) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeFeatures(selectedIds.filter((id) => features.some((f) => f.id === id)));
        for (const id of selectedIds) if (decor.some((d) => d.id === id)) removeDecor(id);
        return;
      }
      if ((e.key === 'd' || e.key === 'D') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        duplicateFeatures(selectedIds.filter((id) => features.some((f) => f.id === id)));
        duplicateDecor(selectedIds.filter((id) => decor.some((d) => d.id === id)));
        return;
      }
      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
      };
      const dir = nudge[e.key];
      if (dir) {
        e.preventDefault();
        // Shift for a coarse step, otherwise the grid pitch, otherwise 0.1 mm.
        const step = e.shiftKey ? (gridMm || 1) * 5 : gridMm || 0.1;
        for (const id of selectedIds) {
          const f = features.find((x) => x.id === id);
          if (f) updateFeature(id, { x: round2(f.x + dir[0] * step), y: round2(f.y + dir[1] * step) });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds, features, decor, gridMm, removeFeatures, removeDecor, duplicateFeatures,
      duplicateDecor, updateFeature, placeDecor, select, setTool]);

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom((z) => Math.min(8, Math.max(0.4, z * (e.deltaY < 0 ? 1.12 : 0.89))));
  };

  const mountSlots = design.includeMountSlots ? mountSlotPositions(W, H) : [];
  const handleMm = HANDLE_PX * mmPerPx;

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink-950">
      <svg
        ref={svgRef}
        viewBox={viewBox}
        className={`h-full w-full ${tool ? 'cursor-crosshair' : 'cursor-default'}`}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
      >
        <defs>
          <clipPath id="panelClip">
            <rect x={0} y={0} width={W} height={H} rx={design.cornerRadiusMm} />
          </clipPath>
          <pattern id="hpGrid" width={5.08} height={5.08} patternUnits="userSpaceOnUse">
            <path d="M 5.08 0 L 0 0 0 5.08" fill="none" stroke="#ffffff14" strokeWidth={0.12} />
          </pattern>
        </defs>

        {/* Drop shadow, so the panel reads as a physical object on the backdrop. */}
        <rect
          x={0.6} y={0.9} width={W} height={H} rx={design.cornerRadiusMm}
          fill="#000" opacity={0.5}
        />

        <g clipPath="url(#panelClip)">
          <rect x={0} y={0} width={W} height={H} fill={design.backgroundColor} />

          {design.backgroundImage && (
            <image
              href={design.backgroundImage}
              x={0} y={0} width={W} height={H}
              opacity={design.backgroundImageOpacity}
              preserveAspectRatio={
                design.backgroundImageFit === 'stretch' ? 'none'
                : design.backgroundImageFit === 'contain' ? 'xMidYMid meet'
                : 'xMidYMid slice'
              }
            />
          )}

          {/* The source photo, for checking that detected holes line up. */}
          {showSource && croppedUrl && (
            <image
              href={croppedUrl}
              x={0} y={0} width={W} height={H}
              opacity={sourceOpacity}
              preserveAspectRatio="none"
            />
          )}

          <rect x={0} y={0} width={W} height={H} fill="url(#hpGrid)" />

          <DecorLayer onGrab={beginDrag} handleMm={handleMm} />
        </g>

        {/* Panel edge */}
        <rect
          x={0} y={0} width={W} height={H} rx={design.cornerRadiusMm}
          fill="none" stroke="#ffffff33" strokeWidth={0.2}
        />

        {mountSlots.map((p, i) => (
          <rect
            key={`m${i}`}
            x={p.x - MOUNT_SLOT.lengthMm / 2}
            y={p.y - MOUNT_SLOT.heightMm / 2}
            width={MOUNT_SLOT.lengthMm}
            height={MOUNT_SLOT.heightMm}
            rx={MOUNT_SLOT.heightMm / 2}
            fill="#0a0a0c"
            stroke="#ffffff40"
            strokeWidth={0.15}
          />
        ))}

        {features.map((f) => (
          <FeatureShape
            key={f.id}
            f={f}
            selected={selectedIds.includes(f.id)}
            onPointerDown={(e) => beginDrag(e, f.id, false)}
            handleMm={handleMm}
          />
        ))}

        {marquee && (
          <rect
            x={Math.min(marquee.x0, marquee.x1)}
            y={Math.min(marquee.y0, marquee.y1)}
            width={Math.abs(marquee.x1 - marquee.x0)}
            height={Math.abs(marquee.y1 - marquee.y0)}
            fill="#ffb45420"
            stroke="var(--color-accent)"
            strokeWidth={mmPerPx}
            strokeDasharray={`${mmPerPx * 3} ${mmPerPx * 3}`}
          />
        )}
      </svg>

      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 text-[11px] text-ink-400">
        <span className="tabular-nums">
          {design.hp} HP · {W.toFixed(1)} × {H.toFixed(1)} mm · {features.length} cutouts
        </span>
        <span>
          {tool
            ? `Click to place ${COMPONENT_SPECS[tool].label} · Shift-click to keep placing · Esc to stop`
            : 'Alt drag to duplicate · ⌘/Ctrl drag to ignore grid · ⌘/Ctrl scroll to zoom'}
        </span>
      </div>

      <div className="absolute right-3 top-3 flex gap-1">
        <ZoomButton onClick={() => setZoom((z) => Math.min(8, z * 1.25))}>+</ZoomButton>
        <ZoomButton onClick={() => setZoom((z) => Math.max(0.4, z / 1.25))}>−</ZoomButton>
        <ZoomButton onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Fit</ZoomButton>
      </div>
    </div>
  );
}

function ZoomButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-ink-700 bg-ink-900/80 px-2 py-1 text-xs text-ink-300
                 backdrop-blur hover:bg-ink-800"
    >
      {children}
    </button>
  );
}

function FeatureShape({
  f, selected, onPointerDown, handleMm,
}: {
  f: Feature;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  handleMm: number;
}) {
  const stroke = selected ? 'var(--color-accent)' : '#ffffff55';
  const sw = selected ? handleMm * 0.28 : handleMm * 0.16;
  // Low-confidence detections are flagged so the user knows where to look
  // rather than having to compare against the photo hole by hole.
  const shaky = f.confidence !== undefined && f.confidence < 0.45;

  const common = {
    fill: '#08090b',
    stroke: shaky && !selected ? 'var(--color-danger)' : stroke,
    strokeWidth: sw,
    strokeDasharray: shaky && !selected ? `${handleMm * 0.4} ${handleMm * 0.3}` : undefined,
    onPointerDown,
    style: { cursor: f.locked ? 'default' : 'move' },
  };

  const len = f.len ?? f.d;
  const rot = f.rotation ?? 0;

  return (
    <g>
      {f.shape === 'circle' && <circle cx={f.x} cy={f.y} r={f.d / 2} {...common} />}
      {f.shape === 'slot' && (
        <rect
          x={f.x - len / 2} y={f.y - f.d / 2} width={len} height={f.d} rx={f.d / 2}
          transform={`rotate(${rot} ${f.x} ${f.y})`}
          {...common}
        />
      )}
      {f.shape === 'rect' && (
        <rect
          x={f.x - f.d / 2} y={f.y - len / 2} width={f.d} height={len} rx={f.radius ?? 0}
          transform={`rotate(${rot} ${f.x} ${f.y})`}
          {...common}
        />
      )}
      {selected && (
        <circle cx={f.x} cy={f.y} r={handleMm * 0.22} fill="var(--color-accent)" pointerEvents="none" />
      )}
    </g>
  );
}

/** Decor drawn from the same rings the mesh builder uses. */
function DecorLayer({
  onGrab, handleMm,
}: {
  onGrab: (e: React.PointerEvent, id: string, isDecor: boolean) => void;
  handleMm: number;
}) {
  const decor = useStore((s) => s.design.decor);
  const fonts = useStore((s) => s.fonts);
  const fontVersion = useStore((s) => s.fontVersion);
  const ensureFont = useStore((s) => s.ensureFont);
  const selectedIds = useStore((s) => s.selectedIds);

  useEffect(() => {
    for (const d of decor) if (d.type === 'text') ensureFont(d.fontFamily, d.fontWeight);
  }, [decor, ensureFont]);

  return (
    <g>
      {decor.map((d) => (
        <DecorShape
          key={d.id}
          el={d}
          fonts={fonts}
          version={fontVersion}
          selected={selectedIds.includes(d.id)}
          handleMm={handleMm}
          onPointerDown={(e) => onGrab(e, d.id, true)}
        />
      ))}
    </g>
  );
}

function DecorShape({
  el, fonts, selected, handleMm, onPointerDown,
}: {
  el: DecorElement;
  fonts: Map<string, OpentypeFont>;
  version: number;
  selected: boolean;
  handleMm: number;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const rings = useMemo<Ring[]>(() => {
    if (el.type === 'text') {
      const font = fonts.get(`${el.fontFamily}@${el.fontWeight}`);
      return font ? textToRings(el, font) : [];
    }
    if (el.type === 'art') return el.rings;
    return shapeRingsForPreview(el);
  }, [el, fonts]);

  if (el.type === 'text' && rings.length === 0) {
    // Font still in flight: show the string so the layout is not a mystery.
    return (
      <text
        x={el.x} y={el.y + el.sizeMm * 0.36}
        fontSize={el.sizeMm * 1.35}
        fill={el.color}
        opacity={0.35}
        textAnchor={el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start'}
        transform={`rotate(${el.rotation} ${el.x} ${el.y})`}
        onPointerDown={onPointerDown}
        style={{ cursor: 'move' }}
      >
        {el.text}
      </text>
    );
  }

  const d = rings.map(ringToPath).join(' ');
  if (!d) return null;
  const box = bbox(rings);

  return (
    <g>
      <path
        d={d}
        fill={el.color}
        fillRule="evenodd"
        // Engraved decor is a recess, so it reads darker than the surface.
        opacity={el.mode === 'engraved' ? 0.75 : 1}
        onPointerDown={onPointerDown}
        style={{ cursor: 'move' }}
      />
      {/*
        An invisible hit area over the element's bounds. Text at panel sizes is
        thin, and asking someone to land the pointer on a 0.4 mm letter stroke
        to move a label is no good.
      */}
      <rect
        x={box.x0} y={box.y0}
        width={Math.max(0.01, box.x1 - box.x0)}
        height={Math.max(0.01, box.y1 - box.y0)}
        fill="transparent"
        onPointerDown={onPointerDown}
        style={{ cursor: 'move' }}
      />
      {selected && (
        <rect
          x={box.x0} y={box.y0}
          width={Math.max(0.01, box.x1 - box.x0)}
          height={Math.max(0.01, box.y1 - box.y0)}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={handleMm * 0.16}
          strokeDasharray={`${handleMm * 0.4} ${handleMm * 0.3}`}
          pointerEvents="none"
        />
      )}
    </g>
  );
}

export function ringToPath(r: Ring): string {
  if (r.length < 3) return '';
  let s = `M ${fmt(r[0].x)} ${fmt(r[0].y)}`;
  for (let i = 1; i < r.length; i++) s += ` L ${fmt(r[i].x)} ${fmt(r[i].y)}`;
  return `${s} Z`;
}

/**
 * Render the crop out to a data URL so it can underlay the panel.
 *
 * The crop is in source-image pixels while the panel is in millimetres, so
 * stretching the cropped region across the panel rect is exactly the alignment
 * the detector assumed. If they disagree visually, the HP or crop is wrong,
 * which is the whole point of showing it.
 */
function useCroppedSourceUrl(): string | null {
  const sourceImage = useStore((s) => s.sourceImage);
  const crop = useStore((s) => s.crop);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceImage || !crop) { setUrl(null); return; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(crop.w));
    canvas.height = Math.max(1, Math.round(crop.h));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const full = document.createElement('canvas');
    full.width = sourceImage.width;
    full.height = sourceImage.height;
    full.getContext('2d')?.putImageData(sourceImage, 0, 0);
    ctx.drawImage(full, -Math.round(crop.x), -Math.round(crop.y));

    const next = canvas.toDataURL('image/png');
    setUrl(next);
  }, [sourceImage, crop]);

  return url;
}

function fmt(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
