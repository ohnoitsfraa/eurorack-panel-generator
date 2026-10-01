'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The value every one of these has, or undefined if they differ: what a field
 * editing several things at once shows, or "mixed".
 */
export function shared<T>(values: T[]): T | undefined {
  return values.length > 0 && values.every((v) => v === values[0]) ? values[0] : undefined;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="label text-[12px] text-ink-400">{label}</span>
        {hint && <span className="font-mono text-[12px] tabular-nums text-ink-400">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

/**
 * A number input that lets you type freely.
 *
 * Committing on every keystroke makes it impossible to type "-" or clear the
 * box to retype, so the raw string is held locally and only parsed on blur or
 * Enter. Arrow keys still step live, because that should feel immediate.
 */
export function NumberInput({
  value, onChange, min, max, step = 0.1, suffix, disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(fmt(value));
  }, [value]);

  const commit = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) { setDraft(fmt(value)); return; }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    onChange(clamped);
    setDraft(fmt(clamped));
  };

  return (
    <div className="relative">
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={draft}
        onFocus={() => { focused.current = true; }}
        onBlur={(e) => { focused.current = false; commit(e.target.value); }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commit((e.target as HTMLInputElement).value); e.currentTarget.blur(); }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            commit(String(round(Number(draft || 0) + delta)));
          }
        }}
        className="w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 pr-8 font-mono text-[14px] tabular-nums
                   outline-none focus:border-accent disabled:opacity-40"
      />
      {suffix && (
        <span className="label pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11.5px] text-ink-400">
          {suffix}
        </span>
      )}
    </div>
  );
}

export function Slider({
  value, onChange, min, max, step = 1,
}: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function Button({
  children, onClick, variant = 'default', disabled, title, className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const styles = {
    default: 'border-ink-600 bg-ink-800 hover:bg-ink-700 text-ink-100',
    primary: 'border-accent bg-accent text-ink-950 hover:brightness-110 font-medium',
    ghost: 'border-transparent bg-transparent hover:bg-ink-800 text-ink-300',
    danger: 'border-ink-600 bg-ink-800 text-danger hover:bg-ink-700',
  }[variant];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`whitespace-nowrap rounded-md border px-2.5 py-1.5 text-[13.5px] transition-colors disabled:cursor-not-allowed
                  disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Select<T extends string>({
  value, onChange, options, disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      className="w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 text-[15px] outline-none
                 focus:border-accent disabled:opacity-40"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-10 shrink-0"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          // Only push a value the renderer can actually use.
          if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v);
        }}
        className="w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 font-mono text-[13.5px]
                   uppercase outline-none focus:border-accent"
      />
    </div>
  );
}

export function Toggle({
  checked, onChange, label,
}: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 py-1 text-left"
    >
      <span className="text-[15px] text-ink-100">{label}</span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors
                    ${checked ? 'bg-accent' : 'bg-ink-700'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-ink-950 transition-transform
                      ${checked ? 'translate-x-4.5' : 'translate-x-0.5'}`}
        />
      </span>
    </button>
  );
}

export function Section({
  title, children, right,
}: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="border-b border-ink-800 px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="label text-[12.5px] text-ink-300">{title}</h3>
        {right}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/**
 * Lettering that is missing only because its font has not arrived.
 *
 * Deliberately not styled as a problem: it clears itself, usually before
 * anyone reads it. It is shown at all because a font that never arrives would
 * otherwise leave a panel silently unlettered, and that is only discovered
 * after the print.
 */
export function PendingFonts({ families }: { families: string[] }) {
  if (families.length === 0) return null;
  return (
    <p className="rounded-md border border-ink-700 bg-ink-800/60 px-2.5 py-2 text-[12.5px]
                  leading-relaxed text-ink-300">
      Waiting for {families.join(', ')}. Lettering appears, and exports, once
      {families.length === 1 ? ' it arrives' : ' they arrive'}.
    </p>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-[13.5px] leading-relaxed text-ink-400">{children}</p>;
}

function fmt(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}
function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
