<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
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
    selectResizablePanelSizeHydrated,
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
    showHandleIndicator = false,

    // Width props (for horizontal orientation)
    minWidth = 280,
    maxWidth = 800,
    defaultWidth = 320,
    resetWidth = undefined,
    restoreStoredWidth = true,
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
    disableWidthTransition = false,
    notifyAutomaticWidthChanges = true,
    clampStoredWidth = false,
    onWidthChange,
    onResizeStart,
    onResize,
    onResizeEnd,
    onResizeCancel,
    resizeScrollContainer = null,

    // For skipping resize (used by parent to control when we're in full-width mode)
    doSkipResize = false,

    // Retain the stored fixed width when a temporary fill mode ends.
    preserveFixedWidthAfterFill = false,

    // Allow a consumer's increasing default to grow an already-mounted panel.
    growWithDefaultWidth = false,

    // Follow reactive default changes in either direction while preserving manual offset.
    resizeWithDefaultWidth = false,

    // Follow reactive default changes exactly, discarding a manual offset.
    syncWithDefaultWidth = false,

    // Apply a temporary visual delta without changing or persisting the base width.
    transientWidthDelta = 0,

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
    showHandleIndicator?: boolean;

    // Width props (for horizontal orientation)
    minWidth?: number;
    maxWidth?: number;
    defaultWidth?: number;
    /** Canonical handle-reset width when it differs from the rendered default. */
    resetWidth?: number;
    /** Restore the persisted normal width when mounting. */
    restoreStoredWidth?: boolean;
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
    disableWidthTransition?: boolean;
    /** Notify on mount and programmatic changes. Manual resize always notifies. */
    notifyAutomaticWidthChanges?: boolean;
    /** Clamp stale persisted widths to current bounds instead of rejecting them. */
    clampStoredWidth?: boolean;
    onWidthChange?: (width: number) => void;
    onResizeStart?: () => void;
    onResize?: (previousWidth: number, nextWidth: number) => void;
    onResizeEnd?: (startSize: number, finalSize: number) => void;
    onResizeCancel?: () => void;
    /** Scroll viewport that should advance when a right-edge resize reaches its boundary. */
    resizeScrollContainer?: HTMLElement | null;

    // For skipping resize (used by parent to control when we're in full-width mode)
    doSkipResize?: boolean;

    // Keep the fixed width instead of measuring a parent that may have expanded meanwhile.
    preserveFixedWidthAfterFill?: boolean;

    // Grow to a larger reactive default without shrinking manual widths.
    growWithDefaultWidth?: boolean;

    // Resize by the reactive default delta while preserving manual adjustment.
    resizeWithDefaultWidth?: boolean;

    // Resize exactly to each reactive default.
    syncWithDefaultWidth?: boolean;

    // Temporary rendered-width delta that is never persisted.
    transientWidthDelta?: number;

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
  // Storage keys are captured at init: selector readables must be created at
  // component init, and the keys are not expected to change during the lifecycle.
  // svelte-ignore state_referenced_locally
  const storedPanelSize = selectResizablePanelSize(storageKey ?? '');
  // svelte-ignore state_referenced_locally
  const storedExpandedPanelSize = selectResizablePanelSize(expandedStorageKey ?? '');
  // svelte-ignore state_referenced_locally
  const storedPanelSizeHydrated = selectResizablePanelSizeHydrated(storageKey ?? '');
  // svelte-ignore state_referenced_locally
  const storedExpandedPanelSizeHydrated = selectResizablePanelSizeHydrated(
    expandedStorageKey ?? '',
  );
  // svelte-ignore state_referenced_locally
  const isWorkspaceLeftPanel =
    storageKey === 'workspace-left-panel-width' ||
    storageKey?.startsWith('workspace-left-panel-width:') === true;
  // svelte-ignore state_referenced_locally
  const isWorkspaceExpandedPanel =
    expandedStorageKey === 'workspace-left-panel-expanded-width' ||
    expandedStorageKey?.startsWith('workspace-left-panel-expanded-width:') === true;
  // svelte-ignore state_referenced_locally
  const isWorkspaceSidebarPanel = isWorkspaceLeftPanel || isWorkspaceExpandedPanel;
  // Scoped workspace keys retain their per-workspace persistence; only the legacy
  // unscoped keys use the shared sidebar width fields.
  // svelte-ignore state_referenced_locally
  const usesLegacySidebarWidth = storageKey === 'workspace-left-panel-width';
  // svelte-ignore state_referenced_locally
  const usesLegacySidebarExpandedWidth =
    expandedStorageKey === 'workspace-left-panel-expanded-width';
  let appliedStoredPanelSize = $state<number | undefined>(undefined);
  let appliedStoredExpandedPanelSize = $state<number | undefined>(undefined);
  // svelte-ignore state_referenced_locally
  let previousDefaultWidth = defaultWidth;
  // svelte-ignore state_referenced_locally
  let wasDefaultWidthResizeEnabled = resizeWithDefaultWidth || syncWithDefaultWidth;

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
    if (clampStoredWidth && isWidth) return Math.max(min, Math.min(max, pixels));
    return pixels >= min && pixels <= max ? pixels : null;
  }

  function getStoredPanelSize(isWidth: boolean): number | null {
    if (isWidth && usesLegacySidebarWidth) return $sidebarWidth;
    const value = $storedPanelSize;
    return value === undefined ? null : storedValueToPixels(value, isWidth);
  }

  function getStoredExpandedPanelSize(): number | null {
    if (usesLegacySidebarExpandedWidth) return $sidebarExpandedWidth;
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
    const savedWidth = restoreStoredWidth ? getStoredPanelSize(true) : null;
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
  let panelElement: HTMLDivElement | null = $state(null);
  // svelte-ignore state_referenced_locally
  let wasSkippingResize = $state(doSkipResize);
  // svelte-ignore state_referenced_locally
  let expandedWidth = $state(
    orientation === 'horizontal' ? getInitialExpandedWidth() : defaultExpandedWidth,
  );
  // svelte-ignore state_referenced_locally
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
  let lastResizeWidth = $state(0);
  let startScrollLeft = 0;
  let lastPointerX = 0;
  let resizeAutoScrollFrame: number | null = null;
  const RESIZE_EDGE_THRESHOLD = 24;
  const RESIZE_AUTO_SCROLL_STEP = 8;

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
    if (!restoreStoredWidth || initiallyCollapsed || isExpanded || orientation !== 'horizontal') {
      return;
    }

    const storedValue = usesLegacySidebarWidth ? $sidebarWidth : $storedPanelSize;
    if (storedValue === undefined || storedValue === appliedStoredPanelSize) return;

    const pixels = usesLegacySidebarWidth ? storedValue : storedValueToPixels(storedValue, true);
    if (pixels !== null) {
      panelWidth = pixels;
      widthPercent = pixelsToPercent(panelWidth, true);
      appliedStoredPanelSize = storedValue;
    }
  });

  $effect(() => {
    if (orientation !== 'horizontal') return;

    const storedValue = usesLegacySidebarExpandedWidth
      ? $sidebarExpandedWidth
      : $storedExpandedPanelSize;
    if (storedValue === undefined || storedValue === appliedStoredExpandedPanelSize) return;

    const pixels = usesLegacySidebarExpandedWidth
      ? storedValue
      : storedValueToPixels(storedValue, true);
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

  $effect(() => {
    const nextDefaultWidth = defaultWidth;
    const priorDefaultWidth = previousDefaultWidth;
    const defaultWidthResizeEnabled = resizeWithDefaultWidth || syncWithDefaultWidth;
    const defaultWidthResizeWasEnabled = wasDefaultWidthResizeEnabled;
    previousDefaultWidth = nextDefaultWidth;
    wasDefaultWidthResizeEnabled = defaultWidthResizeEnabled;

    // Layout hydration can update the panel count and enable reactive default
    // resizing in the same render. Treat the persisted width as authoritative
    // for that frame instead of applying the restored default delta twice.
    if (restoreStoredWidth && defaultWidthResizeEnabled && !defaultWidthResizeWasEnabled) return;

    if (
      defaultWidthResizeEnabled &&
      !initiallyCollapsed &&
      !isExpanded &&
      orientation === 'horizontal' &&
      nextDefaultWidth !== priorDefaultWidth
    ) {
      const nextWidth = syncWithDefaultWidth
        ? nextDefaultWidth
        : panelWidth + nextDefaultWidth - priorDefaultWidth;
      panelWidth = Math.max(minWidth, Math.min(maxWidth, nextWidth));
      widthPercent = pixelsToPercent(panelWidth, true);
      persistPanelSize(storageKey, panelWidth, true);
      return;
    }

    if (
      !growWithDefaultWidth ||
      initiallyCollapsed ||
      isExpanded ||
      orientation !== 'horizontal' ||
      nextDefaultWidth <= priorDefaultWidth ||
      panelWidth >= nextDefaultWidth
    ) {
      return;
    }

    panelWidth = Math.max(minWidth, Math.min(maxWidth, nextDefaultWidth));
    widthPercent = pixelsToPercent(panelWidth, true);
    persistPanelSize(storageKey, panelWidth, true);
  });

  // React to Redux-driven sidebar collapse changes (Cmd+B, title-bar toggle, etc.).
  // The first run captures the baseline; subsequent runs apply collapse/expand.
  $effect(() => {
    if (!isWorkspaceSidebarPanel || orientation !== 'horizontal') return;

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
    if (restoreStoredWidth && storageKey && !usesLegacySidebarWidth && !$storedPanelSizeHydrated) {
      appStore.dispatch(requestResizablePanelSize(storageKey));
    }
    if (
      expandedStorageKey &&
      !usesLegacySidebarExpandedWidth &&
      !$storedExpandedPanelSizeHydrated
    ) {
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
    if (isWorkspaceSidebarPanel) {
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
      if (isWorkspaceSidebarPanel) {
        window.removeEventListener('workspace:toggle-left-sidebar', handleSidebarToggle);
      }
    };
  });

  function applyHorizontalResize(clientX: number) {
    const scrollDelta = resizeScrollContainer
      ? resizeScrollContainer.scrollLeft - startScrollLeft
      : 0;
    const delta = side === 'left' ? clientX - startX + scrollDelta : startX - clientX - scrollDelta;
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
    const nextRenderedWidth = isExpanded ? expandedWidth : panelWidth;
    if (!notifyAutomaticWidthChanges) onWidthChange?.(nextRenderedWidth);
    onResize?.(lastResizeWidth, nextRenderedWidth);
    lastResizeWidth = nextRenderedWidth;
  }

  function scheduleResizeAutoScroll() {
    if (resizeAutoScrollFrame !== null || !resizeScrollContainer || side !== 'left') return;

    const containerRect = resizeScrollContainer.getBoundingClientRect();
    const currentWidth = isExpanded ? expandedWidth : panelWidth;
    if (lastPointerX < containerRect.right - RESIZE_EDGE_THRESHOLD || currentWidth >= maxWidth) {
      return;
    }

    resizeAutoScrollFrame = requestAnimationFrame(() => {
      resizeAutoScrollFrame = null;
      if (!isResizing || !resizeScrollContainer) return;

      const maxScrollLeft = Math.max(
        0,
        resizeScrollContainer.scrollWidth - resizeScrollContainer.clientWidth,
      );
      const nextScrollLeft = Math.min(
        maxScrollLeft,
        resizeScrollContainer.scrollLeft + RESIZE_AUTO_SCROLL_STEP,
      );
      if (nextScrollLeft === resizeScrollContainer.scrollLeft) return;

      resizeScrollContainer.scrollLeft = nextScrollLeft;
      applyHorizontalResize(lastPointerX);
      scheduleResizeAutoScroll();
    });
  }

  function handleResize(e: MouseEvent) {
    if (!isResizing) return;

    if (orientation === 'horizontal') {
      lastPointerX = e.clientX;
      applyHorizontalResize(e.clientX);
      scheduleResizeAutoScroll();
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
    if (resizeAutoScrollFrame !== null) cancelAnimationFrame(resizeAutoScrollFrame);
    resizeAutoScrollFrame = null;
    const finalSize =
      orientation === 'horizontal' ? (isExpanded ? expandedWidth : panelWidth) : panelHeight;
    onResizeEnd?.(orientation === 'horizontal' ? startWidth : startHeight, finalSize);
    document.body.classList.remove('panel-resizing');
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
    document.removeEventListener('keydown', handleResizeKeydown);
  }

  function cancelResize() {
    if (!isResizing) return;
    isResizing = false;
    if (resizeAutoScrollFrame !== null) cancelAnimationFrame(resizeAutoScrollFrame);
    resizeAutoScrollFrame = null;
    if (orientation === 'horizontal') {
      if (isExpanded) {
        expandedWidth = startWidth;
        expandedWidthPercent = pixelsToPercent(startWidth, true);
      } else {
        panelWidth = startWidth;
        widthPercent = pixelsToPercent(startWidth, true);
      }
      if (!notifyAutomaticWidthChanges) onWidthChange?.(startWidth);
    } else {
      panelHeight = startHeight;
      heightPercent = pixelsToPercent(startHeight, false);
    }
    document.body.classList.remove('panel-resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);
    document.removeEventListener('keydown', handleResizeKeydown);
    onResizeCancel?.();
  }

  function handleResizeKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    cancelResize();
  }

  function startResize(e: MouseEvent) {
    isResizing = true;
    onResizeStart?.();
    document.body.classList.add('panel-resizing');

    if (orientation === 'horizontal') {
      startX = e.clientX;
      lastPointerX = e.clientX;
      startScrollLeft = resizeScrollContainer?.scrollLeft ?? 0;
      // Start from the current width (either normal or expanded)
      startWidth = isExpanded ? expandedWidth : panelWidth;
      lastResizeWidth = startWidth;
      document.body.style.cursor = side === 'left' ? 'col-resize' : 'ew-resize';
    } else {
      startY = e.clientY;
      startHeight = panelHeight;
      document.body.style.cursor = 'ns-resize';
    }

    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);
    document.addEventListener('keydown', handleResizeKeydown);
  }

  function handleDoubleClick() {
    if (orientation === 'horizontal') {
      if (isExpanded) {
        const previousWidth = expandedWidth;
        expandedWidth = defaultExpandedWidth;
        // Always update percentage for tracking
        expandedWidthPercent = pixelsToPercent(defaultExpandedWidth, true);
        if (expandedStorageKey) {
          persistPanelSize(expandedStorageKey, expandedWidth, true);
        }
        if (!notifyAutomaticWidthChanges) onWidthChange?.(expandedWidth);
        onResizeEnd?.(previousWidth, expandedWidth);
      } else {
        const previousWidth = panelWidth;
        const targetWidth = resetWidth ?? defaultWidth;
        panelWidth = Math.max(minWidth, Math.min(maxWidth, targetWidth));
        isCollapsed = false;
        // Always update percentage for tracking
        widthPercent = pixelsToPercent(panelWidth, true);
        if (storageKey) {
          persistPanelSize(storageKey, panelWidth, true);
        }
        if (!notifyAutomaticWidthChanges) onWidthChange?.(panelWidth);
        onResizeEnd?.(previousWidth, panelWidth);
      }
    } else {
      // Vertical orientation
      const previousHeight = panelHeight;
      panelHeight = defaultHeight;
      // Always update percentage for tracking
      heightPercent = pixelsToPercent(defaultHeight, false);
      if (storageKey) {
        persistPanelSize(storageKey, panelHeight, false);
      }
      onResizeEnd?.(previousHeight, panelHeight);
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
        const nextWidth = isExpanded ? expandedWidth : panelWidth;
        if (!notifyAutomaticWidthChanges) onWidthChange?.(nextWidth);
        persistPanelSize(isExpanded ? expandedStorageKey : storageKey, nextWidth, true);
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
    document.removeEventListener('keydown', handleResizeKeydown);
    document.body.classList.remove('panel-resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (resizeAutoScrollFrame !== null) cancelAnimationFrame(resizeAutoScrollFrame);
    if (isResizing) {
      onResizeEnd?.(
        orientation === 'horizontal' ? startWidth : startHeight,
        orientation === 'horizontal' ? (isExpanded ? expandedWidth : panelWidth) : panelHeight,
      );
    }
  });

  // Compute the actual dimensions to use based on orientation and expanded state
  let actualWidth = $derived(
    !isExpanded && panelWidth === 0
      ? 0
      : Math.max(
          minWidth,
          Math.min(maxWidth, (isExpanded ? expandedWidth : panelWidth) + transientWidthDelta),
        ),
  );
  let actualHeight = $derived(panelHeight);

  $effect.pre(() => {
    const isSkippingResize = doSkipResize;
    if (wasSkippingResize && !isSkippingResize && !preserveFixedWidthAfterFill) {
      const renderedWidth = panelElement?.getBoundingClientRect().width ?? 0;
      if (renderedWidth > 0) {
        panelWidth = Math.max(minWidth, Math.min(maxWidth, renderedWidth));
        widthPercent = pixelsToPercent(panelWidth, true);
      }
    }
    wasSkippingResize = isSkippingResize;
  });

  $effect(() => {
    if (!notifyAutomaticWidthChanges) return;
    const width = actualWidth;
    untrack(() => onWidthChange?.(width));
  });
</script>

{#if orientation === 'horizontal'}
  <div
    bind:this={panelElement}
    transition:fly={{
      x: animateOnMount ? (side === 'right' ? actualWidth : -actualWidth) : 0,
      duration: animateOnMount ? animationDuration : 0,
      easing: cubicOut,
    }}
    class="relative shrink-0 {isResizing || disableWidthTransition
      ? ''
      : 'transition-[width,min-width,max-width] mx-auto duration-300 ease-(--ease-emphasized-out)'} {!doSkipResize &&
    actualWidth === 0
      ? 'overflow-hidden'
      : ''} {className}"
    style={doSkipResize
      ? 'width: 100%;'
      : `width: ${actualWidth}px; min-width: ${actualWidth === 0 ? 0 : minWidth}px; max-width: ${maxWidth}px;`}
  >
    <!-- Panel content slot -->
    <div
      class="h-full min-h-0 transition-opacity duration-300 ease-(--ease-emphasized-out) {!doSkipResize &&
      actualWidth === 0
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
          ? '-right-2'
          : '-left-2'} app-resize-handle h-full w-4 z-30 {handleClassName}"
        data-resize-axis="x"
        data-resize-indicator={showHandleIndicator ? 'short' : undefined}
        data-resizing={isResizing}
        onmousedown={startResize}
        ondblclick={handleDoubleClick}
        onkeydown={handleHandleKeydown}
        tabindex="0"
        aria-label={m.layout_resizable_resizePanel_ariaLabel()}
        title={m.layout_resizable_dragToResize_tooltip()}
      >
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
          ? 'absolute -top-2'
          : 'absolute -bottom-2'} app-resize-handle left-0 right-0 h-4 z-30 {handleClassName}"
        data-resize-axis="y"
        data-resizing={isResizing}
        onmousedown={startResize}
        ondblclick={handleDoubleClick}
        onkeydown={handleHandleKeydown}
        tabindex="0"
        aria-label={m.layout_resizable_resizePanelHeight_ariaLabel()}
        title={m.layout_resizable_dragToResizeHeight_tooltip()}
      >
      </button>
    {/if}

    <!-- Panel content slot -->
    {@render children?.()}
  </div>
{/if}
