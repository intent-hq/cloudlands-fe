<script lang="ts">
  import { onMount } from 'svelte';
  import NotesPanel from '../notes/NotesPanel.svelte';
  import CodeChangesPanel from '../file-tracking/CodeChangesPanel.svelte';
  import VSCodeFileExplorer from '../file-explorer/VSCodeFileExplorer.svelte';
  import VSCodeScrollablePanel from '../ui/VSCodeScrollablePanel.svelte';
  import ActivityLog from '$features/log/ActivityLog.svelte';
  import ErrorBoundary from '../ErrorBoundary.svelte';
  import { fly } from 'svelte/transition';
  import {
  selectPanelVisibilityFlag,
  selectWorkspaceSidebarPanelLayout,
} from '$store/renderer/slices/ui-layout/ui-layout-selectors';
  import {
  setWorkspaceSidebarPanelLayout,
  type WorkspaceSidebarPanelLayoutState,
} from '$store/renderer/slices/ui-layout/ui-layout-slice';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';


  interface Props {
    workspaceId: string;
    selectedNoteId?: string | null;
    selectedFile?: string;
    loading?: boolean;
    showCodeDiff?: (change: any) => void;
    onOpenNote?: (noteId: string) => void;
    onOpenFile?: (file: string) => void;
    onSelectAgent?: (agentId: string) => void;
    handleFileSelect?: (file: string) => void;
    fileTreeView?: any;
  }

  let {
    workspaceId,
    selectedNoteId = null,
    selectedFile = '',
    loading = false,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    showCodeDiff,
    onOpenNote = () => {},
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onOpenFile = () => {},
    onSelectAgent,
    handleFileSelect = () => {},
    fileTreeView = $bindable(),
  }: Props = $props();

  // Panel configuration
  // Note: defaultHeight is the content height (excluding the 28px header)
  const panels = [
    // i18n-ignore (panel titles are unused layout metadata, not rendered)
    { id: 'notes', title: 'Context', minHeight: 80, defaultHeight: 92 }, // Total will be 92 + 28 = 120px
    { id: 'source-control', title: 'Code Changes', minHeight: 80, defaultHeight: 200 }, // i18n-ignore (unused layout metadata)
    { id: 'explorer', title: 'Explorer', minHeight: 80, defaultHeight: 200 },
    { id: 'activity', title: 'Activity', minHeight: 80, defaultHeight: 200 },
  ];

  const workspaceSidebarPanelLayout = selectWorkspaceSidebarPanelLayout();

  // Track collapsed states and custom heights
  let collapsedStates = $state<Record<string, boolean>>({});
  let panelHeights = $state<Record<string, number>>({});
  let containerHeight = $state(0);
  let containerRef: HTMLDivElement;

  // Dragging state
  let isDragging = $state(false);
  let draggedDivider: string | null = $state(null);
  let focusedDivider: string | null = $state(null);
  let dragStartY = $state(0);
  let dragStartHeights = $state<Record<string, number>>({});

  // Load persisted states from Redux and initialize DOM measurements.
  onMount(() => {
    loadSavedState();
    initializePanelHeights();
    updateContainerHeight();

    // Observe container size changes
    const resizeObserver = new ResizeObserver(() => {
      updateContainerHeight();
      recalculatePanelHeights();
    });

    if (containerRef) {
      resizeObserver.observe(containerRef);
    }

    // Window resize handler
    const handleResize = () => {
      updateContainerHeight();
      recalculatePanelHeights();
    };
    window.addEventListener('resize', handleResize);

    // Global mouse events for dragging
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    // Listen for panel:focus events from keyboard shortcuts
    const handlePanelFocus = (event: Event) => {
      const customEvent = event as CustomEvent<{ panelId: string }>;
      const panelId = customEvent.detail?.panelId;
      if (panelId) {
        // Expand the panel if collapsed
        if (collapsedStates[panelId]) {
          collapsedStates[panelId] = false;
          recalculatePanelHeights();
          persistPanelLayout();
        }
        // Focus the first focusable element in the panel
        setTimeout(() => {
          const panelElement = containerRef?.querySelector(`[data-sidebar-panel="${panelId}"]`);
          if (panelElement) {
            const focusable = panelElement.querySelector<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            );
            focusable?.focus();
          }
        }, 50);
      }
    };
    window.addEventListener('panel:focus', handlePanelFocus);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('panel:focus', handlePanelFocus);
    };
  });

  // Wrapper functions to handle type mismatches


  function ensureMissingPanelStates() {
    panels.forEach((panel) => {
      if (!(panel.id in collapsedStates)) {
        // Don't collapse any panels by default - let them all be visible initially
        const collapsedByDefault = ['activity'];
        collapsedStates[panel.id] = collapsedByDefault.includes(panel.id);
      }
    });
  }

  function loadSavedState() {
    collapsedStates = { ...$workspaceSidebarPanelLayout.collapsed };
    panelHeights = { ...$workspaceSidebarPanelLayout.heights };
    ensureMissingPanelStates();
  }

  function initializePanelHeights() {
    const headerHeight = 28;
    const visiblePanels = getVisiblePanels();
    const totalHeaders = getShownPanels().length * headerHeight;
    const availableHeight = containerHeight - totalHeaders;

    if (availableHeight > 0 && visiblePanels.length > 0) {
      const defaultHeight = Math.floor(availableHeight / visiblePanels.length);

      panels.forEach((panel) => {
        if (!(panel.id in panelHeights) || panelHeights[panel.id] === 0) {
          // Use panel's defaultHeight if defined, otherwise use calculated defaultHeight
          panelHeights[panel.id] = panel.defaultHeight || defaultHeight;
        }
      });
    }
  }

  let appliedPersistedPanelLayout = $state<WorkspaceSidebarPanelLayoutState | undefined>(undefined);

  $effect(() => {
    if ($workspaceSidebarPanelLayout === appliedPersistedPanelLayout) return;
    collapsedStates = { ...$workspaceSidebarPanelLayout.collapsed };
    panelHeights = { ...$workspaceSidebarPanelLayout.heights };
    ensureMissingPanelStates();
    appliedPersistedPanelLayout = $workspaceSidebarPanelLayout;
  });

  function persistPanelLayout() {
    appStore.dispatch(
      setWorkspaceSidebarPanelLayout({
        collapsed: { ...collapsedStates },
        heights: { ...panelHeights },
      }),
    );
  }

  function updateContainerHeight() {
    if (containerRef) {
      containerHeight = containerRef.clientHeight;
    }
  }

  function togglePanel(panelId: string) {
    collapsedStates[panelId] = !collapsedStates[panelId];
    recalculatePanelHeights();
    persistPanelLayout();
  }

  function getShownPanels() {
    return panels.filter((p) => {
      if (p.id === 'notes') return $showNotes;
      if (p.id === 'source-control') return $showSourceControl;
      if (p.id === 'explorer') return $showExplorer;
      if (p.id === 'activity') return $showActivity;
      return false;
    });
  }

  function getVisiblePanels() {
    return getShownPanels().filter((p) => !collapsedStates[p.id]);
  }

  function recalculatePanelHeights() {
    const headerHeight = 28;
    const shownPanels = getShownPanels();
    const visiblePanels = getVisiblePanels();
    const totalHeaders = shownPanels.length * headerHeight;
    const availableHeight = containerHeight - totalHeaders;

    if (availableHeight <= 0 || visiblePanels.length === 0) return;

    // Calculate total current height of visible panels
    let totalCurrentHeight = 0;
    visiblePanels.forEach((panel) => {
      totalCurrentHeight += panelHeights[panel.id] || 0;
    });

    // If no current heights or they don't match available space, redistribute
    if (
      totalCurrentHeight === 0 ||
      Math.abs(totalCurrentHeight - availableHeight) > visiblePanels.length * 10
    ) {
      const heightPerPanel = Math.floor(availableHeight / visiblePanels.length);
      visiblePanels.forEach((panel) => {
        panelHeights[panel.id] = Math.max(panel.minHeight, heightPerPanel);
      });
    } else {
      // Scale existing heights proportionally
      const scale = availableHeight / totalCurrentHeight;
      visiblePanels.forEach((panel) => {
        panelHeights[panel.id] = Math.max(
          panel.minHeight,
          Math.floor((panelHeights[panel.id] || 0) * scale),
        );
      });
    }
  }

  // Dragging handlers
  function handleDividerMouseDown(e: MouseEvent, panelId: string) {
    e.preventDefault();
    isDragging = true;
    draggedDivider = panelId;
    focusedDivider = panelId;
    dragStartY = e.clientY;

    // Store current heights
    dragStartHeights = { ...panelHeights };

    // Add dragging class to body
    document.body.classList.add('dragging');
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging || !draggedDivider) return;

    const deltaY = e.clientY - dragStartY;
    const visiblePanels = getVisiblePanels();
    const currentIndex = visiblePanels.findIndex((p) => p.id === draggedDivider);

    if (currentIndex === -1 || currentIndex === visiblePanels.length - 1) return;

    const currentPanel = visiblePanels[currentIndex];
    const nextPanel = visiblePanels[currentIndex + 1];

    const newCurrentHeight = Math.max(
      currentPanel.minHeight,
      (dragStartHeights[currentPanel.id] || 0) + deltaY,
    );

    const newNextHeight = Math.max(
      nextPanel.minHeight,
      (dragStartHeights[nextPanel.id] || 0) - deltaY,
    );

    // Only update if both panels respect minimum heights
    if (newCurrentHeight >= currentPanel.minHeight && newNextHeight >= nextPanel.minHeight) {
      panelHeights[currentPanel.id] = newCurrentHeight;
      panelHeights[nextPanel.id] = newNextHeight;
    }
  }

  function handleMouseUp() {
    if (isDragging) {
      isDragging = false;
      draggedDivider = null;
      focusedDivider = null;
      document.body.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      persistPanelLayout();
    }
  }

  // Keyboard support for divider resizing
  function getPanelMinHeight(id: string) {
    const p = panels.find((pp) => pp.id === id);
    return p?.minHeight ?? 0;
  }
  function handleDividerKeydown(e: KeyboardEvent, panelId: string) {
    const step = e.shiftKey ? 20 : 10;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      focusedDivider = panelId;
      adjustDivider(panelId, -step);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      focusedDivider = panelId;
      adjustDivider(panelId, step);
    } else if (e.key === 'Enter') {
      // Reset equal distribution among visible panels
      const visible = getVisiblePanels();
      const equal = visible.length > 0 ? Math.floor(containerHeight / visible.length) : 0;
      visible.forEach((p) => (panelHeights[p.id] = Math.max(p.minHeight ?? 0, equal)));
      persistPanelLayout();
    }
  }
  function adjustDivider(panelId: string, deltaPx: number) {
    const visible = getVisiblePanels();
    const idx = visible.findIndex((p) => p.id === panelId);
    if (idx === -1 || idx === visible.length - 1) return;
    const current = visible[idx];
    const next = visible[idx + 1];
    const newCurrent = Math.max(
      getPanelMinHeight(current.id),
      (panelHeights[current.id] || 0) + deltaPx,
    );
    const newNext = Math.max(getPanelMinHeight(next.id), (panelHeights[next.id] || 0) - deltaPx);
    panelHeights[current.id] = newCurrent;
    panelHeights[next.id] = newNext;
    persistPanelLayout();
  }

  // Calculate actual panel heights for rendering
  let calculatedHeights = $derived.by(() => {
    const heights: Record<string, number> = {};

    panels.forEach((panel) => {
      if (collapsedStates[panel.id]) {
        heights[panel.id] = 0;
      } else {
        heights[panel.id] = panelHeights[panel.id] || 200;
      }
    });

    return heights;
  });

  // Determine which panels should be shown — reactive readable selectors at init
  const showNotes = selectPanelVisibilityFlag(workspaceId, 'showNotesPanel');
  const showSourceControl = selectPanelVisibilityFlag(workspaceId, 'showCodeChangesPanel');
  const showExplorer = selectPanelVisibilityFlag(workspaceId, 'showFilesPanel');
  const showActivity = selectPanelVisibilityFlag(workspaceId, 'showActivityLogPanel');

  // Helper to check if a divider should be shown
  function shouldShowDivider(panelId: string): boolean {
    if (collapsedStates[panelId]) return false;

    const visiblePanels = getVisiblePanels();
    const currentIndex = visiblePanels.findIndex((p) => p.id === panelId);

    // Don't show divider for the last visible panel
    return currentIndex !== -1 && currentIndex < visiblePanels.length - 1;
  }
</script>

<div class="vscode-sidebar-container pt-3 px-3">
  <!-- Workspace Header -->
  <!-- <div class="mb-6 mt-3">
    {#if workspace}
      <div class="w-full h-full" in:fly={{ x: -10, duration: 200 }}>
        <WorkspaceSidebarHeader {workspace} {workspaceId} />
      </div>
    {/if}
  </div> -->

  <!-- Panels Container -->
  <div bind:this={containerRef} class="vscode-resizable-panels">
    <!-- Notes Panel -->
    {#if $showNotes}
      <div
        class="panel-container"
        data-sidebar-panel="notes"
        style="height: {collapsedStates['notes']
          ? '28px'
          : `${(calculatedHeights['notes'] || 92) + 28}px`}"
      >
        <div class="panel-wrapper">
          <NotesPanel
            {workspaceId}
            selectedNoteId={selectedNoteId ?? undefined}
            {onOpenNote}
            collapsed={collapsedStates['notes']}
            onCollapse={() => togglePanel('notes')}
          />
        </div>
        {#if shouldShowDivider('notes')}
          <button
            type="button"
            class="resize-divider {focusedDivider === 'notes' ? 'resize-divider-active' : ''}"
            aria-label={m.workspace_resizablePanels_resize_ariaLabel()}
            tabindex="0"
            onkeydown={(e) => handleDividerKeydown(e, 'notes')}
            onmousedown={(e) => handleDividerMouseDown(e, 'notes')}
            onfocus={() => (focusedDivider = 'notes')}
            onblur={() => (focusedDivider = null)}
            title={m.workspace_resizablePanels_resize_tooltip()}
          ></button>
        {/if}
      </div>
    {/if}

    <!-- Code Changes Panel -->
    {#if $showSourceControl}
      <div
        class="panel-container"
        data-sidebar-panel="source-control"
        style="height: {collapsedStates['source-control']
          ? '28px'
          : `${(calculatedHeights['source-control'] || 200) + 28}px`}"
        transition:fly={{ y: 6, duration: 200 }}
      >
        <div class="panel-wrapper">
          <CodeChangesPanel
            {workspaceId}
            collapsed={collapsedStates['source-control']}
            onCollapse={() => togglePanel('source-control')}
          />
        </div>
        {#if shouldShowDivider('source-control')}
          <button
            type="button"
            class="resize-divider {focusedDivider === 'source-control'
              ? 'resize-divider-active'
              : ''}"
            aria-label={m.workspace_resizablePanels_resize_ariaLabel()}
            tabindex="0"
            onkeydown={(e) => handleDividerKeydown(e, 'source-control')}
            onmousedown={(e) => handleDividerMouseDown(e, 'source-control')}
            onfocus={() => (focusedDivider = 'source-control')}
            onblur={() => (focusedDivider = null)}
            title={m.workspace_resizablePanels_resize_tooltip()}
          ></button>
        {/if}
      </div>
    {/if}

    <!-- Explorer Panel -->
    {#if $showExplorer}
      <div
        class="panel-container"
        data-sidebar-panel="explorer"
        style="height: {collapsedStates['explorer']
          ? '28px'
          : `${(calculatedHeights['explorer'] || 200) + 28}px`}"
      >
        <div class="panel-wrapper">
          <VSCodeFileExplorer
            {workspaceId}
            onFileSelect={handleFileSelect}
            {onSelectAgent}
            bind:selectedFile
            bind:this={fileTreeView}
            isLoading={loading}
            collapsed={collapsedStates['explorer']}
            onCollapse={() => togglePanel('explorer')}
          />
        </div>
        {#if shouldShowDivider('explorer')}
          <button
            type="button"
            class="resize-divider {focusedDivider === 'explorer' ? 'resize-divider-active' : ''}"
            aria-label={m.workspace_resizablePanels_resize_ariaLabel()}
            tabindex="0"
            onkeydown={(e) => handleDividerKeydown(e, 'explorer')}
            onmousedown={(e) => handleDividerMouseDown(e, 'explorer')}
            onfocus={() => (focusedDivider = 'explorer')}
            onblur={() => (focusedDivider = null)}
            title={m.workspace_resizablePanels_resize_tooltip()}
          ></button>
        {/if}
      </div>
    {/if}

    <!-- Activity Panel -->
    {#if $showActivity}
      <div
        class="panel-container"
        data-sidebar-panel="activity"
        style="height: {collapsedStates['activity']
          ? '28px'
          : `${(calculatedHeights['activity'] || 200) + 28}px`}"
        transition:fly={{ y: 6, duration: 200 }}
      >
        <div class="panel-wrapper">
          <VSCodeScrollablePanel
            title={m.workspace_resizablePanels_activity_label()}
            storageKey="activity"
            collapsed={collapsedStates['activity']}
            onCollapse={() => togglePanel('activity')}
            class="h-full"
          >
            <ErrorBoundary componentName="ActivityLog">
              <ActivityLog
                {workspaceId}
                {handleFileSelect}
                onShowAgent={(agentId) => {
                  // Dispatch action to open agent in panel
                  appStore.dispatch(
                    openAgentTabRequested(workspaceId, { agentId }),
                  );
                }}
              />
            </ErrorBoundary>
          </VSCodeScrollablePanel>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .vscode-sidebar-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .vscode-resizable-panels {
    display: flex;
    flex-direction: column;
    width: 100%;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    position: relative;
  }

  .panel-container {
    display: flex;
    flex-direction: column;
    min-height: 28px;
    transition: height 0.2s ease-out;
    overflow: hidden;
    position: relative;
  }

  /* Remove transition while dragging */
  :global(body.dragging) .panel-container {
    transition: none;
  }

  .panel-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .resize-divider {
    position: absolute;
    bottom: -4px;
    left: 0;
    right: 0;
    height: 8px;
    cursor: ns-resize;
    z-index: 10;
    background: transparent;
    transition: background-color 0.15s ease;
    border: none;
    padding: 0;
  }

  /* Subtle line indicator */
  .resize-divider::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--border);
    transform: translateY(-50%);
    transition: all 0.15s ease;
  }

  /* Hover state - subtle highlight */
  .resize-divider:hover {
    background: hsl(var(--primary) / 0.1);
  }

  .resize-divider:hover::before {
    background: hsl(var(--primary) / 0.5);
  }

  /* Focus state - keyboard navigation */
  .resize-divider:focus {
    outline: none;
    background: hsl(var(--primary) / 0.15);
  }

  .resize-divider:focus::before {
    background: hsl(var(--primary) / 0.6);
    height: 2px;
  }

  /* Active/dragging state - only for the actively dragged divider */
  .resize-divider-active,
  .resize-divider-active:hover {
    background: hsl(var(--primary) / 0.2);
  }

  .resize-divider-active::before,
  .resize-divider-active:hover::before {
    background: hsl(var(--primary));
    height: 2px;
  }

  /* Remove global dragging style that affects all dividers */
  :global(body.dragging) {
    cursor: ns-resize !important;
    user-select: none !important;
  }
</style>
