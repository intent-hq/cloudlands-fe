<script lang="ts">
  /**
   * One takeover banner row: kind chip + dot-matrix headline with the
   * typewriter wipe-in, dwell-proportional fade-out and — when the parent
   * overlay measured a headline overflow — the constant-speed marquee.
   * Purely presentational: the parent measures the DOM and reports the
   * scroll duration to the controller (see HudTakeoverOverlay.svelte).
   */
  import {
    bannerDelay,
    bannerOutDelay,
    bannerScrollDurationS,
    HUD_TAKEOVER_BANNER_IN_S,
    HUD_TAKEOVER_BANNER_SCROLL_HOLD_S,
    HUD_TAKEOVER_BANNER_SCROLL_PX_PER_S,
  } from './hud-takeover-layout';
  import type { HudTakeoverTrigger } from './hud-takeover-queue';
  import {
    bannerView,
    takeoverAttentionChipLabel,
    takeoverKindColor,
    takeoverKindLabel,
  } from './hud-takeover-meta';

  let {
    banner,
    index,
    title,
    repoRef,
    motion,
    needsPan,
    dwellMs,
    overflowPx,
  }: {
    banner: HudTakeoverTrigger;
    /** Position in the stacked banner list (staggers the in/out delays). */
    index: number;
    title: string;
    repoRef: string;
    motion: boolean;
    needsPan: boolean;
    dwellMs: number;
    /** Measured headline overflow (px) from the parent's measurement $effect. */
    overflowPx: number;
  } = $props();

  const color = $derived(takeoverKindColor(banner.kind));
  const bv = $derived(bannerView(banner, title, repoRef));
  const scrollPx = $derived(motion && !bv.wrap ? overflowPx : 0);
  const scrollS = $derived(bannerScrollDurationS(scrollPx));
</script>

<div
  class="ov-banner"
  class:ov-no-motion={!motion}
  style:--banner-in-delay={motion ? `${bannerDelay(needsPan, index)}s` : '0s'}
  style:--banner-out-delay={motion
    ? `${bannerOutDelay(needsPan, index, dwellMs, scrollS)}s`
    : '0s'}
  data-testid="hud-takeover-banner"
>
  <span class="ov-banner-chip" class:ov-anim-blink={motion} style:border-color={color} style:color>
    {banner.signal ? takeoverAttentionChipLabel(banner.signal) : takeoverKindLabel(banner.kind)}
  </span>
  {#if bv.big}
    <div class="ov-banner-big" class:ov-banner-big-wrap={bv.wrap} style:color>
      {#if scrollPx > 0}
        <!-- Overflow marquee: constant-speed left travel after the wipe-in +
             head hold; the tail then holds (fill: both). Driven by the
             measured overflow (see the parent's measurement $effect). -->
        <span
          class="ov-banner-marquee"
          style:--banner-scroll-px={`${scrollPx}px`}
          style:--banner-scroll-s={`${(scrollPx / HUD_TAKEOVER_BANNER_SCROLL_PX_PER_S).toFixed(2)}s`}
          style:--banner-scroll-delay={`${(
            Number(bannerDelay(needsPan, index)) +
            HUD_TAKEOVER_BANNER_IN_S +
            HUD_TAKEOVER_BANNER_SCROLL_HOLD_S
          ).toFixed(2)}s`}
          data-testid="hud-takeover-banner-marquee"
        >
          {bv.big}
        </span>
      {:else}
        {bv.big}
      {/if}
    </div>
  {/if}
  {#if bv.status}
    <div class="ov-banner-status" data-testid={bv.statusTestId}>
      {bv.status}
    </div>
  {/if}
  {#if bv.sub}
    <div class="ov-banner-sub">{bv.sub}</div>
  {/if}
</div>

<style>
  @keyframes bannerin {
    from {
      clip-path: inset(0 100% 0 0);
    }
    to {
      clip-path: inset(0 0 0 0);
    }
  }
  /* Overflow marquee: read position travels left→right across the text —
     the text itself translates left by the measured overflow, then holds
     (fill: both keeps the head pinned before, the tail visible after). */
  @keyframes bannerscroll {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(calc(-1 * var(--banner-scroll-px, 0px)));
    }
  }
  @keyframes bannerout {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }

  .ov-banner {
    border-top: 1px solid hsl(var(--border) / 0.8);
    border-bottom: 1px solid hsl(var(--border) / 0.8);
    background: hsl(var(--app-background) / 0.88);
    padding: 14px 22px;
    /* Typewriter wipe in, then auto fade-out while the map stays up. The
       out-delay is dwell-proportional (bannerOutDelay: unfolded hold ≈ half
       the entry's dwell); the wipe duration mirrors
       HUD_TAKEOVER_BANNER_IN_S. */
    animation:
      bannerin 1.1s steps(22) var(--banner-in-delay, 0s) both,
      bannerout 0.45s ease var(--banner-out-delay, 5.2s) both;
  }
  .ov-banner-chip {
    display: inline-block;
    border: 1px solid;
    padding: 4px 11px;
    margin-bottom: 10px;
    font: 600 10px 'JetBrains Mono', monospace;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .ov-anim-blink {
    animation: hudblink 1.6s step-end infinite;
  }
  .ov-banner-big {
    font: 700 42px 'Doto', 'JetBrains Mono', monospace;
    letter-spacing: 0.08em;
    line-height: 1.05;
    white-space: nowrap;
    overflow: hidden;
    text-transform: uppercase;
  }
  .ov-banner-big-wrap {
    font-size: 24px;
    white-space: normal;
    text-transform: none;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }
  /* Marquee inner span: starts pinned left (head visible), then travels by
     the measured overflow at the constant HUD_TAKEOVER_BANNER_SCROLL_PX_PER_S
     speed after the wipe-in + head hold; fill both holds the tail. */
  .ov-banner-marquee {
    display: inline-block;
    animation: bannerscroll var(--banner-scroll-s, 0s) linear var(--banner-scroll-delay, 0s) both;
  }
  .ov-banner-sub {
    margin-top: 6px;
    font: 500 11.5px 'JetBrains Mono', monospace;
    letter-spacing: 0.18em;
    color: hsl(var(--text-subtle));
    text-transform: uppercase;
  }
  .ov-banner-status {
    margin-top: 8px;
    font: 500 14px 'JetBrains Mono', monospace;
    line-height: 1.4;
    color: hsl(var(--text-subtle));
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }

  /* ── Reduced motion: skip every animation, content shows immediately ── */
  .ov-banner.ov-no-motion,
  .ov-no-motion .ov-banner-marquee {
    animation: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .ov-banner,
    .ov-banner-marquee,
    .ov-anim-blink {
      animation: none;
    }
  }
</style>
