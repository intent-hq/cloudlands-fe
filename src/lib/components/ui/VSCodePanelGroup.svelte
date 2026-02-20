<script lang="ts">
  import { logger } from '$lib/utils/client-logger';

  import { onMount } from 'svelte';
  import VSCodePanel from './VSCodePanel.svelte';
  import VSCodeScrollablePanel from './VSCodeScrollablePanel.svelte';
  import type { Snippet } from 'svelte';

  interface Panel {
    id: string;
    title: string;
    icon?: any;
    minHeight?: number;
    defaultHeight?: number;
    collapsible?: boolean;
    scrollable?: boolean;
    showAction?: boolean;
    actionIcon?: any;
    actionLabel?: string;
    onAction?: () => void;
    content?: Snippet;
    headerActions?: Snippet;
  }

  interface Props {
    panels: Panel[];
    storageKey?: string;
    class?: string;
    onPanelCollapse?: (panelId: string, isCollapsed: boolean) => void;
  }

  let {
    panels,
    storageKey = 'vscode-panel-group',
    class: className = '',
    onPanelCollapse,
  }: Props = $props();

  // Track collapsed state for each panel
  let collapsedStates = $state<Record<string, boolean>>({});
  let panelHeights = $state<Record<string, number>>({});
  let containerHeight = $state(0);
  let containerRef: HTMLDivElement;

  // Initialize from localStorage
  $effect(() => {
    if (typeof window !== 'undefined' && storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          const data = JSON.parse(saved);
          collapsedStates = data.collapsed || {};
          panelHeights = data.heights || {};
        } catch (e) {
          logger.error('Failed to load panel states:', e);
        }
      }
    }

    // Initialize any missing states
    panels.forEach((panel) => {
      if (!(panel.id in collapsedStates)) {
        collapsedStates[panel.id] = false;
      }
      if (!(panel.id in panelHeights)) {
        panelHeights[panel.id] = panel.defaultHeight || 200;
      }
    });
  });

  // Save to localStorage when states change
  $effect(() => {
    if (typeof window !== 'undefined' && storageKey) {
      const data = {
        collapsed: collapsedStates,
        heights: panelHeights,
      };
      localStorage.setItem(storageKey, JSON.stringify(data));
    }
  });

  // Calculate visible panels
  let visiblePanels = $derived(panels.filter((p) => !collapsedStates[p.id]));

  // Calculate heights for each panel
  let calculatedHeights = $derived.by(() => {
    const headerHeight = 28; // Height of VSCode panel header
    const totalHeaders = panels.length * headerHeight;
    const availableHeight = containerHeight - totalHeaders;

    if (availableHeight <= 0 || visiblePanels.length === 0) {
      return {};
    }

    // Distribute available height among visible panels
    const heights: Record<string, number> = {};
    const visibleCount = visiblePanels.length;

    if (visibleCount === 0) {
      return heights;
    }

    // Calculate total min height needed
    let totalMinHeight = 0;
    visiblePanels.forEach((panel) => {
      totalMinHeight += panel.minHeight || 100;
    });

    if (totalMinHeight > availableHeight) {
      // If minimum heights exceed available space, use minimum heights
      visiblePanels.forEach((panel) => {
        heights[panel.id] = panel.minHeight || 100;
      });
    } else {
      // Distribute remaining space proportionally
      const extraSpace = availableHeight - totalMinHeight;
      const spacePerPanel = extraSpace / visibleCount;

      visiblePanels.forEach((panel) => {
        heights[panel.id] = (panel.minHeight || 100) + spacePerPanel;
      });
    }

    // Collapsed panels get 0 height
    panels.forEach((panel) => {
      if (collapsedStates[panel.id]) {
        heights[panel.id] = 0;
      }
    });

    return heights;
  });

  function togglePanel(panelId: string) {
    collapsedStates[panelId] = !collapsedStates[panelId];
    onPanelCollapse?.(panelId, collapsedStates[panelId]);

    // Store the height before collapsing
    if (!collapsedStates[panelId]) {
      // Restoring - recalculate heights
      updateContainerHeight();
    }
  }

  function updateContainerHeight() {
    if (containerRef) {
      containerHeight = containerRef.clientHeight;
    }
  }

  // Observe container size changes
  onMount(() => {
    updateContainerHeight();

    const resizeObserver = new ResizeObserver(() => {
      updateContainerHeight();
    });

    if (containerRef) {
      resizeObserver.observe(containerRef);
    }

    return () => {
      resizeObserver.disconnect();
    };
  });
</script>

<div bind:this={containerRef} class="flex flex-col w-full h-full overflow-hidden {className}">
  {#each panels as panel (panel.id)}
    {@const isCollapsed = collapsedStates[panel.id]}
    {@const height = calculatedHeights[panel.id] || 0}

    {@const safeHeight = Number.isFinite(height) ? height : 0}
    <div
      class="flex flex-col min-h-7 overflow-hidden transition-[height] duration-200 ease-out"
      style="height: {isCollapsed ? '28px' : `${safeHeight + 28}px`};"
    >
      {#if panel.scrollable}
        <VSCodeScrollablePanel
          title={panel.title}
          icon={panel.icon}
          collapsible={panel.collapsible !== false}
          collapsed={isCollapsed}
          onCollapse={() => togglePanel(panel.id)}
          showAction={panel.showAction}
          actionIcon={panel.actionIcon}
          actionLabel={panel.actionLabel}
          onAction={panel.onAction}
          headerActions={panel.headerActions}
          class="h-full"
        >
          {#if panel.content}
            {@render panel.content()}
          {/if}
        </VSCodeScrollablePanel>
      {:else}
        <VSCodePanel
          title={panel.title}
          icon={panel.icon}
          collapsible={panel.collapsible !== false}
          collapsed={isCollapsed}
          onCollapse={() => togglePanel(panel.id)}
          showAction={panel.showAction}
          actionIcon={panel.actionIcon}
          actionLabel={panel.actionLabel}
          onAction={panel.onAction}
          headerActions={panel.headerActions}
          class="h-full"
        >
          {#if panel.content}
            {@render panel.content()}
          {/if}
        </VSCodePanel>
      {/if}
    </div>
  {/each}
</div>
