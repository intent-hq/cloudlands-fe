<script lang="ts">
  import { createProximityHover, type ProximityHover } from '$lib/interaction';
  import { ProximityHighlight } from '$lib/components/ui/proximity-highlight';
  import { onMount, tick } from 'svelte';

  interface Props {
    activeIndex?: number | null;
    onactiveindexchange?: (index: number | null) => void;
  }

  let { activeIndex, onactiveindexchange }: Props = $props();
  let marker: HTMLSpanElement | null = $state(null);
  let hover: ProximityHover | null = $state.raw(null);
  let selectedIndexes = $state<number[]>([]);
  let lastPointerIndex: number | null | undefined;
  const itemSelector =
    '[data-menu-item], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"]';

  $effect(() => {
    if (!hover || activeIndex === undefined || hover.pointerPosition) return;
    hover.setActiveIndex(activeIndex);
  });

  $effect(() => {
    if (!hover?.pointerPosition) {
      lastPointerIndex = undefined;
      return;
    }
    if (hover.activeIndex === lastPointerIndex) return;
    lastPointerIndex = hover.activeIndex;
    onactiveindexchange?.(hover.activeIndex);
  });

  onMount(() => {
    const container = marker?.parentElement;
    if (!container) return;
    container.dataset.listOverlay = '';
    container.classList.add('relative', 'isolate');
    const instance = createProximityHover(container);
    hover = instance;
    let items: HTMLElement[] = [];

    const containsMenuItem = (node: Node) =>
      node instanceof Element && (node.matches(itemSelector) || node.querySelector(itemSelector));
    const isDisabled = (item: HTMLElement) =>
      item.hasAttribute('data-disabled') || item.getAttribute('aria-disabled') === 'true';
    const isSelected = (item: HTMLElement) =>
      item.hasAttribute('data-selected') ||
      item.getAttribute('data-state') === 'checked' ||
      item.getAttribute('aria-selected') === 'true' ||
      item.getAttribute('aria-checked') === 'true';

    const sync = () => {
      const nextItems = Array.from(container.querySelectorAll<HTMLElement>(itemSelector)).filter(
        (item) => item.closest('[data-list-overlay]') === container && !isDisabled(item),
      );
      if (
        nextItems.length !== items.length ||
        nextItems.some((item, index) => item !== items[index])
      ) {
        items.forEach((_, index) => instance.registerItem(index, null));
        items = nextItems;
        items.forEach((item, index) => instance.registerItem(index, item));
      } else {
        instance.measure();
      }
      const nextSelected = items.flatMap((item, index) => (isSelected(item) ? [index] : []));
      if (
        nextSelected.length !== selectedIndexes.length ||
        nextSelected.some((index, offset) => index !== selectedIndexes[offset])
      ) {
        selectedIndexes = nextSelected;
      }
      if (activeIndex === undefined) {
        const highlighted = items.findIndex(
          (item) => item.hasAttribute('data-highlighted') || item === document.activeElement,
        );
        if (highlighted >= 0) instance.setActiveIndex(highlighted);
      }
    };

    const observer = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            record.type === 'attributes' ||
            [...record.addedNodes, ...record.removedNodes].some(containsMenuItem),
        )
      ) {
        sync();
      }
    });
    observer.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'data-highlighted',
        'data-selected',
        'data-state',
        'data-disabled',
        'aria-selected',
        'aria-checked',
        'aria-disabled',
      ],
    });
    const handleFocus = (event: FocusEvent) => {
      const index = items.indexOf(event.target as HTMLElement);
      if (index >= 0) instance.setActiveIndex(index);
    };
    container.addEventListener('focusin', handleFocus);
    void tick().then(sync);

    return () => {
      observer.disconnect();
      container.removeEventListener('focusin', handleFocus);
      instance.destroy();
      hover = null;
      delete container.dataset.listOverlay;
    };
  });
</script>

<span
  bind:this={marker}
  data-slot="menu-list-highlight"
  data-active-index={hover?.activeIndex ?? undefined}
  class="contents"
  aria-hidden="true"
>
  {#if hover}
    <ProximityHighlight store={hover} {selectedIndexes} />
  {/if}
</span>
