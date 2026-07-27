<script lang="ts">
  import {
  onMount,
  onDestroy,
} from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import {
  requestResizablePanelSize,
  setResizablePanelSize,
  setSidebarExpandedWidth,
  setWidth as setSidebarWidth,
} from '$store/renderer/slices/ui-layout/ui-layout-slice';
  import {
  selectIsCollapsed,
  selectResizablePanelSize,
  selectSidebarExpandedWidth,
  selectSidebarWidth,
} from '$store/renderer/slices/ui-layout/ui-layout-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';


  let {
    // Common props
    orientation = 'horizontal',
    storageKey = null,
    className = '',
    handleClassName = '',

    // Width props (for horizontal orientation)
    minWidth = 280,
    maxWidth = 800,
    defaultWidth = 320,
    defaultExpandedWidth = 600,
    side = 'right',
    expandedStorageKey = null,
    collapseThreshold = null,
    isExpanded = false,

    // Height props (for vertical orientation)
    minHeight = 200,
    maxHeight = 800,
    defaultHeight = 400,
    edge = 'top',

    // Animation props
    animateOnMount = false,
    animationDuration = 300,

    // For skipping resize (used by parent to control when we're in full-width mode)
    doSkipResize = false,

    // Percentage-based resizing weight: 0 = fixed pixels, 1 = fully percentage-based
    // Values between 0 and 1 blend between the two behaviors
    // e.g., 0.5 means 50% fixed pixels + 50% percentage-based
    percentageWeight = 0,

    // Legacy prop - maps to percentageWeight: true = 1, false = 0
    usePercentage = undefined,

    // Start collapsed (width = 0) without persisting through layout state.
    initiallyCollapsed = false,

    children,
  }: {
    // Common props
    orientation?: 'horizontal' | 'vertical';
    storageKey?: string | null;
    className?: string;
    handleClassName?: string;

    // Width props (for horizontal orientation)
    minWidth?: number;
    maxWidth?: number;
    defaultWidth?: number;
    defaultExpandedWidth?: number;
    side?: 'left' | 'right';
    expandedStorageKey?: string | null;
    collapseThreshold?: number | null;
    isExpanded?: boolean;

    // Height props (for vertical orientation)
    minHeight?: number;
    maxHeight?: number;
    defaultHeight?: number;
    edge?: 'top' | 'bottom';

    // Animation props
    animateOnMount?: boolean;
    animationDuration?: number;

    // For skipping resize (used by parent to control when we're in full-width mode)
    doSkipResize?: boolean;

    // Percentage-based resizing weight (0-1)
    percentageWeight?: number;

    // Legacy prop for backwards compatibility
    usePercentage?: boolean;

    // Start collapsed without persisting — used for routes like /workspace/new
    initiallyCollapsed?: boolean;

    children?: any;
  } = $props();

  const sidebarIsCollapsed = selectIsCollapsed();
  const sidebarWidth = selectSidebarWidth();
  const sidebarExpandedWidth = selectSidebarExpandedWidth();
  const storedPanelSize = selectResizablePanelSize(storageKey ?? '');
  const storedExpandedPanelSize = selectResizablePanelSize(expandedStorageKey ?? '');
  const isWorkspaceLeftPanel = storageKey === 'workspace-left-panel-width';
  const isWorkspaceExpandedPanel = expandedStorageKey === 'workspace-left-panel-expanded-width';
  let appliedStoredPanelSize = $state<number | undefined>(undefined);
  let appliedStoredExpandedPanelSize = $state<number | undefined>(undefined);

  // Compute effective weight (legacy usePercentage prop takes precedence if defined)
  const effectiveWeight = $derived(
    usePercentage !== undefined
      ? usePercentage
        ? 1
        : 0
      : Math.max(0, Math.min(1, percentageWeight)),
  );

  // Get current window dimensions
  function getWindowWidth(): number {
    return typeof window !== 'undefined' ? window.innerWidth : 1200;
  }

  function getWindowHeight(): number {
    return typeof window !== 'undefined' ? window.innerHeight : 800;
  }

  // Convert between pixels and percentage
  function pixelsToPercent(pixels: number, isWidth: boolean): number {
    const total = isWidth ? getWindowWidth() : getWindowHeight();
    return (pixels / total) * 100;
  }

  function percentToPixels(percent: number, isWidth: boolean): number {
    const total = isWidth ? getWindowWidth() : getWindowHeight();
    return (percent / 100) * total;
  }

  function storedValueToPixels(value: number, isWidth: boolean): number | null {
    const weight = getInitialWeight();
    const pixels = weight > 0 ? percentToPixels(value, isWidth) : value;
    const min = isWidth ? minWidth : minHeight;
    const max = isWidth ? maxWidth : maxHeight;
    return pixels >= min && pixels <= max ? pixels : null;
  }

  function getStoredPanelSize(isWidth: boolean): number | null {
    if (isWidth && isWorkspaceLeftPanel) return $sidebarWidth;
    const value = $storedPanelSize;
    return value === undefined ? null : storedValueToPixels(value, isWidth);
  }

  function getStoredExpandedPanelSize(): number | null {
    if (isWorkspaceExpandedPanel) return $sidebarExpandedWidth;
    const value = $storedExpandedPanelSize;
    return value === undefined ? null : storedValueToPixels(value, true);
  }

  function getValueToPersist(pixels: number, isWidth: boolean): number {
    return effectiveWeight > 0 ? pixelsToPercent(pixels, isWidth) : pixels;
  }

  function persistPanelSize(key: string | null, pixels: number, isWidth: boolean) {
    if (!key) return;

    if (key === 'workspace-left-panel-width') {
      appStore.dispatch(setSidebarWidth(pixels));
    } else if (key === 'workspace-left-panel-expanded-width') {
      appStore.dispatch(setSidebarExpandedWidth(pixels));
    } else {
      appStore.dispatch(setResizablePanelSize(key, getValueToPersist(pixels, isWidth)));
    }
  }

  // Compute initial weight for use in initialization (before $derived is available)
  function getInitialWeight(): number {
    if (usePercentage !== undefined) return usePercentage ? 1 : 0;
    return Math.max(0, Math.min(1, percentageWeight));
  }

  // Helper function to get initial width from Redux-owned persisted state.
  // When percentage weight > 0, stored value is a percentage
  function getInitialWidth(): number {
    const savedWidth = getStoredPanelSize(true);
    if (savedWidth !== null) return savedWidth;
    return defaultWidth;
  }

  // Helper function to get initial expanded width from Redux-owned persisted state.
  function getInitialExpandedWidth(): number {
    const savedWidth = getStoredExpandedPanelSize();
    if (savedWidth !== null) return savedWidth;
    return defaultExpandedWidth;
  }

  // Helper function to get initial height from Redux-owned persisted state.
  function getInitialHeight(): number {
    const savedHeight = getStoredPanelSize(false);
    if (savedHeight !== null) return savedHeight;
    return defaultHeight;
  }

  // State for horizontal orientation - initialize with saved values
  // Note: We intentionally capture orientation and default values at initialization.
  // These props are not expected to change during the component's lifecycle.
  // svelte-ignore state_referenced_locally
  let panelWidth = $state(
    initiallyCollapsed ? 0 : orientation === 'horizontal' ? getInitialWidth() : defaultWidth,
  );
  // svelte-ignore state_referenced_locally
  let expandedWidth = $state(
    orientation === 'horizontal' ? getInitialExpandedWidth() : defaultExpandedWidth,
  );
  let isCollapsed = $state(initiallyCollapsed);

  // State for vertical orientation - initialize with saved values
  // svelte-ignore state_referenced_locally
  let panelHeight = $state(orientation === 'vertical' ? getInitialHeight() : defaultHeight);

  // Store percentages for percentage-based resizing (calculated on mount and resize)
  let widthPercent = $state(0);
  let expandedWidthPercent = $state(0);
  let heightPercent = $state(0);

  // Common state
  let isResizing = $state(false);
  let startX = $state(0);
  let startY = $state(0);
  let startWidth = $state(0);
  let startHeight = $state(0);

  // Track previous window size for weighted blending

  // Handle window resize with weighted blending between fixed and percentage-based sizing
  function handleWindowResize() {
    const weight = effectiveWeight;
    if (weight === 0) return;

    if (orientation === 'horizontal') {
      // Calculate what percentage-based width would be
      if (widthPercent > 0) {
        const percentBasedWidth = percentToPixels(widthPercent, true);
        // Blend: (1 - weight) * currentPixels + weight * percentBasedWidth
        // But we want to respond to the *change* in window size proportionally
        // So we calculate the delta and apply weight to it
        const currentWidth = panelWidth;
        const blendedWidth = currentWidth * (1 - weight) + percentBasedWidth * weight;
        panelWidth = Math.max(minWidth, Math.min(maxWidth, blendedWidth));

        // Update sidebar width store for left sidebar on window resize
        if (storageKey === 'workspace-left-panel-width') {
          appStore.dispatch(setSidebarWidth(panelWidth));
        }
      }
      if (expandedWidthPercent > 0) {
        const percentBasedWidth = percentToPixels(expandedWidthPercent, true);
        const blendedWidth = expandedWidth * (1 - weight) + percentBasedWidth * weight;
        expandedWidth = Math.max(minWidth, Math.min(maxWidth, blendedWidth));
      }
    } else {
      // Vertical orientation
      if (heightPercent > 0) {
        const percentBasedHeight = percentToPixels(heightPercent, false);
        const blendedHeight = panelHeight * (1 - weight) + percentBasedHeight * weight;
        panelHeight = Math.max(minHeight, Math.min(maxHeight, blendedHeight));
      }
    }
  }

  // Handle sidebar toggle event (used by the onboarding-exit force-expand flow,
  // which sets the panel width without flipping the Redux `sidebarCollapsed` flag).
  function handleSidebarToggle(event: Event) {
    const detail = (event as CustomEvent<{ collapsed: boolean; restoreWidth: number }>).detail;
    if (detail.collapsed) {
      // Save current width before collapsing
      widthBeforeToggle = panelWidth;
      panelWidth = 0;
    } else {
      // Restore to previous width
      panelWidth = widthBeforeToggle > 0 ? widthBeforeToggle : defaultWidth;
    }
    // Update percentage tracking
    widthPercent = pixelsToPercent(panelWidth, true);
  }

  // Apply a Redux-driven collapse/expand of the workspace left sidebar
  // (Cmd+B keyboard shortcut, title-bar toggle, settings proposals, etc.).
  function applySidebarCollapsedChange(collapsed: boolean) {
    if (collapsed) {
      widthBeforeToggle = panelWidth;
      panelWidth = 0;
    } else {
      panelWidth = widthBeforeToggle > 0 ? widthBeforeToggle : defaultWidth;
    }
    widthPercent = pixelsToPercent(panelWidth, true);
  }

  // Store width before toggle collapse (only used for workspace left sidebar)
  // svelte-ignore state_referenced_locally
  let widthBeforeToggle = $state(defaultWidth);

  // Tracks the last collapsed value we reacted to, so the effect ignores
  // its first run (which initializes from the Redux state during onMount).
  let lastSidebarCollapsed = $state<boolean | undefined>(undefined);

  $effect(() => {
    if (initiallyCollapsed || isExpanded || orientation !== 'horizontal') return;

    const storedValue = isWorkspaceLeftPanel ? $sidebarWidth : $storedPanelSize;
    if (storedValue === undefined || storedValue === appliedStoredPanelSize) return;

    const pixels = isWorkspaceLeftPanel ? storedValue : storedValueToPixels(storedValue, true);
    if (pixels !== null) {
      panelWidth = pixels;
      widthPercent = pixelsToPercent(panelWidth, true);
      appliedStoredPanelSize = storedValue;
    }
  });

  $effect(() => {
    if (orientation !== 'horizontal') return;

    const storedValue = isWorkspaceExpandedPanel ? $sidebarExpandedWidth : $storedExpandedPanelSize;
    if (storedValue === undefined || storedValue === appliedStoredExpandedPanelSize) return;

    const pixels = isWorkspaceExpandedPanel ? storedValue : storedValueToPixels(storedValue, true);
    if (pixels !== null) {
      expandedWidth = pixels;
      expandedWidthPercent = pixelsToPercent(expandedWidth, true);
      appliedStoredExpandedPanelSize = storedValue;
    }
  });

  $effect(() => {
    if (orientation !== 'vertical') return;

    const storedValue = $storedPanelSize;
    if (storedValue === undefined || storedValue === appliedStoredPanelSize) return;

    const pixels = storedValueToPixels(storedValue, false);
    if (pixels !== null) {
      panelHeight = pixels;
      heightPercent = pixelsToPercent(panelHeight, false);
      appliedStoredPanelSize = storedValue;
    }
  });

  // React to Redux-driven sidebar collapse changes (Cmd+B, title-bar toggle, etc.).
  // The first run captures the baseline; subsequent runs apply collapse/expand.
  $effect(() => {
    if (!isWorkspaceLeftPanel || orientation !== 'horizontal') return;

    const collapsed = $sidebarIsCollapsed;
    if (lastSidebarCollapsed === undefined) {
      lastSidebarCollapsed = collapsed;
      return;
    }
    if (collapsed === lastSidebarCollapsed) return;

    lastSidebarCollapsed = collapsed;
    applySidebarCollapsedChange(collapsed);
  });

  // Check for collapse threshold on mount and set up resize listener
  onMount(() => {
    if (storageKey && !isWorkspaceLeftPanel) {
      appStore.dispatch(requestResizablePanelSize(storageKey));
    }
    if (expandedStorageKey && !isWorkspaceExpandedPanel) {
      appStore.dispatch(requestResizablePanelSize(expandedStorageKey));
    }

    if (orientation === 'horizontal' && collapseThreshold && panelWidth < collapseThreshold) {
      isCollapsed = true;
      panelWidth = minWidth;
    }

    // Initialize percentages from current pixel values (always track for weighted blending)
    widthPercent = pixelsToPercent(panelWidth, true);
    expandedWidthPercent = pixelsToPercent(expandedWidth, true);
    heightPercent = pixelsToPercent(panelHeight, false);

    // Listen for window resize if any percentage weight is used
    if (effectiveWeight > 0) {
      window.addEventListener('resize', handleWindowResize);
    }

    // Listen for sidebar toggle event (only for workspace left panel)
    if (isWorkspaceLeftPanel) {
      // Initialize from store's collapsed state
      const initialCollapsed = $sidebarIsCollapsed;
      if (initialCollapsed) {
        widthBeforeToggle = panelWidth;
        panelWidth = 0;
        widthPercent = 0;
      }
      window.addEventListener('workspace:toggle-left-sidebar', handleSidebarToggle);
    }

    return () => {
      window.removeEventListener('resize', handleWindowResize);
      if (isWorkspaceLeftPanel) {
        window.removeEventListener('workspace:toggle-left-sidebar', handleSidebarToggle);
      }
    };
  });

  function handleResize(e: MouseEvent) {
    if (!isResizing) return;

    if (orientation === 'horizontal') {
      // Calculate delta based on side
      const delta = side === 'left' ? e.clientX - startX : startX - e.clientX;
      let newWidth = startWidth + delta;

      // Clamp to min/max
      newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

      // Update the appropriate width based on expanded state
      if (isExpanded) {
        expandedWidth = newWidth;
        // Always update percentage for window resize tracking
        expandedWidthPercent = pixelsToPercent(newWidth, true);
      } else {
        // Check if we should collapse (if collapse feature is enabled)
        if (collapseThreshold !== null) {
          if (newWidth < collapseThreshold) {
            isCollapsed = true;
            panelWidth = minWidth;
            widthPercent = pixelsToPercent(minWidth, true);
          } else {
            isCollapsed = false;
            panelWidth = newWidth;
            widthPercent = pixelsToPercent(newWidth, true);
          }
        } else {
          panelWidth = newWidth;
          widthPercent = pixelsToPercent(newWidth, true);
        }

        // Update sidebar width store for left sidebar (live during drag)
        if (storageKey === 'workspace-left-panel-width') {
          appStore.dispatch(setSidebarWidth(panelWidth));
        }
      }
    } else {
      // Vertical orientation
      const delta = edge === 'top' ? startY - e.clientY : e.clientY - startY;
      let newHeight = startHeight + delta;

      // Clamp to min/max
      newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
      panelHeight = newHeight;
      // Always update percentage for window resize tracking
      heightPercent = pixelsToPercent(newHeight, false);
    }
  }

  function stopResize() {
    if (!isResizing) return;

    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    // Persist dimensions through Redux-owned layout persistence.
    if (orientation === 'horizontal') {
      if (isExpanded && expandedStorageKey) {
        persistPanelSize(expandedStorageKey, expandedWidth, true);
      } else if (!isExpanded && storageKey) {
        persistPanelSize(storageKey, panelWidth, true);
      }
    } else {
      // Vertical orientation
      if (storageKey) {
        persistPanelSize(storageKey, panelHeight, false);
      }
    }

    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);
  }

  function startResize(e: MouseEvent) {
    isResizing = true;

    if (orientation === 'horizontal') {
      startX = e.clientX;
      // Start from the current width (either normal or expanded)
      startWidth = isExpanded ? expandedWidth : panelWidth;
      document.body.style.cursor = side === 'left' ? 'col-resize' : 'ew-resize';
    } else {
      startY = e.clientY;
      startHeight = panelHeight;
      document.body.style.cursor = 'ns-resize';
    }

    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);
  }

  function handleDoubleClick() {
    if (orientation === 'horizontal') {
      if (isExpanded) {
        expandedWidth = defaultExpandedWidth;
        // Always update percentage for tracking
        expandedWidthPercent = pixelsToPercent(defaultExpandedWidth, true);
        if (expandedStorageKey) {
          persistPanelSize(expandedStorageKey, expandedWidth, true);
        }
      } else {
        panelWidth = defaultWidth;
        isCollapsed = false;
        // Always update percentage for tracking
        widthPercent = pixelsToPercent(defaultWidth, true);
        if (storageKey) {
          persistPanelSize(storageKey, panelWidth, true);
        }
      }
    } else {
      // Vertical orientation
      panelHeight = defaultHeight;
      // Always update percentage for tracking
      heightPercent = pixelsToPercent(defaultHeight, false);
      if (storageKey) {
        persistPanelSize(storageKey, panelHeight, false);
      }
    }
  }

  // Keyboard support for resize handles
  function handleHandleKeydown(e: KeyboardEvent) {
    const step = e.shiftKey ? 20 : 10;
    if (orientation === 'horizontal') {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const delta = e.key === 'ArrowLeft' ? -step : step;
        let newWidth = (isExpanded ? expandedWidth : panelWidth) + delta;
        newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
        if (isExpanded) {
          expandedWidth = newWidth;
          // Always update percentage for tracking
          expandedWidthPercent = pixelsToPercent(newWidth, true);
        } else {
          if (collapseThreshold !== null) {
            if (newWidth < collapseThreshold) {
              isCollapsed = true;
              panelWidth = minWidth;
              widthPercent = pixelsToPercent(minWidth, true);
            } else {
              isCollapsed = false;
              panelWidth = newWidth;
              widthPercent = pixelsToPercent(newWidth, true);
            }
          } else {
            panelWidth = newWidth;
            widthPercent = pixelsToPercent(newWidth, true);
          }
        }
      } else if (e.key === 'Enter') {
        // Enter resets to defaults (same as double-click)
        handleDoubleClick();
      }
    } else {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const delta = e.key === 'ArrowUp' ? -step : step;
        let newHeight = panelHeight + delta;
        newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
        panelHeight = newHeight;
        // Always update percentage for tracking
        heightPercent = pixelsToPercent(newHeight, false);
      } else if (e.key === 'Enter') {
        handleDoubleClick();
      }
    }
  }

  onDestroy(() => {
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);
  });

  // Compute the actual dimensions to use based on orientation and expanded state
  let actualWidth = $derived(isExpanded ? expandedWidth : panelWidth);
  let actualHeight = $derived(panelHeight);
</script>

{#if orientation === 'horizontal'}
  <div
    transition:fly={{
      x: animateOnMount ? (side === 'right' ? actualWidth : -actualWidth) : 0,
      duration: animateOnMount ? animationDuration : 0,
      easing: cubicOut,
    }}
    class="relative shrink-0 {isResizing
      ? ''
      : 'transition-[width] mx-auto duration-300 ease-[cubic-bezier(0.33,1,0.68,1)]'} {actualWidth === 0
      ? 'overflow-hidden'
      : ''} {className}"
    style={doSkipResize
      ? 'width: 100%;'
      : `width: ${actualWidth}px; min-width: ${actualWidth === 0 ? 0 : minWidth}px; max-width: ${maxWidth}px;`}
  >
    <!-- Panel content slot -->
    <div
      class="h-full min-h-0 transition-opacity duration-300 ease-[cubic-bezier(0.33,1,0.68,1)] {actualWidth === 0
        ? 'opacity-0'
        : 'opacity-100'}"
    >
      {@render children?.({ isCollapsed })}
    </div>

    <!-- Resize handle -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->

    {#if !doSkipResize}
      <button
        type="button"
        class="absolute top-0 {side === 'left'
          ? '-right-px'
          : '-left-px'} w-px h-full cursor-col-resize hover:bg-primary focus-visible:ring-0 transition-colors group z-30 {handleClassName}"
        onmousedown={startResize}
        ondblclick={handleDoubleClick}
        onkeydown={handleHandleKeydown}
        tabindex="0"
        aria-label={m.layout_resizable_resizePanel_ariaLabel()}
        title={m.layout_resizable_dragToResize_tooltip()}
      >
        <!-- Visual indicator on hover -->
        <div
          class="absolute inset-y-0 {side === 'left'
            ? '-right-1'
            : '-left-1'} w-2 opacity-0 group-hover:opacity-100 transition-opacity bg-primary/20"
        ></div>
      </button>
    {/if}
  </div>
{:else}
  <!-- Vertical orientation -->
  <div
    class="relative flex flex-col {isResizing
      ? ''
      : 'transition-[height] duration-200 ease-out'} {className}"
    style={doSkipResize
      ? ''
      : `height: ${actualHeight}px; min-height: ${minHeight}px; max-height: ${maxHeight}px;`}
  >
    {#if !doSkipResize}
      <!-- Resize handle -->
      <button
        type="button"
        class="{edge === 'top'
          ? 'absolute -top-px'
          : 'absolute -bottom-px'} left-0 right-0 h-px cursor-ns-resize hover:bg-primary focus-visible:ring-0 transition-colors group z-30 {handleClassName}"
        onmousedown={startResize}
        ondblclick={handleDoubleClick}
        onkeydown={handleHandleKeydown}
        tabindex="0"
        aria-label={m.layout_resizable_resizePanelHeight_ariaLabel()}
        title={m.layout_resizable_dragToResizeHeight_tooltip()}
      >
        <!-- Visual indicator on hover -->
        <div
          class="absolute inset-x-0 {edge === 'top'
            ? '-top-1'
            : '-bottom-1'} h-2 opacity-0 group-hover:opacity-100 transition-opacity bg-primary/20"
        ></div>
      </button>
    {/if}

    <!-- Panel content slot -->
    {@render children?.()}
  </div>
{/if}
