<script lang="ts">
  /**
   * WorkspaceLayout - The visual layout structure of a workspace page
   *
   * This component provides a flexible layout with:
   * 1. Left Sidebar (ResizablePanel)
   * 2. Main Content Area (Panel Layout with splittable panels)
   * 3. Terminal Overlay (Bottom)
   *
   * It accepts snippets for each section to allow maximum flexibility
   * while maintaining consistent layout behavior.
   */

  import type { Snippet } from 'svelte';

  // Components
  import ResizablePanel from '$lib/components/layout/ResizablePanel.svelte';
  import ErrorBoundary from '$lib/components/ErrorBoundary.svelte';
  import { Logger } from '$shared/logger';
  import { m } from '$shared/paraglide/messages.js';
  import { selectIsCollapsed } from '$store/renderer/slices/ui-layout/ui-layout-selectors';

  // Props
  interface Props {
    // Snippets for each section
    sidebar: Snippet;
    content: Snippet;
    terminalOverlay?: Snippet;
    modals?: Snippet;

    // Storage keys for panel persistence
    sidebarStorageKey?: string;
    sidebarExpandedStorageKey?: string;

    // Panel size configuration
    sidebarMinWidth?: number;
    sidebarMaxWidth?: number;
    sidebarDefaultWidth?: number;
    sidebarDefaultExpandedWidth?: number;

    // Percentage weight for resize behavior (0 = fixed pixels, 1 = fully percentage-based)
    // 0.5 = 50/50 blend between fixed and proportional
    sidebarPercentageWeight?: number;

    // Which side the sidebar is on
    sidebarSide?: 'left' | 'right';

    // Start with sidebar collapsed (width 0) — used for onboarding flow
    startCollapsed?: boolean;
    active?: boolean;

    // Allow additional props to pass through
    [key: string]: unknown;
  }

  let {
    sidebar,
    content,
    terminalOverlay,
    modals,
    sidebarStorageKey = 'workspace-left-panel-width',
    sidebarExpandedStorageKey = 'workspace-left-panel-expanded-width',
    sidebarMinWidth = 280,
    sidebarMaxWidth = 800,
    sidebarDefaultWidth = 360,
    sidebarDefaultExpandedWidth = 600,
    sidebarPercentageWeight = 0,
    sidebarSide = 'left',
    startCollapsed = false,
    active = true,
  }: Props = $props();

  const workspaceLogger = new Logger('WorkspaceLayout');
  const sidebarIsCollapsed = selectIsCollapsed();
</script>

<ErrorBoundary logger={workspaceLogger}>
  <!-- Main Workspace Layout -->
  <div
    class="workspace-page h-full flex flex-col relative bg-sidebar"
    aria-label={m.workspace_layout_ariaLabel()}
  >
    <!-- Upper Area: Sidebar + Content (shrinks when terminal is open) -->
    <div class="upper-area flex-1 flex min-h-0">
      {#if sidebarSide === 'right'}
        <!-- Main Content Area (Panel Layout) - rendered first when sidebar is on right -->
        <div class="main-content-area flex h-full min-w-0 z-10 bg-sidebar pl-2 sm:pl-3">
          {@render content()}
        </div>
      {/if}

      <!-- Sidebar -->
      <ResizablePanel
        {active}
        side={sidebarSide}
        minWidth={sidebarMinWidth}
        maxWidth={sidebarMaxWidth}
        defaultWidth={sidebarDefaultWidth}
        defaultExpandedWidth={sidebarDefaultExpandedWidth}
        storageKey={sidebarStorageKey}
        expandedStorageKey={sidebarExpandedStorageKey}
        percentageWeight={sidebarPercentageWeight}
        initiallyCollapsed={startCollapsed}
        className="workspace-sidebar-panel workspace-sidebar-{sidebarSide} flex-none h-full min-w-0 bg-sidebar {sidebarSide ===
        'left'
          ? 'mr-auto ml-0'
          : 'ml-auto mr-0'}"
      >
        {@render sidebar()}
      </ResizablePanel>

      {#if sidebarSide === 'left'}
        <!-- Main Content Area (Panel Layout) - rendered after when sidebar is on left -->
        <div
          class="main-content-area flex h-full min-w-0 z-10 bg-sidebar {$sidebarIsCollapsed
            ? 'pl-2 sm:pl-3'
            : ''}"
        >
          {@render content()}
        </div>
      {/if}
    </div>

    <!-- Terminal Overlay (positioned at bottom, pushes content up) -->
    {#if terminalOverlay}
      <div class="terminal-overlay-container flex-none">
        {@render terminalOverlay()}
      </div>
    {/if}

    <!-- Modals -->
    {#if modals}
      {@render modals()}
    {/if}
  </div>
</ErrorBoundary>

<style>
  .upper-area {
    position: relative;
  }

  .main-content-area {
    flex: 1;
  }

  @media (max-width: 639px) {
    .upper-area :global(.workspace-sidebar-panel) {
      position: absolute;
      inset-block: 0;
      z-index: 20;
    }

    .upper-area :global(.workspace-sidebar-left) {
      left: 0;
    }

    .upper-area :global(.workspace-sidebar-right) {
      right: 0;
    }
  }

  /* Terminal Overlay - positioned at bottom, shrinks content above */
  .terminal-overlay-container {
    width: 100%;
    z-index: 40;
  }
</style>
