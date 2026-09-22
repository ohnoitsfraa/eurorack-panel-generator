/**
 * The Panelmate mark, from panelmate-brand/svg/mark-*-small.svg.
 *
 * A 3U panel stem beside a graduated knob bowl, which together make a "P".
 * This is the kit's simplified cut, drawn for use below 64px: the full mark
 * adds a knurl, a jack and HP ticks that close up into grey at the 32px the
 * header asks for. Geometry is the kit's, unaltered — verify compares the two
 * — and only the colours are swapped for tokens.
 *
 * The kit ships the mark twice, dark and light, and the difference between
 * them is a straight exchange of Rack Ink and Brushed Alu. That is what the
 * scale's two ends already mean, so one drawing serves both themes here.
 *
 * The slots in the stem and the ring around the bowl are knockouts: shapes
 * painted in the background colour rather than true holes. They are right
 * wherever the mark sits on ink-950, which is where the header puts it; on any
 * other surface they would show as patches of the wrong tone.
 */
export function Logo({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      fill="none"
    >
      <rect x="20" y="8" width="28" height="104" rx="6" fill="var(--color-ink-100)" />
      <rect x="27" y="14" width="14" height="5" rx="2.5" fill="var(--color-ink-950)" />
      <rect x="27" y="101" width="14" height="5" rx="2.5" fill="var(--color-ink-950)" />
      <line x1="51.36" y1="19.38" x2="48.20" y2="14.87" stroke="var(--color-ink-100)" strokeWidth="3" strokeLinecap="round" />
      <line x1="64.08" y1="14.04" x2="63.08" y2="8.64" stroke="var(--color-ink-100)" strokeWidth="3" strokeLinecap="round" />
      <line x1="77.86" y1="14.47" x2="79.19" y2="9.13" stroke="var(--color-ink-100)" strokeWidth="3" strokeLinecap="round" />
      <line x1="90.23" y1="20.57" x2="93.66" y2="16.26" stroke="var(--color-ink-100)" strokeWidth="3" strokeLinecap="round" />
      <line x1="98.96" y1="31.25" x2="103.86" y2="28.75" stroke="var(--color-ink-100)" strokeWidth="3" strokeLinecap="round" />
      <line x1="102.47" y1="44.58" x2="107.96" y2="44.34" stroke="var(--color-ink-100)" strokeWidth="3" strokeLinecap="round" />
      <line x1="100.13" y1="58.17" x2="105.23" y2="60.24" stroke="var(--color-ink-100)" strokeWidth="3" strokeLinecap="round" />
      <line x1="92.37" y1="69.57" x2="96.16" y2="73.56" stroke="var(--color-ink-100)" strokeWidth="3" strokeLinecap="round" />
      <line x1="80.58" y1="76.73" x2="82.37" y2="81.93" stroke="var(--color-ink-100)" strokeWidth="3" strokeLinecap="round" />
      <line x1="66.89" y1="78.35" x2="66.36" y2="83.83" stroke="var(--color-ink-100)" strokeWidth="3" strokeLinecap="round" />
      <line x1="53.75" y1="74.15" x2="51.00" y2="78.91" stroke="var(--color-ink-100)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="70" cy="46" r="27.5" fill="var(--color-ink-950)" />
      <circle cx="70" cy="46" r="25" fill="var(--brand-lime)" />
      <line x1="74.60" y1="42.14" x2="86.09" y2="32.50" stroke="var(--brand-ink)" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
}
