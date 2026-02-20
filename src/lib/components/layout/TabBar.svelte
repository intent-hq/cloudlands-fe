<script lang="ts">
  import { logger } from '$lib/utils/client-logger';
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';

  export interface TabBarSlotProps {
    draggedTabId: string | null;
    dragOverTabId: string | null;
    tabOrder: string[];
    handleDragStart: (e: DragEvent, tabId: string) => void;
    handleDragOver: (e: DragEvent, tabId: string) => void;
    handleDragLeave: () => void;
    handleDrop: (e: DragEvent, tabId: string) => void;
    handleDragEnd: () => void;
    visibleTabIds: string[];
    hiddenTabIds: string[];
    hasOverflow: boolean;
  }

  interface Props {
    class?: string;
    children?: Snippet<[TabBarSlotProps]>;
    tabOrder: string[];
    initialOrder?: string[];
    onReorder?: (fromId: string, toId: string) => void;
    onDrop?: (fromId: string, toId: string) => void;
  }

  let {
    class: className = '',
    children,
    tabOrder = [],
    initialOrder = [],
    onReorder,
    onDrop,
  }: Props = $props();

  let wrapperElement: HTMLElement | null = $state(null);
  let containerElement: HTMLElement | null = $state(null);

  // Use reactive state only for visual updates
  let draggedTabId: string | null = $state(null);
  let dragOverTabId: string | null = $state(null);
  let dragPreviewOrder: string[] | null = $state(null);

  // Use a non-reactive object to store drag state that survives re-renders
  // This is necessary because updating dragPreviewOrder causes DOM reordering
  // which can confuse the browser's drag events
  const dragStateRef = {
    draggedId: null as string | null,
    dropTargetId: null as string | null,
    handled: false,
  };

  // Overflow handling state
  let hasOverflow = $state(false);
  let canScrollLeft = $state(false);
  let canScrollRight = $state(false);
  let visibleTabIds = $state<string[]>([]);
  let hiddenTabIds = $state<string[]>([]);

  // Debug logging - commented out to reduce console spam
  // $effect(() => {
  //   logger.info('[TabBar] tabOrder prop changed:', tabOrder);
  // });

  function handleReorder(fromId: string, toId: string) {
    if (onReorder) {
      onReorder(fromId, toId);
    }
  }

  function handleDragStartTab(e: DragEvent, tabId: string) {
    // Store in both reactive state (for UI) and ref (for event handlers)
    draggedTabId = tabId;
    dragStateRef.draggedId = tabId;
    dragStateRef.dropTargetId = null;
    dragStateRef.handled = false;
    // Initialize drag preview order with current tab order
    dragPreviewOrder = [...tabOrder];
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      // Use a custom MIME type to avoid browser treating this as a link drag
      e.dataTransfer.setData('application/x-tab-drag', tabId);
      // Set a transparent 1x1 drag image to hide the default browser ghost
      const dragImage = new Image();
      dragImage.src =
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      e.dataTransfer.setDragImage(dragImage, 0, 0);
    }
  }

  function handleDragOverTab(e: DragEvent, tabId: string) {
    // Check both reactive state and ref (ref survives re-renders)
    const currentDraggedId = draggedTabId || dragStateRef.draggedId;

    // Always prevent default when we're in a drag operation to avoid browser's default behavior
    if (currentDraggedId) {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
      }

      // Only update preview order when dragging over a different tab
      if (currentDraggedId !== tabId) {
        dragOverTabId = tabId;
        // Track as last valid drop target in the ref (survives re-renders)
        dragStateRef.dropTargetId = tabId;

        // Temporarily reorder tabs for visual feedback
        if (dragPreviewOrder && dragPreviewOrder.length > 0) {
          const draggedIndex = dragPreviewOrder.indexOf(currentDraggedId);
          const overIndex = dragPreviewOrder.indexOf(tabId);

          if (draggedIndex !== -1 && overIndex !== -1) {
            const newOrder = [...dragPreviewOrder];
            newOrder.splice(draggedIndex, 1);
            newOrder.splice(overIndex, 0, currentDraggedId);
            dragPreviewOrder = newOrder;
          }
        }
      }
    }
  }

  function handleDragLeaveTab() {
    // Don't clear the ref - only clear reactive state
    dragOverTabId = null;
  }

  function commitReorder(fromId: string, toId: string) {
    if (dragStateRef.handled) {
      return;
    }
    dragStateRef.handled = true;

    if (onDrop) {
      onDrop(fromId, toId);
    } else if (onReorder) {
      onReorder(fromId, toId);
    }
  }

  function handleDropTab(e: DragEvent, targetTabId: string) {
    e.preventDefault();
    e.stopPropagation();

    // Use ref values since reactive state may have been cleared
    const fromId = draggedTabId || dragStateRef.draggedId;

    if (fromId && targetTabId && fromId !== targetTabId) {
      commitReorder(fromId, targetTabId);
    }

    // Reset drag state
    resetDragState();
  }

  function resetDragState() {
    draggedTabId = null;
    dragOverTabId = null;
    dragPreviewOrder = null;
    // Don't reset dragStateRef here - it's reset on drag start
  }

  function handleDragEndTab() {
    // Use ref values since reactive state may have been cleared by re-renders
    const fromId = dragStateRef.draggedId;
    const toId = dragStateRef.dropTargetId;
    const handled = dragStateRef.handled;

    // If drop wasn't handled yet and we have a valid target, commit the reorder
    if (!handled && fromId && toId && fromId !== toId) {
      commitReorder(fromId, toId);
    }
    resetDragState();
  }

  // Container-level drag handlers to prevent browser default behavior
  function handleContainerDragOver(e: DragEvent) {
    // Check both reactive state and ref
    const currentDraggedId = draggedTabId || dragStateRef.draggedId;

    // Prevent default to allow drop and avoid browser's link behavior (globe icon)
    if (currentDraggedId) {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
      }
    }
  }

  function handleContainerDrop(e: DragEvent) {
    // Prevent browser default
    e.preventDefault();

    // Use ref values since reactive state may have been cleared
    const fromId = draggedTabId || dragStateRef.draggedId;
    const toId = dragOverTabId || dragStateRef.dropTargetId;

    // If we have a valid reorder, commit it
    if (fromId && toId && fromId !== toId) {
      commitReorder(fromId, toId);
    }

    // Reset drag state
    resetDragState();
  }

  // Overflow detection and scroll functions
  function updateScrollState() {
    if (!containerElement) {
      canScrollLeft = false;
      canScrollRight = false;
      return;
    }

    const { scrollLeft, scrollWidth, clientWidth } = containerElement;
    const maxScrollLeft = scrollWidth - clientWidth;

    canScrollLeft = scrollLeft > 0;
    canScrollRight = scrollLeft < maxScrollLeft - 1;
  }

  function checkOverflow() {
    if (!containerElement) {
      hasOverflow = false;
      return;
    }

    // Check if content overflows horizontally
    hasOverflow = containerElement.scrollWidth > containerElement.clientWidth;
    updateScrollState();
    calculateVisibleTabs();
  }

  function calculateVisibleTabs() {
    if (!containerElement) {
      visibleTabIds = [];
      hiddenTabIds = [];
      return;
    }

    const containerRect = containerElement.getBoundingClientRect();
    const visible: string[] = [];
    const hidden: string[] = [];

    const tabElements = containerElement.querySelectorAll('[role="tab"]');
    tabElements.forEach((el) => {
      const tabId = el.getAttribute('data-tab-id');
      if (!tabId) return;

      const rect = el.getBoundingClientRect();
      // Check if tab is within container bounds
      if (rect.left >= containerRect.left && rect.right <= containerRect.right) {
        visible.push(tabId);
      } else {
        hidden.push(tabId);
      }
    });

    visibleTabIds = visible;
    hiddenTabIds = hidden;
  }

  function scrollToPrevious() {
    if (!containerElement || !canScrollLeft) {
      return;
    }

    const itemWidth = containerElement.children[0]?.getBoundingClientRect().width || 0;
    const gap = parseInt(getComputedStyle(containerElement).gap) || 0;
    const scrollDistance = itemWidth + gap;

    containerElement.scrollBy({
      left: -scrollDistance,
      behavior: 'smooth',
    });
  }

  function scrollToNext() {
    if (!containerElement || !canScrollRight) {
      return;
    }

    const itemWidth = containerElement.children[0]?.getBoundingClientRect().width || 0;
    const gap = parseInt(getComputedStyle(containerElement).gap) || 0;
    const scrollDistance = itemWidth + gap;

    containerElement.scrollBy({
      left: scrollDistance,
      behavior: 'smooth',
    });
  }

  // Setup overflow detection on mount and when tabOrder changes
  $effect(() => {
    if (containerElement) {
      checkOverflow();
    }
  });

  function handleKeyDown(e: KeyboardEvent) {
    // Arrow left: scroll left
    if (e.key === 'ArrowLeft' && hasOverflow && canScrollLeft) {
      e.preventDefault();
      scrollToPrevious();
    }
    // Arrow right: scroll right
    if (e.key === 'ArrowRight' && hasOverflow && canScrollRight) {
      e.preventDefault();
      scrollToNext();
    }
  }

  function handleWheel(e: WheelEvent) {
    if (!containerElement) return;

    // Use deltaY for vertical scroll (most common), or deltaX for horizontal scroll
    // This allows vertical mouse wheel scrolling to scroll tabs horizontally
    const delta = e.deltaY || e.deltaX;

    // Only prevent default and scroll if there's something to scroll
    if (delta !== 0) {
      e.preventDefault();
      containerElement.scrollLeft += delta;
    }
  }

  onMount(() => {
    if (containerElement) {
      checkOverflow();
      containerElement.addEventListener('scroll', updateScrollState);
      containerElement.addEventListener('keydown', handleKeyDown);
      containerElement.addEventListener('wheel', handleWheel, { passive: false });
      window.addEventListener('resize', checkOverflow);

      return () => {
        containerElement?.removeEventListener('scroll', updateScrollState);
        containerElement?.removeEventListener('keydown', handleKeyDown);
        containerElement?.removeEventListener('wheel', handleWheel);
        window.removeEventListener('resize', checkOverflow);
      };
    }
  });
</script>

<div bind:this={wrapperElement} class="relative flex items-center h-full min-w-0">
  <!-- Scrollable tabs container -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={containerElement}
    class="flex items-center h-full overflow-x-auto overflow-y-hidden scrollbar-hide flex-1 {className}"
    role="tablist"
    aria-label="Space tabs"
    style="will-change: scroll-position;"
    ondragover={handleContainerDragOver}
    ondrop={handleContainerDrop}
  >
    <!-- Tabs -->
    <div class="flex items-center h-full">
      {@render children?.({
        draggedTabId,
        dragOverTabId,
        tabOrder: dragPreviewOrder !== null ? dragPreviewOrder : tabOrder,
        handleDragStart: handleDragStartTab,
        handleDragOver: handleDragOverTab,
        handleDragLeave: handleDragLeaveTab,
        handleDrop: handleDropTab,
        handleDragEnd: handleDragEndTab,
        visibleTabIds,
        hiddenTabIds,
        hasOverflow,
      })}
    </div>
  </div>
</div>

<style>
  :global(.scrollbar-hide) {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }

  :global(.scrollbar-hide::-webkit-scrollbar) {
    display: none;
  }

  /* Smooth scroll behavior for tab container */
  :global(.scrollbar-hide) {
    scroll-behavior: smooth;
  }

  /* Respect prefers-reduced-motion */
  @media (prefers-reduced-motion: reduce) {
    :global(.scrollbar-hide) {
      scroll-behavior: auto;
    }
  }
</style>
