<script lang="ts">
  /**
   * AGENT ACTIVITY · TOK/S panel (mock lines 214-223) — a bar per trailing
   * per-minute `stats.getRateHistory` sample (up to 40; the array already ends
   * at the current minute), normalized to the window's max. Each bar stacks the
   * §5.39 per-kind counters (in / out / thoughts / cached = read + creation);
   * segments carry their own fill PATTERN as well as a color, so the legend
   * stays readable without relying on hue alone. The "TOK/S NOW" footer
   * converts the newest minute's total token count to a per-second rate (÷60).
   * The 15s history poll keeps the samples fresh, so no client-side window
   * sliding is needed.
   */
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { selectHudRateHistory } from '$store/renderer/slices/hud/hud-selectors';

  const rateHistory$ = selectHudRateHistory();

  /** Trailing minute samples (chronological); empty when no data yet. */
  const samples = $derived($rateHistory$?.samples ?? []);

  /** Stack order (bottom → top) and the per-kind legend labels. */
  const SEGMENT_KINDS = ['in', 'out', 'thoughts', 'cached'] as const;
  type SegmentKind = (typeof SEGMENT_KINDS)[number];

  const segmentLabels: Record<SegmentKind, string> = {
    get in() {
      return m.hud_tokRate_segment_in_label();
    },
    get out() {
      return m.hud_tokRate_segment_out_label();
    },
    get thoughts() {
      return m.hud_tokRate_segment_thoughts_label();
    },
    get cached() {
      return m.hud_tokRate_segment_cached_label();
    },
  };

  /** One stacked bar: its total plus each kind's share of that total. */
  interface Bar {
    bucketUtc: string;
    total: number;
    /** Percent-of-total per kind, in stack order; zero shares are dropped. */
    segments: Array<{ kind: SegmentKind; tokens: number }>;
  }

  const bars = $derived.by((): Bar[] =>
    samples.map((sample) => {
      const counts: Record<SegmentKind, number> = {
        in: sample.inputTokens,
        out: sample.outputTokens,
        // Absent when the daemon reported no reasoning tokens (§5.23/§5.39).
        thoughts: sample.thoughtTokens ?? 0,
        cached: sample.cacheReadTokens + sample.cacheCreationTokens,
      };
      return {
        bucketUtc: sample.bucketUtc,
        // Every counter counts toward the bar height — `counts` already covers
        // all of them, so the stack total is just their sum.
        total: SEGMENT_KINDS.reduce((sum, kind) => sum + counts[kind], 0),
        segments: SEGMENT_KINDS.filter((kind) => counts[kind] > 0).map((kind) => ({
          kind,
          tokens: counts[kind],
        })),
      };
    }),
  );

  const maxTokens = $derived(Math.max(1, ...bars.map((bar) => bar.total)));
  /** TOK/S NOW — the newest minute sample's tokens over its 60s span. */
  const tokRate = $derived(bars.length > 0 ? Math.round(bars[bars.length - 1].total / 60) : 0);

  /** One x-axis time tick, positioned by the bar it sits under. */
  interface AxisTick {
    key: string;
    label: string;
    /** Horizontal position (percent of the plot width). */
    leftPct: number;
    /** True for the right-edge "now" label (anchored to its right edge). */
    rightEdge: boolean;
  }

  function pad2(n: number): string {
    return String(n).padStart(2, '0');
  }

  /**
   * X-axis ticks: on-the-hour LOCAL-time labels ("HH:00") under any bar whose
   * bucket falls on a minute-:00 boundary, plus the newest bucket's local
   * "HH:MM" anchored at the right edge. The newest bar's own hour tick is
   * dropped — the right-edge label already covers it. A 40-minute window holds
   * at most one hour boundary, so this stays legible (mid tick + right label).
   */
  const ticks = $derived.by((): AxisTick[] => {
    const n = bars.length;
    if (n === 0) return [];
    const out: AxisTick[] = [];
    bars.forEach((bar, index) => {
      if (index === n - 1) return; // covered by the right-edge label
      const date = new Date(bar.bucketUtc);
      if (Number.isNaN(date.getTime()) || date.getMinutes() !== 0) return;
      out.push({
        key: `hour-${bar.bucketUtc}`,
        label: `${pad2(date.getHours())}:00`,
        leftPct: ((index + 0.5) / n) * 100,
        rightEdge: false,
      });
    });
    const newest = new Date(bars[n - 1].bucketUtc);
    if (!Number.isNaN(newest.getTime())) {
      out.push({
        key: 'now',
        label: `${pad2(newest.getHours())}:${pad2(newest.getMinutes())}`,
        leftPct: 100,
        rightEdge: true,
      });
    }
    return out;
  });
</script>

<section class="hud-tokrate-panel" data-testid="hud-tokrate-panel">
  <header class="hud-tokrate-header">
    <span class="hud-tokrate-title">{m.hud_tokRate_title()}</span>
    <span class="hud-tokrate-rule"></span>
    <span class="hud-tokrate-window">{m.hud_tokRate_window_label()}</span>
  </header>
  <div class="hud-tokrate-chart">
    {#each bars as bar (bar.bucketUtc)}
      <div class="hud-tokrate-bar" style:height={`${Math.round((bar.total / maxTokens) * 100)}%`}>
        {#each bar.segments as segment (segment.kind)}
          <div
            class="hud-tokrate-segment"
            data-segment={segment.kind}
            style:flex-grow={segment.tokens}
            title={segmentLabels[segment.kind]}
          ></div>
        {/each}
      </div>
    {/each}
  </div>
  <div class="hud-tokrate-axis" data-testid="hud-tokrate-axis">
    {#each ticks as tick (tick.key)}
      <span
        class="hud-tokrate-tick"
        class:right-edge={tick.rightEdge}
        style:left={`${tick.leftPct}%`}>{tick.label}</span
      >
    {/each}
  </div>
  <ul class="hud-tokrate-legend" data-testid="hud-tokrate-legend">
    {#each SEGMENT_KINDS as kind (kind)}
      <li class="hud-tokrate-legend-item">
        <span class="hud-tokrate-swatch" data-segment={kind}></span>
        <span>{segmentLabels[kind]}</span>
      </li>
    {/each}
  </ul>
  <div class="hud-tokrate-footer">
    <span class="hud-tokrate-spacer"></span>
    <span class="hud-tokrate-value">{formatInteger(tokRate)}</span>
    <span>{m.hud_tokRate_now_label()}</span>
  </div>
</section>

<style>
  .hud-tokrate-panel {
    border: 1px solid hsl(var(--border) / 0.8);
    background: hsl(var(--card) / 0.75);
  }
  .hud-tokrate-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid hsl(var(--border) / 0.5);
  }
  .hud-tokrate-title {
    font:
      600 10px Inter,
      system-ui,
      sans-serif;
    letter-spacing: 0.18em;
    color: hsl(var(--text-subtle));
    text-transform: uppercase;
  }
  .hud-tokrate-rule {
    flex: 1;
    height: 1px;
    background: hsl(var(--border) / 0.6);
  }
  .hud-tokrate-window {
    font:
      500 9px 'JetBrains Mono',
      monospace;
    color: hsl(var(--text-ghost));
  }
  .hud-tokrate-chart {
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 74px;
    padding: 10px 12px 6px;
  }
  .hud-tokrate-axis {
    position: relative;
    height: 12px;
    margin: 0 12px;
  }
  .hud-tokrate-tick {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    white-space: nowrap;
    font:
      500 9px 'JetBrains Mono',
      monospace;
    color: hsl(var(--text-ghost));
    pointer-events: none;
  }
  .hud-tokrate-tick.right-edge {
    transform: translateX(-100%);
  }
  .hud-tokrate-bar {
    display: flex;
    /* Segments stack bottom-up in SEGMENT_KINDS order. */
    flex-direction: column-reverse;
    flex: 1;
    min-height: 1px;
    /* Visible for an all-zero minute, where no segment renders. */
    background: hsl(var(--primary) / 0.2);
    transition: height 0.9s ease;
  }
  .hud-tokrate-segment {
    flex-basis: 0;
    min-height: 0;
    /* Each kind pairs a distinct fill pattern with its color so the segments
       stay distinguishable without relying on hue alone. */
    background-color: hsl(var(--primary) / 0.65);
  }
  .hud-tokrate-segment[data-segment='out'],
  .hud-tokrate-swatch[data-segment='out'] {
    background-color: hsl(var(--primary) / 0.35);
    background-image: repeating-linear-gradient(
      45deg,
      hsl(var(--primary) / 0.85) 0 1px,
      transparent 1px 3px
    );
  }
  .hud-tokrate-segment[data-segment='thoughts'],
  .hud-tokrate-swatch[data-segment='thoughts'] {
    background-color: hsl(var(--warning) / 0.35);
    background-image: repeating-linear-gradient(
      -45deg,
      hsl(var(--warning) / 0.9) 0 1px,
      transparent 1px 3px
    );
  }
  .hud-tokrate-segment[data-segment='cached'],
  .hud-tokrate-swatch[data-segment='cached'] {
    background-color: hsl(var(--muted) / 0.5);
    background-image: repeating-linear-gradient(
      0deg,
      hsl(var(--text-subtle) / 0.7) 0 1px,
      transparent 1px 3px
    );
  }
  .hud-tokrate-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    margin: 0;
    padding: 0 12px 2px;
    list-style: none;
    font:
      500 9px 'JetBrains Mono',
      monospace;
    color: hsl(var(--text-ghost));
  }
  .hud-tokrate-legend-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .hud-tokrate-swatch {
    width: 8px;
    height: 8px;
    background-color: hsl(var(--primary) / 0.65);
  }
  .hud-tokrate-footer {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 2px 12px 10px;
    font:
      500 10px 'JetBrains Mono',
      monospace;
    color: hsl(var(--text-ghost));
  }
  .hud-tokrate-spacer {
    flex: 1;
  }
  .hud-tokrate-value {
    color: hsl(var(--primary));
    font-size: 14px;
  }
  @media (prefers-reduced-motion: reduce) {
    .hud-tokrate-bar {
      transition: none;
    }
  }
</style>
