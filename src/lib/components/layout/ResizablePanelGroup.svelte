<script lang="ts">
  import { logger } from '$lib/utils/client-logger';

  import { onMount, onDestroy } from 'svelte';

  interface Panel {
    id: string;
    minSize?: number;
    maxSize?: number;
    defaultSize?: number;
    collapsible?: boolean;
    collapsed?: boolean;
  }

  let {
    panels = [],
    orientation = 'vertical',
    storageKey = null,
    className = '',
    children,
  }: {
    panels?: Panel[];
    orientation?: 'horizontal' | 'vertical';
    storageKey?: string | null;
    className?: string;
    children?: any;
  } = $props();

  // Helper function to get initial panel sizes from localStorage
  function getInitialPanelSizes(): { sizes: number[]; collapsed: Set<string> } {
    if (!panels || panels.length === 0) {
      return { sizes: [], collapsed: new Set() };
    }

    if (typeof window !== 'undefined' && storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          const { sizes, collapsed } = JSON.parse(saved);
          if (sizes && sizes.length === panels.length) {
            return {
              sizes,
              collapsed: new Set(collapsed || []),
            };
          }
        } catch (e) {
          logger.error('Failed to load panel sizes:', e);
        }
      }
    }

    // Default: equal distribution among non-collapsed panels
    const visiblePanels = panels.filter((p) => !p.collapsed);
    const defaultSize = visiblePanels.length > 0 ? 100 / visiblePanels.length : 0;

    // Calculate initial sizes
    let sizes = panels.map((p) => (p.collapsed ? 0 : p.defaultSize || defaultSize));

    // Normalize sizes to ensure they sum to 100%
    const totalSize = sizes.reduce((sum, size) => sum + size, 0);
    if (totalSize > 0 && Math.abs(totalSize - 100) > 0.01) {
      // Scale all sizes proportionally to sum to 100
      const scaleFactor = 100 / totalSize;
      sizes = sizes.map((size) => size * scaleFactor);
    }

    const collapsed = new Set(panels.filter((p) => p.collapsed).map((p) => p.id));

    return { sizes, collapsed };
  }

  // Initialize with saved values
  const initialValues = getInitialPanelSizes();

  // State for panel sizes (as percentages)
  let panelSizes: number[] = $state(initialValues.sizes);
  let collapsedPanels = $state<Set<string>>(initialValues.collapsed);
  let isResizing = $state(false);
  let resizingIndex = $state(-1);
  let startPosition = $state(0);
  let startSizes: number[] = $state([]);

  let containerRef: HTMLDivElement;
  let resizeObserver: ResizeObserver;

  // Normalize sizes to ensure they sum to 100%
  function normalizeSizes(sizes: number[]): number[] {
    const totalSize = sizes.reduce((sum, size) => sum + size, 0);
    if (totalSize === 0) {
      // If all panels are collapsed, return as is
      return sizes;
    }
    if (Math.abs(totalSize - 100) > 0.01) {
      // Scale all sizes proportionally to sum to 100
      const scaleFactor = 100 / totalSize;
      return sizes.map((size) => size * scaleFactor);
    }
    return sizes;
  }

  // Re-initialize panel sizes when panels change
  function initializePanelSizes() {
    const newValues = getInitialPanelSizes();
    panelSizes = normalizeSizes(newValues.sizes);
    collapsedPanels = newValues.collapsed;
  }

  // Save panel sizes to localStorage
  function savePanelSizes() {
    if (storageKey) {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          sizes: panelSizes,
          collapsed: Array.from(collapsedPanels),
        }),
      );
    }
  }

  // Redistribute space when panels collapse/expand while maintaining ratios

  // Toggle panel collapse state
  export function togglePanel(panelId: string) {
    const panelIndex = panels.findIndex((p) => p.id === panelId);
    if (panelIndex === -1) return;

    const panel = panels[panelIndex];
    const wasCollapsed = collapsedPanels.has(panelId);

    if (wasCollapsed) {
      // Expanding a panel
      collapsedPanels.delete(panelId);
      collapsedPanels = new Set(collapsedPanels); // Trigger reactivity

      // Get visible panels (excluding this one that's expanding)
      const visibleIndices = panels
        .map((_, i) => i)
        .filter((i) => !collapsedPanels.has(panels[i].id) && i !== panelIndex);

      if (visibleIndices.length > 0) {
        // Calculate total current size of visible panels

        // Give the expanding panel a reasonable size (30% or its default)
        const expandingSize = panel.defaultSize || 30;

        // Scale down other panels proportionally to make room
        const scaleFactor = (100 - expandingSize) / 100;

        const newSizes = [...panelSizes];

        // Set the expanding panel size
        newSizes[panelIndex] = expandingSize;

        // Scale other panels
        visibleIndices.forEach((i) => {
          newSizes[i] = panelSizes[i] * scaleFactor;
        });

        panelSizes = normalizeSizes(newSizes);
      } else {
        // No other panels visible, give this one 100%
        const newSizes = [...panelSizes];
        newSizes[panelIndex] = 100;
        panelSizes = newSizes;
      }
    } else {
      // Collapsing a panel

      collapsedPanels.add(panelId);
      collapsedPanels = new Set(collapsedPanels); // Trigger reactivity

      // Get remaining visible panels
      const visibleIndices = panels
        .map((_, i) => i)
        .filter((i) => !collapsedPanels.has(panels[i].id) && i !== panelIndex);

      if (visibleIndices.length > 0) {
        // Calculate scale factor to expand remaining panels
        const totalVisible = visibleIndices.reduce((sum, i) => sum + panelSizes[i], 0);

        if (totalVisible > 0) {
          // Scale up proportionally to fill the space
          const scaleFactor = 100 / totalVisible;

          const newSizes = [...panelSizes];
          newSizes[panelIndex] = 0;

          visibleIndices.forEach((i) => {
            newSizes[i] = panelSizes[i] * scaleFactor;
          });

          panelSizes = normalizeSizes(newSizes);
        } else {
          // If all visible panels had 0 size, distribute equally
          const equalSize = 100 / visibleIndices.length;
          const newSizes = [...panelSizes];
          newSizes[panelIndex] = 0;

          visibleIndices.forEach((i) => {
            newSizes[i] = equalSize;
          });

          panelSizes = normalizeSizes(newSizes);
        }
      }
    }

    savePanelSizes();
  }

  // Start resizing
  function startResize(index: number, e: MouseEvent) {
    if (index < 0 || index >= panels.length - 1) return;

    isResizing = true;
    resizingIndex = index;
    startPosition = orientation === 'vertical' ? e.clientY : e.clientX;
    startSizes = [...panelSizes];

    document.body.style.cursor = orientation === 'vertical' ? 'ns-resize' : 'ew-resize';
    document.body.style.userSelect = 'none';

    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);
  }

  // Handle resize movement
  function handleResize(e: MouseEvent) {
    if (!isResizing || resizingIndex < 0) return;

    const currentPosition = orientation === 'vertical' ? e.clientY : e.clientX;
    const delta = currentPosition - startPosition;
    const containerDimension =
      orientation === 'vertical' ? containerRef?.clientHeight || 0 : containerRef?.clientWidth || 0;

    if (containerDimension === 0) return;

    // Convert pixel delta to percentage
    const deltaPercent = (delta / containerDimension) * 100;

    // Calculate new sizes for the two adjacent panels
    const newSizes = [...startSizes];
    const panel1Index = resizingIndex;
    const panel2Index = resizingIndex + 1;

    // Skip if either panel is collapsed
    if (
      collapsedPanels.has(panels[panel1Index].id) ||
      collapsedPanels.has(panels[panel2Index].id)
    ) {
      return;
    }

    let newSize1 = startSizes[panel1Index] + deltaPercent;
    let newSize2 = startSizes[panel2Index] - deltaPercent;

    // Apply min/max constraints
    const panel1 = panels[panel1Index];
    const panel2 = panels[panel2Index];

    // Convert min/max from pixels to percentages if needed
    const minSize1 = panel1.minSize ? (panel1.minSize / containerDimension) * 100 : 5;
    const maxSize1 = panel1.maxSize ? (panel1.maxSize / containerDimension) * 100 : 95;
    const minSize2 = panel2.minSize ? (panel2.minSize / containerDimension) * 100 : 5;
    const maxSize2 = panel2.maxSize ? (panel2.maxSize / containerDimension) * 100 : 95;

    // Clamp sizes
    if (newSize1 < minSize1) {
      const diff = minSize1 - newSize1;
      newSize1 = minSize1;
      newSize2 = startSizes[panel2Index] - deltaPercent + diff;
    } else if (newSize1 > maxSize1) {
      const diff = newSize1 - maxSize1;
      newSize1 = maxSize1;
      newSize2 = startSizes[panel2Index] - deltaPercent - diff;
    }

    if (newSize2 < minSize2) {
      const diff = minSize2 - newSize2;
      newSize2 = minSize2;
      newSize1 = startSizes[panel1Index] + deltaPercent + diff;
    } else if (newSize2 > maxSize2) {
      const diff = newSize2 - maxSize2;
      newSize2 = maxSize2;
      newSize1 = startSizes[panel1Index] + deltaPercent - diff;
    }

    newSizes[panel1Index] = newSize1;
    newSizes[panel2Index] = newSize2;

    // Don't normalize during active resizing as we're only adjusting two panels
    panelSizes = newSizes;
  }

  // Stop resizing
  function stopResize() {
    if (!isResizing) return;

    isResizing = false;
    resizingIndex = -1;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);

    // Normalize sizes after resizing is complete to ensure they sum to 100%
    panelSizes = normalizeSizes(panelSizes);
    savePanelSizes();
  }

  // Adjust panel sizes programmatically (for keyboard navigation)
  function adjustPanelSizes(index: number, deltaPercent: number) {
    if (index < 0 || index >= panels.length - 1) return;

    const panel1Index = index;
    const panel2Index = index + 1;

    // Skip if either panel is collapsed
    if (
      collapsedPanels.has(panels[panel1Index].id) ||
      collapsedPanels.has(panels[panel2Index].id)
    ) {
      return;
    }

    const newSizes = [...panelSizes];
    newSizes[panel1Index] = Math.max(5, Math.min(95, newSizes[panel1Index] + deltaPercent));
    newSizes[panel2Index] = Math.max(5, Math.min(95, newSizes[panel2Index] - deltaPercent));

    panelSizes = newSizes;
    savePanelSizes();
  }

  // Handle container resize - use requestAnimationFrame to avoid ResizeObserver loop
  let resizeRafId: number | null = null;
  function handleContainerResize() {
    if (resizeRafId !== null) return; // Already scheduled
    resizeRafId = requestAnimationFrame(() => {
      resizeRafId = null;
      if (!containerRef) return;
    });
  }

  // Initialize on mount
  onMount(() => {
    initializePanelSizes();
    // Set up resize observer
    resizeObserver = new ResizeObserver(handleContainerResize);
    if (containerRef) {
      resizeObserver.observe(containerRef);
    }
  });

  // Cleanup on destroy
  onDestroy(() => {
    if (resizeRafId !== null) {
      cancelAnimationFrame(resizeRafId);
      resizeRafId = null;
    }
    if (resizeObserver && containerRef) {
      resizeObserver.unobserve(containerRef);
    }
    stopResize();
  });
</script>

<div
  bind:this={containerRef}
  class="flex {orientation === 'vertical' ? 'flex-col' : 'flex-row'} {className}"
  style="position: relative; width: 100%; height: 100%;"
>
  {#each panels as panel, index (panel.id)}
    {@const isCollapsed = collapsedPanels.has(panel.id)}
    {@const size = panelSizes[index] || 0}

    <!-- Panel Container -->
    <div
      class="min-h-0 min-w-0 relative flex flex-col overflow-hidden shrink-0 {isCollapsed
        ? 'hidden'
        : ''}"
      style="{orientation === 'vertical' ? 'height' : 'width'}: {isCollapsed ? '0' : size + '%'};
             transition: {isResizing ? 'none' : 'all 0.2s ease-out'};"
      data-panel-id={panel.id}
    >
      {#if children}
        {@render children(panel, index, isCollapsed)}
      {/if}
    </div>

    <!-- Divider (between panels, not after the last one) -->
    {#if index < panels.length - 1}
      {@const nextCollapsed = collapsedPanels.has(panels[index + 1].id)}
      {#if !isCollapsed && !nextCollapsed}
        <button
          type="button"
          class="relative {orientation === 'vertical'
            ? 'h-px w-full cursor-ns-resize'
            : 'w-px h-full cursor-ew-resize'} hover:bg-primary active:bg-primary transition-colors group z-30"
          onmousedown={(e) => startResize(index, e)}
          ondblclick={() => {
            // Reset to equal sizes on double-click
            const visiblePanels = panels.filter((_, i) => !collapsedPanels.has(panels[i].id));
            const equalSize = visiblePanels.length > 0 ? 100 / visiblePanels.length : 0;
            const newSizes = panels.map((panel) => (collapsedPanels.has(panel.id) ? 0 : equalSize));
            panelSizes = normalizeSizes(newSizes);
            savePanelSizes();
          }}
          onkeydown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault();
              // Decrease first panel size
              const delta = e.shiftKey ? 10 : 2;
              adjustPanelSizes(index, -delta);
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault();
              // Increase first panel size
              const delta = e.shiftKey ? 10 : 2;
              adjustPanelSizes(index, delta);
            }
          }}
          title="Drag to resize, double-click to reset"
          aria-label="Resize panels (double-click to reset)"
        >
          <!-- Visual indicator on hover (matching ResizablePanel style) -->
          <div
            class="absolute {orientation === 'vertical'
              ? 'inset-x-0 -top-1 h-2'
              : 'inset-y-0 -left-1 w-2'} opacity-0 group-hover:opacity-100 transition-opacity bg-primary/20"
          ></div>

          <!-- Optional grip indicator (uncomment to show grip dots) -->
          <!-- <div
            class="absolute {orientation === 'vertical'
              ? 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'
              : 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90'}
              opacity-0 group-hover:opacity-50 transition-opacity pointer-events-none"
          >
            <Fa icon={faGripVertical} size="lg" class="text-foreground" />
          </div> -->
        </button>
      {/if}
    {/if}
  {/each}
</div>
