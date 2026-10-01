'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CUTOUT_PRESETS, MOUNT_SLOT, mountSlotPositions, panelHeightMm, panelWidthMm } from '@/lib/eurorack';
import type { DecorElement, Feature } from '@/lib/types';
import { useStore } from '@/lib/store';
import { textToRings } from '@/lib/model/text';
import { bbox, type Ring } from '@/lib/geom/poly';
import { alignTo, snapToGrid, type AlignTarget, type Guide } from '@/lib/align';
import { cutoutFill } from '@/lib/color';
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

/**
 * The SVG element, so handles can convert pointer positions into panel
 * millimetres. Passed by context rather than threaded through props, because
 * every handle needs it and nothing else does.
 */
const CanvasFrame = createContext<React.RefObject<SVGSVGElement | null> | null>(null);

/**
 * One drag handles cutouts and decor together.
 *
 * Each item remembers where it started rather than accumulating deltas, so a
 * long drag cannot drift, and snapping stays anchored to the original position
 * instead of compounding rounding on every pointer move.
 */
type DragItem =
  | { kind: 'feature'; id: string; ox: number; oy: number }
  | { kind: 'decor'; id: string; ox: number; oy: number }
  | { kind: 'art'; id: string; rings: Ring[] };

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
  /** Set while an Alt-drag is carrying a fresh copy, so the canvas can say so. */
  const [duplicating, setDuplicating] = useState<{ from: Array<{ x: number; y: number }> } | null>(null);

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

  /**
   * Millimetres per screen pixel.
   *
   * Taken from the SVG's own transform rather than from its width. The view
   * box is fitted inside the element with `meet`, so whenever the element's
   * shape differs from the panel's the drawing is letterboxed and the real
   * scale is set by whichever axis runs out first. Dividing by the width gets
   * it wrong by that ratio, which made handles the wrong size and put the
   * alignment tolerance out by several times.
   */
  const [mmPerPx, setMmPerPx] = useState(viewW / 800);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const ctm = svg.getScreenCTM();
      if (ctm && ctm.a > 0) setMmPerPx(1 / ctm.a);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, [viewW, viewH, zoom, pan.x, pan.y]);

  const snap = useCallback(
    (v: number, off: boolean) => (gridMm > 0 && !off ? Math.round(v / gridMm) * gridMm : round2(v)),
    [gridMm],
  );

  // --- dragging ---

  /**
   * The item under the cursor when the drag began.
   *
   * Snapping is worked out for this one and the resulting offset applied to
   * everything else in the selection, so a group keeps its internal spacing.
   * Snapping each item on its own quietly rearranges the group.
   */
  const drag = useRef<{
    items: DragItem[];
    anchor: { ox: number; oy: number } | null;
    start: { x: number; y: number };
    moved: boolean;
  } | null>(null);

  const [guides, setGuides] = useState<Guide[]>([]);

  /**
   * Snapshot what a drag will move.
   *
   * Read from the store rather than from this render's props. Alt-drag creates
   * the copies and starts dragging them inside one event handler, before React
   * has re-rendered, so anything captured in the closure does not know the
   * copies exist yet — the drag would find nothing to move and the duplicate
   * would sit motionless under the original until the pointer was released.
   */
  const dragItemsFor = useCallback((ids: string[]): DragItem[] => {
    const { features: nowFeatures, decor: nowDecor } = useStore.getState().design;
    const out: DragItem[] = [];
    for (const id of ids) {
      const f = nowFeatures.find((x) => x.id === id);
      if (f) { out.push({ kind: 'feature', id, ox: f.x, oy: f.y }); continue; }
      const d = nowDecor.find((x) => x.id === id);
      if (!d) continue;
      if (d.type === 'art') out.push({ kind: 'art', id, rings: d.rings });
      else out.push({ kind: 'decor', id, ox: d.x, oy: d.y });
    }
    return out;
  }, []);

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
      // Where the originals sit, so the canvas can show what is being left
      // behind while the copy moves away.
      const origins = [
        ...features.filter((f) => featureIds.includes(f.id)).map((f) => ({ x: f.x, y: f.y })),
        ...decor
          .filter((d) => decorIds.includes(d.id) && d.type !== 'art')
          .map((d) => ({ x: (d as { x: number }).x, y: (d as { y: number }).y })),
      ];
      const copies = [...duplicateFeatures(featureIds, 0), ...duplicateDecor(decorIds, 0)];
      if (copies.length) {
        select(copies);
        setDuplicating({ from: origins });
        const items = dragItemsFor(copies);
        drag.current = { items, anchor: anchorOf(items, copies[0]), start: toMm(e), moved: false };
        return;
      }
    }

    select(base);
    const items = dragItemsFor(base);
    drag.current = { items, anchor: anchorOf(items, id), start: toMm(e), moved: false };
    void isDecor;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d) {
      const now = toMm(e);
      let dx = now.x - d.start.x;
      let dy = now.y - d.start.y;
      if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) d.moved = true;
      // Cmd/Ctrl temporarily ignores both the grid and the guides, for nudging
      // something into a spot neither would allow.
      const free = e.metaKey || e.ctrlKey;

      if (d.anchor) {
        const raw = { x: d.anchor.ox + dx, y: d.anchor.oy + dy };
        if (free) {
          setGuides([]);
          dx = round2(raw.x) - d.anchor.ox;
          dy = round2(raw.y) - d.anchor.oy;
        } else {
          // Alignment is decided first and the grid only fills in where
          // nothing lined up, because lining two things up is the more
          // specific intention of the two.
          const moving = new Set(d.items.map((i) => i.id));
          const targets = alignTargets(features, decor, moving);
          const self = selfExtent(features, decor, d.items);
          const res = alignTo(raw.x, raw.y, targets, { w: W, h: H }, HANDLE_PX * mmPerPx * 0.8, self);
          setGuides(res.guides);
          const gx = res.guides.some((g) => g.axis === 'x') ? res.x : snapToGrid(raw.x, gridMm);
          const gy = res.guides.some((g) => g.axis === 'y') ? res.y : snapToGrid(raw.y, gridMm);
          dx = gx - d.anchor.ox;
          dy = gy - d.anchor.oy;
        }
      }

      for (const item of d.items) {
        if (item.kind === 'art') {
          placeDecor(item.id, round2(dx), round2(dy), item.rings);
        } else if (item.kind === 'decor') {
          placeDecor(item.id, round2(item.ox + dx), round2(item.oy + dy));
        } else {
          updateFeature(item.id, { x: round2(item.ox + dx), y: round2(item.oy + dy) });
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
    setDuplicating(null);
    setGuides([]);
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
  const soleSelection =
    selectedIds.length === 1 ? features.find((f) => f.id === selectedIds[0]) : undefined;
  // Worked out from the panel rather than the theme: a hole has to contrast
  // with the surface it is cut through, whatever colour that has been set to.
  const holeFill = cutoutFill(design.backgroundColor);

  return (
    <CanvasFrame.Provider value={svgRef}>
    <div className="relative h-full w-full overflow-hidden"
      style={{ background: 'var(--stage)' }}>
      <svg
        ref={svgRef}
        viewBox={viewBox}
        role="application"
        aria-label="Panel layout"
        data-panel-canvas=""
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
            <path d="M 5.08 0 L 0 0 0 5.08" fill="none" stroke="var(--grid-line)" strokeWidth={0.12} />
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
          fill="none" stroke="var(--panel-edge)" strokeWidth={0.2}
        />

        {mountSlots.map((p, i) => (
          <rect
            key={`m${i}`}
            x={p.x - MOUNT_SLOT.lengthMm / 2}
            y={p.y - MOUNT_SLOT.heightMm / 2}
            width={MOUNT_SLOT.lengthMm}
            height={MOUNT_SLOT.heightMm}
            rx={MOUNT_SLOT.heightMm / 2}
            fill={holeFill}
            stroke="var(--panel-edge)"
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
            fill={holeFill}
          />
        ))}

        {/* Alignment guides. Drawn over everything, since their whole job is
            to be noticed the moment two things line up. */}
        {guides.map((g, i) => {
          const pad = handleMm * 0.8;
          const panelLine = g.source === 'panel';
          return (
            <g key={`g${i}`} pointerEvents="none">
              <line
                x1={g.axis === 'x' ? g.at : g.from - pad}
                y1={g.axis === 'x' ? g.from - pad : g.at}
                x2={g.axis === 'x' ? g.at : g.to + pad}
                y2={g.axis === 'x' ? g.to + pad : g.at}
                stroke={panelLine ? '#6ec1ff' : 'var(--color-accent)'}
                strokeWidth={handleMm * 0.1}
                strokeDasharray={panelLine ? `${handleMm * 0.5} ${handleMm * 0.4}` : undefined}
              />
              {/* Small ticks at the ends, so a guide is still readable where it
                  runs across a busy part of the panel. */}
              {[g.from - pad, g.to + pad].map((end, k) => (
                <line
                  key={k}
                  x1={g.axis === 'x' ? g.at - handleMm * 0.3 : end}
                  y1={g.axis === 'x' ? end : g.at - handleMm * 0.3}
                  x2={g.axis === 'x' ? g.at + handleMm * 0.3 : end}
                  y2={g.axis === 'x' ? end : g.at + handleMm * 0.3}
                  stroke={panelLine ? '#6ec1ff' : 'var(--color-accent)'}
                  strokeWidth={handleMm * 0.1}
                />
              ))}
              {g.gap && <GuideGap guide={g} gap={g.gap} handleMm={handleMm} />}
            </g>
          );
        })}

        {/* While an Alt-drag is in progress, ring what was left behind and
            what is being carried, so it is obvious a copy is being made rather
            than the original being moved. */}
        {duplicating && (
          <g pointerEvents="none">
            {duplicating.from.map((p, i) => (
              <circle
                key={`o${i}`}
                cx={p.x} cy={p.y} r={handleMm * 0.9}
                fill="none" stroke="var(--color-ink-400)" strokeWidth={handleMm * 0.14}
                strokeDasharray={`${handleMm * 0.3} ${handleMm * 0.25}`}
              />
            ))}
            {features
              .filter((f) => selectedIds.includes(f.id))
              .map((f) => (
                <g key={`c${f.id}`}>
                  <circle
                    cx={f.x} cy={f.y} r={handleMm * 1.05}
                    fill="none" stroke="var(--color-accent)" strokeWidth={handleMm * 0.2}
                  />
                  <text
                    x={f.x + handleMm * 1.3} y={f.y - handleMm * 0.9}
                    fontSize={handleMm * 1.5}
                    fill="var(--color-accent)"
                    style={{ fontWeight: 700 }}
                  >
                    +1
                  </text>
                </g>
              ))}
          </g>
        )}

        {/* Handles only for a lone selection: resizing several cutouts around
            different centres at once is more confusing than useful. */}
        {!tool && !duplicating && soleSelection && (
          <FeatureHandles f={soleSelection} handleMm={handleMm} />
        )}

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

      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 text-[12.5px] text-ink-400">
        <span className="tabular-nums">
          {design.hp} HP · {W.toFixed(1)} × {H.toFixed(1)} mm · {features.length} cutouts
        </span>
        <span>
          {duplicating
            ? 'Duplicating — release to drop the copy'
            : guides.length
            ? `Aligned${guides.some((g) => g.source === 'panel') ? ' to the panel centre' : ''}`
              + `${gapSummary(guides)} · ⌘/Ctrl to ignore`
            : tool
            ? `Click to place a ${(CUTOUT_PRESETS.find((p) => p.id === tool)?.label ?? 'cutout').toLowerCase()} · Shift-click to keep placing · Esc to stop`
            : 'Alt drag to duplicate · ⌘/Ctrl drag to ignore grid · ⌘/Ctrl scroll to zoom'}
        </span>
      </div>

      <div className="absolute right-3 top-3 flex gap-1">
        <ZoomButton onClick={() => setZoom((z) => Math.min(8, z * 1.25))}>+</ZoomButton>
        <ZoomButton onClick={() => setZoom((z) => Math.max(0.4, z / 1.25))}>−</ZoomButton>
        <ZoomButton onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Fit</ZoomButton>
      </div>
    </div>
    </CanvasFrame.Provider>
  );
}

/** The grabbed item, whose snapping decides where the whole selection lands. */
function anchorOf(items: DragItem[], preferredId: string): { ox: number; oy: number } | null {
  const chosen = items.find((i) => i.id === preferredId) ?? items[0];
  if (!chosen) return null;
  if (chosen.kind === 'art') return { ox: 0, oy: 0 };
  return { ox: chosen.ox, oy: chosen.oy };
}

/** Everything a drag can line up against, minus whatever is being dragged. */
function alignTargets(
  features: Feature[],
  decor: DecorElement[],
  moving: Set<string>,
): AlignTarget[] {
  const out: AlignTarget[] = [];
  for (const f of features) {
    if (moving.has(f.id)) continue;
    const rx = (f.shape === 'circle' ? f.w : f.w) / 2;
    const ry = (f.shape === 'circle' ? f.w : f.h) / 2;
    out.push({ id: f.id, x: f.x, y: f.y, rx, ry });
  }
  for (const d of decor) {
    if (moving.has(d.id) || d.type === 'art') continue;
    out.push({ id: d.id, x: d.x, y: d.y, rx: 2, ry: 2 });
  }
  return out;
}

/** Half-size of what is being dragged, so its guide spans it. */
function selfExtent(features: Feature[], decor: DecorElement[], items: DragItem[]): { rx: number; ry: number } {
  const first = items[0];
  if (!first) return { rx: 0, ry: 0 };
  const f = features.find((x) => x.id === first.id);
  if (f) return { rx: f.w / 2, ry: (f.shape === 'circle' ? f.w : f.h) / 2 };
  void decor;
  return { rx: 2, ry: 2 };
}

function ZoomButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-ink-700 bg-ink-900/80 px-2 py-1 text-[13.5px] text-ink-300
                 backdrop-blur hover:bg-ink-800"
    >
      {children}
    </button>
  );
}

function FeatureShape({
  f, selected, onPointerDown, handleMm, fill,
}: {
  f: Feature;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  handleMm: number;
  fill: string;
}) {
  const stroke = selected ? 'var(--color-accent)' : 'var(--panel-edge)';
  const sw = selected ? handleMm * 0.28 : handleMm * 0.16;
  // Low-confidence detections are flagged so the user knows where to look
  // rather than having to compare against the photo hole by hole.
  const shaky = f.confidence !== undefined && f.confidence < 0.45;

  const common = {
    fill,
    stroke: shaky && !selected ? 'var(--color-danger)' : stroke,
    strokeWidth: sw,
    strokeDasharray: shaky && !selected ? `${handleMm * 0.4} ${handleMm * 0.3}` : undefined,
    onPointerDown,
    style: { cursor: 'move' },
  };

  return (
    <g>
      {f.shape === 'circle' ? (
        <circle cx={f.x} cy={f.y} r={f.w / 2} {...common} />
      ) : (
        <rect
          x={f.x - f.w / 2} y={f.y - f.h / 2} width={f.w} height={f.h}
          rx={Math.min(f.radius, Math.min(f.w, f.h) / 2)}
          transform={`rotate(${f.rotation} ${f.x} ${f.y})`}
          {...common}
        />
      )}
      {selected && (
        <circle cx={f.x} cy={f.y} r={handleMm * 0.18} fill="var(--color-accent)" pointerEvents="none" />
      )}
    </g>
  );
}

type HandleRole = 'size' | 'width' | 'height' | 'corner' | 'radius' | 'rotate';

/**
 * Drag handles for the selected cutout.
 *
 * Shown only for a single selection, because a handle that resizes several
 * things at once around different centres is more confusing than useful.
 *
 * Everything is worked out in the cutout's own rotated frame, so dragging the
 * width handle of a cutout turned 30° widens it along its own axis rather than
 * along the screen. Handles keep a constant size on screen regardless of zoom,
 * which is why their geometry is expressed in `handleMm`.
 */
function FeatureHandles({ f, handleMm }: { f: Feature; handleMm: number }) {
  const updateFeature = useStore((s) => s.updateFeature);
  const gridMm = useStore((s) => s.gridMm);
  const svgRef = useContext(CanvasFrame);

  const drag = useRef<{ role: HandleRole; start: Feature } | null>(null);
  const r = handleMm * 0.42;
  const rot = (f.rotation * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);

  /** Panel point -> the cutout's own frame, with rotation undone. */
  const toLocal = (px: number, py: number) => {
    const dx = px - f.x;
    const dy = py - f.y;
    return { u: dx * cos + dy * sin, v: -dx * sin + dy * cos };
  };
  /** The cutout's frame -> panel space, for placing the handles. */
  const toPanel = (u: number, v: number) => ({
    x: f.x + u * cos - v * sin,
    y: f.y + u * sin + v * cos,
  });

  const pointAt = (e: React.PointerEvent) => {
    const svg = svgRef?.current;
    if (!svg) return { x: 0, y: 0 };
    return new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
  };

  const snap = (v: number, free: boolean) =>
    gridMm > 0 && !free ? Math.round(v / gridMm) * gridMm : Math.round(v * 100) / 100;

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = pointAt(e);
    const { u, v } = toLocal(p.x, p.y);
    const free = e.metaKey || e.ctrlKey;
    const min = 0.4;

    if (d.role === 'rotate') {
      // Shift constrains to 15° steps, the usual way to get a clean right angle.
      const raw = (Math.atan2(p.y - f.y, p.x - f.x) * 180) / Math.PI;
      const stepped = e.shiftKey ? Math.round(raw / 15) * 15 : Math.round(raw);
      updateFeature(f.id, { rotation: ((stepped + 90) % 180) - 90 });
      return;
    }

    if (d.role === 'radius') {
      // Measured inward from the corner along the diagonal.
      const maxR = Math.min(f.w, f.h) / 2;
      const fromCorner = Math.hypot(f.w / 2 - Math.abs(u), f.h / 2 - Math.abs(v));
      updateFeature(f.id, { radius: Math.max(0, Math.min(maxR, fromCorner)) });
      return;
    }

    // Resizing is symmetric about the centre: a cutout's position is what has
    // been carefully placed, so the handle changes its size, not where it sits.
    const w = Math.max(min, snap(Math.abs(u) * 2, free));
    const h = Math.max(min, snap(Math.abs(v) * 2, free));

    if (f.shape === 'circle' || d.role === 'size') {
      const size = Math.max(min, snap(Math.hypot(u, v) * 2, free));
      updateFeature(f.id, { w: size, h: size, radius: size / 2 });
      return;
    }
    const next =
      d.role === 'width' ? { w } : d.role === 'height' ? { h } : { w, h };
    const nw = next.w ?? f.w;
    const nh = next.h ?? f.h;
    updateFeature(f.id, { ...next, radius: Math.min(f.radius, Math.min(nw, nh) / 2) });
  };

  const begin = (role: HandleRole) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { role, start: f };
  };
  const end = () => { drag.current = null; };

  const handles: Array<{ role: HandleRole; u: number; v: number; cursor: string }> =
    f.shape === 'circle'
      ? [{ role: 'size', u: f.w / 2, v: 0, cursor: 'ew-resize' }]
      : [
          { role: 'width', u: f.w / 2, v: 0, cursor: 'ew-resize' },
          { role: 'height', u: 0, v: f.h / 2, cursor: 'ns-resize' },
          { role: 'corner', u: f.w / 2, v: f.h / 2, cursor: 'nwse-resize' },
        ];

  const rotateAt = toPanel(0, -f.h / 2 - handleMm * 1.5);
  const radiusAt = toPanel(f.w / 2 - Math.min(f.radius, Math.min(f.w, f.h) / 2), -f.h / 2);

  return (
    <g onPointerMove={onMove} onPointerUp={end} onPointerLeave={end}>
      {f.shape === 'rect' && (
        <>
          <line
            x1={f.x} y1={f.y} x2={rotateAt.x} y2={rotateAt.y}
            stroke="var(--color-accent)" strokeWidth={handleMm * 0.1} pointerEvents="none"
          />
          <circle
            cx={rotateAt.x} cy={rotateAt.y} r={r}
            fill="var(--color-ink-950)" stroke="var(--color-accent)" strokeWidth={handleMm * 0.14}
            style={{ cursor: 'grab' }}
            onPointerDown={begin('rotate')}
          >
            <title>Drag to rotate · Shift for 15° steps</title>
          </circle>
          <rect
            x={radiusAt.x - r * 0.8} y={radiusAt.y - r * 0.8} width={r * 1.6} height={r * 1.6}
            fill="var(--color-ink-950)" stroke="var(--color-accent)" strokeWidth={handleMm * 0.12}
            style={{ cursor: 'nwse-resize' }}
            onPointerDown={begin('radius')}
          >
            <title>Drag to round the corners</title>
          </rect>
        </>
      )}

      {handles.map((hd) => {
        const p = toPanel(hd.u, hd.v);
        return (
          <rect
            key={hd.role}
            x={p.x - r} y={p.y - r} width={r * 2} height={r * 2}
            fill="var(--color-accent)" stroke="var(--color-ink-950)" strokeWidth={handleMm * 0.08}
            style={{ cursor: hd.cursor }}
            onPointerDown={begin(hd.role)}
          >
            <title>Drag to resize · ⌘/Ctrl to ignore the grid</title>
          </rect>
        );
      })}
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
  const selectedIds = useStore((s) => s.selectedIds);

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

/**
 * The distance between the dragged thing and what it lined up with.
 *
 * Drawn as a dimension on the guide itself — ticks at the two centres, the
 * figure between them — rather than following the pointer, so it reads as a
 * measurement of the panel and not as a tooltip. The label is set across the
 * line on the vertical guides, where there is room, and alongside it on the
 * horizontal ones, where there is not.
 *
 * Centre to centre, because that is how component spacing is specified: a
 * column of jacks at 15 mm centres is the figure on the drawing, not the gap
 * between the holes.
 */
function GuideGap({
  guide, gap, handleMm,
}: { guide: Guide; gap: NonNullable<Guide['gap']>; handleMm: number }) {
  const vertical = guide.axis === 'x';
  const mid = (gap.from + gap.to) / 2;
  const tick = handleMm * 0.45;
  const font = handleMm * 1.25;
  // As many decimals as the figure actually has, up to two. A round 20 mm
  // should not read "20.00", and 5.08 — one HP, which the grid offers as a
  // step — must not round to "5.1" for anyone checking pitch.
  const text = `${trim(gap.mm)} mm`;

  // Clear of the line either way: beside it when the line is vertical, above
  // it when the line runs across.
  const x = vertical ? guide.at + font * 0.6 : mid;
  const y = vertical ? mid : guide.at - font * 0.85;

  return (
    <g pointerEvents="none">
      {[gap.from, gap.to].map((end, i) => (
        <line
          key={i}
          x1={vertical ? guide.at - tick : end}
          y1={vertical ? end : guide.at - tick}
          x2={vertical ? guide.at + tick : end}
          y2={vertical ? end : guide.at + tick}
          stroke="var(--color-accent)"
          strokeWidth={handleMm * 0.14}
        />
      ))}
      {/* A halo drawn from the glyphs themselves rather than a box behind
          them: a box has to be sized from a guess at the text width, and the
          guess clipped "25 mm" the first time it was tried. */}
      <text
        x={x}
        y={y}
        fontSize={font}
        textAnchor={vertical ? 'start' : 'middle'}
        dominantBaseline="central"
        fill="var(--color-accent)"
        stroke="var(--color-ink-950)"
        strokeWidth={font * 0.3}
        strokeLinejoin="round"
        style={{ fontWeight: 600, paintOrder: 'stroke' }}
      >
        {text}
      </text>
    </g>
  );
}

/** The same figures for the readout at the foot of the canvas. */
function gapSummary(guides: Guide[]): string {
  const parts = guides
    .filter((g) => g.gap)
    .map((g) => `${g.axis === 'x' ? '↕' : '↔'} ${trim(g.gap!.mm)} mm`);
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}

/** Two decimals at most, and none that are only zeros. */
function trim(mm: number): string {
  return String(Math.round(mm * 100) / 100);
}
