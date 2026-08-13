<script lang="ts">
  import { navigateAfterWorkspaceRemoval } from '$lib/utils/workspace-navigation';
  import './multi-select-sidebar-transitions.css';
  import {
    selectStagedWorkingChanges,
    selectUnstagedWorkingChanges,
  } from '$store/renderer/slices/changes/changes-selectors';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { loadChatTranscript } from '$features/agent/chat-read-service';
  import { selectActiveTab } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import AuggieAvatarWithState from '$features/agent/components/auggie-avatar/AugieAvatarWithState.svelte';
  import { Button } from '$lib/components/ui/button';
  import OpenComboButton from '$features/external-editors/components/OpenComboButton.svelte';
  import { faNote } from '$lib/icons/faNote';

  import {
    markNoteRead,
    refreshUnreadNotes,
  } from '$store/renderer/slices/note-read-tracking/note-read-tracking-slice';
  import { initializeNotes } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
  import {
    selectAllWorkspaceAgents,
    selectIsLoadingAgents,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import {
    selectAgentIsRunning,
    selectAgentSessionStreamingContent,
  } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
  import { cn } from '$lib/utils';
  import { dispatchWindowEvent } from '$lib/utils/window-events';
  import { scrollFade } from '$lib/actions/scroll-fade';

  import { loadWorkspacesRequested } from '$store/renderer/slices/workspace/workspace-slice';
  import { locateItemInSidebarConsumed } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { selectPendingLocateInSidebar } from '$store/renderer/slices/app-layout/app-layout-selectors';
  import {
    faArrowUpRightFromSquare,
    faCompressAlt,
    faExpandAlt,
    faPencil,
    faPlus,
    faTimes,
  } from '@fortawesome/free-solid-svg-icons';

  import { onMount } from 'svelte';
  import { cubicIn, cubicOut } from 'svelte/easing';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import type { TransitionConfig } from 'svelte/transition';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import CreateAgentSection from './CreateAgentSection.svelte';
  import ExpandableFileSearch from './sidebar/ExpandableFileSearch.svelte';
  import {
    FilesPanel,
    SidebarChangesPanel,
    getActivityChatTarget,
    isChildNote,
    isSpecNote,
  } from './sidebar';
  import ActivityLogPreview from './sidebar/ActivityLogPreview.svelte';
  import AddContextSection from './sidebar/AddContextSection.svelte';
  import ContextPanel from './sidebar/ContextPanel.svelte';
  import WorkspaceProgressCard from './sidebar/WorkspaceProgressCard.svelte';
  import SidebarLauncherHoverCard from './sidebar/SidebarLauncherHoverCard.svelte';
  import WorkspaceAgentsList from './WorkspaceAgentsList.svelte';
  import WorkspaceTerminalDock from './WorkspaceTerminalDock.svelte';
  import SidebarBrowserLauncher from './SidebarBrowserLauncher.svelte';
  import { selectEffectiveFileExplorerWorkspacePath } from '$store/renderer/slices/file-explorer/file-explorer-selectors';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    selectAllNotes,
    selectNotesLoading,
  } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import { loadEventsRequested } from '$store/renderer/slices/workspace-events/workspace-events-slice';
  import { selectWorkspaceEvents } from '$store/renderer/slices/workspace-events/workspace-events-selectors';
  import { selectWorkspaceScriptEntries } from '$store/renderer/slices/scripts/scripts-selectors';
  import { openWorkspaceDiff } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import type { WorkspaceEvent } from '$features/events/types';
  import { setMultiSelectSidebarSelectedTabs } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { selectMultiSelectSidebarSelectedTabIds } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { store as appStore } from '$store/renderer/store';
  import type { BuiltinSpecialistId } from '$lib/constants/specialists';
  import {
    deriveAgentLauncherItems,
    getAgentLauncherPreview,
    getNoteLauncherPreview,
  } from './utils/sidebar-launcher-preview';
  import {
    normalizeSelectedTabs,
    TAB_DEFINITIONS,
    type LauncherTabId,
    type TabId,
  } from './multi-select-sidebar-tabs';
  import { normalizeActivityFilePath } from './utils/activity-file-path';
  import { getFixedContainingBlockOffset } from './utils/fixed-containing-block';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';

  interface Props {
    workspaceId: string;
    panelLayoutId?: string;
    onCreateNote?: () => void;
    onCreateFile?: (folderPath: string, fileName?: string) => void | Promise<void>;
    onFileRenamed?: (oldPath: string, newPath: string) => void;
    isNewWorkspaceSession?: boolean;
    onCreateAgent?: () => void;
    onCreateAgentWithSpecialist?: (specialistId: string | null) => void;
    onAcceptChanges?: () => void;
    onCloseWorkspace?: (event: MouseEvent) => void;
    draggableTitleRegion?: boolean;
    class?: string;
  }

  let {
    workspaceId,
    panelLayoutId = workspaceId,
    onCreateNote,
    onCreateFile,
    onFileRenamed,
    isNewWorkspaceSession = false,
    onCreateAgent,
    onCreateAgentWithSpecialist,
    onAcceptChanges,
    onCloseWorkspace,
    draggableTitleRegion = false,
    class: className,
  }: Props = $props();

  // Reactive writable store that mirrors workspaceId so Redux selectors
  // re-evaluate whenever the prop changes (called at component init time).
  // svelte-ignore state_referenced_locally - intentional initial capture; the $effect below syncs later changes
  const workspaceIdStore = writable(workspaceId);
  const LAUNCHER_ICON_LIMIT = 6;
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });
  const fileExplorerWorkspacePath = selectEffectiveFileExplorerWorkspacePath(workspaceIdStore);

  // Transient signal: panel tab "Reveal in Sidebar" → scroll & highlight.
  const pendingLocateInSidebar$ = selectPendingLocateInSidebar();

  const workspace = selectWorkspaceById(workspaceIdStore);
  const notes = selectAllNotes(workspaceIdStore);
  const launcherNotes = $derived(
    $notes.filter((note) => !isChildNote(note, $notes)).slice(0, LAUNCHER_ICON_LIMIT),
  );
  const notesLoading$ = selectNotesLoading(workspaceIdStore);
  const allWorkspaceAgents = selectAllWorkspaceAgents(workspaceIdStore);
  const agentsLoading = selectIsLoadingAgents(workspaceIdStore);
  const launcherAgentState = $derived.by(() =>
    deriveAgentLauncherItems(
      $allWorkspaceAgents,
      LAUNCHER_ICON_LIMIT,
      (agent) => selectAgentIsRunning.select(appStore.state, agent.id),
      (agent, isRunning) =>
        getAgentLauncherPreview(
          agent,
          isRunning ? selectAgentSessionStreamingContent.select(appStore.state, agent.id) : '',
        ),
    ),
  );
  const launcherAgents = $derived(launcherAgentState.launcherAgents);
  const runningLauncherAgents = $derived(launcherAgentState.runningAgents);
  const launcherAgentNames = $derived.by(() =>
    Object.fromEntries(
      $allWorkspaceAgents.flatMap((agent) =>
        agent.id && agent.name ? [[agent.id, agent.name]] : [],
      ),
    ),
  );
  const selectedTabIds = selectMultiSelectSidebarSelectedTabIds(workspaceIdStore);
  const selectedTabs = $derived(normalizeSelectedTabs($selectedTabIds));
  let openLauncherHoverKey = $state<string | null>(null);
  const launcherRects = new Map<LauncherTabId, DOMRect>();
  const expandedCardRects = new Map<LauncherTabId, DOMRect>();

  function handleLauncherHoverOpenChange(key: string, open: boolean) {
    if (open) {
      openLauncherHoverKey = key;
    } else if (openLauncherHoverKey === key) {
      openLauncherHoverKey = null;
    }
  }

  function cardMorph(
    node: HTMLElement,
    { tabId, direction }: { tabId: LauncherTabId; direction: 'expand' | 'collapse' },
  ): TransitionConfig {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return { duration: 0 };

    const mountedLauncherRect =
      direction === 'collapse'
        ? sidebarElement
            ?.querySelector<HTMLElement>(`[data-sidebar-launcher="${tabId}"]`)
            ?.getBoundingClientRect()
        : undefined;
    const launcherRect = mountedLauncherRect ?? launcherRects.get(tabId);
    const cardRect =
      direction === 'collapse'
        ? (expandedCardRects.get(tabId) ?? node.getBoundingClientRect())
        : node.getBoundingClientRect();
    if (!launcherRect || cardRect.width === 0 || cardRect.height === 0) return { duration: 0 };

    const translateX = launcherRect.left - cardRect.left;
    const translateY = launcherRect.top - cardRect.top;
    const scaleX = launcherRect.width / cardRect.width;
    const scaleY = launcherRect.height / cardRect.height;
    const fixedContainingBlockOffset = getFixedContainingBlockOffset(node);
    const fixedLeft = cardRect.left - fixedContainingBlockOffset.x;
    const fixedTop = cardRect.top - fixedContainingBlockOffset.y;

    return {
      duration: 300,
      css: (t) => {
        const shellProgress = direction === 'expand' ? cubicOut(t) : cubicIn(t);
        const shellInverse = 1 - shellProgress;
        const contentProgress = Math.max(0, Math.min(1, (t - 0.72) / 0.28));
        return `position: fixed; left: ${fixedLeft}px; top: ${fixedTop}px; width: ${cardRect.width}px; height: ${cardRect.height}px; transform-origin: top left; transform: translate(${shellInverse * translateX}px, ${shellInverse * translateY}px) scale(${scaleX + shellProgress * (1 - scaleX)}, ${scaleY + shellProgress * (1 - scaleY)}); background-color: color-mix(in srgb, hsl(var(--card)) ${shellInverse * 100}%, hsl(var(--background))); --sidebar-card-content-opacity: ${contentProgress}; --sidebar-card-content-y: ${(1 - contentProgress) * 4}px; will-change: transform;`;
      },
    };
  }

  function launcherGridReveal(_node: Element): TransitionConfig {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return { duration: 0 };

    return {
      delay: 210,
      duration: 90,
      css: (t) => `opacity: ${t};`,
    };
  }

  function persistSelectedTabs(nextSelectedTabs: Set<TabId>) {
    if (!workspaceId) return;
    appStore.dispatch(setMultiSelectSidebarSelectedTabs(workspaceId, [...nextSelectedTabs]));
  }

  function handleTabClick(tabId: TabId) {
    const previousTabId = [...selectedTabs][0] ?? 'overview';
    const nextTabId = previousTabId === tabId ? 'overview' : tabId;
    if (previousTabId === 'overview' && tabId !== 'overview') {
      const launcher = sidebarElement?.querySelector<HTMLElement>(
        `[data-sidebar-launcher="${tabId}"]`,
      );
      if (launcher) launcherRects.set(tabId as LauncherTabId, launcher.getBoundingClientRect());
    } else if (previousTabId !== 'overview' && nextTabId === 'overview') {
      const expandedCard = sidebarElement?.querySelector<HTMLElement>('.sidebar-expanded-card');
      if (expandedCard) {
        expandedCardRects.set(previousTabId as LauncherTabId, expandedCard.getBoundingClientRect());
      }
    }
    persistSelectedTabs(new Set([nextTabId]));
  }

  function isTabSelected(tabId: TabId): boolean {
    return selectedTabs.has(tabId);
  }

  const ftStagedChanges$ = selectStagedWorkingChanges(workspaceIdStore);
  const ftUnstagedChanges$ = selectUnstagedWorkingChanges(workspaceIdStore);
  const panelLayoutManager = $derived(getPanelLayoutManager(panelLayoutId));
  const panelLayoutIdStore = writable(panelLayoutId);
  $effect(() => panelLayoutIdStore.set(panelLayoutId));
  const activeTab$ = selectActiveTab(panelLayoutIdStore);
  const focusedContentType = $derived($activeTab$?.type ?? null);
  const focusedContentNoteId = $derived($activeTab$?.noteId ?? null);
  const focusedContentAgentId = $derived($activeTab$?.agentId ?? null);
  const focusedContentFilePath = $derived($activeTab$?.filePath ?? null);
  const focusedContentDiffPath = $derived($activeTab$?.diffPath ?? null);
  let lastInitializedNotesWorkspaceId: string | null = null;

  $effect(() => {
    if (!workspaceId || lastInitializedNotesWorkspaceId === workspaceId) return;
    lastInitializedNotesWorkspaceId = workspaceId;
    const initialSelectedNoteId = focusedContentType === 'note' ? focusedContentNoteId : undefined;
    appStore.dispatch(initializeNotes(workspaceId, initialSelectedNoteId ?? undefined));
  });

  // Recent activity preview (overview state): fetch the event stream once per
  // workspace; live updates arrive via the daemon-events-bridge `eventReceived`
  // dispatches into the same slice.
  const workspaceEvents$ = selectWorkspaceEvents(workspaceIdStore);
  const workspaceScripts$ = selectWorkspaceScriptEntries(workspaceIdStore);
  const scriptNames = $derived(
    Object.fromEntries($workspaceScripts$.map((script) => [script.id, script.name])),
  );
  let lastLoadedEventsWorkspaceId: string | null = null;
  $effect(() => {
    if (!workspaceId || lastLoadedEventsWorkspaceId === workspaceId) return;
    lastLoadedEventsWorkspaceId = workspaceId;
    appStore.dispatch(loadEventsRequested(workspaceId));
  });

  // Internal state-change events that aren't useful in a compact preview
  // (mirrors SidebarActivityPanel's HIDDEN_EVENT_TYPES, plus typing/telemetry
  // chatter like draft:changed which fires on every chat-input keystroke).
  const HIDDEN_ACTIVITY_EVENT_TYPES = new Set([
    'agent:idle',
    'agent:subscribed',
    'agent:unsubscribed',
    'agent:woken-by-subscription',
    'agent:delivery-confirmed',
    'agent:event-delivery-failed',
    'agent:event-delivery-timeout',
    'agent:subscriptions-restored',
    'agent:subscriptions-changed',
    'agent:session-stats-changed',
    'draft:changed',
    'workspace:tokenUsage-changed',
    'workspace:activity-changed',
    'workspace:attention-changed',
    'changes:git-status',
    'changes:metrics-changed',
    'line-attribution:updated',
    'task:ready-tasks-changed',
    'terminal:data',
    'terminal:cwd',
    'script:output',
    'search:result',
    'search:done',
    'git:clone:progress',
  ]);

  function shouldHideActivityEvent(event: WorkspaceEvent): boolean {
    if (HIDDEN_ACTIVITY_EVENT_TYPES.has(event.type)) return true;
    // Streaming chunks/status, queue/process bookkeeping, host exec output, and
    // app UI-automation pings are machine-level chatter, not user activity.
    if (event.type.startsWith('agent:stream:')) return true;
    if (event.type.startsWith('agent:queue:')) return true;
    if (event.type.startsWith('agent:process:')) return true;
    if (event.type.startsWith('host:exec:')) return true;
    if (event.type.startsWith('app:')) return true;
    // agent:tool:call fires again for every status patch; `tool_call_update`
    // payloads only carry changed fields, so a patch without a title or tool
    // name is a repeat of a call already shown ("Used a tool" noise).
    if (event.type === 'agent:tool:call') {
      const data = event.data as
        { title?: string; toolName?: string; input?: { _acpTitle?: string } } | undefined;
      if (!data?.title && !data?.toolName && !data?.input?._acpTitle) return true;
    }
    // workspace:updated whose delta is only the lastActivity heartbeat.
    if (event.type === 'workspace:updated') {
      const changes = (event.data as { changes?: Record<string, unknown> } | undefined)?.changes;
      if (changes) {
        const fields = Object.keys(changes).filter((key) => key !== 'workspaceId');
        if (fields.length > 0 && fields.every((field) => field === 'lastActivity')) return true;
      }
    }
    return false;
  }

  // Slice buffer is oldest→newest; the preview wants newest-first.
  const recentActivityEvents = $derived(
    [...$workspaceEvents$].reverse().filter((event) => !shouldHideActivityEvent(event)),
  );

  const effectiveSelectedNoteId = $derived(
    focusedContentType === 'note' ? focusedContentNoteId : null,
  );
  const effectiveSelectedAgentId = $derived(
    focusedContentType === 'agent' ? focusedContentAgentId : null,
  );
  const effectiveSelectedFile = $derived(
    focusedContentType === 'file' ? focusedContentFilePath : null,
  );
  const effectiveActiveFilePath = $derived.by(() => {
    if (focusedContentType === 'diff' && focusedContentDiffPath) {
      return focusedContentDiffPath;
    }
    return null;
  });
  const effectiveActiveFileStaged = $derived.by(() => {
    if (focusedContentType === 'diff' && focusedContentDiffPath) {
      const diffPath = focusedContentDiffPath;
      const isInStaged = stagedChanges.some(
        (c) => c.file === diffPath || c.relativePath === diffPath,
      );
      if (isInStaged) return true;
      const isInUnstaged = unstagedChanges.some(
        (c) => c.file === diffPath || c.relativePath === diffPath,
      );
      if (isInUnstaged) return false;
      return null;
    }
    return null;
  });
  const effectiveIsAllChangesViewActive = $derived(focusedContentType === 'local-changes');

  function handleOpenAgentInPanel(agentId: string, event?: WorkspaceEvent) {
    // Activity events can reference agents whose sessions aren't hydrated in
    // the workspace-agents slice (completed/background agents), so the store
    // lookup is only used for the tab title — never as a gate.
    const agent = $allWorkspaceAgents.find((a) => a.id === agentId);
    panelLayoutManager.openTab({
      type: 'agent',
      title: agent?.name || `Agent ${agentId.substring(0, 8)}`,
      closable: true,
      agentId,
      workspaceId,
    });

    if (!event) return;
    const target = getActivityChatTarget(event);
    if (!target.messageId && !target.toolCallId && target.turnNumber === undefined) return;

    for (const delay of [100, 300, 600]) {
      setTimeout(() => {
        dispatchWindowEvent('agent:scroll-to-activity', { agentId, ...target });
      }, delay);
    }
  }

  function handleOpenNoteInPanel(noteId: string) {
    const note = $notes.find((n) => n.id === noteId);
    const title = note?.title || m.workspace_addContext_note_label();
    panelLayoutManager.openTab({
      type: 'note',
      title,
      closable: true,
      noteId,
      workspaceId,
    });

    // Mark note as read when opened to clear unread indicator
    appStore.dispatch(markNoteRead(workspaceId, noteId));
  }

  function handleOpenFileInPanel(filePath: string) {
    const fileName = filePath.split('/').pop() || filePath;
    panelLayoutManager.openTab({
      type: 'file',
      title: fileName,
      closable: true,
      filePath,
      workspaceId,
    });
  }

  // Compact activity rows represent the file itself, so open its scoped file
  // tab rather than routing through the changes/diff surface.
  function handleOpenActivityFileEvent(event: WorkspaceEvent) {
    const data = event.data as Record<string, unknown> | undefined;
    const eventPath = [data?.relativePath, data?.path, data?.filePath, data?.file].find(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    if (!eventPath) return;
    const filePath = normalizeActivityFilePath(eventPath, $workspace);
    if (filePath) handleOpenFileInPanel(filePath);
  }

  function handleOpenCodeReviewInPanel() {
    panelLayoutManager.openTab({
      type: 'code-review',
      title: m.workspace_multiSelectSidebar_codeReview_label(),
      closable: true,
      workspaceId,
    });
  }

  const stagedChanges = $derived($ftStagedChanges$ ?? []);
  const unstagedChanges = $derived($ftUnstagedChanges$ ?? []);
  const launcherChanges = $derived(
    [...stagedChanges, ...unstagedChanges].slice(0, LAUNCHER_ICON_LIMIT),
  );
  const localChangesCount = $derived(
    new Set(
      [...stagedChanges, ...unstagedChanges]
        .map((change) => change.relativePath || change.file)
        .filter(Boolean),
    ).size,
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function handleArchiveWorkspace() {
    if (!$workspace) return;
    const { toast } = await import('svelte-sonner');
    const workspaceTitle = $workspace.title || m.workspace_multiSelectSidebar_space_label();

    const result = await workspaceClient.archive($workspace.id);
    if (result.ok) {
      appStore.dispatch(loadWorkspacesRequested());
      toast.warning(m.workspace_multiSelectSidebar_archivedSpace_toast({ title: workspaceTitle }), {
        duration: 15000,
        action: {
          label: m.workspace_multiSelectSidebar_undo_label(),
          onClick: async () => {
            const undoResult = await workspaceClient.unarchive($workspace.id);
            if (undoResult.ok) {
              appStore.dispatch(loadWorkspacesRequested());
            }
          },
        },
      });
      await navigateAfterWorkspaceRemoval($workspace.id);
    } else {
      toast.error(m.workspace_multiSelectSidebar_archiveFailed_error());
    }
  }

  // File panel state
  let showOnlyChangedFiles = $state(false);
  let fileSearchQuery = $state('');
  let filesPanelRef: FilesPanel | null = $state(null);
  let filesExpandedTick = $state(0);

  const hasExpandedDirectories = $derived.by(() => {
    void filesExpandedTick;
    return filesPanelRef?.getHasExpandedDirectories() ?? false;
  });

  // Sidebar element ref
  let sidebarElement: HTMLDivElement | null = $state(null);

  // Map registry sidebar tab IDs to MultiSelectTabbedSidebar tab IDs
  function mapSidebarTabId(registryTabId: string): TabId | null {
    const mapping: Record<string, TabId> = {
      notes: 'context',
      agents: 'agents',
      files: 'files',
      terminals: 'agents', // terminals don't have their own tab, fall back to agents
      changes: 'changes',
      browser: 'agents',
    };
    return mapping[registryTabId] ?? null;
  }

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key === 'c') {
        e.preventDefault();
        const workspacePath = selectEffectiveFileExplorerWorkspacePath.select(
          appStore.state,
          workspaceId,
        );
        if (workspacePath) {
          navigator.clipboard.writeText(workspacePath);
          import('$lib/components/ui/toast').then(({ toast }) => {
            toast.success(m.ui_openCombo_pathCopied_label());
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  });

  // Handle "Reveal in Sidebar" requests dispatched from panel tab context menus.
  $effect(() => {
    const pending = $pendingLocateInSidebar$;
    if (!pending) return;
    if (pending.workspaceId !== workspaceId) return;

    const { sidebarTabId, type, noteId, filePath, agentId } = pending.target;

    // Switch to the appropriate sidebar tab
    const targetTab = mapSidebarTabId(sidebarTabId);
    if (targetTab) {
      persistSelectedTabs(new Set([targetTab]));
    }

    // Scroll to the item after a short delay to allow tab switch to render
    const timeoutId = setTimeout(() => {
      let selector: string | null = null;

      switch (type) {
        case 'note':
          if (noteId) selector = `[data-note-id="${noteId}"]`;
          break;
        case 'file':
        case 'diff':
          if (filePath) selector = `[data-file-path="${CSS.escape(filePath)}"]`;
          break;
        case 'agent':
          if (agentId) selector = `[data-agent-id="${agentId}"]`;
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
      appStore.dispatch(locateItemInSidebarConsumed(workspaceId));
    }, 150);

    return () => {
      clearTimeout(timeoutId);
    };
  });
  // Refresh unread notes — only dispatch when note data actually changes
  let lastRefreshKey: string | undefined;
  $effect(() => {
    if (workspaceId && $notes.length > 0) {
      const trackableNotes = $notes.filter((n) => !isSpecNote(n.id as string));
      const notesWithTimestamps = trackableNotes.map((n) => ({
        id: n.id as string,
        updatedAt: n.updatedAt || n.updated_at || n.createdAt || n.created_at || '',
        createdAt: n.createdAt || n.created_at,
      }));
      const refreshKey =
        workspaceId + ':' + notesWithTimestamps.map((n) => n.id + ':' + n.updatedAt).join(',');
      if (refreshKey !== lastRefreshKey) {
        lastRefreshKey = refreshKey;
        appStore.dispatch(refreshUnreadNotes(workspaceId, notesWithTimestamps));
      }
    }
  });

  const orderedSelectedTabs = $derived(
    TAB_DEFINITIONS.map((tab) => tab.id as TabId).filter(
      (id) => id !== 'overview' && selectedTabs.has(id),
    ),
  );
  const isLauncherOverview = $derived(isTabSelected('overview'));
</script>

<div bind:this={sidebarElement} class={cn('flex h-full flex-col bg-transparent', className)}>
  <!-- Fixed Top Section: Progress Card -->
  <div class="shrink-0 px-6 pb-2 pt-5" data-workspace-title-region draggable={draggableTitleRegion}>
    <WorkspaceProgressCard {workspaceId} onOpenNote={handleOpenNoteInPanel} {onCloseWorkspace} />
  </div>

  {#if !isNewWorkspaceSession}
    <div
      class={cn(
        'sidebar-stage grid min-h-0 flex-1',
        isLauncherOverview ? 'grid-rows-[minmax(0,1fr)_232px]' : 'grid-rows-[minmax(0,1fr)_0px]',
      )}
      data-sidebar-stage
    >
      <div class="min-h-0 overflow-hidden">
        {#if isLauncherOverview}
          <!-- Latest activity sits above the launcher tiles in the overview state. -->
          <div class="flex h-full min-h-0 flex-col px-2" data-testid="sidebar-activity-preview">
            {#if localChangesCount > 0}
              <div class="shrink-0 px-4 pb-3" data-sidebar-overview-summary>
                <div class="flex flex-col gap-0.5">
                  {#if localChangesCount > 0}
                    <Button
                      variant="plain"
                      class="h-auto w-full justify-between rounded-md border-0! pl-0! pr-2! py-1.5! text-left text-muted-foreground transition-colors hover:text-foreground"
                      onclick={() => handleTabClick('changes')}
                      aria-label={localChangesCount === 1
                        ? m.workspace_multiSelectSidebar_showLocalChanges_one()
                        : m.workspace_multiSelectSidebar_showLocalChanges_many({
                            count: formatInteger(localChangesCount),
                          })}
                      data-sidebar-local-changes-summary
                    >
                      <span class="type-body font-normal">
                        {localChangesCount === 1
                          ? m.workspace_multiSelectSidebar_localChanges_one()
                          : m.workspace_multiSelectSidebar_localChanges_many({
                              count: formatInteger(localChangesCount),
                            })}
                      </span>
                      <Fa icon={faPencil} class="size-3 text-ghost" />
                    </Button>
                  {/if}
                </div>
              </div>
            {/if}
            <ActivityLogPreview
              events={recentActivityEvents}
              {scriptNames}
              agentNames={launcherAgentNames}
              maxItems={3}
              onOpenFileEvent={handleOpenActivityFileEvent}
              onShowAgent={handleOpenAgentInPanel}
              onOpenNote={handleOpenNoteInPanel}
            />
          </div>
        {:else}
          <!-- One expanded tile fills the body beneath the workspace identity. -->
          {@html '<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->'}
          <div
            role="presentation"
            class="flex h-full w-full min-w-0 flex-col overflow-hidden px-4 pb-1 pt-3"
          >
            {#each orderedSelectedTabs as tabId (tabId)}
              {@const tab = TAB_DEFINITIONS.find((t) => t.id === tabId)}
              <div
                class="sidebar-expanded-card relative z-10 flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-background border border-border"
                in:cardMorph|global={{
                  tabId: tabId as LauncherTabId,
                  direction: 'expand',
                }}
                out:cardMorph|global={{
                  tabId: tabId as LauncherTabId,
                  direction: 'collapse',
                }}
              >
                <div
                  class="sidebar-expanded-content flex min-h-0 flex-1 flex-col"
                  data-sidebar-expanded-content
                >
                  <!-- Panel header/description -->
                  {#if tab && !tab.hideHeader}
                    <div class="px-4 pb-1 pt-4">
                      <h6
                        class="text-ui font-semibold text-foreground flex items-center gap-2 mb-0.5"
                      >
                        {tab.label}
                        <span class="ml-auto flex items-center gap-1">
                          {#if tabId === 'agents' && (onCreateAgent || onCreateAgentWithSpecialist)}
                            <CreateAgentSection
                              onCreate={onCreateAgent}
                              onCreateWithSpecialist={onCreateAgentWithSpecialist}
                              compact
                            />
                          {:else if tabId === 'context'}
                            <AddContextSection onAddNote={onCreateNote} compact />
                          {/if}
                          <Tooltip
                            content={m.ui_tab_close_ariaLabel()}
                            side="top"
                            delayDuration={300}
                          >
                            <Button
                              variant="plain"
                              class="flex size-7 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-subtle transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
                              onclick={() => handleTabClick(tab.id)}
                              aria-label={m.ui_tab_close_ariaLabel()}
                              data-sidebar-close
                            >
                              <Fa icon={faTimes} class="size-2.5" />
                            </Button>
                          </Tooltip>
                        </span>
                      </h6>
                      {#if tabId !== 'agents'}
                        <p
                          class="text-ui text-subtle mt-0.5 leading-snug transition-all duration-200"
                        >
                          {#if tabId === 'context' && $workspace?.isRemote}
                            {tab.description}
                            {m.workspace_multiSelectSidebar_notesLiveOn_before()}
                            <span class="font-mono text-subtle"
                              >{$workspace.environmentConfig?.ssh?.host
                                ? `${$workspace.environmentConfig.ssh.host}:`
                                : ''}{$workspace.id}<!-- i18n-ignore (file path) -->/.workspace</span
                            >.
                          {:else if tabId === 'context' && $workspace?.path}
                            {tab.description}
                            {m.workspace_multiSelectSidebar_notesLiveIn_before()}
                            <span class="inline-flex items-baseline gap-1">
                              <OpenComboButton
                                filePath={$workspace.path + '/.workspace'}
                                {workspaceId}
                                isDirectory={true}
                                variant="sidebar"
                                compact
                                class="inline-flex"
                              >
                                <span
                                  class="text-inherit underline underline-offset-2 decoration-muted-foreground/20"
                                  ><!-- i18n-ignore (file path) -->/{$workspace.path
                                    .split(/[/\\]/)
                                    .slice(-1)[0]}/.workspace<!-- i18n-ignore (file path) --></span
                                >
                              </OpenComboButton></span
                            >.
                          {:else if tabId === 'files' && $fileExplorerWorkspacePath}
                            {$workspace?.skipWorktree
                              ? m.workspace_multiSelectSidebar_workingDirectlyIn_before()
                              : m.workspace_multiSelectSidebar_repoCopyLivesIn_before()}
                            <span class="inline-flex items-baseline gap-1">
                              <OpenComboButton
                                filePath={$fileExplorerWorkspacePath}
                                {workspaceId}
                                isDirectory={true}
                                variant="sidebar"
                                compact
                                class="inline-flex"
                              >
                                <span
                                  class="text-inherit underline underline-offset-2 decoration-muted-foreground/20"
                                  >/{$fileExplorerWorkspacePath
                                    .split(/[/\\]/)
                                    .slice(-2)
                                    .join('/')}.</span
                                >
                              </OpenComboButton></span
                            >
                          {:else}
                            {tab.description}
                          {/if}
                        </p>
                      {/if}
                    </div>
                  {/if}
                  <!-- Panel content -->
                  <!-- {#key workspaceId} forces remount of agent-related panels on workspace switch,
                 ensuring onMount stream listeners and subscriptions rebind correctly -->
                  {#key workspaceId}
                    <div
                      class="min-h-0 flex-1 pt-2 {tabId === 'files'
                        ? 'overflow-hidden pb-0'
                        : 'overflow-y-auto pb-6'}"
                      use:scrollFade
                    >
                      {#if tabId === 'agents'}
                        <div class="px-4 transition-all duration-200" data-testid="agent-panel">
                          <WorkspaceAgentsList
                            agents={$allWorkspaceAgents}
                            loading={$agentsLoading}
                            runningAgentIds={runningLauncherAgents.map((agent) => agent.id)}
                            selectedAgentId={effectiveSelectedAgentId}
                            onSelect={({ agentId }) => handleOpenAgentInPanel(agentId)}
                          />
                        </div>
                      {:else if tabId === 'context'}
                        <div class="px-4 transition-all duration-200">
                          <ContextPanel
                            notes={$notes}
                            {workspaceId}
                            selectedNoteId={effectiveSelectedNoteId}
                            onOpenNote={handleOpenNoteInPanel}
                            onOpenAgent={handleOpenAgentInPanel}
                            {onCreateNote}
                            loading={$notesLoading$}
                            showAddSection={false}
                          />
                        </div>
                      {:else if tabId === 'changes'}
                        <div class="flex h-full flex-1 flex-col px-4 transition-all duration-200">
                          <div class="w-full flex-1">
                            <SidebarChangesPanel
                              {workspaceId}
                              activeFilePath={effectiveActiveFilePath}
                              activeFileStaged={effectiveActiveFileStaged}
                              isAllChangesViewActive={effectiveIsAllChangesViewActive}
                              onOpenChange={(change) => {
                                appStore.dispatch(
                                  openWorkspaceDiff(workspaceId, change as never, {
                                    filePath: change.relativePath || change.file,
                                    changeId: change.id,
                                  }),
                                );
                              }}
                              onOpenFullPanel={onAcceptChanges}
                              onOpenNote={handleOpenNoteInPanel}
                              onOpenCodeReview={handleOpenCodeReviewInPanel}
                            />
                          </div>
                        </div>
                      {:else if tabId === 'files'}
                        <div class="flex h-full min-h-0 flex-col px-4 transition-all duration-200">
                          <!-- File filter controls -->
                          <div class="flex shrink-0 items-center gap-2 pb-2" data-file-tree-toolbar>
                            <ExpandableFileSearch
                              bind:query={fileSearchQuery}
                              onKeydown={(event) => filesPanelRef?.handleSearchKeyDown(event)}
                            />
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              class="shrink-0 text-subtle"
                              tooltip={m.workspace_multiSelectSidebar_newFile_tooltip()}
                              onclick={() => filesPanelRef?.startCreatingFile()}
                            >
                              <Fa icon={faPlus} class="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              class="shrink-0 {showOnlyChangedFiles
                                ? 'text-primary'
                                : 'text-subtle'}"
                              tooltip={showOnlyChangedFiles
                                ? m.workspace_multiSelectSidebar_showAllFiles_tooltip()
                                : m.workspace_multiSelectSidebar_showOnlyChangedFiles_tooltip()}
                              onclick={() => (showOnlyChangedFiles = !showOnlyChangedFiles)}
                            >
                              <Fa icon={faPencil} class="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              class="shrink-0 text-subtle"
                              tooltip={hasExpandedDirectories
                                ? m.workspace_multiSelectSidebar_collapseAll_tooltip()
                                : m.workspace_multiSelectSidebar_expandAll_tooltip()}
                              onclick={async () => {
                                if (hasExpandedDirectories) {
                                  filesPanelRef?.collapseAll();
                                } else {
                                  await filesPanelRef?.expandAll();
                                }
                                filesExpandedTick++;
                              }}
                            >
                              <Fa
                                icon={hasExpandedDirectories ? faCompressAlt : faExpandAlt}
                                class="w-3 h-3"
                              />
                            </Button>
                          </div>
                          <FilesPanel
                            bind:this={filesPanelRef}
                            {workspaceId}
                            selectedFile={effectiveSelectedFile}
                            onOpenFile={handleOpenFileInPanel}
                            {onCreateFile}
                            {onFileRenamed}
                            onSelectAgent={handleOpenAgentInPanel}
                            showOnlyChanged={showOnlyChangedFiles}
                            searchQuery={fileSearchQuery}
                          />
                        </div>
                      {/if}
                    </div>
                  {/key}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      {#if isLauncherOverview}
        <!-- Lightweight launchers disappear while a section is expanded. -->
        <div
          class="flex h-full min-h-0 items-end px-6 pt-4"
          data-testid="sidebar-launchers"
          data-launcher-layout="tiles"
          in:launcherGridReveal|global
        >
          <div class="grid h-56 w-full auto-rows-fr grid-cols-2 gap-3">
            {#each TAB_DEFINITIONS.filter((definition) => definition.id !== 'overview') as tab (tab.id)}
              <div
                class="group/launcher relative flex h-full min-h-0 w-full min-w-0 cursor-pointer overflow-hidden rounded-lg bg-card border border-border p-3 text-foreground transition-colors"
                data-sidebar-launcher={tab.id}
              >
                <Button
                  variant="plain"
                  class="absolute inset-0 z-0 h-auto cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
                  onclick={() => handleTabClick(tab.id)}
                  data-testid={tab.id === 'agents' ? 'agent-panel-toggle' : undefined}
                  aria-expanded="false"
                  aria-label={m.ui_vscodePanel_expand_ariaLabel()}
                ></Button>
                <div
                  class="pointer-events-none relative z-10 flex h-full min-h-0 w-full min-w-0 flex-col justify-between"
                >
                  <div
                    class="grid min-h-7 min-w-0 grid-cols-[repeat(3,1.75rem)] gap-0 text-muted-foreground"
                    data-sidebar-launcher-icons
                  >
                    {#if tab.id === 'agents'}
                      {#each launcherAgents as { agent, isRunning, preview } (agent.id)}
                        <SidebarLauncherHoverCard
                          title={agent.name ||
                            `${m.workspace_fileChanges_agent_label()} ${agent.id.slice(0, 8)}`}
                          status={isRunning ? m.chat_backgroundHooks_running_label() : undefined}
                          rows={[
                            {
                              label: m.chat_agentThread_you_label(),
                              text: preview.lastUserMessage,
                            },
                            {
                              label: m.workspace_fileChanges_agent_label(),
                              text: preview.response,
                            },
                          ]}
                          emptyText={m.layout_sidebarNav_noMessages_label()}
                          kind="agent"
                          open={openLauncherHoverKey === `agent:${agent.id}`}
                          onOpenChange={(open) => {
                            handleLauncherHoverOpenChange(`agent:${agent.id}`, open);
                            if (open && agent.messages.length === 0)
                              void loadChatTranscript(agent.id);
                          }}
                        >
                          <Button
                            variant="plain"
                            class="pointer-events-auto flex size-5 cursor-pointer items-center justify-center rounded-sm transition-colors hover:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                            onclick={() => handleOpenAgentInPanel(agent.id)}
                            aria-label={agent.name || m.workspace_fileChanges_agent_label()}
                            data-sidebar-agent={agent.id}
                            data-sidebar-agent-state={isRunning ? 'running' : 'idle'}
                          >
                            <AuggieAvatarWithState
                              agentId={agent.id}
                              specialist={agent.metadata?.specialist as
                                BuiltinSpecialistId | undefined}
                              size={18}
                              state={isRunning ? 'running' : 'idle'}
                            />
                          </Button>
                        </SidebarLauncherHoverCard>
                      {/each}
                    {:else if tab.id === 'context'}
                      {#each launcherNotes as note (note.id)}
                        <SidebarLauncherHoverCard
                          title={note.title || m.chat_mentions_untitledNote_label()}
                          rows={[{ text: getNoteLauncherPreview(note) }]}
                          emptyText="Empty note"
                          kind="note"
                          open={openLauncherHoverKey === `note:${note.id}`}
                          onOpenChange={(open) =>
                            handleLauncherHoverOpenChange(`note:${note.id}`, open)}
                        >
                          <Button
                            variant="plain"
                            class="pointer-events-auto flex size-5 cursor-pointer items-center justify-center rounded-sm transition-colors hover:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                            onclick={() => handleOpenNoteInPanel(note.id as string)}
                            aria-label={note.title || m.chat_mentions_untitledNote_label()}
                            data-sidebar-context={note.id}
                          >
                            <Fa icon={faNote} class="size-3" />
                          </Button>
                        </SidebarLauncherHoverCard>
                      {/each}
                    {:else if tab.id === 'changes'}
                      {#each launcherChanges as change (change.id)}
                        {@const changePath = change.relativePath || change.file}
                        <Tooltip content={changePath} side="top" delayDuration={200}>
                          <Button
                            variant="plain"
                            class="pointer-events-auto flex size-7 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                            onclick={() => {
                              appStore.dispatch(
                                openWorkspaceDiff(workspaceId, change as never, {
                                  filePath: changePath,
                                  changeId: change.id,
                                }),
                              );
                            }}
                            aria-label={m.fileTracking_fileRow_openFile_label()}
                            data-sidebar-change={changePath}
                          >
                            <Fa icon={faNote} class="size-3" />
                          </Button>
                        </Tooltip>
                      {/each}
                    {/if}
                  </div>
                  <div class="flex min-w-0 items-end justify-between gap-2">
                    <span class="truncate text-sm font-medium">{tab.label}</span>
                    {#if tab.id === 'changes' && localChangesCount > 0}
                      <span class="type-caption text-muted-foreground" data-sidebar-changes-sync
                        >{m.workspace_multiSelectSidebar_sync_label()}</span
                      >
                    {:else if tab.id === 'files' && $fileExplorerWorkspacePath}
                      <OpenComboButton
                        filePath={$fileExplorerWorkspacePath}
                        {workspaceId}
                        isDirectory={true}
                        side="top"
                        variant="sidebar"
                        class="pointer-events-auto relative z-20"
                      >
                        <span
                          class="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
                          data-files-open-in
                        >
                          <Fa icon={faArrowUpRightFromSquare} class="size-2.5" />
                          <span class="sr-only">{m.ui_openCombo_openInApp_tooltip()}</span>
                        </span>
                      </OpenComboButton>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}
  <!-- Persistent bottom row: Browser + Terminals stay visible in every state. -->
  <div
    class={cn(
      'grid w-full shrink-0 gap-3 pb-3 transition-all duration-500',
      isNewWorkspaceSession ? 'grid-cols-1' : 'grid-cols-2',
      isLauncherOverview ? 'px-6 pt-3' : 'px-4 pt-2',
    )}
  >
    {#if !isNewWorkspaceSession}
      <SidebarBrowserLauncher {workspaceId} {panelLayoutId} />
    {/if}
    <WorkspaceTerminalDock {workspaceId} />
  </div>
</div>
