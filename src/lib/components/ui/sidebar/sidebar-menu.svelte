<script lang="ts">
  import SizeProvider from '$lib/components/ui/SizeProvider.svelte';
  import type { UiSize } from '$lib/components/ui/size-context';
  import { createProximityHover, type ProximityHover } from '$lib/interaction';
  import { cn, type WithElementRef } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';
  import Highlight from './sidebar-menu-highlight.svelte';
  import {
    setSidebarMenuContext,
    setSidebarMenuLevelContext,
    type SidebarMenuLevel,
  } from './sidebar-menu-context';

  let {
    ref = $bindable(null),
    class: className,
    size,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLUListElement>, HTMLUListElement> & {
    size?: UiSize;
  } = $props();

  let hover = $state.raw<ProximityHover | null>(null);
  let activeIndexes = $state.raw<ReadonlyMap<SidebarMenuLevel, number>>(new Map());
  let focusIndex = $state<number | null>(null);
  let levels = $state<SidebarMenuLevel[]>([]);
  let nextIndex = 0;
  const elements = new Map<number, HTMLElement>();

  setSidebarMenuContext({
    get hover() {
      return hover;
    },
    get activeIndexes() {
      return activeIndexes;
    },
    get focusIndex() {
      return focusIndex;
    },
    get levels() {
      return levels;
    },
    claimIndex(level) {
      const index = nextIndex++;
      levels[index] = level;
      return index;
    },
    registerElement(index, element) {
      if (element) elements.set(index, element);
      else elements.delete(index);
      hover?.registerItem(index, element);
    },
    setActive(index, level, active) {
      const current = activeIndexes.get(level);
      if ((active && current === index) || (!active && current !== index)) return;
      const next = new Map(activeIndexes);
      if (active) next.set(level, index);
      else if (next.get(level) === index) next.delete(level);
      activeIndexes = next;
    },
    setFocus(index) {
      focusIndex = index;
    },
    refresh() {
      hover?.measure();
    },
  });
  setSidebarMenuLevelContext('root');

  let hoverIndex = $derived(hover?.activeIndex ?? null);
  let hoverRect = $derived(hoverIndex === null ? undefined : hover?.itemRects[hoverIndex]);
  let focusRect = $derived(focusIndex === null ? undefined : hover?.itemRects[focusIndex]);
  let activeRects = $derived(
    [...activeIndexes.entries()]
      .map(([level, index]) => ({ level, index, rect: hover?.itemRects[index] }))
      .filter((entry) => Boolean(entry.rect)),
  );
  let hoverAnchorRect = $derived.by(() => {
    if (hoverIndex === null) return undefined;
    const activeIndex = activeIndexes.get(levels[hoverIndex]);
    return activeIndex === undefined ? activeRects[0]?.rect : hover?.itemRects[activeIndex];
  });

  function handleFocus(event: FocusEvent) {
    const target = event.target as HTMLElement;
    if (!target.matches('[data-sidebar="menu-button"], [data-sidebar="menu-sub-button"]')) return;
    const index = Number(target.dataset.sidebarIndex);
    if (!Number.isInteger(index)) return;
    hover?.setActiveIndex(index);
    focusIndex = target.matches(':focus-visible') ? index : null;
  }

  function handleBlur(event: FocusEvent) {
    if (ref?.contains(event.relatedTarget as Node)) return;
    focusIndex = null;
    hover?.setActiveIndex(null);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
      return;
    }
    const buttons = Array.from(
      ref?.querySelectorAll<HTMLElement>(
        '[data-sidebar="menu-button"], [data-sidebar="menu-sub-button"]',
      ) ?? [],
    ).filter(
      (button) =>
        !button.closest('[data-sidebar="menu-sub"][data-state="closed"]') &&
        !button.matches(':disabled, [aria-disabled="true"]'),
    );
    const current = buttons.indexOf(event.target as HTMLElement);
    if (current < 0 || buttons.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Home') buttons[0]?.focus();
    else if (event.key === 'End') buttons.at(-1)?.focus();
    else {
      const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
      buttons[(current + delta + buttons.length) % buttons.length]?.focus();
    }
  }

  $effect(() => {
    if (!ref) return;
    const instance = createProximityHover(ref);
    hover = instance;
    for (const [index, element] of elements) instance.registerItem(index, element);
    return () => {
      instance.destroy();
      if (hover === instance) hover = null;
    };
  });
</script>

{#snippet MenuContent()}
  <ul
    bind:this={ref}
    data-slot="sidebar-menu"
    data-sidebar="menu"
    class={cn('relative flex w-full min-w-0 select-none flex-col gap-0.5', className)}
    onfocusin={handleFocus}
    onfocusout={handleBlur}
    onpointerdown={() => (focusIndex = null)}
    onkeydown={handleKeydown}
    {...restProps}
  >
    {#each activeRects as active (active.level)}
      {#if active.rect}
        <Highlight
          rect={active.rect}
          identity={active.index}
          tier="moderate"
          kind="active"
          class="bg-active z-0"
        />
      {/if}
    {/each}
    {#key hover?.sessionId ?? 0}
      {#if hoverRect && hoverIndex !== null}
        <Highlight
          rect={hoverRect}
          initialRect={hoverAnchorRect}
          identity={hoverIndex}
          tier="fast"
          kind="hover"
          class="bg-hover z-0"
        />
      {/if}
    {/key}
    {#if focusRect && focusIndex !== null}
      <Highlight
        rect={focusRect}
        identity={focusIndex}
        tier="fast"
        kind="focus"
        class="border-focus-ring z-20 border"
      />
    {/if}
    {@render children?.()}
  </ul>
{/snippet}

{#if size}
  <SizeProvider {size}>{@render MenuContent()}</SizeProvider>
{:else}
  {@render MenuContent()}
{/if}
