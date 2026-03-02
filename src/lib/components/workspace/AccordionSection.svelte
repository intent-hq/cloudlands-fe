<script lang="ts">
  import { faChevronDown, type IconDefinition } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { slide } from 'svelte/transition';
  import type { Snippet } from 'svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';

  interface Props {
    icon: IconDefinition;
    label: string;
    description?: string;
    expanded: boolean;
    onToggle: () => void;
    badge?: Snippet;
    children: Snippet;
    contentClass?: string;
    defaultHeight?: number;
    minHeight?: number;
    maxHeight?: number;
    resizable?: boolean;
    sectionId?: string;
  }

  let {
    icon,
    label,
    description,
    expanded,
    onToggle,
    badge,
    children,
    contentClass = 'pb-3',
    defaultHeight = 300,
    minHeight = 100,
    maxHeight = 600,
    resizable = true,
    sectionId,
  }: Props = $props();

  // Track previous expanded state to detect changes
  let prevExpanded: boolean | null = null;

  // Smart scroll when expanding/collapsing
  $effect(() => {
    const currentExpanded = expanded;
    const wasExpanded = prevExpanded;

    // Skip on first run
    if (wasExpanded === null) {
      prevExpanded = currentExpanded;
      return;
    }

    if (currentExpanded === wasExpanded) return;
    prevExpanded = currentExpanded;

    if (!sectionEl) return;

    // Find scrollable parent
    let scrollParent: HTMLElement | null = sectionEl.parentElement;
    while (scrollParent) {
      const style = getComputedStyle(scrollParent);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') break;
      scrollParent = scrollParent.parentElement;
    }
    if (!scrollParent) return;

    const rect = sectionEl.getBoundingClientRect();
    const parentRect = scrollParent.getBoundingClientRect();
    const threshold = 200;

    if (currentExpanded && !wasExpanded) {
      // Expanding: scroll if header is within 200px of parent bottom
      const distanceFromBottom = parentRect.bottom - rect.top;
      if (distanceFromBottom < threshold) {
        // Wait for slide animation to start, then scroll header into view
        requestAnimationFrame(() => {
          sectionEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
    } else if (!currentExpanded && wasExpanded) {
      // Collapsing: scroll if header is above the parent top
      if (rect.top < parentRect.top) {
        requestAnimationFrame(() => {
          sectionEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
    }
  });

  // Storage key for persisting height
  const storageKey = $derived(sectionId ? `accordion-height-${sectionId}` : null);

  // Check if user has previously resized this section (persisted in localStorage)
  function checkIfResized(): boolean {
    const key = sectionId ? `accordion-height-${sectionId}` : null;
    if (typeof window === 'undefined' || !key) return false;
    return localStorage.getItem(key) !== null;
  }

  // Load saved height or use default
  function loadHeight(key: string | null, defHeight: number): number {
    if (typeof window === 'undefined' || !key) return defHeight;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= minHeight && parsed <= maxHeight) {
          return parsed;
        }
      }
    } catch {
      // Ignore errors
    }
    return defHeight;
  }

  // Height management: auto-fit mode vs fixed mode
  // In auto-fit mode: CSS max-height handles sizing automatically
  // In fixed mode: height is user-set and stays fixed
  let isAutoFitMode = $state(true);
  // Note: We intentionally use defaultHeight as initial value; it's synced via effect below
  // svelte-ignore state_referenced_locally
  let fixedHeight = $state(defaultHeight);

  // Get the actual rendered height of the content element
  function getCurrentHeight(): number {
    return contentEl?.offsetHeight ?? fixedHeight;
  }

  let isResizing = $state(false);

  // Initialize and reload height when sectionId changes (e.g., workspace switch)
  $effect(() => {
    // Access storageKey to create dependency on sectionId
    const key = storageKey;
    fixedHeight = loadHeight(key, defaultHeight);
    isAutoFitMode = !checkIfResized();
  });

  // Direct DOM reference for performant resize - avoid Svelte reactivity during drag
  let contentEl: HTMLDivElement | null = $state(null);
  let sectionEl: HTMLDivElement | null = $state(null);

  // Scroll position tracking for gradient fades
  let isScrolledFromTop = $state(false);
  let isScrolledFromBottom = $state(false);

  // Track if content has scrollable overflow (exceeds max height)
  let hasOverflow = $state(false);

  // Consider it "not auto-fit" if user resized OR if content exceeds the max height (has scrollbar)
  const isEffectivelyAutoFit = $derived(isAutoFitMode && !hasOverflow);

  function handleScroll(e: Event) {
    const el = e.target as HTMLElement;
    const scrollTop = el.scrollTop;
    const scrollHeight = el.scrollHeight;
    const clientHeight = el.clientHeight;

    isScrolledFromTop = scrollTop > 0;
    isScrolledFromBottom = scrollTop + clientHeight < scrollHeight - 1;
    // Content has overflow if it can scroll at all
    hasOverflow = scrollHeight > clientHeight + 1;
  }

  // Check overflow state when content changes
  function checkOverflow() {
    if (!contentEl) return;
    hasOverflow = contentEl.scrollHeight > contentEl.clientHeight + 1;
  }

  // Check overflow when expanded or content changes
  $effect(() => {
    if (expanded && contentEl) {
      checkOverflow();
    }
  });

  // Also set up a ResizeObserver to track content changes
  $effect(() => {
    if (!contentEl || !expanded) return;

    const observer = new ResizeObserver(() => {
      checkOverflow();
    });

    observer.observe(contentEl);
    return () => observer.disconnect();
  });

  // Use plain object to avoid triggering reactivity on every mouse move
  let resizeStartY = 0;
  let resizeStartHeight = 0;

  function saveHeight(h: number) {
    if (typeof window === 'undefined' || !storageKey) return;
    try {
      localStorage.setItem(storageKey, String(h));
    } catch {
      // Ignore errors
    }
  }

  function clearSavedHeight() {
    if (typeof window === 'undefined' || !storageKey) return;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Ignore errors
    }
  }

  function handleResizeStart(e: MouseEvent) {
    if (!resizable) return;
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;
    resizeStartY = e.clientY;
    resizeStartHeight = getCurrentHeight();

    window.addEventListener('mousemove', handleResizeMove);
    window.addEventListener('mouseup', handleResizeEnd);
  }

  function handleResizeMove(e: MouseEvent) {
    if (!isResizing) return;
    const delta = e.clientY - resizeStartY;
    const newHeight = Math.max(minHeight, Math.min(maxHeight, resizeStartHeight + delta));
    // Switch to fixed mode as soon as user starts dragging
    isAutoFitMode = false;
    fixedHeight = newHeight;
  }

  function handleResizeEnd() {
    if (!isResizing) return;
    isResizing = false;
    saveHeight(fixedHeight);
    window.removeEventListener('mousemove', handleResizeMove);
    window.removeEventListener('mouseup', handleResizeEnd);
  }

  function handleDoubleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Reset to auto-fit mode
    isAutoFitMode = true;
    clearSavedHeight();
    checkOverflow();
  }
</script>

<div bind:this={sectionEl} class="container relative px-5 pb-1.5 border-t border-border pt-1">
  <!-- <div class="absolute inset-x-0 top-0 border-t border-border"></div> -->

  <button type="button" class="sticky-header w-full cursor-pointer bg-sidebar" onclick={onToggle}>
    <div class="w-full flex items-center gap-2.5 px-3 py-1.5 transition-colors">
      <Fa {icon} size={12} class="text-ghost" />
      <span class="text-sm font-medium flex-1 text-left">{label}</span>
      {#if badge}
        {@render badge()}
      {/if}
      <Fa
        icon={faChevronDown}
        class="text-subtle transition-transform duration-200 {expanded
          ? ''
          : '-rotate-90'}"
        size={8}
      />
    </div>
  </button>
  {#if expanded}
    <div class="relative" transition:slide={{ duration: 150 }}>
      {#if description}
        <p
          class="description text-ui text-subtle px-3 pt-2.5 pb-2 pl-9 leading-snug"
        >
          {description}
        </p>
      {/if}

      <div class="relative">
        <!-- Top gradient fade -->
        <div
          class="absolute top-0 left-0 right-0 h-3 bg-linear-to-b from-sidebar to-transparent pointer-events-none z-10 transition-opacity duration-150"
          class:opacity-0={!isScrolledFromTop}
          aria-hidden="true"
        ></div>

        <div
          bind:this={contentEl}
          class="panel-content overflow-y-auto pl-6 overflow-x-hidden {contentClass}"
          class:resizing-content={isResizing}
          style={isAutoFitMode ? `max-height: ${defaultHeight}px;` : `height: ${fixedHeight}px;`}
          onscroll={handleScroll}
        >
          {@render children()}
        </div>

        <!-- Bottom gradient fade -->
        <div
          class="absolute bottom-0 left-0 right-0 h-3 bg-linear-to-t from-sidebar to-transparent pointer-events-none z-10 transition-opacity duration-150"
          class:opacity-0={!isScrolledFromBottom}
          aria-hidden="true"
        ></div>
      </div>
      {#if resizable}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <Tooltip
          content={isEffectivelyAutoFit
            ? 'Drag to resize'
            : 'Drag to resize\nDouble-click to auto-fit'}
          side="bottom"
          delayDuration={300}
          class="w-full"
        >
          <div
            class="resize-handle"
            class:resizing={isResizing}
            role="separator"
            aria-orientation="horizontal"
            aria-valuenow={getCurrentHeight()}
            aria-valuemin={minHeight}
            aria-valuemax={maxHeight}
            aria-label="Resize panel"
            tabindex="0"
            onmousedown={handleResizeStart}
            ondblclick={handleDoubleClick}
            onkeydown={(e) => {
              if (e.key === 'ArrowDown') {
                isAutoFitMode = false;
                fixedHeight = Math.min(maxHeight, getCurrentHeight() + 20);
                saveHeight(fixedHeight);
              } else if (e.key === 'ArrowUp') {
                isAutoFitMode = false;
                fixedHeight = Math.max(minHeight, getCurrentHeight() - 20);
                saveHeight(fixedHeight);
              }
            }}
          >
            <div class="resize-handle-bar"></div>
          </div>
        </Tooltip>
      {/if}
    </div>
  {/if}
</div>

<style>
  .container {
    container-type: inline-size;
  }

  .sticky-header {
    position: sticky;
    top: -1px;
    z-index: 10;
  }

  .resize-handle {
    position: relative;
    height: 8px;
    cursor: ns-resize;
    margin-bottom: -4.5px;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .resize-handle:hover,
  .resize-handle.resizing {
    opacity: 1;
  }

  .resize-handle-bar {
    width: 40px;
    height: 3px;
    background: hsl(var(--muted-foreground) / 0.3);
    border-radius: 2px;
    transition: background 0.15s ease;
  }

  .resize-handle:hover .resize-handle-bar,
  .resize-handle.resizing .resize-handle-bar {
    background: hsl(var(--primary) / 0.5);
  }

  /* Show handle on parent hover */
  .relative:hover .resize-handle {
    opacity: 1;
  }

  /* Panel content container */
  .panel-content {
    contain: layout style;
  }

  /* Disable transitions during resize for instant feedback */
  .resizing-content {
    transition: none !important;
    pointer-events: none;
  }

  @container (max-width: 300px) {
    .description {
      padding-left: 0.75rem;
    }

    .panel-content {
      padding-left: 0;
    }
  }
</style>
