<script lang="ts">
  import { tick } from 'svelte';
  import Fa from 'svelte-fa';
  import {
    faCode,
    faCodeBranch,
    faCodeCommit,
    faComment,
    faFile,
    faGear,
    faGlobe,
    faHouse,
    faRobot,
    faTableColumns,
    faTerminal,
  } from '@fortawesome/free-solid-svg-icons';
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import { RESOURCE_ICON_BY_KIND } from '$lib/components/shared/resource-icon';
  import type { PanelTabType } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import {
    getPanelNavigatorGeometry,
    type PanelNavigatorGeometry,
  } from './panel-navigator-geometry';

  export interface PanelNavigatorItem {
    id: string;
    title: string;
    type?: PanelTabType;
  }

  let {
    panels,
    viewport,
    panelRoot,
    ariaLabel,
    activePanelId = null,
    onActivate,
    class: className = '',
  }: {
    panels: readonly PanelNavigatorItem[];
    viewport: HTMLElement | null;
    panelRoot: HTMLElement | null;
    ariaLabel: string;
    activePanelId?: string | null;
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

  function getPanelIcon(type?: PanelTabType): IconDefinition {
    switch (type) {
      case 'agent':
        return faComment;
      case 'agent-overview':
        return faRobot;
      case 'note':
        return RESOURCE_ICON_BY_KIND.note;
      case 'terminal':
        return faTerminal;
      case 'browser':
        return faGlobe;
      case 'file':
        return faFile;
      case 'diff':
        return faCodeBranch;
      case 'changes':
      case 'local-changes':
      case 'chat-changes':
      case 'activity-changes':
        return RESOURCE_ICON_BY_KIND.changes;
      case 'settings':
        return faGear;
      case 'overview':
        return faHouse;
      case 'code-review':
        return faCodeCommit;
      case 'hook-script':
      case 'activity':
        return faCode;
      default:
        return faTableColumns;
    }
  }
</script>

<nav
  class="panel-navigator pointer-events-none flex h-9 justify-center {className}"
  aria-label={ariaLabel}
  data-panel-navigator
>
  <div
    class="panel-navigator-track pointer-events-none relative h-9 w-full max-w-xl overflow-hidden rounded-(--radius-large) bg-popover text-popover-foreground shadow-(--elevation-overlay) ring-1 ring-border ring-inset"
  >
    {#each panels as panel (panel.id)}
      {@const segment = segmentGeometry.get(panel.id)}
      {#if segment}
        {@const active = panel.id === activePanelId}
        <button
          type="button"
          class="panel-navigator-segment group pointer-events-auto absolute inset-y-0 z-10 min-w-0 border-0 bg-transparent p-1 text-muted-foreground focus-visible:outline-none"
          style:left={`${segment.start * 100}%`}
          style:width={`${segment.size * 100}%`}
          aria-label={panel.title}
          aria-current={active ? 'page' : undefined}
          title={panel.title}
          data-panel-navigator-segment={panel.id}
          data-panel-navigator-icon={panel.type ?? 'panel'}
          onclick={() => onActivate(panel.id)}
        >
          <span
            class="panel-navigator-tile flex size-full items-center justify-center rounded-(--radius-medium) group-focus-visible:ring-2 group-focus-visible:ring-ring/65 {active
              ? 'bg-primary text-primary-foreground shadow-(--elevation-raised) group-hover:bg-primary'
              : 'group-hover:bg-accent group-hover:text-accent-foreground'}"
            aria-hidden="true"
          >
            <Fa icon={getPanelIcon(panel.type)} size={14} class="panel-navigator-icon" />
          </span>
        </button>
      {/if}
    {/each}
    <div
      class="panel-navigator-thumb pointer-events-none absolute bottom-0 z-20 h-0.5 rounded-full bg-primary/70"
      style:left={`${geometry.thumbStart * 100}%`}
      style:width={`${geometry.thumbSize * 100}%`}
      data-panel-navigator-thumb
      aria-hidden="true"
    ></div>
  </div>
</nav>

<style>
  .panel-navigator-tile {
    transition:
      background-color 120ms ease,
      color 120ms ease,
      box-shadow 120ms ease;
  }

  @media (prefers-reduced-motion: reduce) {
    .panel-navigator-tile {
      transition: none;
    }
  }

  @media (forced-colors: active) {
    .panel-navigator-track,
    [aria-current='page'] .panel-navigator-tile {
      border: 1px solid CanvasText;
      background: Canvas;
      color: CanvasText;
    }
  }
</style>
