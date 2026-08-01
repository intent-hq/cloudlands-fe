<script lang="ts">
  /**
   * One-line agent activity ticker (mock's line-swap): when the line changes,
   * the previous line slides up and the new one slides in from below. Wire
   * content — i18n-exempt.
   */
  let { line }: { line: string } = $props();

  // The stack renders [prevLine, shownLine]; resting position shows the
  // bottom row (slid), so the very first line renders without animation.
  let prevLine = $state('');
  let shownLine = $state(line);
  let sliding = $state(true);

  $effect(() => {
    if (line === shownLine) return;
    prevLine = shownLine;
    shownLine = line;
    // FLIP: snap back to the (now-stale) top row, then release the slide.
    sliding = false;
    requestAnimationFrame(() => requestAnimationFrame(() => (sliding = true)));
  });
</script>

<div class="hud-agent-line-clip">
  <div class="hud-agent-line-stack" class:hud-agent-line-slide={sliding}>
    <div class="hud-agent-line-row">{prevLine}</div>
    <div class="hud-agent-line-row">{shownLine}</div>
  </div>
</div>

<style>
  .hud-agent-line-clip {
    height: 15px;
    overflow: hidden;
  }
  .hud-agent-line-stack {
    transform: translateY(0);
  }
  .hud-agent-line-slide {
    transform: translateY(-15px);
    transition: transform 0.45s ease;
  }
  .hud-agent-line-row {
    font:
      500 9.5px 'JetBrains Mono',
      monospace;
    color: hsl(var(--text-subtle));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    height: 15px;
    line-height: 15px;
  }
  @media (prefers-reduced-motion: reduce) {
    .hud-agent-line-slide {
      transition: none;
    }
  }
</style>
