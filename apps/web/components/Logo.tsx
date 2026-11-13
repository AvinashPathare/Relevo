/**
 * The Relevo wordmark (brand/relevo-wordmark.svg, inlined): lowercase letters in rounded strokes, with
 * the last "o" drawn as a relay ring — two arcs handing over to each other, like a rerouted payout.
 * Letters take the text colour; the second arc is the accent. Strokes are heavier than in the brand
 * file (18 vs 14) so the mark holds up at header size next to the display font.
 */
export function Logo({ height = 28 }: { height?: number }) {
  return (
    <svg
      viewBox="0 0 438 124"
      height={height}
      width={(height * 438) / 124}
      role="img"
      aria-label="Relevo"
      fill="none"
      stroke="currentColor"
      strokeWidth="18"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M24 100V40" />
      <path d="M24 72A28 28 0 0 1 52 44" />
      <path d="M78 70H138A30 30 0 1 0 129.2 91.2" />
      <path d="M164 10V100" />
      <path d="M190 70H250A30 30 0 1 0 241.2 91.2" />
      <path d="M276 40L302 100L328 40" />
      <path d="M354 70a30 30 0 0 1 51.9 -20.6" />
      <path d="M414 70a30 30 0 0 1 -51.9 20.6" stroke="var(--violet, #5b45d6)" />
    </svg>
  );
}
