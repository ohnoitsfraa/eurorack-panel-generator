'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { conflicts, useStore } from '@/lib/store';
import { RACK_WIDTHS, packToSide, panelSlotFill, rowHeightPx, type Rack, type RackRow } from '@/lib/rack';
import type { Font } from 'opentype.js';
import { panelHeightMm, panelWidthMm } from '@/lib/eurorack';
import type { PanelDesign } from '@/lib/types';
import { PanelThumb } from './PanelThumb';
import { Button } from './ui';

/**
 * Rack layout, in the spirit of ModularGrid.
 *
 * Rows are drawn at a pixel-per-HP scale so every panel lands on the same
 * grid, which is what makes the layout legible: a 4 HP panel is visibly a
 * quarter of a 16 HP one. Panels drag within and between rows and snap to
 * whole HP, because rack rails are drilled on the HP pitch and a panel cannot
 * sit between holes.
 */

/**
 * How wide a rack is drawn.
 *
 * Rather than a fixed scale, the widest row is fitted to the space available,
 * so a rack uses the window it has been given instead of sitting in a column
 * with the rest of the page empty beside it. Zoom then multiplies that fit, so
 * 1 means "as wide as it goes".
 *
 * Capped at both ends: a single 4 HP panel blown up to fill a wide screen
 * looks absurd, and past a point a row is more useful scrolled than shrunk.
 */
const FIT = { minPxPerHp: 5, maxPxPerHp: 22, sidePaddingPx: 40 } as const;

/**
 * What counts as a double press: about the system default interval, and a
 * little movement allowed for a finger, which never lands twice in one place.
 */
const DOUBLE_PRESS = { ms: 400, slopPx: 10 } as const;

export function RackView() {
  const rack = useStore((s) => s.rack);
  const library = useStore((s) => s.library);
  const fonts = useStore((s) => s.fonts);
  const designWidthHp = useStore((s) => s.designWidthHp);
  const movePlacement = useStore((s) => s.movePlacement);
  const removePlacement = useStore((s) => s.removePlacement);
  const addRow = useStore((s) => s.addRow);
  const updateRow = useStore((s) => s.updateRow);
  const removeRow = useStore((s) => s.removeRow);
  const openDesign = useStore((s) => s.openDesign);
  const exportRack = useStore((s) => s.exportRack);
  const emptyRack = useStore((s) => s.emptyRack);
  const clearEverything = useStore((s) => s.clearEverything);
  const [confirming, setConfirming] = useState<'rack' | 'all' | null>(null);

  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState<string | null>(null);
  /** Where each panel stood when the current drag began, to show which ones it pushed. */
  const [dragFrom, setDragFrom] = useState<Map<string, { row: string; hp: number }> | null>(null);
  const packPlacements = useStore((s) => s.packPlacements);

  // A panel that is moved by something else, pushed aside or packed to a
  // side, jumps to its new place with a small hop, so the move is seen
  // without a slide that would lag behind the drag.
  const lastHp = useRef(new Map<string, number>());
  useEffect(() => {
    const seen = new Map<string, number>();
    for (const row of rack.rows) {
      for (const p of row.placements) {
        seen.set(p.id, p.hp);
        const was = lastHp.current.get(p.id);
        if (was === undefined || was === p.hp || p.id === dragging) continue;
        const el = document.querySelector<HTMLElement>(`[data-rack-placement="${p.id}"]`);
        el?.animate(
          [{ transform: 'translateY(0)' }, { transform: 'translateY(-7px)' }, { transform: 'translateY(0)' }],
          { duration: 170, easing: 'ease-out' },
        );
      }
    }
    lastHp.current = seen;
  }, [rack, dragging]);

  // A panel shown large, from its zoom button, to read its lettering
  // without opening it. Esc or a click closes it.
  const [peek, setPeek] = useState<string | null>(null);
  useEffect(() => {
    if (!peek) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPeek(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [peek]);

  // Measure the space the rack has, and fit the widest row into it.
  const frameRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setAvailable(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const widestHp = Math.max(1, ...rack.rows.map((r) => r.widthHp));
  const fitted = available > 0
    ? (available - FIT.sidePaddingPx) / widestHp
    : FIT.minPxPerHp * 1.6;
  const scale = Math.max(FIT.minPxPerHp, Math.min(FIT.maxPxPerHp, fitted)) * zoom;

  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const drag = useRef<{
    placementId: string;
    widthHp: number;
    grabOffsetHp: number;
    /** The rack as it stood when the drag began, which every step is laid out from. */
    origin: Rack;
  } | null>(null);

  const byId = new Map(library.map((d) => [d.id, d]));

  // Two quick presses on the same panel open it. Counted on pointerdown rather
  // than left to dblclick, which touch screens do not reliably send, and which
  // would otherwise have to compete with the drag the first press starts.
  const lastPress = useRef<{ placementId: string; at: number; x: number; y: number } | null>(null);
  const isSecondPress = (placementId: string, e: React.PointerEvent): boolean => {
    const prev = lastPress.current;
    const now = e.timeStamp;
    const again = prev !== null
      && prev.placementId === placementId
      && now - prev.at < DOUBLE_PRESS.ms
      && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_PRESS.slopPx;
    lastPress.current = again ? null : { placementId, at: now, x: e.clientX, y: e.clientY };
    return again;
  };

  /** Which row is under this pointer position, if any. */
  const rowAt = useCallback((clientY: number): RackRow | null => {
    for (const row of rack.rows) {
      const el = rowRefs.current.get(row.id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return row;
    }
    return null;
  }, [rack.rows]);

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const row = rowAt(e.clientY);
    if (!row) return;
    const el = rowRefs.current.get(row.id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const hp = (e.clientX - r.left) / scale - d.grabOffsetHp;
    const clamped = Math.max(0, Math.min(row.widthHp - d.widthHp, Math.round(hp)));
    // The panels already there step aside to make room.
    movePlacement(d.placementId, row.id, clamped, d.origin);
  };

  const endDrag = () => { drag.current = null; setDragging(null); setDragFrom(null); };

  const pushedCount = dragging && dragFrom
    ? rack.rows.reduce((n, r) => n + r.placements.filter((p) => {
      const b = dragFrom.get(p.id);
      return p.id !== dragging && b && b.row === r.id && b.hp !== p.hp;
    }).length, 0)
    : 0;

  const totalHp = rack.rows.reduce((n, r) => n + r.widthHp, 0);
  const usedTotal = rack.rows.reduce(
    (n, r) => n + r.placements.reduce((m, p) => m + designWidthHp(p.designId), 0),
    0,
  );

  return (
    <div
      ref={frameRef}
      className="flex h-full w-full flex-col overflow-auto bg-ink-950 p-5"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-[15px] font-medium">{rack.name}</h2>
        <span className="label text-[11.5px] tabular-nums text-ink-400">
          {usedTotal} of {totalHp} HP used · {rack.rows.length} row
          {rack.rows.length === 1 ? '' : 's'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button onClick={() => setZoom((z) => Math.max(0.5, z / 1.2))}>−</Button>
          <Button onClick={() => setZoom((z) => Math.min(3, z * 1.2))}>+</Button>
          <Button onClick={() => addRow()}>Add row</Button>
          <Button onClick={exportRack} disabled={usedTotal === 0} title="Export this rack and its panels to a file">
            Export rack
          </Button>
          <Button
            variant="danger"
            onClick={() => setConfirming((c) => (c ? null : 'rack'))}
            title="Empty the rack, or clear everything"
          >
            Clear…
          </Button>
        </div>
      </div>

      {confirming && (
        <div className="mb-4 rounded-lg border border-danger/50 bg-danger/5 p-3">
          <p className="text-[13.5px] text-ink-100">
            {confirming === 'rack'
              ? 'Take every panel out of the rack? The rows and your saved panels stay.'
              : 'Delete every saved panel, the rack, and the panel being edited?'}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-400">
            {confirming === 'rack'
              ? 'Panels stay in the library, so you can put them back.'
              : 'Everything is kept in this browser and nowhere else, so this cannot be undone. Export first if there is anything you want to keep.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            <Button onClick={() => setConfirming(null)}>Cancel</Button>
            {confirming === 'rack' ? (
              <>
                <Button
                  variant="danger"
                  onClick={() => { emptyRack(); setConfirming(null); }}
                  disabled={usedTotal === 0}
                >
                  Empty the rack
                </Button>
                <Button variant="ghost" onClick={() => setConfirming('all')}>
                  Clear everything instead…
                </Button>
              </>
            ) : (
              <Button
                variant="danger"
                onClick={() => { void clearEverything(); setConfirming(null); }}
              >
                Delete everything, for good
              </Button>
            )}
          </div>
        </div>
      )}

      {library.length === 0 && (
        <div className="mb-4 rounded-lg border border-dashed border-ink-600 px-4 py-6 text-center">
          <p className="text-[13.5px] text-ink-300">No saved panels yet</p>
          <p className="mt-1 text-[12.5px] text-ink-400">
            Design a panel in the Layout view and press Save, then it can go in the rack.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {rack.rows.map((row) => {
          const bad = conflicts(row, designWidthHp);
          const used = row.placements.reduce((n, p) => n + designWidthHp(p.designId), 0);
          return (
            <div key={row.id}>
              <div className="mb-1 flex items-center gap-2 text-[12.5px] text-ink-400">
                <RowWidth row={row} onChange={(widthHp) => updateRow(row.id, { widthHp })} />
                <select
                  value={row.format}
                  onChange={(e) => updateRow(row.id, { format: e.target.value as RackRow['format'] })}
                  className="rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[12.5px]"
                >
                  <option value="3U">3U</option>
                  <option value="1U-intellijel">1U Intellijel</option>
                  <option value="1U-pulplogic">1U Pulp Logic</option>
                </select>
                <span className="label tabular-nums">
                  {used}/{row.widthHp} HP
                  {row.widthHp - used > 0 ? ` · ${row.widthHp - used} free` : ''}
                </span>
                {bad.size > 0 && <span className="text-danger">panels overlap</span>}
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  className="ml-auto text-ink-400 hover:text-danger"
                  title="Remove row"
                >
                  Remove row
                </button>
              </div>

              <div
                ref={(el) => { if (el) rowRefs.current.set(row.id, el); }}
                className="relative rounded-md border border-ink-700 bg-ink-900"
                style={{
                  width: row.widthHp * scale,
                  height: rowHeightPx(row, scale),
                  // Rail ticks every HP, so free space is countable by eye.
                  backgroundImage:
                    'repeating-linear-gradient(to right, #ffffff10 0 1px, transparent 1px)',
                  backgroundSize: `${scale}px 100%`,
                }}
              >
                {row.placements.map((p) => {
                  const saved = byId.get(p.designId);
                  if (!saved) return null;
                  const w = designWidthHp(p.designId) * scale;
                  // A comfortable target, unless the panel itself is narrower
                  // than one: a 2 HP module is about 30px wide at the default
                  // zoom, and a button that overhung it would sit on its
                  // neighbour. Shrinking beats hanging over.
                  const btnPx = Math.max(16, Math.min(28, Math.floor(w) - 8));
                  // Pushed aside by the panel being dragged: where it began, and which way it went.
                  const began = dragFrom?.get(p.id);
                  const pushed = dragging && dragging !== p.id && began && began.row === row.id && began.hp !== p.hp
                    ? (p.hp > began.hp ? 'right' : 'left') : null;
                  // What the side arrows would move, so one that would move nothing is shown off.
                  const layout = row.placements.map((q) => ({ id: q.id, hp: q.hp, width: designWidthHp(q.designId) }));
                  const wouldMove = (side: 'left' | 'right') =>
                    [...packToSide(layout, p.id, side, row.widthHp)].some(([id, hp]) => layout.find((q) => q.id === id)?.hp !== hp);
                  const lifted = dragging === p.id;
                  return (
                    <div
                      key={p.id}
                      data-rack-placement={p.id}
                      data-pushed={pushed ?? undefined}
                      className={`group absolute top-0 h-full rounded-sm
                        ${lifted ? 'z-20 shadow-[0_10px_24px_rgba(0,0,0,0.55)] ring-2 ring-accent'
                          : pushed ? 'z-10 ring-2 ring-accent/70'
                          : bad.has(p.id) ? 'ring-2 ring-danger' : 'ring-1 ring-ink-600'}`}
                      style={{
                        left: p.hp * scale, width: w, cursor: lifted ? 'grabbing' : 'grab',
                        // Lifted off the rail while it is carried.
                        transform: lifted ? 'translateY(-4px) scale(1.02)' : undefined,
                      }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        if (isSecondPress(p.id, e)) {
                          endDrag();
                          openDesign(p.designId);
                          return;
                        }
                        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                        const r = e.currentTarget.getBoundingClientRect();
                        drag.current = {
                          placementId: p.id,
                          widthHp: designWidthHp(p.designId),
                          // Keep the grab point under the cursor rather than
                          // snapping the panel's left edge to it.
                          grabOffsetHp: (e.clientX - r.left) / scale,
                          origin: rack,
                        };
                        setDragging(p.id);
                        setDragFrom(new Map(rack.rows.flatMap((rr) => rr.placements.map((q) => [q.id, { row: rr.id, hp: q.hp }] as const))));
                      }}
                      title={`${saved.name} · ${saved.design.hp} HP · double-click to edit`}
                      data-rack-panel={saved.name}
                    >
                      <div className="h-full overflow-hidden rounded-sm">
                        <PanelThumb
                          design={saved.design}
                          fonts={fonts}
                          className="pointer-events-none h-full"
                          // The panel is a touch narrower than its slot; the
                          // remainder is the rack clearance, drawn as the seam.
                          style={{ width: `${panelSlotFill(saved.design.hp) * 100}%` }}
                        />
                      </div>
                      {pushed && (
                        // Which way it was pushed, while the drag that pushed it lasts.
                        <div className="pointer-events-none absolute inset-0 rounded-sm bg-accent/15 outline-dashed outline-1 outline-accent">
                          <span
                            className="absolute top-1/2 -translate-y-1/2 rounded bg-accent px-1 text-[12px] font-semibold leading-snug text-ink-950"
                            style={pushed === 'right' ? { left: 2 } : { right: 2 }}
                          >
                            {pushed === 'right' ? '→' : '←'}
                          </span>
                        </div>
                      )}
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden bg-ink-950/80 px-1 py-0.5
                                      text-[11px] leading-tight text-ink-100 group-hover:block">
                        {saved.name}
                      </div>
                      {/* Stacked rather than side by side: a panel is always
                          tall enough for three of these, and often not wide
                          enough. The gap between them is deliberate — one
                          opens the design and the last throws it out of the
                          rack, and they are a pointer-width apart. */}
                      {/* Push this panel and everything beyond it over to a
                          side. On the edges, halfway down, pointing the way
                          things will go; hidden while anything is carried. */}
                      {!dragging && (['left', 'right'] as const).map((side) => (
                        <div
                          key={side}
                          className="absolute top-1/2 hidden -translate-y-1/2 group-hover:block"
                          style={side === 'left' ? { left: 2 } : { right: 2 }}
                        >
                          <PanelAction
                            size={btnPx}
                            onClick={() => packPlacements(p.id, side)}
                            title={side === 'left'
                              ? `Move ${saved.name} and everything left of it over to the left`
                              : `Move ${saved.name} and everything right of it over to the right`}
                            disabled={!wouldMove(side)}
                          >
                            {side === 'left' ? <path d="M10 3.5L5.5 8l4.5 4.5" /> : <path d="M6 3.5L10.5 8 6 12.5" />}
                          </PanelAction>
                        </div>
                      ))}
                      <div
                        className="absolute right-1 top-1 hidden flex-col group-hover:flex"
                        style={{ gap: Math.max(2, Math.round(btnPx * 0.14)) }}
                      >
                        <PanelAction
                          size={btnPx}
                          onClick={() => setPeek(p.designId)}
                          title={`Zoom in on ${saved.name}`}
                        >
                          <circle cx="7" cy="7" r="4.3" />
                          <path d="M10.2 10.2l3.4 3.4" />
                        </PanelAction>
                        <PanelAction
                          size={btnPx}
                          onClick={() => openDesign(p.designId)}
                          title={`Edit ${saved.name}`}
                        >
                          <path d="M11.6 2.4a1.4 1.4 0 0 1 2 2L6.2 11.8l-2.7.7.7-2.7z" />
                        </PanelAction>
                        <PanelAction
                          size={btnPx}
                          onClick={() => removePlacement(p.id)}
                          title={`Remove ${saved.name} from the rack`}
                          className="rack-action-remove"
                        >
                          <path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" />
                        </PanelAction>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[12.5px] text-ink-400" data-rack-hint="">
        {dragging && pushedCount > 0
          ? `Making room: ${pushedCount} panel${pushedCount === 1 ? '' : 's'} moved aside. Let go to drop it here.`
          : 'Drag panels to move them between and within rows; panels in the way move aside. Hover a panel for arrows that push it and everything beyond it to one side.'}
      </p>

      {peek && byId.get(peek) && (
        <PanelPeek saved={byId.get(peek)!} fonts={fonts} onClose={() => setPeek(null)} />
      )}
    </div>
  );
}

/** One panel as large as the window allows, over the rack. */
function PanelPeek({
  saved, fonts, onClose,
}: {
  saved: { name: string; design: PanelDesign };
  fonts: Map<string, Font>;
  onClose: () => void;
}) {
  const W = panelWidthMm(saved.design.hp);
  const H = panelHeightMm(saved.design.format);
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-ink-950/85 p-6 backdrop-blur-sm"
      onPointerDown={onClose}
      role="dialog"
      aria-label={`${saved.name}, zoomed in`}
      data-rack-peek={saved.name}
    >
      <PanelThumb
        design={saved.design}
        fonts={fonts}
        className="max-h-full max-w-full drop-shadow-2xl"
        style={{ height: 'calc(100vh - 6rem)', aspectRatio: `${W} / ${H}` }}
      />
      <p className="text-[13px] text-ink-200">
        {saved.name} · {saved.design.hp} HP
        <span className="ml-2 text-ink-400">Esc or click to close</span>
      </p>
    </div>
  );
}

/**
 * A row's width, in HP.
 *
 * The common case sizes are offered because most people have a case rather
 * than a bench full of rails, but any width can be typed: home-built cases,
 * skiffs and rack ears come in whatever size they come in, and a list of seven
 * options cannot know that.
 */
function RowWidth({ row, onChange }: { row: RackRow; onChange: (hp: number) => void }) {
  const isPreset = RACK_WIDTHS.includes(row.widthHp as (typeof RACK_WIDTHS)[number]);
  const [custom, setCustom] = useState(!isPreset);
  const [draft, setDraft] = useState(String(row.widthHp));

  useEffect(() => { setDraft(String(row.widthHp)); }, [row.widthHp]);

  const commit = (raw: string) => {
    const n = Math.round(Number(raw));
    // Below 1 HP a row cannot hold anything; the ceiling is past any case that
    // exists and only stops a typo turning into an enormous layout.
    if (Number.isFinite(n) && n >= 1 && n <= 400) onChange(n);
    else setDraft(String(row.widthHp));
  };

  if (custom) {
    return (
      <span className="flex items-center gap-1">
        <input
          type="text"
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { commit((e.target as HTMLInputElement).value); e.currentTarget.blur(); }
            if (e.key === 'Escape') { setDraft(String(row.widthHp)); e.currentTarget.blur(); }
          }}
          aria-label="Row width in HP"
          className="w-14 rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[12.5px] tabular-nums
                     outline-none focus:border-accent"
        />
        <span className="text-[12.5px] text-ink-400">HP</span>
        <button
          type="button"
          onClick={() => setCustom(false)}
          className="px-1 text-[12.5px] text-ink-400 hover:text-ink-100"
          title="Choose from the common sizes instead"
        >
          ▾
        </button>
      </span>
    );
  }

  return (
    <select
      value={row.widthHp}
      onChange={(e) => {
        if (e.target.value === 'custom') { setCustom(true); return; }
        onChange(Number(e.target.value));
      }}
      className="rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[12.5px]"
      aria-label="Row width"
    >
      {RACK_WIDTHS.map((w) => (
        <option key={w} value={w}>{w} HP</option>
      ))}
      <option value="custom">Custom…</option>
    </select>
  );
}

/**
 * One of the small controls that appear on a panel in the rack.
 *
 * Icon-only, so it carries its own label for anyone not looking at it. The
 * square is the hit target and the glyph inside is half of it: the target is
 * what you aim at, the glyph only has to be recognisable.
 */
function PanelAction({
  size, onClick, title, className = '', disabled, children,
}: {
  size: number;
  onClick: () => void;
  title: string;
  className?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      // The panel underneath starts a drag on pointerdown, which would
      // otherwise steal the click.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      style={{ width: size, height: size }}
      className={`rack-action flex items-center justify-center rounded transition-colors disabled:opacity-35 ${className}`}
    >
      <svg
        viewBox="0 0 16 16"
        width={Math.round(size * 0.5)}
        height={Math.round(size * 0.5)}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  );
}
