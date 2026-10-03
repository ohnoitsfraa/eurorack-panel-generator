'use client';

import { useRef } from 'react';
import {
  COMPONENT_SPECS, CUTOUT_PRESETS, DECOR_KEEPOUT, HOLE_CLEARANCE, STANDARD_KINDS, THICKNESS,
  decorKeepoutMm, hasStandardSize, panelWidthMm,
} from '@/lib/eurorack';
import { describeFeature, isStadium, type Feature, type FeatureKind, type PanelFormat } from '@/lib/types';
import { featureForKind, useStore } from '@/lib/store';
import { pickInList } from '@/lib/listSelect';
import { Button, ColorInput, Field, NumberInput, ROTATION_DETENTS, Section, Select, shared, Slider, Toggle } from './ui';

/**
 * Everything about one cutout.
 *
 * Changing the type resets the geometry to that component's standard size,
 * because that is nearly always what is meant — the exception being a shape
 * deliberately tuned by hand, which is what Custom is for.
 */
function FeatureEditor({ feature: f }: { feature: Feature }) {
  const updateFeature = useStore((s) => s.updateFeature);
  const removeFeatures = useStore((s) => s.removeFeatures);
  const duplicateFeatures = useStore((s) => s.duplicateFeatures);
  const spec = COMPONENT_SPECS[f.kind];
  const standard = hasStandardSize(f.kind);
  const offStandard = standard && f.shape === 'circle' && Math.abs(f.w - spec.holeMm) > 0.01;

  const setSize = (w: number, h: number) =>
    updateFeature(f.id, {
      w, h,
      radius: f.shape === 'circle' ? w / 2 : Math.min(f.radius, Math.min(w, h) / 2),
    });

  return (
    <Section title={describeFeature(f, spec.label)}>
      <Field label="Standard size" hint={standard ? `${spec.holeMm} mm` : undefined}>
        <Select<FeatureKind | 'custom'>
          value={standard ? f.kind : 'custom'}
          onChange={(kind) =>
            updateFeature(f.id, kind === 'custom'
              ? { kind: 'custom' }
              : { ...featureForKind(kind), x: f.x, y: f.y })
          }
          options={[
            { value: 'custom', label: 'Custom size' },
            ...STANDARD_KINDS.map((k) => ({
              value: k,
              label: `${COMPONENT_SPECS[k].label} — ${COMPONENT_SPECS[k].holeMm} mm`,
            })),
          ]}
        />
      </Field>
      <p className="-mt-1 text-[12.5px] leading-relaxed text-ink-400">
        Picking a component sets the hole to the size that hardware needs, and
        keeps every cutout of that type matching.
      </p>

      <Field label="Shape">
        <Select
          value={f.shape}
          onChange={(shape) =>
            updateFeature(f.id, shape === 'circle'
              ? { shape, h: f.w, radius: f.w / 2 }
              : { shape, radius: Math.min(f.radius, Math.min(f.w, f.h) / 2) })
          }
          options={[
            { value: 'circle', label: 'Circle' },
            { value: 'rect', label: 'Rectangle' },
          ]}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="X" hint="mm">
          <NumberInput value={f.x} onChange={(x) => updateFeature(f.id, { x })} step={0.1} />
        </Field>
        <Field label="Y" hint="mm">
          <NumberInput value={f.y} onChange={(y) => updateFeature(f.id, { y })} step={0.1} />
        </Field>
      </div>

      {f.shape === 'circle' ? (
        <Field label="Diameter" hint="mm">
          <NumberInput
            value={f.w}
            onChange={(d) => setSize(d, d)}
            min={0.2} max={200} step={0.1}
          />
        </Field>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Width" hint="mm">
              <NumberInput value={f.w} onChange={(w) => setSize(w, f.h)} min={0.2} max={300} step={0.1} />
            </Field>
            <Field label="Height" hint="mm">
              <NumberInput value={f.h} onChange={(h) => setSize(f.w, h)} min={0.2} max={300} step={0.1} />
            </Field>
          </div>
          <Field label="Corner radius" hint={isStadium(f) ? 'fully rounded' : 'mm'}>
            <Slider
              min={0}
              max={Math.min(f.w, f.h) / 2}
              step={0.05}
              value={Math.min(f.radius, Math.min(f.w, f.h) / 2)}
              onChange={(radius) => updateFeature(f.id, { radius })}
            />
          </Field>
        </>
      )}

      {f.shape === 'rect' && (
        <Field label="Rotation" hint={`${f.rotation.toFixed(0)}°`}>
          <Slider
            min={-90} max={90} step={1}
            value={f.rotation}
            onChange={(rotation) => updateFeature(f.id, { rotation })}
            detents={ROTATION_DETENTS.half} labelled={ROTATION_DETENTS.labelled}
          />
        </Field>
      )}

      {offStandard && (
        <div className="rounded-md border border-ink-700 bg-ink-900 px-2.5 py-2">
          <p className="text-[12.5px] leading-relaxed text-ink-300">
            A {spec.label.toLowerCase()} normally needs {spec.holeMm} mm. This one
            is {f.w.toFixed(2)} mm.
          </p>
          <Button
            onClick={() => setSize(spec.holeMm, spec.holeMm)}
            className="mt-1.5 w-full"
          >
            Reset to {spec.holeMm} mm
          </Button>
        </div>
      )}

      {f.confidence !== undefined && (
        <p className="text-[12.5px] text-ink-400">
          Detector confidence {Math.round(f.confidence * 100)}%
        </p>
      )}

      <Toggle
        checked={f.locked ?? false}
        onChange={(locked) => updateFeature(f.id, { locked })}
        label="Keep when re-detecting"
      />

      <div className="grid grid-cols-2 gap-1">
        <Button onClick={() => duplicateFeatures([f.id])}>Duplicate</Button>
        <Button variant="danger" onClick={() => removeFeatures([f.id])}>Delete</Button>
      </div>
    </Section>
  );
}

/**
 * Size several cutouts at once.
 *
 * Each field shows the value the selection shares, or says it is mixed and
 * shows the first one's; setting it sets it on all of them, as one step for
 * undo. Circles and rectangles are sized by their own fields, so a selection
 * of both can still give every circle one diameter without touching the
 * rectangles.
 */
function BatchFeatureSize({ features }: { features: Feature[] }) {
  const updateFeatures = useStore((s) => s.updateFeatures);
  const circles = features.filter((f) => f.shape === 'circle');
  const rects = features.filter((f) => f.shape === 'rect');
  const ids = features.map((f) => f.id);

  const kind = shared(features.map((f) => (hasStandardSize(f.kind) ? f.kind : 'custom')));
  const shape = shared(features.map((f) => f.shape));
  const diameter = shared(circles.map((f) => f.w));
  const width = shared(rects.map((f) => f.w));
  const height = shared(rects.map((f) => f.h));
  const radius = shared(rects.map((f) => Math.min(f.radius, Math.min(f.w, f.h) / 2)));
  const rotation = shared(rects.map((f) => f.rotation));
  const mixed = (v: unknown, unit = 'mm') => (v === undefined ? 'mixed' : unit);
  const count = (n: number, one: string) => (features.length > n ? ` · ${n} ${one}${n === 1 ? '' : 's'}` : '');

  // As for one cutout: a circle's radius follows its diameter, and a corner
  // radius never exceeds half the shorter side.
  const resizeRects = (w: (f: Feature) => number, h: (f: Feature) => number) =>
    updateFeatures(rects.map((f) => f.id), (f) => {
      const nw = w(f), nh = h(f);
      return { w: nw, h: nh, radius: Math.min(f.radius, Math.min(nw, nh) / 2) };
    });

  return (
    <div className="space-y-2" data-batch-cutouts="">
      <Field label="Standard size" hint={kind === undefined ? 'mixed' : undefined}>
        <Select<FeatureKind | 'custom' | ''>
          value={kind ?? ''}
          onChange={(k) => {
            if (!k) return;
            updateFeatures(ids, (f) => (k === 'custom' ? { kind: 'custom' } : { ...featureForKind(k), x: f.x, y: f.y }));
          }}
          options={[
            ...(kind === undefined ? [{ value: '' as const, label: 'Mixed' }] : []),
            { value: 'custom', label: 'Custom size' },
            ...STANDARD_KINDS.map((k) => ({
              value: k,
              label: `${COMPONENT_SPECS[k].label} — ${COMPONENT_SPECS[k].holeMm} mm`,
            })),
          ]}
        />
      </Field>

      <Field label="Shape" hint={shape === undefined ? 'mixed' : undefined}>
        <Select<'circle' | 'rect' | ''>
          value={shape ?? ''}
          onChange={(s) => {
            if (!s) return;
            updateFeatures(ids, (f) => (s === 'circle'
              ? { shape: s, h: f.w, radius: f.w / 2 }
              : { shape: s, radius: Math.min(f.radius, Math.min(f.w, f.h) / 2) }));
          }}
          options={[
            ...(shape === undefined ? [{ value: '' as const, label: 'Mixed' }] : []),
            { value: 'circle', label: 'Circle' },
            { value: 'rect', label: 'Rectangle' },
          ]}
        />
      </Field>

      {circles.length > 0 && (
        <Field label={`Diameter${count(circles.length, 'circle')}`} hint={mixed(diameter)}>
          <NumberInput
            value={diameter ?? circles[0].w}
            onChange={(d) => updateFeatures(circles.map((f) => f.id), () => ({ w: d, h: d, radius: d / 2 }))}
            min={0.2} max={200} step={0.1}
          />
        </Field>
      )}

      {rects.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label={`Width${count(rects.length, 'rectangle')}`} hint={mixed(width)}>
              <NumberInput
                value={width ?? rects[0].w}
                onChange={(w) => resizeRects(() => w, (f) => f.h)}
                min={0.2} max={300} step={0.1}
              />
            </Field>
            <Field label="Height" hint={mixed(height)}>
              <NumberInput
                value={height ?? rects[0].h}
                onChange={(h) => resizeRects((f) => f.w, () => h)}
                min={0.2} max={300} step={0.1}
              />
            </Field>
          </div>
          <Field label="Corner radius" hint={mixed(radius)}>
            <NumberInput
              value={radius ?? rects[0].radius}
              onChange={(r) => updateFeatures(rects.map((f) => f.id), (f) => ({ radius: Math.min(r, Math.min(f.w, f.h) / 2) }))}
              min={0} max={150} step={0.05}
            />
          </Field>
          <Field label="Rotation" hint={rotation === undefined ? 'mixed' : `${rotation.toFixed(0)}°`}>
            <Slider
              min={-90} max={90} step={1}
              value={rotation ?? rects[0].rotation}
              onChange={(r) => updateFeatures(rects.map((f) => f.id), () => ({ rotation: r }))}
              detents={ROTATION_DETENTS.half} labelled={ROTATION_DETENTS.labelled}
            />
          </Field>
        </>
      )}
    </div>
  );
}

/** A small drawing of the shape, so the palette reads at a glance. */
function ShapeGlyph({ preset }: { preset: (typeof CUTOUT_PRESETS)[number] }) {
  const scale = 14 / Math.max(preset.w, preset.h);
  const w = preset.w * scale;
  const h = preset.h * scale;
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" className="shrink-0" aria-hidden>
      {preset.shape === 'circle' ? (
        <circle cx={8} cy={8} r={6} fill="none" stroke="currentColor" strokeWidth={1.4} />
      ) : (
        <rect
          x={8 - w / 2} y={8 - h / 2} width={w} height={h}
          rx={Math.min(preset.radius * scale, Math.min(w, h) / 2)}
          fill="none" stroke="currentColor" strokeWidth={1.4}
        />
      )}
    </svg>
  );
}

/** Panel-level settings: format, size, colour, background. */
export function PanelTab() {
  const design = useStore((s) => s.design);
  const keepout = decorKeepoutMm(design);
  const setDesign = useStore((s) => s.setDesign);
  const gridMm = useStore((s) => s.gridMm);
  const setGrid = useStore((s) => s.setGrid);
  const runDetection = useStore((s) => s.runDetection);
  const hasSource = useStore((s) => s.sourceImage !== null);
  const sourceHp = useStore((s) => s.sourceHp);

  return (
    <>
      <Section title="Panel">
        <Field label="Format">
          <Select<PanelFormat>
            value={design.format}
            onChange={(format) => { setDesign({ format }); if (hasSource) runDetection(); }}
            options={[
              { value: '3U', label: '3U — 128.5 mm' },
              { value: '1U-intellijel', label: '1U Intellijel — 39.65 mm' },
              { value: '1U-pulplogic', label: '1U Pulp Logic — 38.1 mm' },
            ]}
          />
        </Field>

        <Field label="Width" hint={`${panelWidthMm(design.hp).toFixed(2)} mm`}>
          <div className="flex items-center gap-2">
            <NumberInput
              value={design.hp}
              onChange={(hp) => { setDesign({ hp: Math.round(hp) }); if (hasSource) runDetection(); }}
              min={1} max={120} step={1} suffix="HP"
            />
          </div>
        </Field>
        {sourceHp !== null && (
          <p className="-mt-1 flex items-center gap-2 text-[12.5px] text-ink-400">
            <span className="label">The module is {sourceHp} HP</span>
            {design.hp !== sourceHp && (
              <button
                type="button"
                onClick={() => { setDesign({ hp: sourceHp }); if (hasSource) runDetection(); }}
                className="text-accent underline-offset-2 hover:underline"
              >
                match it
              </button>
            )}
          </p>
        )}
        <p className="-mt-1 text-[12.5px] leading-relaxed text-ink-400">
          Width includes the standard 0.3 mm clearance so the module does not
          bind against its neighbours.
        </p>

        <Field label="Thickness" hint={`${design.thicknessMm.toFixed(1)} mm`}>
          <Slider
            min={THICKNESS.min} max={THICKNESS.max} step={0.1}
            value={design.thicknessMm}
            onChange={(thicknessMm) => setDesign({ thicknessMm })}
          />
        </Field>

        <Field label="Corner radius" hint={`${design.cornerRadiusMm.toFixed(1)} mm`}>
          <Slider
            min={0} max={4} step={0.1}
            value={design.cornerRadiusMm}
            onChange={(cornerRadiusMm) => setDesign({ cornerRadiusMm })}
          />
        </Field>

        <Toggle
          checked={design.includeMountSlots}
          onChange={(includeMountSlots) => setDesign({ includeMountSlots })}
          label="Add M3 mounting slots"
        />

        <Field label="Hole allowance" hint={`+${design.holeClearanceMm.toFixed(2)} mm`}>
          <Slider
            min={HOLE_CLEARANCE.min} max={HOLE_CLEARANCE.max} step={0.05}
            value={design.holeClearanceMm}
            onChange={(holeClearanceMm) => setDesign({ holeClearanceMm })}
          />
        </Field>
        <p className="-mt-1 text-[12.5px] leading-relaxed text-ink-400">
          Added to every cutout when the model is built. Printed holes come out
          slightly under size as the plastic cools, so cutouts are drawn at the
          manufacturer's figure and opened up here to suit your printer. Print a
          test strip and adjust once.
        </p>

        <Toggle
          checked={keepout > 0}
          onChange={(on) => setDesign({ decorKeepoutMm: on ? DECOR_KEEPOUT.default : 0 })}
          label="Keep raised art clear of cutouts"
        />
        {keepout > 0 && (
          <Field label="Gap around cutouts" hint={`${keepout.toFixed(1)} mm`}>
            <Slider
              min={0.5} max={DECOR_KEEPOUT.max} step={0.1}
              value={keepout}
              onChange={(decorKeepoutMm) => setDesign({ decorKeepoutMm })}
            />
          </Field>
        )}
        <p className="-mt-1 text-[12.5px] leading-relaxed text-ink-400">
          Raised lettering and artwork are trimmed back this far from every
          cutout, so the nut of a jack or pot can tighten down flat on the
          panel. Flush and engraved art sit level, so they are left as they are.
        </p>
      </Section>

      <Section title="Finish">
        <Field label="Panel colour">
          <ColorInput value={design.backgroundColor} onChange={(backgroundColor) => setDesign({ backgroundColor })} />
        </Field>
        <div className="flex flex-wrap gap-1">
          {['#121418', '#e8e6df', '#23262b', '#c9ccd1', '#1f3b57', '#57351f', '#7d1f2b', '#1f5740'].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setDesign({ backgroundColor: c })}
              style={{ background: c }}
              className="h-6 w-6 rounded border border-ink-600 transition-transform hover:scale-110"
              aria-label={`Use ${c}`}
            />
          ))}
        </div>
      </Section>

      <Section title="Editing">
        <Field label="Grid snap">
          <Select
            value={String(gridMm)}
            onChange={(v) => setGrid(Number(v))}
            options={[
              { value: '0', label: 'Off — free movement' },
              { value: '0.5', label: '0.5 mm' },
              { value: '1', label: '1 mm' },
              { value: '2.54', label: '2.54 mm (half HP)' },
              { value: '5.08', label: '5.08 mm (1 HP)' },
            ]}
          />
        </Field>
        <p className="text-[12.5px] leading-relaxed text-ink-400">
          Arrow keys nudge, Shift for a bigger step. Alt while dragging ignores
          the grid. ⌘/Ctrl+D duplicates.
        </p>
      </Section>
    </>
  );
}

/** Add, inspect and align cutouts. */
export function FeaturesTab() {
  const features = useStore((s) => s.design.features);
  const selectedIds = useStore((s) => s.selectedIds);
  const select = useStore((s) => s.select);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  /** Where a Shift-click run in the cutout list starts. */
  const listAnchor = useRef<string | null>(null);
  const updateFeature = useStore((s) => s.updateFeature);
  const removeFeatures = useStore((s) => s.removeFeatures);
  const duplicateFeatures = useStore((s) => s.duplicateFeatures);
  const mirrorFeatures = useStore((s) => s.mirrorFeatures);
  const alignFeatures = useStore((s) => s.alignFeatures);
  const distribute = useStore((s) => s.distribute);

  const picked = features.filter((f) => selectedIds.includes(f.id));

  return (
    <>
      <Section title="Add a cutout">
        <div className="grid grid-cols-2 gap-1">
          {CUTOUT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setTool(tool === preset.id ? null : preset.id)}
              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-[12.5px] transition-colors
                ${tool === preset.id
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-ink-700 bg-ink-900 text-ink-300 hover:border-ink-400'}`}
            >
              <ShapeGlyph preset={preset} />
              <span className="truncate">{preset.label}</span>
            </button>
          ))}
        </div>
        {tool
          ? <p className="text-[12.5px] text-accent">Click on the panel to place it. Esc to cancel.</p>
          : (
            <p className="text-[12.5px] leading-relaxed text-ink-400">
              Place a shape, then set its size — either by hand, by dragging its
              handles, or from a standard component size.
            </p>
          )}
      </Section>

      <Section title={`Cutouts (${features.length})`}>
        {features.length === 0 ? (
          <p className="py-2 text-center text-[13.5px] text-ink-400">
            Nothing yet. Load a module photo and detect, or place cutouts by hand.
          </p>
        ) : (
          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
            {features.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={(e) => {
                    // Cmd adds or takes out one; Shift takes the whole run from the last one picked.
                    const r = pickInList(features.map((x) => x.id), selectedIds, listAnchor.current, f.id,
                      { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey });
                    listAnchor.current = r.anchor;
                    select(r.selection);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-[12.5px]
                    ${selectedIds.includes(f.id) ? 'bg-accent/15 text-accent' : 'text-ink-300 hover:bg-ink-800'}`}
                >
                  <span className="truncate">
                    {describeFeature(f, COMPONENT_SPECS[f.kind].label)}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-400">
                    {f.x.toFixed(1)}, {f.y.toFixed(1)}
                    {f.confidence !== undefined && f.confidence < 0.45 && (
                      <span className="ml-1 text-danger" title="Low confidence">!</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {picked.length > 1 && (
        <Section title={`${picked.length} selected`}>
          <BatchFeatureSize features={picked} />
          <div className="grid grid-cols-3 gap-1">
            <Button onClick={() => alignFeatures(selectedIds, 'left')}>Left</Button>
            <Button onClick={() => alignFeatures(selectedIds, 'cx')}>Centre X</Button>
            <Button onClick={() => alignFeatures(selectedIds, 'right')}>Right</Button>
            <Button onClick={() => alignFeatures(selectedIds, 'top')}>Top</Button>
            <Button onClick={() => alignFeatures(selectedIds, 'cy')}>Centre Y</Button>
            <Button onClick={() => alignFeatures(selectedIds, 'bottom')}>Bottom</Button>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <Button onClick={() => distribute(selectedIds, 'x')} disabled={picked.length < 3}>
              Space evenly ↔
            </Button>
            <Button onClick={() => distribute(selectedIds, 'y')} disabled={picked.length < 3}>
              Space evenly ↕
            </Button>
            <Button onClick={() => mirrorFeatures(selectedIds, 'x')}>Mirror ↔</Button>
            <Button onClick={() => mirrorFeatures(selectedIds, 'y')}>Mirror ↕</Button>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <Button onClick={() => duplicateFeatures(selectedIds)}>Duplicate</Button>
            <Button variant="danger" onClick={() => removeFeatures(selectedIds)}>Delete</Button>
          </div>
        </Section>
      )}

      {picked.length === 1 && <FeatureEditor feature={picked[0]} />}
    </>
  );
}
