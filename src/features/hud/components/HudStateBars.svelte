<script lang="ts">
  /**
   * HUD state-bar list — the mock's label / proportional bar / count rows
   * used by the AGENTS and WORKSPACES panels. Percentages are derived from
   * the caller-provided denominator (clamped so a zero fleet renders empty
   * bars, never NaN widths).
   */
  export interface HudStateBar {
    /** Localized row label (already small-caps in the catalog). */
    label: string;
    count: number;
    /** CSS color value for the filled bar segment. */
    color: string;
    /** Blink the row (label + count) to draw attention; reduced-motion safe. */
    blink?: boolean;
    /** Optional test hook for the row. */
    testId?: string;
  }

  let { bars, total }: { bars: HudStateBar[]; total: number } = $props();

  function pct(count: number): string {
    if (!Number.isFinite(total) || total <= 0) return '0%';
    return `${Math.round((Math.max(0, count) / total) * 100)}%`;
  }
</script>

<div class="hud-state-bars">
  {#each bars as bar (bar.label)}
    <div class="hud-state-bar-row" class:hud-state-bar-blink={bar.blink} data-testid={bar.testId}>
      <span class="hud-state-bar-label" style:color={bar.blink ? bar.color : undefined}>
        {bar.label}
      </span>
      <div class="hud-state-bar-track">
        <div
          class="hud-state-bar-fill"
          style:width={pct(bar.count)}
          style:background={bar.color}
        ></div>
      </div>
      <span class="hud-state-bar-count">{bar.count}</span>
    </div>
  {/each}
</div>

<style>
  .hud-state-bars {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
  }
  .hud-state-bar-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font:
      500 10px 'JetBrains Mono',
      monospace;
  }
  .hud-state-bar-label {
    min-width: 64px;
    color: hsl(var(--text-subtle));
  }
  .hud-state-bar-track {
    flex: 1;
    height: 8px;
    background: hsl(var(--muted) / 0.6);
    position: relative;
  }
  .hud-state-bar-fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
  }
  .hud-state-bar-count {
    min-width: 18px;
    text-align: right;
  }
  /* Attention blink (mock hudblink): only the flagged row's label + count
     pulse, the track stays steady. Gated by the caller (blink at non-zero). */
  .hud-state-bar-blink .hud-state-bar-label,
  .hud-state-bar-blink .hud-state-bar-count {
    animation: hudblink 1.6s step-end infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .hud-state-bar-blink .hud-state-bar-label,
    .hud-state-bar-blink .hud-state-bar-count {
      animation: none;
    }
  }
</style>
