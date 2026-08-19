<div
  aria-hidden="true"
  class="aurora-softening-layer pointer-events-none absolute inset-0 z-10"
  data-testid="aurora-softening-layer"
></div>

<style>
  /* Theme-aware fallback for browsers that cannot mask backdrop blur. */
  .aurora-softening-layer {
    background: linear-gradient(
      to bottom,
      transparent 0%,
      hsl(var(--background) / 0.04) 36%,
      hsl(var(--background) / 0.18) 62%,
      hsl(var(--background) / 0.46) 82%,
      hsl(var(--background) / 0.72) 100%
    );
  }

  @supports ((backdrop-filter: blur(1px)) and (mask-image: linear-gradient(black, transparent))) or
    (
      (-webkit-backdrop-filter: blur(1px)) and
        (-webkit-mask-image: linear-gradient(black, transparent))
    ) {
    .aurora-softening-layer {
      background: rgb(255 255 255 / 0.001);
      -webkit-backdrop-filter: blur(18px) saturate(0.9);
      backdrop-filter: blur(18px) saturate(0.9);
      -webkit-mask-image: linear-gradient(
        to bottom,
        transparent 0%,
        rgb(0 0 0 / 0.06) 26%,
        rgb(0 0 0 / 0.25) 48%,
        rgb(0 0 0 / 0.64) 72%,
        black 100%
      );
      mask-image: linear-gradient(
        to bottom,
        transparent 0%,
        rgb(0 0 0 / 0.06) 26%,
        rgb(0 0 0 / 0.25) 48%,
        rgb(0 0 0 / 0.64) 72%,
        black 100%
      );
    }
  }
</style>
