<script lang="ts" generics="T">
  import { ProximityHighlight } from '$lib/components/ui/proximity-highlight';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { createProximityHover, proximityItem, type ProximityHover } from '$lib/interaction';
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';
  import type { Snippet } from 'svelte';
  import type { Action } from 'svelte/action';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { ListKey, ListRowContext, SelectionMode } from './types';

  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
    items: readonly T[];
    row: Snippet<[ListRowContext<T>]>;
    getKey?: (item: T, index: number) => ListKey;
    getText?: (item: T, index: number) => string;
    selectable?: SelectionMode;
    selectedKeys?: ListKey[];
    onSelectedKeysChange?: (keys: ListKey[]) => void;
    onActivate?: (item: T, index: number) => void;
    status?: 'ready' | 'loading' | 'error';
    empty?: Snippet;
    loading?: Snippet;
    error?: Snippet;
    virtualize?: boolean | 'auto';
    rowHeight?: number;
    overscan?: number;
    ariaLabel?: string;
    class?: string;
  }

  let {
    items,
    row,
    getKey = (_item, index) => index,
    getText = (item, index) => String(getKey(item, index)),
    selectable = false,
    selectedKeys = $bindable([]),
    onSelectedKeysChange,
    onActivate,
    status = 'ready',
    empty,
    loading,
    error,
    virtualize = 'auto',
    rowHeight = 48,
    overscan = 4,
    ariaLabel,
    class: className,
    ...restProps
  }: Props = $props();

  let viewport: HTMLDivElement | null = $state(null);
  let content: HTMLDivElement | null = $state(null);
  let hover: ProximityHover | null = $state.raw(null);
  let activeIndex = $state(0);
  let scrollTop = $state(0);
  let viewportHeight = $state(0);
  let typeahead = '';
  let typeaheadAt = 0;

  const isVirtualized = $derived(
    virtualize === true || (virtualize === 'auto' && items.length > 200),
  );
  const startIndex = $derived(
    isVirtualized ? Math.max(0, Math.floor(scrollTop / rowHeight) - overscan) : 0,
  );
  const endIndex = $derived(
    isVirtualized
      ? Math.min(items.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan)
      : items.length,
  );
  const visibleRows = $derived(
    items.slice(startIndex, endIndex).map((item, offset) => ({ item, index: startIndex + offset })),
  );
  const selectedSet = $derived(new Set(selectedKeys));
  const selectedIndexes = $derived(
    items.flatMap((item, index) => (selectedSet.has(getKey(item, index)) ? [index] : [])),
  );

  $effect(() => {
    if (!content || status !== 'ready' || items.length === 0) {
      hover = null;
      return;
    }
    const instance = createProximityHover(content);
    hover = instance;
    return () => {
      instance.destroy();
      if (hover === instance) hover = null;
    };
  });

  $effect(() => {
    if (activeIndex >= items.length) activeIndex = Math.max(0, items.length - 1);
  });

  const registerRow: Action<HTMLElement, { store: ProximityHover | null; index: number }> = (
    node,
    options,
  ) => {
    let registration = options.store
      ? proximityItem(node, { hover: options.store, index: options.index })
      : undefined;
    return {
      update(next) {
        registration?.destroy?.();
        registration = next.store
          ? proximityItem(node, { hover: next.store, index: next.index })
          : undefined;
      },
      destroy() {
        registration?.destroy?.();
      },
    };
  };

  function setSelection(next: ListKey[]) {
    selectedKeys = next;
    onSelectedKeysChange?.(next);
  }

  function toggleSelection(index: number) {
    if (!selectable) return;
    const key = getKey(items[index], index);
    if (selectable === 'single') {
      setSelection(selectedSet.has(key) ? [] : [key]);
      return;
    }
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelection([...next]);
  }

  function focusIndex(index: number) {
    if (items.length === 0) return;
    activeIndex = Math.max(0, Math.min(items.length - 1, index));
    hover?.setActiveIndex(activeIndex);
    if (isVirtualized && viewport) viewport.scrollTop = activeIndex * rowHeight;
    requestAnimationFrame(() => {
      content?.querySelector<HTMLElement>(`[data-list-index="${activeIndex}"]`)?.focus();
    });
  }

  function isNestedControl(event: MouseEvent): boolean {
    const target = event.target as Element | null;
    const rowElement = event.currentTarget as HTMLElement;
    const control = target?.closest(
      'button,a,input,select,textarea,[role="button"],[role="menuitem"]',
    );
    return Boolean(control && control !== rowElement);
  }

  function activate(event: MouseEvent, item: T, index: number) {
    if (isNestedControl(event)) return;
    activeIndex = index;
    hover?.setActiveIndex(index);
    toggleSelection(index);
    onActivate?.(item, index);
  }

  function handleKeydown(event: KeyboardEvent, item: T, index: number) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusIndex(index + (event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusIndex(event.key === 'Home' ? 0 : items.length - 1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleSelection(index);
      onActivate?.(item, index);
      return;
    }
    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
    const now = Date.now();
    typeahead = now - typeaheadAt > 500 ? event.key : typeahead + event.key;
    typeaheadAt = now;
    const query = typeahead.toLocaleLowerCase();
    for (let offset = 1; offset <= items.length; offset += 1) {
      const candidate = (index + offset) % items.length;
      if (getText(items[candidate], candidate).toLocaleLowerCase().startsWith(query)) {
        event.preventDefault();
        focusIndex(candidate);
        break;
      }
    }
  }

  function handleScroll() {
    if (!viewport) return;
    scrollTop = viewport.scrollTop;
    viewportHeight = viewport.clientHeight;
    hover?.measure();
  }
</script>

{#if status === 'loading'}
  {#if loading}
    {@render loading()}
  {:else}
    <div class="space-y-2 p-2" role="status" aria-label={m.ui_spinner_loading_ariaLabel()}>
      {#each [0, 1, 2] as row (row)}
        <Skeleton class="h-10 w-full" />
      {/each}
    </div>
  {/if}
{:else if status === 'error'}
  {#if error}
    {@render error()}
  {:else}
    <p class="p-4 text-sm text-error-foreground" role="alert">{m.error_page_title()}</p>
  {/if}
{:else if items.length === 0}
  {#if empty}
    {@render empty()}
  {:else}
    <p class="p-4 text-center text-sm text-muted-foreground">{m.ui_list_empty_label()}</p>
  {/if}
{:else}
  <div
    bind:this={viewport}
    data-slot="list-view"
    data-virtualized={isVirtualized || undefined}
    class={cn('min-w-0 overflow-auto', className)}
    role={selectable ? 'listbox' : 'list'}
    aria-label={ariaLabel}
    aria-multiselectable={selectable === 'multi' || undefined}
    onscroll={handleScroll}
    {...restProps}
  >
    <div
      bind:this={content}
      class="relative min-w-0"
      style:height={isVirtualized ? `${items.length * rowHeight}px` : undefined}
    >
      {#if hover}<ProximityHighlight store={hover} {selectedIndexes} />{/if}
      <div style:transform={isVirtualized ? `translateY(${startIndex * rowHeight}px)` : undefined}>
        {#each visibleRows as { item, index } (getKey(item, index))}
          {@const key = getKey(item, index)}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex (listbox uses roving option focus; role is selected at runtime) -->
          <div
            data-slot="list-view-item"
            data-list-index={index}
            data-highlighted={hover?.activeIndex === index || undefined}
            class="group/collection-row relative z-10 min-w-0 rounded-(--radius-small) outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            role={selectable ? 'option' : 'listitem'}
            aria-selected={selectable ? selectedSet.has(key) : undefined}
            tabindex={index === activeIndex ? 0 : -1}
            use:registerRow={{ store: hover, index }}
            onclick={(event) => activate(event, item, index)}
            onfocus={() => {
              activeIndex = index;
              hover?.setActiveIndex(index);
            }}
            onfocusout={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget as Node | null) &&
                hover?.activeIndex === index
              ) {
                hover.setActiveIndex(null);
              }
            }}
            onkeydown={(event) => handleKeydown(event, item, index)}
          >
            {@render row({
              item,
              index,
              selected: selectedSet.has(key),
              highlighted: hover?.activeIndex === index,
            })}
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}
