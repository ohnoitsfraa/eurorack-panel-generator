'use client';

import {
  COMPONENT_SPECS, CUTOUT_PRESETS, HOLE_CLEARANCE, STANDARD_KINDS, THICKNESS,
  hasStandardSize, panelWidthMm,
} from '@/lib/eurorack';
import { describeFeature, isStadium, type Feature, type FeatureKind, type PanelFormat } from '@/lib/types';
import { featureForKind, useStore } from '@/lib/store';
import { Button, ColorInput, Field, NumberInput, Section, Select, Slider, Toggle } from './ui';

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
      <p className="-mt-1 text-[11px] leading-relaxed text-ink-400">
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
          />
        </Field>
      )}

      {offStandard && (
        <div className="rounded-md border border-ink-700 bg-ink-900 px-2.5 py-2">
          <p className="text-[11px] leading-relaxed text-ink-300">
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
        <p className="text-[11px] text-ink-400">
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
  const setDesign = useStore((s) => s.setDesign);
  const gridMm = useStore((s) => s.gridMm);
  const setGrid = useStore((s) => s.setGrid);
  const runDetection = useStore((s) => s.runDetection);
  const hasSource = useStore((s) => s.sourceImage !== null);

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
        <p className="-mt-1 text-[11px] leading-relaxed text-ink-400">
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
        <p className="-mt-1 text-[11px] leading-relaxed text-ink-400">
          Added to every cutout when the model is built. Printed holes come out
          slightly under size as the plastic cools, so cutouts are drawn at the
          manufacturer's figure and opened up here to suit your printer. Print a
          test strip and adjust once.
        </p>
      </Section>

      <Section title="Finish">
        <Field label="Panel colour">
          <ColorInput value={design.backgroundColor} onChange={(backgroundColor) => setDesign({ backgroundColor })} />
        </Field>
        <div className="flex flex-wrap gap-1">
          {['#23262b', '#0b0b0d', '#f2f2f0', '#c9ccd1', '#1f3b57', '#57351f', '#7d1f2b', '#1f5740'].map((c) => (
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

        <BackgroundImageField />
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
        <p className="text-[11px] leading-relaxed text-ink-400">
          Arrow keys nudge, Shift for a bigger step. Alt while dragging ignores
          the grid. ⌘/Ctrl+D duplicates.
        </p>
      </Section>
    </>
  );
}

function BackgroundImageField() {
  const design = useStore((s) => s.design);
  const setDesign = useStore((s) => s.setDesign);

  return (
    <div className="space-y-2 border-t border-ink-800 pt-3">
      <Field label="Background image">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => setDesign({ backgroundImage: String(reader.result) });
            reader.readAsDataURL(f);
            e.target.value = '';
          }}
          className="w-full text-[11px] text-ink-400 file:mr-2 file:rounded file:border-0
                     file:bg-ink-700 file:px-2 file:py-1 file:text-[11px] file:text-ink-100"
        />
      </Field>

      {design.backgroundImage && (
        <>
          <Field label="Opacity" hint={`${Math.round(design.backgroundImageOpacity * 100)}%`}>
            <Slider
              min={0} max={1} step={0.05}
              value={design.backgroundImageOpacity}
              onChange={(backgroundImageOpacity) => setDesign({ backgroundImageOpacity })}
            />
          </Field>
          <Field label="Fit">
            <Select
              value={design.backgroundImageFit}
              onChange={(backgroundImageFit) => setDesign({ backgroundImageFit })}
              options={[
                { value: 'cover', label: 'Cover' },
                { value: 'contain', label: 'Contain' },
                { value: 'stretch', label: 'Stretch' },
              ]}
            />
          </Field>
          <Button variant="ghost" onClick={() => setDesign({ backgroundImage: undefined })}>
            Remove image
          </Button>
          <p className="text-[11px] leading-relaxed text-ink-400">
            A background image is a visual reference only — it is not part of
            the printed model. To print artwork, trace it into relief from the
            Text &amp; art tab.
          </p>
        </>
      )}
    </div>
  );
}

/** Add, inspect and align cutouts. */
export function FeaturesTab() {
  const features = useStore((s) => s.design.features);
  const selectedIds = useStore((s) => s.selectedIds);
  const select = useStore((s) => s.select);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
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
              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] transition-colors
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
          ? <p className="text-[11px] text-accent">Click on the panel to place it. Esc to cancel.</p>
          : (
            <p className="text-[11px] leading-relaxed text-ink-400">
              Place a shape, then set its size — either by hand, by dragging its
              handles, or from a standard component size.
            </p>
          )}
      </Section>

      <Section title={`Cutouts (${features.length})`}>
        {features.length === 0 ? (
          <p className="py-2 text-center text-xs text-ink-400">
            Nothing yet. Load a module photo and detect, or place cutouts by hand.
          </p>
        ) : (
          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
            {features.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => select([f.id])}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-[11px]
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
