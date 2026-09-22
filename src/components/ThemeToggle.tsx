'use client';

import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import type { ThemeChoice } from '@/lib/theme';

const OPTIONS: Array<{ id: ThemeChoice; label: string; title: string }> = [
  { id: 'light', label: '☀', title: 'Light' },
  { id: 'system', label: '◐', title: 'Match the system' },
  { id: 'dark', label: '☾', title: 'Dark' },
];

/**
 * Light, dark, or follow the system.
 *
 * Reads the stored choice after mounting rather than during render: the boot
 * script has already applied it to the document, and touching localStorage
 * while rendering would disagree with the server's markup.
 */
export function ThemeToggle() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const syncTheme = useStore((s) => s.syncTheme);

  useEffect(() => {
    syncTheme();
    // Follow the system while it is being followed, so switching the machine
    // to dark at sunset changes the app with it.
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => { if (useStore.getState().theme === 'system') syncTheme(); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [syncTheme]);

  return (
    <div className="flex rounded-md border border-ink-700 p-0.5" role="group" aria-label="Theme">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          title={o.title}
          aria-pressed={theme === o.id}
          onClick={() => setTheme(o.id)}
          className={`rounded px-2 py-1 text-[13.5px] leading-none transition-colors
            ${theme === o.id ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-100'}`}
        >
          <span aria-hidden>{o.label}</span>
          <span className="sr-only">{o.title}</span>
        </button>
      ))}
    </div>
  );
}
