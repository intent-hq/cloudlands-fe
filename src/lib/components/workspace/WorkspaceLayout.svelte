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

  import { onDestroy, type Snippet } from 'svelte';
  import { spring } from '$lib/motion';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import WorkspaceSidebarRail from './sidebar/WorkspaceSidebarRail.svelte';
  import { store as appStore } from '$store/renderer/store';
  import { toggleSidebar } from '$store/renderer/slices/ui-layout/ui-layout-slice';

  // Components
  import ResizablePanel from '$lib/components/layout/ResizablePanel.svelte';
  import ErrorBoundary from '$lib/components/ErrorBoundary.svelte';
  import { Logger } from '$shared/logger';
  import { m } from '$shared/paraglide/messages.js';
  import { selectIsCollapsed } from '$store/renderer/slices/ui-layout/ui-layout-selectors';

  // Props
  interface Props {
    // Snippets for each section
    workspaceId?: string;
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
    workspaceId,
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
  let floatingOpen = $state(false);
  let shell: HTMLDivElement | undefined = $state();
  let rail: HTMLDivElement | undefined = $state();
  let availableWidth = $state(0);
  let expandedWidth = $state(0);
  let suppressFocusReveal = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const collapsed = $derived($sidebarIsCollapsed && !startCollapsed);
  const sidebarWidthLimit = $derived(
    availableWidth > 0 ? Math.min(sidebarMaxWidth, availableWidth) : sidebarMaxWidth,
  );
  const sidebarMinimumWidth = $derived(Math.min(sidebarMinWidth, sidebarWidthLimit));
  const floatingWidth = $derived(
    Math.min(expandedWidth || sidebarDefaultWidth, Math.max(0, availableWidth - 48)),
  );

  function cancelDismiss() {
    clearTimeout(closeTimer);
  }

  function reveal() {
    if (!active || !collapsed) return;
    cancelDismiss();
    suppressFocusReveal = false;
    floatingOpen = true;
  }

  function isSidebarTarget(target: EventTarget | null) {
    return target instanceof Node && !!shell?.contains(target);
  }

  function isOverlayTarget(target: EventTarget | null) {
    return (
      target instanceof Element &&
      !!target.closest(
        '[role="menu"], [role="dialog"], [role="tooltip"], [data-popover-content], [data-tooltip-content], [role="listbox"]',
      )
    );
  }

  function dismiss() {
    cancelDismiss();
    floatingOpen = false;
  }

  function scheduleDismiss() {
    cancelDismiss();
    closeTimer = setTimeout(() => {
      if (isSidebarTarget(document.activeElement) || isOverlayTarget(document.activeElement))
        return;
      dismiss();
    }, spring.fast.settleMs);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!floatingOpen) return;
    if (isSidebarTarget(event.target) || isOverlayTarget(event.target)) cancelDismiss();
    else scheduleDismiss();
  }

  function handleFocusIn(event: FocusEvent) {
    if (isSidebarTarget(event.target)) {
      cancelDismiss();
      if (!suppressFocusReveal) reveal();
    } else if (!isOverlayTarget(event.target)) {
      suppressFocusReveal = false;
      dismiss();
    }
  }

  function handlePointerDown(event: PointerEvent) {
    if (!isSidebarTarget(event.target) && !isOverlayTarget(event.target)) dismiss();
  }

  function rememberWidth(width: number) {
    if (width > 0) expandedWidth = width;
  }

  $effect(() => {
    if (!active || !collapsed) dismiss();
  });

  $effect(() => {
    if (!active || !collapsed || floatingOpen) return;
    if (isSidebarTarget(document.activeElement) && !rail?.contains(document.activeElement)) {
      suppressFocusReveal = true;
      rail?.querySelector<HTMLElement>('button')?.focus();
    }
  });

  $effect(() => {
    if (!active || !collapsed || !floatingOpen) return;
    return pushEscapeLayer(() => {
      suppressFocusReveal = true;
      if (isSidebarTarget(document.activeElement)) {
        rail?.querySelector<HTMLElement>('button')?.focus();
      }
      dismiss();
    });
  });

  onDestroy(cancelDismiss);
</script>

<svelte:document
  onpointermove={handlePointerMove}
  onpointerdown={handlePointerDown}
  onfocusin={handleFocusIn}
/>

<ErrorBoundary logger={workspaceLogger}>
  <!-- Main Workspace Layout -->
  <div
    class="workspace-page h-full flex flex-col relative bg-sidebar"
    aria-label={m.workspace_layout_ariaLabel()}
  >
    <!-- Upper Area: Sidebar + Content (shrinks when terminal is open) -->
    <div class="upper-area flex-1 flex min-h-0" bind:clientWidth={availableWidth}>
      {#if sidebarSide === 'right'}
        <!-- Main Content Area (Panel Layout) - rendered first when sidebar is on right -->
        <div class="main-content-area flex h-full min-w-0 z-10 bg-sidebar pl-2 sm:pl-3">
          {@render content()}
        </div>
      {/if}

      <div
        bind:this={shell}
        class="sidebar-shell relative z-20 flex h-full shrink-0 min-w-0"
        class:sidebar-collapsed={collapsed}
        class:sidebar-floating={floatingOpen && collapsed && active}
        class:sidebar-right={sidebarSide === 'right'}
        style:--floating-width={`${floatingWidth}px`}
        onpointerenter={reveal}
        onpointerleave={scheduleDismiss}
        data-workspace-sidebar-shell
      >
        {#if !startCollapsed && active}
          <div
            bind:this={rail}
            class="sidebar-rail-shell h-full shrink-0 overflow-hidden transition-[width] duration-spring-slow ease-spring-slow motion-reduce:transition-none"
            style:width={collapsed ? '48px' : '0px'}
            inert={!collapsed}
            data-workspace-sidebar-rail-shell
          >
            <WorkspaceSidebarRail
              {workspaceId}
              side={sidebarSide}
              onReveal={reveal}
              onExpand={() => appStore.dispatch(toggleSidebar())}
            />
          </div>
        {/if}
        <ResizablePanel
          {active}
          resizable={!$sidebarIsCollapsed}
          side={sidebarSide}
          minWidth={sidebarMinimumWidth}
          maxWidth={sidebarWidthLimit}
          defaultWidth={sidebarDefaultWidth}
          defaultExpandedWidth={sidebarDefaultExpandedWidth}
          storageKey={sidebarStorageKey}
          expandedStorageKey={sidebarExpandedStorageKey}
          percentageWeight={sidebarPercentageWeight}
          initiallyCollapsed={startCollapsed}
          onWidthChange={rememberWidth}
          className="workspace-sidebar-panel workspace-sidebar-{sidebarSide} flex-none h-full min-w-0 bg-sidebar"
        >
          <div
            class="sidebar-content h-full min-h-0 overflow-hidden bg-sidebar"
            style:min-width={collapsed ? undefined : `${sidebarMinimumWidth}px`}
            inert={!active || ($sidebarIsCollapsed && (!collapsed || !floatingOpen))}
            aria-hidden={!active || ($sidebarIsCollapsed && (!collapsed || !floatingOpen))}
            data-workspace-sidebar-flyout={collapsed ? floatingOpen : undefined}
          >
            {@render sidebar()}
          </div>
        </ResizablePanel>
      </div>

      {#if sidebarSide === 'left'}
        <!-- Main Content Area (Panel Layout) - rendered after when sidebar is on left -->
        <div class="main-content-area flex h-full min-w-0 z-10 bg-sidebar">
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

  .sidebar-collapsed :global(.workspace-sidebar-panel) {
    position: static;
    overflow: visible !important;
  }

  .sidebar-collapsed :global(.workspace-sidebar-panel > div) {
    opacity: 1 !important;
  }

  .sidebar-collapsed .sidebar-content {
    position: absolute;
    inset-block: 0;
    left: 48px;
    width: var(--floating-width);
    pointer-events: none;
    opacity: 0;
    transform: translateX(-0.5rem);
    border-radius: var(--radius-large);
    box-shadow: var(--surface-shadow-4);
    transition:
      opacity var(--motion-standard) var(--ease-standard),
      transform var(--motion-standard) var(--ease-standard);
  }

  .sidebar-right.sidebar-collapsed .sidebar-content {
    left: auto;
    right: 48px;
    transform: translateX(0.5rem);
  }

  .sidebar-floating.sidebar-collapsed .sidebar-content {
    pointer-events: auto;
    opacity: 1;
    transform: translateX(0);
  }

  @container style(--motion-reduced: 1) {
    .sidebar-content {
      transition: none;
    }
  }

  @media (max-width: 639px) {
    .sidebar-shell:not(.sidebar-collapsed) {
      position: absolute;
      inset-block: 0;
      z-index: 20;
    }

    .sidebar-shell:not(.sidebar-right) {
      left: 0;
    }

    .sidebar-shell.sidebar-right {
      right: 0;
    }
  }

  /* Terminal Overlay - positioned at bottom, shrinks content above */
  .terminal-overlay-container {
    width: 100%;
    z-index: 40;
  }
</style>
