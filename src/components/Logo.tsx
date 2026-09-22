/**
 * The mark: a module faceplate, head on.
 *
 * A Eurorack module is recognisable by its silhouette before any detail — tall
 * and narrow, with a knob and a pair of jacks. That is the thing this app
 * makes, so that is the mark.
 *
 * Deliberately three features and no more. The first version used the real
 * proportions of an 8 HP panel, which is a fine drawing and useless as an
 * icon: at the sixteen pixels a browser tab gives you it came out five pixels
 * wide. This is squared up and the strokes weighted so nothing merges at that
 * size. Drawn in currentColor, so it takes the colour of whatever it sits in
 * and needs no second version for the light theme.
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
      <rect x="13" y="5" width="38" height="54" rx="7" strokeWidth={6} />
      <circle cx="32" cy="23" r="7.5" strokeWidth={6} />
      <path d="M25 44h0M39 44h0" strokeWidth={10} />
    </svg>
  );
}
