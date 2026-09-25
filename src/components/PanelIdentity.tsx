'use client';

import { useStore } from '@/lib/store';
import { Button } from './ui';

/**
 * Name the panel, save it, put it in the rack, start another.
 *
 * In the header because these belong to whatever is on screen rather than to
 * any one inspector tab: you can be drawing cutouts, looking at the 3D
 * preview or standing in the rack and still want to save what you have.
 *
 * Save keeps its words because it is the only one of the four that reports
 * something — never saved, has changes, up to date — and an icon cannot say
 * which. The other two are icons with labels attached for anyone reading
 * rather than looking, which keeps the header from crowding its narrow widths.
 */
export function PanelIdentity() {
  const designName = useStore((s) => s.designName);
  const setDesignName = useStore((s) => s.setDesignName);
  const saveCurrentDesign = useStore((s) => s.saveCurrentDesign);
  const newDesign = useStore((s) => s.newDesign);
  const addToRack = useStore((s) => s.addToRack);
  const setView = useStore((s) => s.setView);
  const setTab = useStore((s) => s.setTab);
  const activeDesignId = useStore((s) => s.activeDesignId);
  const dirty = useStore((s) => s.dirty);

  const saved = activeDesignId !== null && !dirty;

  /**
   * Save, place, and go and look at it.
   *
   * Only offered once the panel is in the library, because that is what the
   * rack holds — a reference to a saved panel — and racking something that
   * has never been named would make a library entry as a side effect of
   * asking for something else. Changes since the last save are written first,
   * so the rack shows the panel as it is rather than as it was.
   *
   * The view only follows on success: when there is no room the panel has not
   * moved, and arriving at a rack that looks unchanged reads as the click
   * having done nothing. The refusal says what happened instead.
   */
  const addThisPanel = () => {
    if (!activeDesignId) return;
    if (dirty) saveCurrentDesign();
    if (!addToRack(activeDesignId)) return;
    setView('rack');
    setTab('library');
  };

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <input
        value={designName}
        onChange={(e) => setDesignName(e.target.value)}
        aria-label="Panel name"
        placeholder="Untitled panel"
        className="w-48 min-w-24 shrink rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-[13.5px]
                   outline-none focus:border-accent"
      />
      <Button
        variant="primary"
        onClick={() => saveCurrentDesign()}
        disabled={saved}
        // Disabling the settled state makes "Saved" a statement rather than
        // something to keep pressing.
        title={saved ? 'No changes since the last save' : 'Save this panel to the library'}
      >
        {activeDesignId ? (dirty ? 'Save changes' : 'Saved') : 'Save to library'}
      </Button>
      <IconButton
        onClick={addThisPanel}
        disabled={activeDesignId === null}
        label="Add this panel to the rack"
        disabledLabel="Save this panel first, then it can go in the rack"
      >
        {/* A rack row with panels in it, and room for one more. An arrow
            dropping into a tray was the first try and is simply the download
            icon — which the library already uses for exporting a panel. */}
        <rect x="1.25" y="3.5" width="13.5" height="9" rx="1.5" />
        <path d="M4.25 6v4M6.75 6v4" />
        <path d="M11 6v4M9 8h4" />
      </IconButton>
      <IconButton onClick={newDesign} label="Start a new panel">
        {/* A blank panel, and a plus. */}
        <rect x="1.5" y="1.5" width="6.5" height="13" rx="1.5" />
        <path d="M12 6v6M9 9h6" />
      </IconButton>
    </div>
  );
}

/**
 * An icon-only button in the header.
 *
 * The label is the whole explanation for anyone not looking at the picture,
 * so a disabled one says why rather than repeating what it would have done —
 * a greyed control with no reason attached is just a dead end.
 */
function IconButton({
  onClick, label, disabled, disabledLabel, children,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  disabledLabel?: string;
  children: React.ReactNode;
}) {
  const reason = disabled ? (disabledLabel ?? label) : label;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={reason}
      aria-label={reason}
      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md border
                 border-ink-600 bg-ink-800 text-ink-100 transition-colors hover:bg-ink-700
                 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-ink-800"
    >
      <svg
        viewBox="0 0 16 16"
        width={16}
        height={16}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  );
}
