<script lang="ts">
  /**
   * ATTENTION panel — waiting/failed agents and raised workspace attention
   * flags with live elapsed timers (mock's warning-bordered card with the
   * blinking dot). `visibility: hidden` (never unmounted) while empty per
   * mock line 131, so the left column keeps its layout. New items slide the
   * list down (FLIP prep→run) and flash the warning hudhintW highlight;
   * animations are disabled under reduced motion.
   */
  import { onDestroy } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import {
    selectHudAttentionItems,
    type HudAttentionItem,
  } from '$store/renderer/slices/hud/hud-selectors';
  import { formatHudTimer } from '../utils/hud-format';
  import {
    attentionColor,
    attentionKindLabel,
    attentionMessageText,
    attentionSourceLabel,
  } from './hud-right-column-labels';
  import { HudSlide, watchReducedMotion } from './hud-slide.svelte';

  /** Mock's FLIP offset: one attention row (~54px) + list gap (10px). */
  const SLIDE_OFFSET_PX = 64;

  const attentionItems$ = selectHudAttentionItems();

  const slide = new HudSlide();
  const reducedMotion = watchReducedMotion();

  // 1s tick for the live elapsed timers (only while items are visible).
  let nowMs = $state(Date.now());
  let timer: ReturnType<typeof setInterval> | undefined;
  $effect(() => {
    if ($attentionItems$.length > 0 && timer === undefined) {
      nowMs = Date.now();
      timer = setInterval(() => {
        nowMs = Date.now();
      }, 1000);
    } else if ($attentionItems$.length === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  });
  onDestroy(() => {
    if (timer !== undefined) clearInterval(timer);
    slide.dispose();
    reducedMotion.cleanup();
  });

  function rowKey(item: HudAttentionItem): string {
    return `${item.kind}:${item.workspaceId}:${item.agentName ?? ''}`;
  }

  // Insertion detection: a key we have not seen before triggers the slide
  // and gets the warning highlight (skipping the initial render).
  let prevKeys: Set<string> | null = null;
  let highlightKey = $state<string | null>(null);
  $effect(() => {
    const keys = $attentionItems$.map(rowKey);
    if (prevKeys !== null && !reducedMotion.current) {
      const seen = prevKeys;
      const added = keys.find((key) => !seen.has(key));
      if (added !== undefined) {
        highlightKey = added;
        slide.trigger();
      }
    }
    prevKeys = new Set(keys);
  });

  let listStyle = $derived.by(() => {
    if (reducedMotion.current || slide.phase === 'idle') return '';
    if (slide.phase === 'prep') return `transform: translateY(-${SLIDE_OFFSET_PX}px); transition: none;`;
    return 'transform: translateY(0); transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1);';
  });

  function elapsed(item: HudAttentionItem): string {
    if (!item.sinceTs) return formatHudTimer(0);
    const sinceMs = Date.parse(item.sinceTs);
    if (!Number.isFinite(sinceMs)) return formatHudTimer(0);
    return formatHudTimer((nowMs - sinceMs) / 1000);
  }
</script>

<section
  class="hud-attention-panel"
  class:hud-attention-panel-empty={$attentionItems$.length === 0}
  data-testid="hud-attention-panel"
>
  <header class="hud-attention-header">
    <span
      class="hud-attention-blink"
      class:hud-attention-blink-static={reducedMotion.current}
    ></span>
    <span class="hud-attention-title">{m.hud_attention_title()}</span>
    <span class="hud-attention-rule"></span>
    <span class="hud-attention-count">{$attentionItems$.length}</span>
  </header>
  <div class="hud-attention-body">
    <div class="hud-attention-list" style={listStyle}>
      {#each $attentionItems$ as item (rowKey(item))}
        <div
          class="hud-attention-row"
          class:hud-attention-row-hint={rowKey(item) === highlightKey}
          style:border-left-color={attentionColor(item)}
        >
          <div class="hud-attention-row-top" style:color={attentionColor(item)}>
            <span class="hud-attention-src">{attentionSourceLabel(item)}</span>
            <span>{attentionKindLabel(item)}</span>
            <span class="hud-attention-spacer"></span>
            {#if item.sinceTs}
              <!-- No timer when the raise time is unknown (generic rollup
                   rows): a frozen 00:00:00 would misread as "just raised". -->
              <span>{elapsed(item)}</span>
            {/if}
          </div>
          <div class="hud-attention-row-main">
            <span class="hud-attention-ws">{item.workspaceTitle}</span>
            {#if item.agentName}
              <span class="hud-attention-agent">{item.agentName}</span>
            {/if}
          </div>
          {#if item.message !== null}
            <div class="hud-attention-msg">{attentionMessageText(item)}</div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</section>

<style>
  .hud-attention-panel {
    border: 1px solid hsl(var(--warning) / 0.55);
    background: hsl(var(--card) / 0.75);
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  /* Mock line 131: keep layout, hide the frame while no items are raised. */
  .hud-attention-panel-empty {
    visibility: hidden;
  }
  .hud-attention-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid hsl(var(--border) / 0.5);
  }
  .hud-attention-blink {
    width: 7px;
    height: 7px;
    background: hsl(var(--warning));
    animation: hud-attention-blink 1.6s step-end infinite;
  }
  .hud-attention-blink-static {
    animation: none;
  }
  .hud-attention-title {
    font:
      600 10px Inter,
      system-ui,
      sans-serif;
    letter-spacing: 0.18em;
    color: hsl(var(--warning));
    text-transform: uppercase;
  }
  .hud-attention-rule {
    flex: 1;
    height: 1px;
    background: hsl(var(--border) / 0.6);
  }
  .hud-attention-count {
    font:
      500 10px 'JetBrains Mono',
      monospace;
  }
  .hud-attention-body {
    padding: 12px;
    overflow: hidden;
    flex: 1;
    min-height: 0;
  }
  .hud-attention-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .hud-attention-row {
    border-left: 2px solid hsl(var(--warning));
    padding: 2px 6px 2px 10px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .hud-attention-row-hint {
    animation: hud-hint-w 2.5s ease-out both;
  }
  .hud-attention-row-top {
    display: flex;
    align-items: center;
    gap: 8px;
    font:
      600 10px 'JetBrains Mono',
      monospace;
  }
  .hud-attention-src {
    flex: none;
    border: 1px solid hsl(var(--border));
    color: hsl(var(--text-ghost));
    padding: 0 5px;
    font-size: 8.5px;
    letter-spacing: 0.08em;
    height: 14px;
    line-height: 14px;
  }
  .hud-attention-spacer {
    flex: 1;
  }
  .hud-attention-row-main {
    display: flex;
    align-items: baseline;
    gap: 7px;
    font:
      600 12.5px Inter,
      system-ui,
      sans-serif;
    letter-spacing: -0.01em;
    color: hsl(var(--foreground));
  }
  .hud-attention-ws {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .hud-attention-agent {
    font:
      500 10px 'JetBrains Mono',
      monospace;
    color: hsl(var(--text-subtle));
    flex: none;
  }
  .hud-attention-msg {
    font:
      500 10.5px 'JetBrains Mono',
      monospace;
    color: hsl(var(--text-subtle));
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  @keyframes hud-attention-blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.15;
    }
  }
  @keyframes hud-hint-w {
    0% {
      background: hsl(var(--warning) / 0.18);
    }
    100% {
      background: transparent;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .hud-attention-blink,
    .hud-attention-row-hint {
      animation: none !important;
    }
    .hud-attention-list {
      transform: none !important;
      transition: none !important;
    }
  }
</style>
