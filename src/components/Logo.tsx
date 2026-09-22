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
 * The mate is solid and the panel is drawn. That contrast is most of what
 * keeps this from looking like clip art: a mark cut entirely from one stroke
 * weight has no hierarchy, so nothing tells the eye which object it is
 * looking at. The face is real negative space, not a lighter colour — head,
 * ears, muzzle, eyes and nose are one path under nonzero winding, with the
 * holes wound backwards — so the mark stays a single colour and works on any
 * background. The paws are ovals rather than circles, which is the difference
 * between arms and two balls stuck to the sides.
 *
 * Everything is placed so it survives the sixteen pixels a browser tab
 * allows. The head sits tangent to the panel's top edge rather than crossing
 * it, because two strokes of the same colour meeting at that size turn to
 * mush, and the paws are centred on the panel's side edges, which is what
 * makes them read as arms coming from behind and not as two more cutouts.
 * The fine detail — the knob's indicator, the jack's ring — is there for the
 * sizes that can hold it and fills in harmlessly at the sizes that cannot.
 */
const HEAD =
  'M25.4 12.8a6.6 6.6 0 1 0 13.2 0a6.6 6.6 0 1 0 -13.2 0Z'
  + 'M23.5 7.6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0ZM34.5 7.6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0Z'
  + 'M29 15.4a3 2.2 0 1 1 6 0a3 2.2 0 1 1 -6 0Z'
  + 'M27.7 11.4a1.2 1.2 0 1 1 2.4 0a1.2 1.2 0 1 1 -2.4 0Z'
  + 'M33.9 11.4a1.2 1.2 0 1 1 2.4 0a1.2 1.2 0 1 1 -2.4 0Z'
  + 'M30.8 14.9a1.2 0.95 0 1 0 2.4 0a1.2 0.95 0 1 0 -2.4 0Z';

const PAWS =
  'M13.8 38a4.2 5.2 0 1 0 8.4 0a4.2 5.2 0 1 0 -8.4 0Z'
  + 'M41.8 38a4.2 5.2 0 1 0 8.4 0a4.2 5.2 0 1 0 -8.4 0Z';

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
      <path d={HEAD} fill="currentColor" stroke="none" />
      <path d={PAWS} fill="currentColor" stroke="none" />
      <rect x="20" y="22" width="24" height="36" rx="5.5" strokeWidth={5} />
      <circle cx="32" cy="31" r="5" strokeWidth={3} />
      <circle cx="32" cy="29" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="32" cy="47" r="3.4" strokeWidth={2.8} />
      <circle cx="32" cy="47" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}
