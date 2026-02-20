<script lang="ts">
  import { logger } from '$lib/utils/client-logger';

  import { onMount, onDestroy } from 'svelte';
  import NotesPanel from '../notes/NotesPanel.svelte';
  import CodeChangesPanel from '../file-tracking/CodeChangesPanel.svelte';
  import VSCodeFileExplorer from '../file-explorer/VSCodeFileExplorer.svelte';
  import VSCodeScrollablePanel from '../ui/VSCodeScrollablePanel.svelte';
  import ActivityLog from '$features/log/ActivityLog.svelte';
  import ErrorBoundary from '../ErrorBoundary.svelte';
  import { faTimeline } from '@fortawesome/free-solid-svg-icons';
  import { fly } from 'svelte/transition';

  interface Props {
    workspace: any;
    workspaceId: string;
    selectedNoteId?: string | null;
    selectedFile?: string;
    selectedChangeId?: string;
    hasCodeChanges?: boolean;
    hasActivityEvents?: boolean;
    loading?: boolean;
    showCodeDiff?: (change: any) => void;
    onOpenNote?: (noteId: string) => void;
    onOpenFile?: (file: string) => void;
    onOpenSource?: (sourceId: string) => void;
    onSelectAgent?: (agentId: string) => void;
    onCreatePR?: () => void;
    handleFileSelect?: (file: string) => void;
    fileTreeView?: any;
  }

  let {
    workspace,
    workspaceId,
    selectedNoteId = null,
    selectedFile = '',
    selectedChangeId,
    hasCodeChanges = false,
    hasActivityEvents = false,
    loading = false,
    showCodeDiff,
    onOpenNote = () => {},
    onOpenFile = () => {},
    onOpenSource = () => {},
    onSelectAgent,
    onCreatePR = () => {},
    handleFileSelect = () => {},
    fileTreeView = $bindable(),
  }: Props = $props();

  // Track workspace changes for debugging if needed
  // Uncomment the following effect for debugging workspace issues:
  // $effect(() => {
  //   logger.debug("[VSCodeSidebarPanels] Workspace data:", {
  //     workspace,
  //     worktreePath: workspace?.worktreePath,
  //     repositoryPath: workspace?.repositoryPath,
  //     finalPath: workspace?.worktreePath || workspace?.repositoryPath || "",
  //     workspaceId,
  //   });
  // });

  // Panel configuration
  // Note: defaultHeight is the content height (excluding the 28px header)
  const panels = [
    { id: 'notes', title: 'Notes', minHeight: 100, defaultHeight: 92 }, // Total will be 92 + 28 = 120px
    { id: 'source-control', title: 'Code Changes', minHeight: 100, defaultHeight: 200 },
    { id: 'explorer', title: 'Explorer', minHeight: 100, defaultHeight: 200 },
    { id: 'activity', title: 'Activity', minHeight: 100, defaultHeight: 200 },
  ];

  // Track collapsed states
  let collapsedStates = $state<Record<string, boolean>>({});
  let containerHeight = $state(0);
  let containerRef: HTMLDivElement;

  // Wrapper functions to handle type mismatches
  function handleCodeChangeOpenFile(change: any) {
    if (onOpenFile && change?.filePath) {
      onOpenFile(change.filePath);
    }
  }

  function handleShowDiff(change: any) {
    if (showCodeDiff) {
      showCodeDiff(change);
    }
  }

  // Load saved states
  onMount(() => {
    const saved = localStorage.getItem('vscode-sidebar-panels');
    if (saved) {
      try {
        collapsedStates = JSON.parse(saved);
      } catch (e) {
        logger.error('Failed to load panel states:', e);
      }
    }

    // Initialize missing states
    panels.forEach((panel) => {
      if (!(panel.id in collapsedStates)) {
        collapsedStates[panel.id] = false;
      }
    });

    // Update container height
    updateContainerHeight();

    // Observe container size changes
    const resizeObserver = new ResizeObserver(() => {
      updateContainerHeight();
    });

    if (containerRef) {
      resizeObserver.observe(containerRef);
    }

    // Also listen to window resize
    const handleResize = () => {
      updateContainerHeight();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  });

  // Save states when they change
  $effect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('vscode-sidebar-panels', JSON.stringify(collapsedStates));
    }
  });

  function updateContainerHeight() {
    if (containerRef) {
      containerHeight = containerRef.clientHeight;
    }
  }

  function togglePanel(panelId: string) {
    collapsedStates[panelId] = !collapsedStates[panelId];
  }

  // Calculate heights for visible panels
  let panelHeights = $derived.by(() => {
    const headerHeight = 28;

    // Count how many panels are actually being shown
    let shownPanelCount = 0;
    if (showNotes) shownPanelCount++;
    if (showSourceControl) shownPanelCount++;
    if (showExplorer) shownPanelCount++;
    if (showActivity) shownPanelCount++;

    const visiblePanels = panels.filter((p) => {
      // Only count panels that are both shown and not collapsed
      const isShown =
        (p.id === 'notes' && showNotes) ||
        (p.id === 'source-control' && showSourceControl) ||
        (p.id === 'explorer' && showExplorer) ||
        (p.id === 'activity' && showActivity);
      return isShown && !collapsedStates[p.id];
    });

    const totalHeaders = shownPanelCount * headerHeight;
    const availableHeight = containerHeight - totalHeaders;

    if (availableHeight <= 0 || visiblePanels.length === 0) {
      return {};
    }

    const heights: Record<string, number> = {};
    const heightPerPanel = Math.floor(availableHeight / visiblePanels.length);

    panels.forEach((panel) => {
      if (collapsedStates[panel.id]) {
        heights[panel.id] = 0;
      } else {
        // Use panel's defaultHeight if defined, otherwise use calculated heightPerPanel
        heights[panel.id] = panel.defaultHeight || heightPerPanel;
      }
    });

    return heights;
  });

  // Determine which panels should be shown
  let showNotes = $derived(true);
  // Always show source control panel to ensure file changes are detected
  let showSourceControl = $derived(true);
  // Show explorer for both local and remote workspaces
  let showExplorer = $derived(
    workspaceId && workspace && (workspace.worktreePath || workspace.repositoryPath),
  );
  let showActivity = $derived(hasActivityEvents || loading);
</script>

<div bind:this={containerRef} class="vscode-sidebar-panels divide-y divide-border">
  <!-- Notes Panel -->
  {#if showNotes}
    <div
      class="panel-container"
      style="height: {collapsedStates['notes']
        ? '28px'
        : `${(panelHeights['notes'] || 92) + 28}px`}"
    >
      <div class="panel-wrapper">
        <NotesPanel
          {workspaceId}
          selectedNoteId={selectedNoteId ?? undefined}
          {onOpenNote}
          {onOpenSource}
          collapsed={collapsedStates['notes']}
          onCollapse={() => togglePanel('notes')}
        />
      </div>
    </div>
  {/if}

  <!-- Code Changes Panel -->
  {#if showSourceControl}
    {logger.info('[VSCodeSidebarPanels] Rendering Code Changes panel')}
    <div
      class="panel-container"
      style="height: {collapsedStates['source-control']
        ? '28px'
        : `${(panelHeights['source-control'] || 200) + 28}px`}"
      transition:fly={{ y: 6, duration: 200 }}
    >
      <div class="panel-wrapper">
        <CodeChangesPanel
          {workspaceId}
          collapsed={collapsedStates['source-control']}
          onCollapse={() => togglePanel('source-control')}
        />
      </div>
    </div>
  {/if}

  <!-- Explorer Panel -->
  {#if showExplorer}
    <div
      class="panel-container"
      style="height: {collapsedStates['explorer']
        ? '28px'
        : `${(panelHeights['explorer'] || 200) + 28}px`}"
    >
      <div class="panel-wrapper">
        <VSCodeFileExplorer
          workspacePath={workspace?.worktreePath || workspace?.repositoryPath || ''}
          {workspaceId}
          environmentConfig={workspace?.environmentConfig}
          onFileSelect={handleFileSelect}
          {onSelectAgent}
          bind:selectedFile
          bind:this={fileTreeView}
          isLoading={loading}
          collapsed={collapsedStates['explorer']}
          onCollapse={() => togglePanel('explorer')}
        />
      </div>
    </div>
  {/if}

  <!-- Activity Panel -->
  {#if showActivity}
    <div
      class="panel-container"
      style="height: {collapsedStates['activity']
        ? '28px'
        : `${(panelHeights['activity'] || 200) + 28}px`}"
      transition:fly={{ y: 6, duration: 200 }}
    >
      <div class="panel-wrapper">
        <VSCodeScrollablePanel
          title="Activity"
          icon={faTimeline}
          collapsible={true}
          collapsed={collapsedStates['activity']}
          onCollapse={() => togglePanel('activity')}
          class="h-full"
          contentClass="pb-3 min-h-0 relative"
        >
          <ErrorBoundary componentName="ActivityLog">
            <ActivityLog {workspaceId} />
          </ErrorBoundary>
        </VSCodeScrollablePanel>
      </div>
    </div>
  {/if}
</div>

<style>
  .vscode-sidebar-panels {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
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
  }

  .panel-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
</style>
