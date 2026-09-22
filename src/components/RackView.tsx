'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { conflicts, useStore } from '@/lib/store';
import { RACK_WIDTHS, panelSlotFill, rowHeightPx, type RackRow } from '@/lib/rack';
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
  } | null>(null);

  const byId = new Map(library.map((d) => [d.id, d]));

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
    movePlacement(d.placementId, row.id, clamped);
  };

  const endDrag = () => { drag.current = null; setDragging(null); };

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
        <span className="text-[12.5px] tabular-nums text-ink-400">
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
                <span className="tabular-nums">
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
                  return (
                    <div
                      key={p.id}
                      className={`group absolute top-0 h-full overflow-hidden rounded-sm
                        ${bad.has(p.id) ? 'ring-2 ring-danger' : 'ring-1 ring-ink-600'}
                        ${dragging === p.id ? 'z-10 opacity-80' : ''}`}
                      style={{ left: p.hp * scale, width: w, cursor: 'grab' }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                        const r = e.currentTarget.getBoundingClientRect();
                        drag.current = {
                          placementId: p.id,
                          widthHp: designWidthHp(p.designId),
                          // Keep the grab point under the cursor rather than
                          // snapping the panel's left edge to it.
                          grabOffsetHp: (e.clientX - r.left) / scale,
                        };
                        setDragging(p.id);
                      }}
                      title={`${saved.name} · ${saved.design.hp} HP`}
                    >
                      <PanelThumb
                        design={saved.design}
                        fonts={fonts}
                        className="pointer-events-none h-full"
                        // The panel is a touch narrower than its slot; the
                        // remainder is the rack clearance, drawn as the seam.
                        style={{ width: `${panelSlotFill(saved.design.hp) * 100}%` }}
                      />
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden bg-ink-950/80 px-1 py-0.5
                                      text-[11px] leading-tight text-ink-100 group-hover:block">
                        {saved.name}
                      </div>
                      <div className="absolute right-0 top-0 hidden group-hover:flex">
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => openDesign(p.designId)}
                          className="bg-ink-950/85 px-1 text-[11px] text-ink-100 hover:text-accent"
                          title="Edit this design"
                        >
                          edit
                        </button>
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => removePlacement(p.id)}
                          className="bg-ink-950/85 px-1 text-[11px] text-ink-100 hover:text-danger"
                          title="Remove from rack"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[12.5px] text-ink-400">
        Drag panels to move them between and within rows; they snap to whole HP.
        Add panels from the library on the right.
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
