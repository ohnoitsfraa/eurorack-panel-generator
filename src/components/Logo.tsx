/**
 * The mark: two faceplates, side by side, built alike.
 *
 * The name is the brief. A single panel said what the app draws; a matched
 * pair says what it is for — a rack of mismatched hardware ending up looking
 * like one instrument. Both panels carry the same knob in the same place and
 * the same jack below it, because that agreement is the product.
 *
 * Five features and no more. An earlier attempt used the true proportions of
 * an 8 HP panel, which is an accurate drawing and a useless icon: at the
 * sixteen pixels a browser tab allows, it came out five pixels wide. This is
 * squared up and weighted so the pair still reads as two things at that size.
 * Drawn in currentColor, so one mark serves both themes.
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
      <rect x="5" y="8" width="24" height="48" rx="5" strokeWidth={5} />
      <rect x="35" y="8" width="24" height="48" rx="5" strokeWidth={5} />
      <circle cx="17" cy="24" r="5" strokeWidth={4.5} />
      <circle cx="47" cy="24" r="5" strokeWidth={4.5} />
      <path d="M17 42h0M47 42h0" strokeWidth={8} />
    </svg>
  );
}
