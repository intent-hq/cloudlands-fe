<script lang="ts">
  import { fileTrackingStore } from '$features/file-tracking/file-tracking.store.svelte';
  import { track, getFileExtension } from '$lib/services/analytics';
  import { Button } from '$lib/components/ui/button';
  import TabBar from '$lib/components/ui/TabBar.svelte';
  import { noteReadTrackingStore } from '$lib/stores/note-read-tracking.store.svelte';
  import { cn } from '$lib/utils';
  import type { Note, Workspace } from '$shared/types';
  import {
    faAlignLeft,
    faCompressAlt,
    faExpandAlt,
    faFolderTree,
    faPencil,
    faSearch,
    faTimes,
    faRobot,
    faGlobe,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import {
    FilesPanel,
    NotesPanel,
    SidebarChangesPanel,
    WorkspaceProgressCard,
    isSpecNote,
  } from './sidebar';
  import WorkspaceAgentsList from './WorkspaceAgentsList.svelte';
  import TerminalsList from './TerminalsList.svelte';
  import BrowserPanel from '$lib/components/browser/BrowserPanel.svelte';
  import { PanelLayoutControls } from '$lib/components/layout/panel-system';
  import { applyContentPreset } from '$features/layout/preset-executor';

  import { agentService } from '$features/agent/agent.service';
  import { sessionStore } from '$features/agent/browser';
  import { useAllAgentsSubscription } from '$lib/utils/agent-subscription.svelte';
  import {
    getTransientUIStore,
    type SidebarTabId,
  } from '$features/workspace/transient-ui-state.store.svelte';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-manager.svelte';
  import { onMount } from 'svelte';
  import FileActionsDropdown from '../ui/FileActionsDropdown.svelte';
  import Input from '../ui/input/input.svelte';
  import type { LayoutPresetId } from '$lib/components/layout/panel-system/PanelLayoutControls.svelte';

  interface Terminal {
    id: string;
    type: 'terminal' | 'chat';
    title?: string;
    name?: string;
    createdAt: number | string;
    workspaceId?: string;
  }

  interface Props {
    workspace: Workspace;
    workspaceId: string;
    workspacePath?: string;
    // Notes
    notes?: Note[];
    selectedNoteId?: string | null;
    onOpenNote?: (noteId: string) => void;
    onOpenAgent?: (agentId: string) => void;
    onReorderNotes?: (noteIds: string[]) => void;
    onCreateNote?: () => void;
    // Files
    selectedFile?: string | null;
    onOpenFile?: (filePath: string) => void;
    onCreateFile?: (folderPath: string, fileName?: string) => void | Promise<void>;
    onFileRenamed?: (oldPath: string, newPath: string) => void;
    // Changes - active file tracking
    activeFilePath?: string | null;
    activeFileStaged?: boolean | null;
    isAllChangesViewActive?: boolean;
    // Session
    isNewWorkspaceSession?: boolean;
    // Agent creation
    onCreateAgent?: () => void;
    onCreateAgentWithPrompt?: (prompt: string, name: string) => void;
    // Callbacks for activity/file interactions
    onShowAgent?: (agentId: string) => void;
    // Terminals
    terminals?: Terminal[];
    onOpenTerminal?: (terminalId: string) => void;
    onCreateTerminal?: () => void;
    // Open full accept changes panel (can be passed as onAcceptChanges for backwards compat)
    onOpenAcceptChanges?: () => void;
    onAcceptChanges?: () => void;
    // Layout
    class?: string;
    // Allow extra props for backwards compatibility
    [key: string]: unknown;
  }

  let {
    workspace,
    workspaceId,
    workspacePath = '',
    notes = [],
    selectedNoteId = null,
    // Note: onOpenNote, onOpenFile, onOpenAgent, onShowAgent, onOpenTerminal are in Props
    // for backwards compatibility but are not used - we use handleOpen*InPanel instead
    onReorderNotes,
    onCreateNote,
    selectedFile = null,
    onCreateFile,
    onFileRenamed,
    isAllChangesViewActive = false,
    isNewWorkspaceSession = false,
    onCreateAgent,
    terminals = [],
    onCreateTerminal,
    onOpenAcceptChanges,
    onAcceptChanges,
    class: className,
    ...restProps
  }: Props = $props();

  // Support both prop names for backwards compatibility
  const handleOpenAcceptChanges = $derived(onOpenAcceptChanges || onAcceptChanges);

  // Absorb extra props for backwards compatibility (prevents TS warnings)
  void restProps;

  // Get transient UI store for this workspace to persist sidebar tab
  const transientUIStore = $derived(getTransientUIStore(workspaceId));

  // Only use store data if workspace IDs match - prevents showing stale data during rapid switches
  const storeHasCorrectWorkspace = $derived(fileTrackingStore.currentWorkspaceId === workspaceId);

  // Get panel layout manager for opening tabs
  const panelLayoutManager = $derived(getPanelLayoutManager(workspaceId));

  // Get focused content from panel layout manager to sync sidebar selection state
  const focusedContent = $derived(panelLayoutManager.focusedContent);

  // Derive selected IDs from focused panel content (overrides props when panel is focused)
  const effectiveSelectedNoteId = $derived(
    focusedContent.type === 'note' ? focusedContent.noteId : selectedNoteId,
  );
  const effectiveSelectedAgentId = $derived(
    focusedContent.type === 'agent' ? focusedContent.agentId : null,
  );
  const effectiveSelectedTerminalId = $derived(
    focusedContent.type === 'terminal' ? focusedContent.terminalId : null,
  );
  const effectiveSelectedFile = $derived(
    focusedContent.type === 'file' ? focusedContent.filePath : selectedFile,
  );
  // Derive active file from focused diff panel for changes sidebar sync
  // ONLY syncs for diff tabs - file tabs should NOT highlight in the Changes panel
  const effectiveActiveFilePath = $derived.by(() => {
    // Only sync when viewing a diff (clicked from Changes panel)
    if (focusedContent.type === 'diff' && focusedContent.diffPath) {
      return focusedContent.diffPath;
    }
    // For any other content type, don't highlight anything in Changes panel
    return null;
  });
  const effectiveActiveFileStaged = $derived.by(() => {
    // Only sync when viewing a diff (clicked from Changes panel)
    if (focusedContent.type === 'diff' && focusedContent.diffPath) {
      // Find the change to determine if it's staged
      const isStaged = workingChanges.staged.some(
        (c) => c.file === focusedContent.diffPath || c.relativePath === focusedContent.diffPath,
      );
      return isStaged;
    }
    // For any other content type, don't highlight anything
    return null;
  });

  // Derive "all changes view active" state from focused panel content
  // In panel layout mode (TabbedSidebar), we only check the focused tab type,
  // not the prop - the prop reflects mainPanel state which isn't used here
  const effectiveIsAllChangesViewActive = $derived(focusedContent.type === 'local-changes');

  // Handler to open an agent in a panel tab
  function handleOpenAgentInPanel(agentId: string) {
    const agent = workspaceAgents.find((a) => a.id === agentId);
    if (!agent) return;

    panelLayoutManager.openTab({
      type: 'agent',
      title: agent.name || `Agent ${agentId.substring(0, 8)}`,
      closable: true,
      agentId,
      workspaceId,
    });
  }

  // Handler to open a terminal in a panel tab
  function handleOpenTerminalInPanel(terminalId: string) {
    const terminal = terminals.find((t) => t.id === terminalId);
    if (!terminal) return;

    panelLayoutManager.openTab({
      type: 'terminal',
      title: terminal.title || terminal.name || 'Terminal',
      closable: true,
      terminalId,
      workspaceId,
    });
  }

  // Handler to open a URL in a browser panel tab
  function handleOpenBrowserUrl(url: string) {
    // Extract domain from URL for tab title
    let title = url;
    try {
      const urlObj = new URL(url);
      title = urlObj.hostname;
    } catch {
      // If URL parsing fails, use the full URL
    }

    panelLayoutManager.openTab({
      type: 'browser',
      title,
      closable: true,
      browserUrl: url,
      workspaceId,
    });
  }

  // Handler to open a note in a panel tab
  function handleOpenNoteInPanel(noteId: string) {
    const note = notes.find((n) => n.id === noteId);
    // Still open the tab even if note is not in props (it might be loading)
    const title = note?.title || 'Note';

    panelLayoutManager.openTab({
      type: 'note',
      title,
      closable: true,
      noteId,
      workspaceId,
    });

    // Mark note as read when opened to clear unread indicator
    noteReadTrackingStore.markNoteRead(workspaceId, noteId);
  }

  // Handler to open a file in a panel tab
  function handleOpenFileInPanel(filePath: string) {
    const fileName = filePath.split('/').pop() || filePath;

    panelLayoutManager.openTab({
      type: 'file',
      title: fileName,
      closable: true,
      filePath,
      workspaceId,
    });

    track('Opened File', {
      workspace_id: workspaceId,
      file_extension: getFileExtension(filePath),
      source: 'sidebar',
    });
  }

  // Handler to open code review in a panel tab
  // The CodeReviewTabContent component has its own executor, so it will handle triggering the review
  function handleOpenCodeReviewInPanel() {
    panelLayoutManager.openTab({
      type: 'code-review',
      title: 'Code Review',
      closable: true,
      workspaceId,
    });
  }

  // Container dimensions for tiling calculations
  let containerWidth = $state(800);
  let containerHeight = $state(600);

  // Handler for applying layout presets
  async function handleApplyPreset(presetId: LayoutPresetId) {
    await applyContentPreset(presetId, panelLayoutManager, {
      workspaceId,
      containerWidth,
      containerHeight,
    });
  }

  // Get line changes stats from file tracking store (same source as SidebarChangesPanel)
  // CRITICAL: Only use store data when it's for the correct workspace
  const workingChanges = $derived(
    storeHasCorrectWorkspace
      ? (fileTrackingStore.workingChanges ?? { unstaged: [], staged: [] })
      : { unstaged: [], staged: [] },
  );
  // Get commits to include committed changes in badge totals
  const allCommits = $derived(storeHasCorrectWorkspace ? (fileTrackingStore.commits ?? []) : []);
  const totalAdditions = $derived(
    workingChanges.unstaged.reduce((sum, c) => sum + (c.stats?.additions || 0), 0) +
      workingChanges.staged.reduce((sum, c) => sum + (c.stats?.additions || 0), 0) +
      allCommits.reduce(
        (sum, c) => sum + (c.files?.reduce((fs, f) => fs + (f.additions || 0), 0) || 0),
        0,
      ),
  );
  const totalDeletions = $derived(
    workingChanges.unstaged.reduce((sum, c) => sum + (c.stats?.deletions || 0), 0) +
      workingChanges.staged.reduce((sum, c) => sum + (c.stats?.deletions || 0), 0) +
      allCommits.reduce(
        (sum, c) => sum + (c.files?.reduce((fs, f) => fs + (f.deletions || 0), 0) || 0),
        0,
      ),
  );

  // Reactive trigger for agent state changes
  // NOTE: Currently written but not read — the subscribe callback below increments it,
  // but no $derived or template expression consumes it. Kept as a hook point if needed.
  let agentStateTick = $state(0);

  // Subscribe to all agents for this workspace (including background agents).
  // Use .all with $derived.by() to reactively filter when workspace changes (see hook docs).
  const agentSubscription = useAllAgentsSubscription(() => workspaceId);
  const workspaceAgents = $derived.by(() => {
    const all = agentSubscription.all;
    if (!workspaceId) return all;
    return all.filter((s) => s.workspaceId === workspaceId);
  });
  const agentsLoading = $derived(agentSubscription.loading);
  const agentCount = $derived(workspaceAgents.length);

  // Derive if the workspace is in team/orchestration mode
  // (has a spec-writer agent, indicating coordinator-driven workflow)
  const isTeamMode = $derived(
    workspaceAgents.some(
      (a) =>
        a.metadata?.specialist === 'spec-writer' ||
        (a as any).agentMetadata?.specialist === 'spec-writer',
    ),
  );

  const tabs = $derived([
    {
      id: 'agents',
      label: 'Agents',
      icon: faRobot,
      count: agentCount > 0 ? agentCount : undefined,
      iconOnly: true,
    },
    { id: 'notes', label: 'Context', icon: faAlignLeft, iconOnly: true },
    {
      id: 'changes',
      label: 'Changes',
      icon: faPencil,
      badge:
        totalAdditions > 0 || totalDeletions > 0
          ? {
              additions: totalAdditions,
              deletions: totalDeletions,
            }
          : undefined,
      iconOnly: true,
    },
    { id: 'files', label: 'Files', icon: faFolderTree, iconOnly: true },
    // { id: 'terminals', label: 'Terminals', icon: faTerminal, iconOnly:true },
    { id: 'browser', label: 'Browser', icon: faGlobe, iconOnly: true },
  ]);

  // Active tab is derived from the transient UI store
  const activeTab: SidebarTabId = $derived(transientUIStore.sidebarActiveTab);

  // Track previous tab for slide direction
  let previousTab: SidebarTabId | null = $state(null);
  let slideDirection: 'left' | 'right' | null = $state(null);
  let previousWorkspaceId: string | null = $state(null);

  // Reset tab animation state when switching workspaces to avoid sidebar flash
  $effect(() => {
    if (previousWorkspaceId !== null && previousWorkspaceId !== workspaceId) {
      previousTab = null;
      slideDirection = null;
    }
    previousWorkspaceId = workspaceId;
  });

  // Determine slide direction when tab changes
  $effect(() => {
    if (previousTab !== null && previousTab !== activeTab) {
      const tabOrder = tabs.map((t) => t.id);
      const prevIndex = tabOrder.indexOf(previousTab);
      const newIndex = tabOrder.indexOf(activeTab);
      slideDirection = newIndex > prevIndex ? 'left' : 'right';
      // Reset after animation
      setTimeout(() => {
        slideDirection = null;
      }, 150);
    }
    previousTab = activeTab;
  });

  let showOnlyChangedFiles = $state(false);
  let fileSearchQuery = $state('');
  let fileSearchInputRef: ReturnType<
    typeof import('$lib/components/ui/input/input.svelte').default
  > | null = $state(null);
  let isSearchInputFocused = $state(false);
  let filesPanelRef: FilesPanel | null = $state(null);
  // Track expand state - updated reactively when tree changes
  let filesExpandedTick = $state(0);

  // Track sidebar width to hide badges when too narrow
  let sidebarElement: HTMLDivElement | null = $state(null);
  let sidebarWidth = $state(300);
  const hideBadges = $derived(sidebarWidth < 320);
  // Always hide labels for now since we have 6 tabs and they don't fit
  const hideLabels = $derived(sidebarWidth < 500);

  // Responsive breakpoints for sidebar content
  const isNarrow = $derived(sidebarWidth < 280);
  const isVeryNarrow = $derived(sidebarWidth < 200);

  onMount(() => {
    if (!sidebarElement) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        sidebarWidth = entry.contentRect.width;
      }
    });
    resizeObserver.observe(sidebarElement);

    // Add keyboard shortcut handler for Cmd+Shift+C to copy workspace path
    // This is handled here (once per sidebar) instead of in OpenComboButton
    // to prevent duplicate toasts when multiple OpenComboButton instances exist
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key === 'c') {
        e.preventDefault();
        // Copy the workspace path to clipboard
        if (workspacePath) {
          navigator.clipboard.writeText(workspacePath);
          // Import toast dynamically to show feedback
          import('$lib/components/ui/toast').then(({ toast }) => {
            toast.success('Path copied to clipboard');
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('keydown', handleKeyDown);
    };
  });
  const hasExpandedDirectories = $derived.by(() => {
    // Reference tick to make this reactive
    void filesExpandedTick;
    return filesPanelRef?.getHasExpandedDirectories() ?? false;
  });

  let previousStreamingState = new Map<string, boolean>();

  // Subscribe to agent service changes to detect when agents change (added, removed, or streaming state)
  let previousAgentCount = 0;
  onMount(() => {
    const unsubscribeAgent = sessionStore.getStore().subscribe(() => {
      const workspaceSessions = agentService.getSessionsForWorkspace(workspaceId);
      let hasRelevantChange = false;

      // Check if agent count changed
      if (workspaceSessions.length !== previousAgentCount) {
        hasRelevantChange = true;
        previousAgentCount = workspaceSessions.length;
      }

      // Only track streaming state for agents in THIS workspace
      // Previously this iterated allSessions, causing cross-workspace
      // streaming changes to trigger unnecessary re-renders.
      for (const session of workspaceSessions) {
        const isRunning = session.isStreaming || session.isResponding || session.isProcessing;
        const wasRunning = previousStreamingState.get(session.id) ?? false;

        if (isRunning !== wasRunning) {
          hasRelevantChange = true;
          previousStreamingState.set(session.id, !!isRunning);
        }
      }

      if (hasRelevantChange) {
        agentStateTick++;
      }
    });

    return () => {
      unsubscribeAgent();
      previousStreamingState.clear();
    };
  });

  function handleTabClick(tabId: string) {
    transientUIStore.setSidebarActiveTab(tabId as SidebarTabId);
  }

  // Handle locate item in sidebar events from panel tab headers
  onMount(() => {
    const handleLocateItem = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const { sidebarTabId, type, noteId, filePath, agentId, terminalId } = detail;

      // Switch to the appropriate sidebar tab
      if (sidebarTabId) {
        transientUIStore.setSidebarActiveTab(sidebarTabId as SidebarTabId);
      }

      // Scroll to the item after a short delay to allow tab switch to complete
      setTimeout(() => {
        let selector: string | null = null;

        switch (type) {
          case 'note':
            if (noteId) selector = `[data-note-id="${noteId}"]`;
            break;
          case 'file':
          case 'diff':
            if (filePath) selector = `[data-file-path="${filePath}"]`;
            break;
          case 'agent':
            if (agentId) selector = `[data-agent-id="${agentId}"]`;
            break;
          case 'terminal':
            if (terminalId) selector = `[data-terminal-id="${terminalId}"]`;
            break;
        }

        if (selector && sidebarElement) {
          const element = sidebarElement.querySelector(selector);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Add a brief highlight effect
            element.classList.add('sidebar-locate-highlight');
            setTimeout(() => {
              element.classList.remove('sidebar-locate-highlight');
            }, 1500);
          }
        }
      }, 100);
    };

    window.addEventListener('sidebar:locate-item', handleLocateItem);
    return () => {
      window.removeEventListener('sidebar:locate-item', handleLocateItem);
    };
  });

  // Refresh unread notes when workspace or notes change
  // NOTE: This is intentional - refreshUnreadNotes is an external call that doesn't reassign local state
  $effect(() => {
    if (workspaceId && notes.length > 0) {
      const trackableNotes = notes.filter((n) => !isSpecNote(n.id as string));
      const notesWithTimestamps = trackableNotes.map((n) => ({
        id: n.id as string,
        updatedAt: n.updatedAt || n.updated_at || n.createdAt || n.created_at || '',
        createdAt: n.createdAt || n.created_at,
      }));
      noteReadTrackingStore.refreshUnreadNotes(workspaceId, notesWithTimestamps);
    }
  });
</script>

<div bind:this={sidebarElement} class={cn('flex flex-col h-full bg-sidebar', className)} aria-label="Workspace sidebar">
  <!-- Spaces Picker at the top -->
  <!-- <div class="shrink-0 pl-18 pt-2">
    <SpacesPicker {workspaceId} />
  </div> -->

  <!-- Fixed Top Section: Layout Controls + Progress Card -->
  <div class="shrink-0 pb-3 {isNarrow ? 'px-2' : 'px-4'}">
    <!-- Panel Layout Controls - positioned in top right corner -->
    <div class="flex justify-end mb-1.5 mt-3">
      <PanelLayoutControls
        layoutRoot={panelLayoutManager.layout.root}
        canGoBack={panelLayoutManager.canGoBack}
        canGoForward={panelLayoutManager.canGoForward}
        {workspaceId}
        onGoBack={() => panelLayoutManager.goBack()}
        onGoForward={() => panelLayoutManager.goForward()}
        onApplyPreset={handleApplyPreset}
      />
    </div>
    <WorkspaceProgressCard {notes} {workspace} {workspaceId} onOpenNote={handleOpenNoteInPanel} />
  </div>

  {#if !isNewWorkspaceSession}
    <!-- Tab Bar -->
    <div class="relative shrink-0 {isNarrow ? 'px-2' : 'px-6.5'}">
      <TabBar {tabs} {activeTab} onTabChange={handleTabClick} {hideBadges} {hideLabels} />
      <div class="absolute inset-0 top-auto border-t border-border"></div>
      <div class="absolute inset-0 -bottom-px top-auto border-t border-background z-30"></div>
    </div>

    <!-- Git Status Bar (commits to push, PRs) -->
    <!-- <SidebarGitStatusBar {workspaceId} /> -->

    <!-- Tab Content -->
    <div class="flex-1 overflow-hidden flex flex-col min-h-0">
      <!-- Top gradient fade (not for changes - AcceptChangesPanel has its own styling) -->
      <div
        class="pointer-events-none shrink-0 h-3 -mb-3 bg-linear-to-b from-sidebar to-transparent z-10 relative"
      ></div>

      <!-- Scrollable content - all panels stay mounted, hidden with CSS for performance -->
      <div
        class="flex-1 overflow-y-auto overflow-x-hidden transition-transform duration-150 ease-out {slideDirection ===
        'left'
          ? 'animate-slide-from-right'
          : slideDirection === 'right'
            ? 'animate-slide-from-left'
            : ''}"
      >
        <div class={cn('pt-3 pb-3 min-h-full flex flex-col', activeTab !== 'notes' && 'hidden')}>
          <!-- Context panel description -->
          {#if !isVeryNarrow}
            <p class="text-xs text-subtle {isNarrow ? 'px-3' : 'px-6'} pb-3 leading-snug">
              Context about the task, shared with all agents in this space.
            </p>
          {/if}
          <NotesPanel
            {notes}
            {workspaceId}
            selectedNoteId={effectiveSelectedNoteId}
            onOpenNote={handleOpenNoteInPanel}
            onOpenAgent={handleOpenAgentInPanel}
            {onReorderNotes}
            {onCreateNote}
            indentSize={isNarrow ? 14 : 22}
          />
        </div>
        <div
          class={cn(
            'pb-3 min-h-full max-h-full flex flex-col',
            activeTab !== 'changes' && 'hidden',
          )}
        >
          <SidebarChangesPanel
            {workspaceId}
            activeFilePath={effectiveActiveFilePath}
            activeFileStaged={effectiveActiveFileStaged}
            isAllChangesViewActive={effectiveIsAllChangesViewActive}
            onOpenChange={(change) => {
              // Dispatch event to properly add to navigation history and open diff view
              window.dispatchEvent(
                new CustomEvent('workspace:open-diff', {
                  detail: {
                    change,
                    filePath: change.relativePath || change.file,
                    changeId: change.id,
                    staged: change.stage === 'staged',
                  },
                }),
              );
            }}
            onOpenFullPanel={handleOpenAcceptChanges}
            onOpenNote={handleOpenNoteInPanel}
            onOpenCodeReview={handleOpenCodeReviewInPanel}
          />
        </div>
        <div class={cn('pt-3 pb-3 min-h-full flex flex-col', activeTab !== 'files' && 'hidden')}>
          <!-- Files panel: description + actions bar on same line -->
          <div class="pb-1.5 relative">
            <div class="{isNarrow ? 'px-3 pr-10' : 'px-6 pr-13'} flex items-start gap-1">
              <!-- Description (fades out when search is expanded, but keeps width) -->
              <p
                class="flex-1 text-xs text-subtle leading-snug transition-opacity duration-150 pr-12 {fileSearchQuery ||
                isSearchInputFocused
                  ? 'opacity-0'
                  : 'opacity-100'} {isVeryNarrow ? 'hidden' : ''}"
              >
                The agents in this space are working off a copy of your files{#if workspacePath}:
                  <FileActionsDropdown
                    filePath={workspacePath}
                    {workspaceId}
                    isDirectory={true}
                    isWorkspaceRoot={true}
                    workspaceFolderPath={workspacePath}
                    variant="ghost"
                    size="xs"
                    label={workspacePath.split(/[/\\]/).pop() || 'repo'}
                    class="inline-flex underline underline-offset-2 decoration-muted-foreground/20 text-subtle -ml-1 font-normal!"
                  />
                {:else}.
                {/if}
              </p>
            </div>
            <!-- Search (expands over text area) -->
            <div
              class="absolute top-0.5 flex items-center transition-all duration-150 ease-out {fileSearchQuery ||
              isSearchInputFocused
                ? (isNarrow ? 'left-3 right-10' : 'left-6 right-14')
                : (isNarrow ? 'left-[calc(100%-4.5rem)] right-10' : 'left-[calc(100%-5.7rem)] right-14')}"
            >
              <Fa
                icon={faSearch}
                class="absolute left-0 w-2.75 h-2.75 text-ghost pointer-events-none"
              />
              <Input
                bind:this={fileSearchInputRef}
                bind:value={fileSearchQuery}
                type="text"
                noFocusStyle
                class="bg-transparent text-ui! border-0 pl-5 empty:cursor-pointer h-5 w-full"
                onfocus={() => (isSearchInputFocused = true)}
                onblur={() => (isSearchInputFocused = false)}
                onkeydown={(e: KeyboardEvent) => filesPanelRef?.handleSearchKeyDown(e)}
              />
              {#if fileSearchQuery}
                <button
                  type="button"
                  class="absolute right-0 p-0.5 text-muted-foreground hover:text-muted-foreground transition-colors cursor-pointer"
                  onclick={() => {
                    fileSearchQuery = '';
                    fileSearchInputRef?.focus();
                  }}
                >
                  <Fa icon={faTimes} class="w-2.5 h-2.5" />
                </button>
              {/if}
            </div>
            <!-- Filter buttons (absolutely positioned on right) -->
            <div class="absolute top-0 {isNarrow ? 'right-3' : 'right-6'} flex items-center">
              <Button
                variant="ghost-light"
                size="icon-xs"
                class="p-1 rounded transition-colors cursor-pointer shrink-0 {showOnlyChangedFiles
                  ? 'text-muted-foreground'
                  : 'text-muted-foreground hover:text-muted-foreground'}"
                tooltip={showOnlyChangedFiles ? 'Show all files' : 'Show only changed files'}
                onclick={() => (showOnlyChangedFiles = !showOnlyChangedFiles)}
              >
                <Fa icon={faPencil} size="xs" />
              </Button>
              <Button
                variant="ghost-light"
                size="icon-xs"
                class="p-1 rounded transition-colors cursor-pointer shrink-0 text-muted-foreground hover:text-muted-foreground"
                tooltip={hasExpandedDirectories ? 'Collapse all folders' : 'Expand all folders'}
                onclick={async () => {
                  if (hasExpandedDirectories) {
                    filesPanelRef?.collapseAll();
                  } else {
                    await filesPanelRef?.expandAll();
                  }
                  // Trigger reactivity update
                  filesExpandedTick++;
                }}
              >
                <Fa icon={hasExpandedDirectories ? faCompressAlt : faExpandAlt} size="xs" />
              </Button>
            </div>
          </div>
          <FilesPanel
            bind:this={filesPanelRef}
            {workspacePath}
            {workspaceId}
            environmentConfig={workspace?.environmentConfig}
            selectedFile={effectiveSelectedFile}
            onOpenFile={handleOpenFileInPanel}
            {onCreateFile}
            {onFileRenamed}
            onSelectAgent={handleOpenAgentInPanel}
            showOnlyChanged={showOnlyChangedFiles}
            searchQuery={fileSearchQuery}
          />
        </div>
        <div class={cn('pt-3 pb-3 min-h-full flex flex-col', activeTab !== 'agents' && 'hidden')}>
          <!-- Agents panel description -->
          {#if !isVeryNarrow}
            <p class="text-xs text-subtle {isNarrow ? 'px-3' : 'px-6'} pb-2 leading-snug">
              {#if isTeamMode}
                A coordinator agent writes a spec and manages the work of different agents.
              {:else}
                Agents working on your task in this space.
              {/if}
            </p>
          {/if}
          <div class="{isNarrow ? 'px-1' : 'px-3'}">
            <WorkspaceAgentsList
              agents={workspaceAgents}
              loading={agentsLoading}
              selectedAgentId={effectiveSelectedAgentId}
              onSelect={({ agentId }) => handleOpenAgentInPanel(agentId)}
              onCreate={onCreateAgent}
            />
          </div>
        </div>
        <div
          class={cn('pt-3 pb-3 min-h-full flex flex-col', activeTab !== 'terminals' && 'hidden')}
        >
          <!-- Terminals panel description -->
          {#if !isVeryNarrow}
            <p class="text-xs text-subtle {isNarrow ? 'px-3' : 'px-6'} pb-2 leading-snug">
              Terminal sessions in this space.
            </p>
          {/if}
          <div class="{isNarrow ? 'px-1' : 'px-3'}">
            <TerminalsList
              terminals={terminals.map((t) => ({
                id: t.id,
                name: t.title || t.name || 'Terminal',
                type: t.type || 'terminal',
                createdAt:
                  typeof t.createdAt === 'string' ? new Date(t.createdAt).getTime() : t.createdAt,
              }))}
              selectedTerminalId={effectiveSelectedTerminalId}
              onOpenTerminal={(terminalId) => handleOpenTerminalInPanel(terminalId)}
              {onCreateTerminal}
            />
          </div>
        </div>
        <div class={cn('pt-3 pb-3 min-h-full flex flex-col', activeTab !== 'browser' && 'hidden')}>
          <!-- Browser panel description -->
          {#if !isVeryNarrow}
            <p class="text-xs text-subtle {isNarrow ? 'px-3' : 'px-6'} pb-2 leading-snug">
              Browse websites and view recent URLs.
            </p>
          {/if}
          <BrowserPanel {workspaceId} onOpenUrl={handleOpenBrowserUrl} />
        </div>
      </div>

      {#if activeTab !== 'changes'}
        <!-- Bottom gradient fade (not for changes) -->
        <div
          class="pointer-events-none shrink-0 h-6 -mt-6 bg-linear-to-t from-sidebar to-transparent z-10 relative"
        ></div>
      {/if}
    </div>
  {/if}
</div>

<style>
  @keyframes slide-from-right {
    from {
      transform: translateX(20px);
      opacity: 0.8;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  @keyframes slide-from-left {
    from {
      transform: translateX(-20px);
      opacity: 0.8;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  :global(.animate-slide-from-right) {
    animation: slide-from-right 150ms ease-out;
  }

  :global(.animate-slide-from-left) {
    animation: slide-from-left 150ms ease-out;
  }

  /* Highlight effect for sidebar:locate-item */
  :global(.sidebar-locate-highlight) {
    animation: sidebar-locate-pulse 1.5s ease-out;
  }

  @keyframes sidebar-locate-pulse {
    0% {
      background-color: hsl(var(--primary) / 0.3);
    }
    100% {
      background-color: transparent;
    }
  }
</style>
