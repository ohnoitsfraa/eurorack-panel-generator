/**
 * The mark: one panel, with a friend hugging it.
 *
 * An earlier version drew two matched faceplates side by side — accurate to
 * what the app does, but at icon size it read as a pair of dominoes and the
 * "mate" in the name was nowhere. The bear carries that instead: the panel
 * stays the subject, drawn with the knob and jack the old mark had, and the
 * mate stands behind it with its head over the top and both paws round the
 * sides.
 *
 * Everything is placed so it survives the sixteen pixels a browser tab
 * allows. The head sits tangent to the panel's top edge rather than crossing
 * it, because two strokes of the same colour meeting at that size turn to
 * mush. The paws are centred on the panel's side edges, which is what makes
 * them read as arms coming from behind and not as two more cutouts. Ears,
 * head, paws, knob, jack: five round things against one rectangle, and no
 * more than that. Drawn in currentColor, so one mark serves both themes.
 */
export function Logo({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
    >
      <rect x="20" y="22" width="24" height="36" rx="5" strokeWidth={5} />
      <circle cx="32" cy="13" r="6.5" strokeWidth={5} />
      <circle cx="25" cy="7.5" r="3" strokeWidth={4} />
      <circle cx="39" cy="7.5" r="3" strokeWidth={4} />
      <circle cx="18" cy="38" r="4.5" strokeWidth={4.5} />
      <circle cx="46" cy="38" r="4.5" strokeWidth={4.5} />
      <circle cx="32" cy="31" r="4.5" strokeWidth={4.5} />
      <path d="M32 47h0" strokeWidth={8} />
    </svg>
  );
}
