<script lang="ts">
  import { tick } from 'svelte';
  import {
    getPanelNavigatorGeometry,
    type PanelNavigatorGeometry,
  } from './panel-navigator-geometry';

  export interface PanelNavigatorItem {
    id: string;
    title: string;
  }

  let {
    panels,
    viewport,
    panelRoot,
    ariaLabel,
    onActivate,
    class: className = '',
  }: {
    panels: readonly PanelNavigatorItem[];
    viewport: HTMLElement | null;
    panelRoot: HTMLElement | null;
    ariaLabel: string;
    onActivate: (panelId: string) => void;
    class?: string;
  } = $props();

  let geometry = $state<PanelNavigatorGeometry>({ segments: [], thumbStart: 0, thumbSize: 0 });
  let measurementFrame: number | null = null;

  function findPanelElement(root: HTMLElement, panelId: string): HTMLElement | null {
    return (
      [...root.querySelectorAll<HTMLElement>('[data-panel-id]')].find(
        (candidate) => candidate.dataset.panelId === panelId,
      ) ?? null
    );
  }

  function measure() {
    measurementFrame = null;
    if (!viewport || !panelRoot) return;
    const ranges = panels.flatMap((panel) => {
      const element = findPanelElement(panelRoot!, panel.id);
      if (!element) return [];
      const rect = element.getBoundingClientRect();
      return [{ id: panel.id, left: rect.left, right: rect.right }];
    });
    if (ranges.length !== panels.length) return;
    const viewportRect = viewport.getBoundingClientRect();
    geometry = getPanelNavigatorGeometry(ranges, viewportRect);
  }

  function scheduleMeasure() {
    if (measurementFrame !== null) return;
    measurementFrame = requestAnimationFrame(measure);
  }

  $effect(() => {
    const currentPanels = panels;
    const currentViewport = viewport;
    const currentRoot = panelRoot;
    if (!currentViewport || !currentRoot || currentPanels.length < 2) {
      geometry = { segments: [], thumbStart: 0, thumbSize: 0 };
      return;
    }

    let disposed = false;
    let animationProbeFrame: number | null = null;
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    const scheduleAnimationSettlementMeasure = () => {
      if (animationProbeFrame !== null) cancelAnimationFrame(animationProbeFrame);
      animationProbeFrame = requestAnimationFrame(() => {
        animationProbeFrame = null;
        const animations = currentRoot
          .getAnimations({ subtree: true })
          .filter((animation) => animation.pending || animation.playState === 'running');
        if (animations.length === 0) return;
        void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
          if (!disposed) scheduleMeasure();
        });
      });
    };
    const observeCurrentElements = () => {
      resizeObserver.observe(currentViewport);
      resizeObserver.observe(currentRoot);
      for (const panel of currentPanels) {
        const element = findPanelElement(currentRoot, panel.id);
        if (element) resizeObserver.observe(element);
      }
    };

    observeCurrentElements();
    currentViewport.addEventListener('scroll', scheduleMeasure, { passive: true });
    currentRoot.addEventListener('transitionrun', scheduleMeasure, true);
    currentRoot.addEventListener('transitionend', scheduleMeasure, true);
    currentRoot.addEventListener('animationstart', scheduleMeasure, true);
    currentRoot.addEventListener('animationend', scheduleMeasure, true);
    currentRoot.addEventListener('animationcancel', scheduleMeasure, true);
    void tick().then(() => {
      if (disposed) return;
      observeCurrentElements();
      scheduleMeasure();
      scheduleAnimationSettlementMeasure();
    });

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      currentViewport.removeEventListener('scroll', scheduleMeasure);
      currentRoot.removeEventListener('transitionrun', scheduleMeasure, true);
      currentRoot.removeEventListener('transitionend', scheduleMeasure, true);
      currentRoot.removeEventListener('animationstart', scheduleMeasure, true);
      currentRoot.removeEventListener('animationend', scheduleMeasure, true);
      currentRoot.removeEventListener('animationcancel', scheduleMeasure, true);
      if (animationProbeFrame !== null) cancelAnimationFrame(animationProbeFrame);
      if (measurementFrame !== null) cancelAnimationFrame(measurementFrame);
      measurementFrame = null;
    };
  });

  const segmentGeometry = $derived(
    new Map(geometry.segments.map((segment) => [segment.id, segment])),
  );
</script>

<nav
  class="panel-navigator pointer-events-none h-6 {className}"
  aria-label={ariaLabel}
  data-panel-navigator
>
  <div class="panel-navigator-track absolute inset-x-0 bottom-0 h-[5px] rounded-full bg-muted">
    {#each panels as panel (panel.id)}
      {@const segment = segmentGeometry.get(panel.id)}
      {#if segment}
        <button
          type="button"
          class="panel-navigator-segment pointer-events-auto absolute bottom-0 overflow-hidden rounded-sm border border-transparent bg-muted-foreground/25 text-left text-foreground hover:border-border hover:bg-popover focus-visible:border-ring focus-visible:bg-popover focus-visible:outline-none"
          style:left={`${segment.start * 100}%`}
          style:width={`${segment.size * 100}%`}
          aria-label={panel.title}
          title={panel.title}
          data-panel-navigator-segment={panel.id}
          onclick={() => onActivate(panel.id)}
        >
          <span class="panel-navigator-title type-caption block truncate px-1.5 opacity-0">
            {panel.title}
          </span>
        </button>
      {/if}
    {/each}
    <div
      class="panel-navigator-thumb pointer-events-none absolute bottom-0 h-[5px] rounded-full bg-foreground/15 ring-1 ring-inset ring-foreground/35"
      style:left={`${geometry.thumbStart * 100}%`}
      style:width={`${geometry.thumbSize * 100}%`}
      data-panel-navigator-thumb
      aria-hidden="true"
    ></div>
  </div>
</nav>

<style>
  .panel-navigator-segment {
    height: 5px;
    transition:
      height 120ms ease,
      background-color 120ms ease,
      border-color 120ms ease;
  }

  .panel-navigator-segment:hover,
  .panel-navigator-segment:focus-visible {
    z-index: 2;
    height: 24px;
  }

  .panel-navigator-segment:hover .panel-navigator-title,
  .panel-navigator-segment:focus-visible .panel-navigator-title {
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .panel-navigator-segment {
      transition: none;
    }
  }
</style>
