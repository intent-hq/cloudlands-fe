<script lang="ts">
  /**
   * EVENT FEED panel — live global event rows, newest first, capped at the
   * mock's 11 visible rows. Each row is two lines: line 1 carries the kind
   * chip plus the source name (the agent name for agent events, else the
   * workspace/repo name); line 2, indented to align under the chip, carries
   * the wire detail text, color-coded (failures red, attention yellow). New
   * rows slide the list down via the mock's FLIP prep→run phases and flash
   * the alternating hudhintA/B highlight; both are disabled under reduced
   * motion.
   */
  import { onDestroy } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { selectHudFeedItems } from '$store/renderer/slices/hud/hud-selectors';
  import { formatHudClock } from '../utils/hud-format';
  import {
    HUD_FEED_COLORS,
    feedDetailText,
    feedDotColor,
    feedKindLabel,
  } from './hud-right-column-labels';
  import { HudSlide, watchReducedMotion } from './hud-slide.svelte';

  /** Mock renders 11 feed rows. */
  const VISIBLE_ROWS = 11;
  /** FLIP offset: one two-line feed row (~34px) + list gap (8px). */
  const SLIDE_OFFSET_PX = 42;

  const feedItems$ = selectHudFeedItems();

  const slide = new HudSlide();
  const reducedMotion = watchReducedMotion();
  onDestroy(() => {
    slide.dispose();
    reducedMotion.cleanup();
  });

  let items = $derived($feedItems$.slice(0, VISIBLE_ROWS));

  // Insertion detection: a new id on top triggers the slide; the fresh row
  // gets the alternating highlight (mock's hudhintA/B restart trick).
  let prevTopId: string | null = null;
  let highlightId = $state<string | null>(null);
  let highlightFlip = $state(false);
  $effect(() => {
    const topId = items[0]?.id ?? null;
    if (topId !== null && prevTopId !== null && topId !== prevTopId && !reducedMotion.current) {
      highlightId = topId;
      highlightFlip = !highlightFlip;
      slide.trigger();
    }
    prevTopId = topId;
  });

  let listStyle = $derived.by(() => {
    if (reducedMotion.current || slide.phase === 'idle') return '';
    if (slide.phase === 'prep') return `transform: translateY(-${SLIDE_OFFSET_PX}px); transition: none;`;
    return 'transform: translateY(0); transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1);';
  });

  function tsOf(iso: string): string {
    const ms = Date.parse(iso);
    return formatHudClock(Number.isFinite(ms) ? ms : Date.now());
  }

  /**
   * Line-1 source name: the resolved agent display name for agent events
   * (never the raw UUID), else the source workspace/repo title. Empty when
   * neither is known.
   */
  function nameOf(item: (typeof items)[number]): string {
    return item.resolvedAgentName ?? item.workspaceTitle ?? ''; // i18n-ignore (wire identifiers)
  }

  /**
   * Line-2 detail: the row's detail text (localized card-state label for
   * WORKSPACE STATUS rows, wire text otherwise — `feedDetailText`), prefixed
   * with the workspace title when the name line already showed the agent (so
   * the source workspace is not lost). Empty when there is nothing beyond
   * the name line.
   */
  function detailOf(item: (typeof items)[number]): string {
    const detail = feedDetailText(item);
    const parts = item.resolvedAgentName ? [item.workspaceTitle, detail] : [detail];
    // i18n-ignore (wire identifiers joined with a dash glyph)
    return parts
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' — ');
  }

  /**
   * Detail-line color: failures render red, attention yellow (mock palette
   * `err` / `warn`); everything else inherits the subtle body color.
   */
  function detailColor(item: (typeof items)[number]): string | undefined {
    if (item.colorClass === 'err') return HUD_FEED_COLORS.err;
    if (item.colorClass === 'warn') return HUD_FEED_COLORS.warn;
    return undefined;
  }
</script>

<section class="hud-feed-panel" data-testid="hud-feed-panel">
  <header class="hud-feed-header">
    <span class="hud-feed-title">{m.hud_feed_title()}</span>
    <span class="hud-feed-rule"></span>
    <span class="hud-feed-live-dot" class:hud-feed-live-dot-static={reducedMotion.current}></span>
  </header>
  <div class="hud-feed-body">
    {#if items.length === 0}
      <div class="hud-feed-empty">{m.hud_feed_empty_label()}</div>
    {:else}
      <div class="hud-feed-list" style={listStyle}>
        {#each items as item (item.id)}
          <div
            class="hud-feed-row"
            class:hud-feed-row-hint-a={item.id === highlightId && !highlightFlip}
            class:hud-feed-row-hint-b={item.id === highlightId && highlightFlip}
          >
            <div class="hud-feed-line1">
              <span class="hud-feed-time">{tsOf(item.ts)}</span>
              <span class="hud-feed-dot" style:background={feedDotColor(item)}></span>
              <span class="hud-feed-tag">{feedKindLabel(item.kind, item.agentStatus)}</span>
              <span class="hud-feed-name">{nameOf(item)}</span>
            </div>
            {#if detailOf(item)}
              <div class="hud-feed-line2">
                <span class="hud-feed-text" style:color={detailColor(item)}>{detailOf(item)}</span>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</section>

<style>
  .hud-feed-panel {
    border: 1px solid hsl(var(--border) / 0.8);
    background: hsl(var(--card) / 0.75);
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .hud-feed-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid hsl(var(--border) / 0.5);
  }
  .hud-feed-title {
    font:
      600 10px Inter,
      system-ui,
      sans-serif;
    letter-spacing: 0.18em;
    color: hsl(var(--text-subtle));
    text-transform: uppercase;
  }
  .hud-feed-rule {
    flex: 1;
    height: 1px;
    background: hsl(var(--border) / 0.6);
  }
  .hud-feed-live-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: hsl(var(--primary));
    animation: hud-feed-pulse 1.4s ease-in-out infinite;
  }
  .hud-feed-live-dot-static {
    animation: none;
  }
  .hud-feed-body {
    padding: 12px;
    overflow: hidden;
    flex: 1;
    min-height: 0;
  }
  .hud-feed-empty {
    font:
      500 10.5px 'JetBrains Mono',
      monospace;
    color: hsl(var(--text-ghost));
    letter-spacing: 0.08em;
  }
  .hud-feed-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .hud-feed-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font:
      500 10.5px 'JetBrains Mono',
      monospace;
    line-height: 1.45;
  }
  .hud-feed-line1 {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  /* Second line aligns under the chip: time (54px) + dot (6px) + two gaps
     (9px each) = 78px of leading indent. */
  .hud-feed-line2 {
    padding-left: 78px;
  }
  .hud-feed-row-hint-a {
    animation: hud-hint-a 2.5s ease-out both;
  }
  .hud-feed-row-hint-b {
    animation: hud-hint-b 2.5s ease-out both;
  }
  .hud-feed-time {
    color: hsl(var(--text-ghost));
    flex: none;
    width: 54px;
  }
  .hud-feed-dot {
    width: 6px;
    height: 6px;
    flex: none;
  }
  .hud-feed-tag {
    flex: none;
    border: 1px solid hsl(var(--border));
    color: hsl(var(--text-ghost));
    padding: 0 5px;
    font-size: 8.5px;
    letter-spacing: 0.08em;
    height: 14px;
    line-height: 14px;
    white-space: nowrap;
  }
  .hud-feed-name {
    color: hsl(var(--foreground));
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .hud-feed-text {
    color: hsl(var(--text-subtle));
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  @keyframes hud-feed-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.2;
    }
  }
  /* Two identical keyframes so alternating class flips restart the flash
     (mock's hudhintA/B trick). */
  @keyframes hud-hint-a {
    0% {
      background: hsl(var(--primary) / 0.18);
    }
    100% {
      background: transparent;
    }
  }
  @keyframes hud-hint-b {
    0% {
      background: hsl(var(--primary) / 0.18);
    }
    100% {
      background: transparent;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .hud-feed-live-dot,
    .hud-feed-row-hint-a,
    .hud-feed-row-hint-b {
      animation: none !important;
    }
    .hud-feed-list {
      transform: none !important;
      transition: none !important;
    }
  }
</style>
