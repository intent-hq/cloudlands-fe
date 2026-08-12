<script lang="ts">
  import { onMount, untrack, type Snippet } from 'svelte';
  import { cn } from '$lib/utils';
  import {
    clampSurfaceGeometry,
    interpolateSurfaceGeometry,
    makeSurfacePath,
    type SurfaceGeometry,
  } from './smart-corner-tabs-geometry';

  export interface SmartCornerTab {
    id: string;
    label: string;
    disabled?: boolean;
  }

  interface Props {
    tabs: SmartCornerTab[];
    activeTabId?: string;
    onTabChange?: (tabId: string) => void;
    panelId?: string;
    ariaLabel?: string;
    class?: string;
    children?: Snippet<[SmartCornerTab]>;
  }

  let {
    tabs,
    activeTabId,
    onTabChange,
    panelId = 'smart-corner-tabpanel',
    // i18n-ignore (generic component fallback; product callers provide localized labels)
    ariaLabel = 'Tabs',
    class: className,
    children,
  }: Props = $props();

  let rootRef = $state<HTMLDivElement | null>(null);
  let tabListRef = $state<HTMLDivElement | null>(null);
  const surfacePathId = $derived(`${panelId}-surface`);
  // svelte-ignore state_referenced_locally
  let internalActiveId = $state(activeTabId ?? tabs[0]?.id ?? '');
  // svelte-ignore state_referenced_locally
  let visualActiveId = $state(internalActiveId);
  let renderedGeometry = $state<SurfaceGeometry | null>(null);
  let hoverX = $state(0);
  let hoverWidth = $state(0);
  let hoveredTabId = $state<string | null>(null);
  let pressOffset = $state(0);
  let reducedMotion = $state(false);

  const tabButtons = new Map<string, HTMLButtonElement>();
  let resizeObserver: ResizeObserver | null = null;
  let surfaceAnimationFrame: number | null = null;
  let pressAnimationFrame: number | null = null;
  let visualActiveTimer: ReturnType<typeof setTimeout> | null = null;

  const activeId = $derived(activeTabId ?? internalActiveId);
  const activeTab = $derived(tabs.find((tab) => tab.id === activeId) ?? tabs[0]);
  const surfacePath = $derived(
    renderedGeometry
      ? makeSurfacePath({
          ...renderedGeometry,
          topY: renderedGeometry.topY - pressOffset,
          radius: renderedGeometry.radius + pressOffset * 0.35,
        })
      : '',
  );

  function isReducedMotion() {
    return reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function easeOutCubic(progress: number) {
    return 1 - (1 - progress) ** 3;
  }

  function registerTabButton(node: HTMLButtonElement, tabId: string) {
    tabButtons.set(tabId, node);
    resizeObserver?.observe(node);

    return {
      destroy() {
        tabButtons.delete(tabId);
      },
    };
  }

  function measureHover(tabId: string) {
    const button = tabButtons.get(tabId);
    const tabList = tabListRef;
    if (!button || !tabList) return;
    const buttonRect = button.getBoundingClientRect();
    const listRect = tabList.getBoundingClientRect();
    hoverX = buttonRect.left - listRect.left;
    hoverWidth = buttonRect.width;
    hoveredTabId = tabId;
  }

  function getTargetGeometry(): SurfaceGeometry | null {
    const root = rootRef;
    const tabList = tabListRef;
    const button = tabButtons.get(activeId);
    if (!root || !tabList || !button) return null;

    const rootRect = root.getBoundingClientRect();
    const tabListRect = tabList.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const tabStripTop = tabListRect.top - rootRect.top;
    const panelY = tabListRect.bottom - rootRect.top;

    return clampSurfaceGeometry({
      width: root.clientWidth,
      height: root.clientHeight,
      x: buttonRect.left - rootRect.left,
      tabWidth: buttonRect.width,
      topY: tabStripTop,
      panelY,
      radius: 20,
      outerRadius: 20,
    });
  }

  function setRenderedGeometry(next: SurfaceGeometry) {
    renderedGeometry = next;
  }

  function animateSurface(next: SurfaceGeometry) {
    if (surfaceAnimationFrame !== null) cancelAnimationFrame(surfaceAnimationFrame);
    const from = renderedGeometry ?? next;

    if (isReducedMotion() || !renderedGeometry) {
      setRenderedGeometry(next);
      return;
    }

    const startedAt = performance.now();
    const duration = 420;
    const frame = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      setRenderedGeometry(interpolateSurfaceGeometry(from, next, easeOutCubic(progress)));
      if (progress < 1) {
        surfaceAnimationFrame = requestAnimationFrame(frame);
      } else {
        surfaceAnimationFrame = null;
      }
    };
    surfaceAnimationFrame = requestAnimationFrame(frame);
  }

  function measure() {
    const next = getTargetGeometry();
    if (next) animateSurface(next);
    for (const tabId of tabButtons.keys()) resizeObserver?.observe(tabButtons.get(tabId)!);
  }

  function scheduleMeasure() {
    requestAnimationFrame(measure);
  }

  function animatePress(target: number) {
    if (pressAnimationFrame !== null) cancelAnimationFrame(pressAnimationFrame);
    const from = pressOffset;
    if (isReducedMotion()) {
      pressOffset = target;
      return;
    }
    const startedAt = performance.now();
    const duration = target > from ? 160 : 260;
    const frame = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      pressOffset = from + (target - from) * easeOutCubic(progress);
      if (progress < 1) pressAnimationFrame = requestAnimationFrame(frame);
      else pressAnimationFrame = null;
    };
    pressAnimationFrame = requestAnimationFrame(frame);
  }

  function scheduleVisualActive(tabId: string) {
    if (visualActiveTimer !== null) clearTimeout(visualActiveTimer);
    if (isReducedMotion()) {
      visualActiveId = tabId;
      visualActiveTimer = null;
      return;
    }
    visualActiveTimer = setTimeout(() => {
      visualActiveId = tabId;
      visualActiveTimer = null;
    }, 190);
  }

  function activateTab(tabId: string) {
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (!tab || tab.disabled) return;

    internalActiveId = tabId;
    onTabChange?.(tabId);
    scheduleVisualActive(tabId);

    const button = tabButtons.get(tabId);
    button?.scrollIntoView?.({
      behavior: isReducedMotion() ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
    scheduleMeasure();
  }

  function handleTabKeydown(event: KeyboardEvent, tabId: string) {
    const enabledTabs = tabs.filter((tab) => !tab.disabled);
    const index = enabledTabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return;

    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % enabledTabs.length;
    if (event.key === 'ArrowLeft')
      nextIndex = (index - 1 + enabledTabs.length) % enabledTabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = enabledTabs.length - 1;

    if (nextIndex !== null) {
      event.preventDefault();
      const nextTab = enabledTabs[nextIndex];
      tabButtons.get(nextTab.id)?.focus();
      activateTab(nextTab.id);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activateTab(tabId);
    }
  }

  $effect(() => {
    const nextActiveId = activeTabId ?? tabs[0]?.id ?? '';
    if (!tabs.some((tab) => tab.id === internalActiveId)) internalActiveId = nextActiveId;
    if (!tabs.some((tab) => tab.id === visualActiveId)) visualActiveId = nextActiveId;
  });

  $effect(() => {
    const controlledActiveId = activeTabId;
    if (!controlledActiveId || controlledActiveId === visualActiveId) return;
    scheduleVisualActive(controlledActiveId);
  });

  $effect(() => {
    void activeId;
    void tabs.length;
    untrack(scheduleMeasure);
  });

  onMount(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = () => (reducedMotion = mediaQuery.matches);
    const fontsReady = document.fonts?.ready;
    updateMotionPreference();
    mediaQuery.addEventListener('change', updateMotionPreference);

    resizeObserver = new ResizeObserver(scheduleMeasure);
    if (rootRef) resizeObserver.observe(rootRef);
    if (tabListRef) resizeObserver.observe(tabListRef);
    for (const button of tabButtons.values()) resizeObserver.observe(button);
    scheduleMeasure();
    fontsReady?.then(scheduleMeasure);

    return () => {
      mediaQuery.removeEventListener('change', updateMotionPreference);
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (surfaceAnimationFrame !== null) cancelAnimationFrame(surfaceAnimationFrame);
      if (pressAnimationFrame !== null) cancelAnimationFrame(pressAnimationFrame);
      if (visualActiveTimer !== null) clearTimeout(visualActiveTimer);
    };
  });
</script>

<div
  bind:this={rootRef}
  class={cn(
    'smart-corner-tabs relative isolate flex min-h-64 flex-col overflow-visible bg-muted/70',
    className,
  )}
  data-smart-corner-tabs
>
  <div
    class="smart-corner-tabs-strip relative z-10 flex min-h-12 items-end overflow-x-auto scrollbar-none"
  >
    <div
      bind:this={tabListRef}
      class="relative flex min-w-full items-end gap-1 px-2 pt-2"
      role="tablist"
      aria-label={ariaLabel}
    >
      <div
        class={cn(
          'pointer-events-none absolute bottom-1 top-2 rounded-lg bg-card/10 transition-[left,width,opacity] duration-200 ease-out',
          (hoveredTabId === null || hoveredTabId === activeId) && 'opacity-0',
        )}
        style:left={`${hoverX}px`}
        style:width={`${hoverWidth}px`}
        aria-hidden="true"
      ></div>
      {#each tabs as tab (tab.id)}
        <button
          use:registerTabButton={tab.id}
          id={`${surfacePathId}-tab-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={tab.id === activeId}
          aria-controls={panelId}
          tabindex={tab.id === activeId ? 0 : -1}
          disabled={tab.disabled}
          class={cn(
            'relative z-10 min-w-max rounded-lg px-4 py-2.5 text-sm font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
            tab.id === visualActiveId ? 'text-card-foreground' : 'text-muted-foreground',
          )}
          data-smart-corner-tab={tab.id}
          onclick={() => activateTab(tab.id)}
          onkeydown={(event) => handleTabKeydown(event, tab.id)}
          onpointerenter={() => measureHover(tab.id)}
          onpointerleave={() => (hoveredTabId = null)}
          onpointerdown={() => animatePress(7)}
          onpointerup={() => animatePress(0)}
          onpointercancel={() => animatePress(0)}
        >
          {tab.label}
        </button>
      {/each}
    </div>
  </div>

  <svg
    class="smart-corner-tabs-surface pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible"
    viewBox={`0 0 ${renderedGeometry?.width ?? 1} ${renderedGeometry?.height ?? 1}`}
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <defs>
      <clipPath id={surfacePathId} clipPathUnits="userSpaceOnUse">
        <path d={surfacePath}></path>
      </clipPath>
    </defs>
    <path d={surfacePath} fill="hsl(var(--card))"></path>
  </svg>

  <div
    id={panelId}
    class="relative z-10 min-h-52 flex-1 rounded-b-xl px-5 py-6 text-card-foreground"
    role="tabpanel"
    aria-labelledby={`${surfacePathId}-tab-${activeId}`}
    tabindex="0"
  >
    {#if activeTab && children}
      {@render children(activeTab)}
    {:else if activeTab}
      <h2 class="text-lg font-semibold">{activeTab.label}</h2>
    {/if}
  </div>
</div>
