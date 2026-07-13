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
    sidebarMinWidth = 180,
    sidebarMaxWidth = 800,
    sidebarDefaultWidth = 350,
    sidebarDefaultExpandedWidth = 600,
    sidebarPercentageWeight = 0.5,
    sidebarSide = 'left',
    startCollapsed = false,
  }: Props = $props();

  const workspaceLogger = new Logger('WorkspaceLayout');
</script>

<ErrorBoundary logger={workspaceLogger}>
  <!-- Main Workspace Layout -->
  <div class="workspace-page h-full flex flex-col relative bg-sidebar" aria-label="Workspace layout">
    <!-- Upper Area: Sidebar + Content (shrinks when terminal is open) -->
    <div class="upper-area flex-1 flex min-h-0">
      {#if sidebarSide === 'right'}
        <!-- Main Content Area (Panel Layout) - rendered first when sidebar is on right -->
        <div class="main-content-area flex h-full min-w-0 z-10">
          {@render content()}
        </div>
      {/if}

      <!-- Sidebar -->
      <ResizablePanel
        side={sidebarSide}
        minWidth={sidebarMinWidth}
        maxWidth={sidebarMaxWidth}
        defaultWidth={sidebarDefaultWidth}
        defaultExpandedWidth={sidebarDefaultExpandedWidth}
        storageKey={sidebarStorageKey}
        expandedStorageKey={sidebarExpandedStorageKey}
        percentageWeight={sidebarPercentageWeight}
        initiallyCollapsed={startCollapsed}
        className="flex-none h-full min-w-0 {sidebarSide === 'left'
          ? 'mr-auto ml-0'
          : 'ml-auto mr-0'}"
      >
        {@render sidebar()}
      </ResizablePanel>

      {#if sidebarSide === 'left'}
        <!-- Main Content Area (Panel Layout) - rendered after when sidebar is on left -->
        <div class="main-content-area flex h-full min-w-0 z-10">
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

  /* Terminal Overlay - positioned at bottom, shrinks content above */
  .terminal-overlay-container {
    width: 100%;
    z-index: 40;
  }
</style>
