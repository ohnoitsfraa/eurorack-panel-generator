'use client';

import { COMPONENT_SPECS, PLACEABLE_KINDS, THICKNESS, panelWidthMm } from '@/lib/eurorack';
import type { FeatureKind, PanelFormat } from '@/lib/types';
import { useStore } from '@/lib/store';
import { Button, ColorInput, Field, NumberInput, Section, Select, Slider, Toggle } from './ui';

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
          {PLACEABLE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setTool(tool === kind ? null : kind)}
              className={`rounded-md border px-2 py-1.5 text-[11px] transition-colors
                ${tool === kind
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-ink-700 bg-ink-900 text-ink-300 hover:border-ink-400'}`}
            >
              {COMPONENT_SPECS[kind].label}
            </button>
          ))}
        </div>
        {tool && <p className="text-[11px] text-accent">Click on the panel to place it. Esc to cancel.</p>}
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
                  <span className="truncate">{COMPONENT_SPECS[f.kind].label}</span>
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

      {picked.length === 1 && (
        <Section title={COMPONENT_SPECS[picked[0].kind].label}>
          <Field label="Type">
            <Select<FeatureKind>
              value={picked[0].kind}
              onChange={(kind) => {
                const spec = COMPONENT_SPECS[kind];
                updateFeature(picked[0].id, {
                  kind,
                  shape: spec.shape,
                  d: spec.holeMm || picked[0].d,
                  len: spec.shape === 'slot' ? spec.slotLengthMm ?? picked[0].len ?? 40 : picked[0].len,
                });
              }}
              options={PLACEABLE_KINDS.map((k) => ({ value: k, label: COMPONENT_SPECS[k].label }))}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="X" hint="mm">
              <NumberInput value={picked[0].x} onChange={(x) => updateFeature(picked[0].id, { x })} step={0.1} />
            </Field>
            <Field label="Y" hint="mm">
              <NumberInput value={picked[0].y} onChange={(y) => updateFeature(picked[0].id, { y })} step={0.1} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label={picked[0].shape === 'circle' ? 'Diameter' : 'Width'} hint="mm">
              <NumberInput
                value={picked[0].d}
                onChange={(d) => updateFeature(picked[0].id, { d })}
                min={0.2} max={200} step={0.1}
              />
            </Field>
            {picked[0].shape !== 'circle' && (
              <Field label={picked[0].shape === 'slot' ? 'Length' : 'Height'} hint="mm">
                <NumberInput
                  value={picked[0].len ?? picked[0].d}
                  onChange={(len) => updateFeature(picked[0].id, { len })}
                  min={0.2} max={200} step={0.1}
                />
              </Field>
            )}
          </div>

          {picked[0].shape !== 'circle' && (
            <Field label="Rotation" hint={`${(picked[0].rotation ?? 0).toFixed(0)}°`}>
              <Slider
                min={-90} max={90} step={1}
                value={picked[0].rotation ?? 0}
                onChange={(rotation) => updateFeature(picked[0].id, { rotation })}
              />
            </Field>
          )}

          {picked[0].shape === 'rect' && (
            <Field label="Corner radius" hint="mm">
              <NumberInput
                value={picked[0].radius ?? 0}
                onChange={(radius) => updateFeature(picked[0].id, { radius })}
                min={0} max={20} step={0.1}
              />
            </Field>
          )}

          {picked[0].confidence !== undefined && (
            <p className="text-[11px] text-ink-400">
              Detector confidence {Math.round(picked[0].confidence * 100)}%
            </p>
          )}

          <Toggle
            checked={picked[0].locked ?? false}
            onChange={(locked) => updateFeature(picked[0].id, { locked })}
            label="Keep when re-detecting"
          />

          <div className="grid grid-cols-2 gap-1">
            <Button onClick={() => duplicateFeatures([picked[0].id])}>Duplicate</Button>
            <Button variant="danger" onClick={() => removeFeatures([picked[0].id])}>Delete</Button>
          </div>
        </Section>
      )}
    </>
  );
}
