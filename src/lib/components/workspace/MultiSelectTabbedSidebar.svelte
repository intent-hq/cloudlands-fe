<script lang="ts">
  /* eslint-disable max-lines -- splitting this workspace sidebar is outside launcher-only scope */
  import { navigateAfterWorkspaceRemoval } from '$lib/utils/workspace-navigation';
  import { isCmdClickModifier } from '$shared/utils/link-helpers';
  import type { AgentSession } from '$shared/types';
  import './multi-select-sidebar-transitions.css';
  import {
    selectStagedWorkingChanges,
    selectUnstagedWorkingChanges,
  } from '$store/renderer/slices/changes/changes-selectors';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { loadChatTranscript } from '$features/agent/chat-read-service';
  import {
    selectActiveTab,
    selectAllTabs,
    selectFocusedPanelId,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import AgentAvatarStack, {
    type AgentAvatarStackItem,
  } from '$features/agent/components/agent-avatar/AgentAvatarStack.svelte';
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import {
    getAvatarStateForSession,
    type AvatarState,
  } from '$features/agent/components/agent-avatar/avatar-state';
  import { getAgentAvatarStateLabel } from '$features/agent/components/agent-avatar/avatar-state-label';
  import { Button } from '$lib/components/ui/button';
  import { withToastCountdown } from '$lib/components/ui/toast';
  import OpenComboButton from '$features/external-editors/components/OpenComboButton.svelte';
  import ResourceIconTile from '$lib/components/shared/ResourceIconTile.svelte';

  import {
    markNoteRead,
    refreshUnreadNotes,
  } from '$store/renderer/slices/note-read-tracking/note-read-tracking-slice';
  import {
    fetchRetiredAgentsRequested,
    restoreRetiredAgentRequested,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import {
    selectAllWorkspaceAgents,
    selectIsLoadingAgents,
    selectIsLoadingRetiredAgents,
    selectRetiredAgentsLoaded,
    selectRetiredCount,
    selectWorkspaceHasUnreadForegroundAgents,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { selectAgentIsRunning } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
  import { cn } from '$lib/utils';
  import { scrollFade } from '$lib/actions/scroll-fade';
  import { scheduleLayoutRead } from '$lib/utils/layout-phases';

  import { loadWorkspacesRequested } from '$store/renderer/slices/workspace/workspace-slice';
  import {
    locateItemInSidebarConsumed,
    openAgentTabRequested,
  } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { selectPendingLocateInSidebar } from '$store/renderer/slices/app-layout/app-layout-selectors';
  import {
    faArrowUpRightFromSquare,
    faCompressAlt,
    faExpandAlt,
    faPencil,
    faPlus,
  } from '@fortawesome/free-solid-svg-icons';
  import { buildWorkspacePRPresentationModel } from './sidebar/workspace-pr-presentation';
  import { constructPrUrl } from './sidebar/sidebar-changes-utils';
  import { selectPrMonitors } from '$store/renderer/slices/pr-monitor/pr-monitor-selectors';

  import { onDestroy, onMount, tick } from 'svelte';
  import { cubicIn, cubicOut } from 'svelte/easing';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import type { TransitionConfig } from 'svelte/transition';
  import CreateAgentSection from './CreateAgentSection.svelte';
  import ExpandableFileSearch from './sidebar/ExpandableFileSearch.svelte';
  import { FilesPanel, SidebarChangesPanel, isChildNote, isSpecNote } from './sidebar';
  import AddContextSection from './sidebar/AddContextSection.svelte';
  import ContextPanel from './sidebar/ContextPanel.svelte';
  import SidebarExpandableSearch from './sidebar/SidebarExpandableSearch.svelte';
  import SidebarHeaderAction from './sidebar/SidebarHeaderAction.svelte';
  import WorkspaceProgressCard from './sidebar/WorkspaceProgressCard.svelte';
  import SidebarLauncherHoverCard from './sidebar/SidebarLauncherHoverCard.svelte';
  import SidebarPrDropdown from './sidebar/SidebarPrDropdown.svelte';
  import WorkspaceAgentsList from './WorkspaceAgentsList.svelte';
  import WorkspaceTerminalDock from './WorkspaceTerminalDock.svelte';
  import WorkspaceShellList from './WorkspaceShellList.svelte';
  import SidebarExpandedTabStrip from './SidebarExpandedTabStrip.svelte';
  import SidebarBrowserLauncher from './SidebarBrowserLauncher.svelte';
  import SidebarBrowserList from './SidebarBrowserList.svelte';
  import { selectEffectiveFileExplorerWorkspacePath } from '$store/renderer/slices/file-explorer/file-explorer-selectors';
  import {
    selectWorkspaceActivePullRequest,
    selectWorkspaceById,
  } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    selectAllNotes,
    selectNotesLoading,
  } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import { openWorkspaceDiff } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { openTerminalOverlay } from '$store/renderer/slices/terminals/terminals-slice';
  import { setMultiSelectSidebarSelectedTabs } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { selectMultiSelectSidebarSelectedTabIds } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectHudAgentHasPendingQuestion,
    selectHudQuestionsByAgentId,
  } from '$store/renderer/slices/hud/hud-selectors';
  import { deriveWizardPendingQuestions } from '$lib/components/chat/questions/wizard-gate';
  import {
    deriveAgentLauncherItems,
    deriveNoteLauncherItems,
    getAgentLauncherPreview,
    getAgentLauncherStatusPriority,
    getLauncherPreviewLimit,
    getNoteLauncherPreview,
  } from './utils/sidebar-launcher-preview';
  import {
    LAUNCHER_GRID_POSITIONS,
    normalizeSelectedTabs,
    TAB_DEFINITIONS,
    type LauncherTabId,
    type TabId,
  } from './multi-select-sidebar-tabs';
  import { getFixedContainingBlockOffset } from './utils/fixed-containing-block';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';

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
    class: className,
  }: Props = $props();

  // Reactive writable store that mirrors workspaceId so Redux selectors
  // re-evaluate whenever the prop changes (called at component init time).
  // svelte-ignore state_referenced_locally - intentional initial capture; the $effect.pre below syncs later changes
  const workspaceIdStore = writable(workspaceId);
  const LAUNCHER_ICON_LIMIT = 6;
  const LAUNCHER_TARGET_SIZE = 36;
  const LAUNCHER_VISIBLE_SIZE = 20;
  const LAUNCHER_STEP_SIZE = 15;
  const LAUNCHER_VISIBLE_OFFSET = (LAUNCHER_TARGET_SIZE - LAUNCHER_VISIBLE_SIZE) / 2;
  let launcherIconLimit = $state(LAUNCHER_ICON_LIMIT);
  const LAUNCHER_ICON_STACK_CLASS =
    'isolate grid h-9 w-full min-w-0 grid-flow-col items-start overflow-visible text-muted-foreground';
  const LAUNCHER_ICON_BUTTON_CLASS =
    'launcher-icon-button group/preview pointer-events-auto relative flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-sm outline-none transition-colors hover:z-20 hover:text-foreground focus-visible:z-30 focus-visible:text-foreground';
  const LAUNCHER_GLYPH_CLASS = 'launcher-glyph relative flex size-5 items-center justify-center';
  const LAUNCHER_OVERFLOW_BUTTON_CLASS =
    // i18n-ignore (Tailwind utility classes)
    'launcher-overflow-button pointer-events-auto relative z-10 flex h-5 min-w-5 w-auto shrink-0 cursor-pointer items-center justify-center rounded-md! border-0! bg-muted! px-1.5! text-xs font-medium leading-3 whitespace-nowrap text-muted-foreground shadow-none! outline-none transition-colors hover:z-20 hover:bg-muted/80! hover:text-foreground focus-visible:z-30 focus-visible:text-foreground';
  const LAUNCHER_OVERFLOW_STYLE =
    'min-width: 20px; line-height: 12px; font-weight: 500; border-radius: 6px; padding: 0 6px; background: hsl(var(--muted)); box-shadow: none;';
  $effect.pre(() => {
    workspaceIdStore.set(workspaceId);
  });
  const fileExplorerWorkspacePath = selectEffectiveFileExplorerWorkspacePath(workspaceIdStore);

  // Transient signal: panel tab "Reveal in Sidebar" → scroll & highlight.
  const pendingLocateInSidebar$ = selectPendingLocateInSidebar();

  const workspace = selectWorkspaceById(workspaceIdStore);
  const activePullRequest$ = selectWorkspaceActivePullRequest(workspaceIdStore);
  const prMonitors$ = selectPrMonitors(workspaceIdStore);
  // Every PR attributable to the workspace (branch PRs, cross-repo entries,
  // agent PR monitors), deduplicated and ordered by status priority.
  const workspacePrRows = $derived.by(() => {
    const ws = $workspace;
    if (!ws) return [];
    const workspaceRepo =
      ws.repositoryOwner && ws.repositoryName
        ? `${ws.repositoryOwner}/${ws.repositoryName}`
        : undefined;
    return buildWorkspacePRPresentationModel({
      workspacePRs: ws.pullRequests,
      activePR: $activePullRequest$ ?? ws.activePullRequest,
      monitors: $prMonitors$,
      workspaceRepo,
      buildPrUrl: (prNumber, fallbackUrl) =>
        constructPrUrl(prNumber, ws.repositoryOwner, ws.repositoryName, fallbackUrl),
      getDisplayTitle: (pr) => pr.title,
    });
  });
  const notes = selectAllNotes(workspaceIdStore);
  const launcherNoteState = $derived(
    deriveNoteLauncherItems(
      $notes,
      launcherIconLimit,
      (note, allNotes) => !isChildNote(note, allNotes),
    ),
  );
  const launcherNotes = $derived(launcherNoteState.launcherNotes);
  const launcherHasSpecNote = $derived(launcherNotes.some((note) => isSpecNote(note.id as string)));
  const launcherNoteOverflowCount = $derived(launcherNoteState.overflowCount);
  const launcherNoteOverflowLabel = $derived(
    m.lib_commandPalette_showMoreNotes_label({
      count: formatInteger(launcherNoteOverflowCount),
    }),
  );
  const notesLoading$ = selectNotesLoading(workspaceIdStore);
  const allWorkspaceAgents = selectAllWorkspaceAgents(workspaceIdStore);
  const agentsLoading = selectIsLoadingAgents(workspaceIdStore);
  const retiredCount$ = selectRetiredCount(workspaceIdStore);
  const retiredAgentsLoaded$ = selectRetiredAgentsLoaded(workspaceIdStore);
  const loadingRetired$ = selectIsLoadingRetiredAgents(workspaceIdStore);
  const hasUnreadForegroundAgents$ = selectWorkspaceHasUnreadForegroundAgents(workspaceIdStore);
  const hudQuestionsByAgentId$ = selectHudQuestionsByAgentId();

  function getLauncherAvatarState(agent: AgentSession): AvatarState {
    // Keep the derived reactive to capture-only question updates even before a
    // transcript is hydrated into the workspace-agent session.
    void $hudQuestionsByAgentId$;
    const hasQuestion =
      selectHudAgentHasPendingQuestion.select(appStore.state, agent.id) ||
      deriveWizardPendingQuestions(appStore.state, agent.id, agent.messages) !== null;
    return getAvatarStateForSession(agent, { hasQuestion });
  }

  function getLauncherStatusTone(state: AvatarState): 'success' | 'warning' | 'danger' | 'muted' {
    if (state === 'failed') return 'danger';
    if (
      state === 'question' ||
      state === 'needs-permission' ||
      state === 'attention-blocker' ||
      state === 'attention-discussion'
    ) {
      return 'warning';
    }
    if (state === 'running' || state === 'responding') return 'success';
    return 'muted';
  }

  const launcherAgentState = $derived.by(() =>
    deriveAgentLauncherItems(
      $allWorkspaceAgents,
      $allWorkspaceAgents.length,
      (agent) => selectAgentIsRunning.select(appStore.state, agent.id),
      (agent) => getAgentLauncherPreview(agent),
      (agent) =>
        Math.max(
          getAgentLauncherStatusPriority(getLauncherAvatarState(agent)),
          Number(selectAgentIsRunning.select(appStore.state, agent.id)),
        ),
    ),
  );
  const launcherAgents = $derived(launcherAgentState.launcherAgents);
  const launcherAgentStackItems = $derived(
    launcherAgents.map(({ agent }): AgentAvatarStackItem => ({
      key: agent.id,
      agentId: agent.id,
      specialist: agent.metadata?.specialist || agent.agentMetadata?.specialist || null,
      state: getLauncherAvatarState(agent),
    })),
  );
  const runningLauncherAgents = $derived(launcherAgentState.runningAgents);
  const launcherAgentTotal = $derived(launcherAgentState.totalAgents);
  const launcherAgentCountLabel = $derived(
    m.workspace_multiSelectSidebar_agentsLauncherCount_ariaLabel({
      count: formatInteger(launcherAgentTotal),
    }),
  );

  function isAgentLauncherTab(tabId: string): boolean {
    return tabId === 'agents';
  }

  function launcherItemCount(tabId: string): number {
    if (tabId === 'context') {
      return launcherNotes.length + (launcherNoteOverflowCount > 0 ? 1 : 0);
    }
    return 1;
  }

  function launcherGridTemplateColumns(tabId: string): string {
    const itemCount = launcherItemCount(tabId);
    const hasOverflow = tabId === 'context' && launcherNoteOverflowCount > 0;
    if (tabId === 'context' && launcherHasSpecNote) {
      const additionalNoteCount = launcherNotes.length - 1;
      const columns = ['max-content'];
      if (additionalNoteCount > 0) {
        if (additionalNoteCount > 1) {
          columns.push(`repeat(${additionalNoteCount - 1}, ${LAUNCHER_STEP_SIZE}px)`);
        }
        columns.push(`${hasOverflow ? LAUNCHER_TARGET_SIZE : LAUNCHER_VISIBLE_SIZE}px`);
      }
      if (hasOverflow) columns.push('max-content');
      return columns.join(' ');
    }
    if (hasOverflow) {
      return itemCount > 2
        ? `repeat(${itemCount - 2}, ${LAUNCHER_STEP_SIZE}px) ${LAUNCHER_VISIBLE_OFFSET + LAUNCHER_STEP_SIZE}px max-content`
        : `${LAUNCHER_VISIBLE_OFFSET + LAUNCHER_STEP_SIZE}px max-content`;
    }
    return itemCount > 1
      ? `repeat(${itemCount - 1}, ${LAUNCHER_STEP_SIZE}px) ${LAUNCHER_VISIBLE_SIZE}px`
      : `${LAUNCHER_VISIBLE_SIZE}px`;
  }
  const selectedTabIds = selectMultiSelectSidebarSelectedTabIds(workspaceIdStore);
  const selectedTabs = $derived(normalizeSelectedTabs($selectedTabIds));
  let agentSearchQuery = $state('');
  let contextSearchQuery = $state('');
  const expandedStripTabs = $derived(
    TAB_DEFINITIONS.filter((definition) => definition.id !== 'overview').map(
      ({ id, label, icon }) => ({
        id,
        label,
        icon,
        unread: id === 'agents' && $hasUnreadForegroundAgents$,
        unreadLabel:
          id === 'agents'
            ? m.workspace_multiSelectSidebar_agentsTabUnread_ariaLabel({ label })
            : undefined,
      }),
    ),
  );
  let sidebarTabSwitchDirection = $state<'left' | 'right' | 'none'>('none');
  let openLauncherHoverKey = $state<string | null>(null);
  const LAUNCHER_HOVER_INITIAL_DELAY_MS = 400;
  const LAUNCHER_HOVER_SESSION_RESET_DELAY_MS = 300;
  let launcherHoverSessionActive = $state(false);
  let launcherHoverSessionResetTimer: ReturnType<typeof setTimeout> | null = null;
  const launcherHoverDelay = $derived(
    launcherHoverSessionActive ? 0 : LAUNCHER_HOVER_INITIAL_DELAY_MS,
  );
  const launcherRects = new Map<LauncherTabId, DOMRect>();
  const expandedCardRects = new Map<LauncherTabId, DOMRect>();
  // svelte-ignore state_referenced_locally - intentional initial capture for change detection
  let motionWorkspaceId = workspaceId;

  $effect.pre(() => {
    if (motionWorkspaceId === workspaceId) return;
    motionWorkspaceId = workspaceId;
    sidebarTabSwitchDirection = 'none';
    launcherRects.clear();
    expandedCardRects.clear();
  });

  function handleLauncherHoverOpenChange(key: string, open: boolean) {
    if (open) {
      clearLauncherHoverSessionResetTimer();
      launcherHoverSessionActive = true;
      openLauncherHoverKey = key;
    } else if (openLauncherHoverKey === key) {
      openLauncherHoverKey = null;
      clearLauncherHoverSessionResetTimer();
      launcherHoverSessionResetTimer = setTimeout(() => {
        launcherHoverSessionResetTimer = null;
        launcherHoverSessionActive = false;
      }, LAUNCHER_HOVER_SESSION_RESET_DELAY_MS);
    }
  }

  function clearLauncherHoverSessionResetTimer() {
    if (launcherHoverSessionResetTimer === null) return;
    clearTimeout(launcherHoverSessionResetTimer);
    launcherHoverSessionResetTimer = null;
  }

  onDestroy(clearLauncherHoverSessionResetTimer);

  function cardMorph(
    node: HTMLElement,
    {
      tabId,
      direction,
      cardWorkspaceId,
    }: {
      tabId: LauncherTabId;
      direction: 'expand' | 'collapse';
      cardWorkspaceId: string;
    },
  ): TransitionConfig {
    if (cardWorkspaceId !== workspaceId) return { duration: 0 };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return { duration: 0 };

    if (sidebarTabSwitchDirection !== 'none') {
      const incomingOffset = sidebarTabSwitchDirection === 'right' ? 24 : -24;
      const offset = direction === 'expand' ? incomingOffset : -incomingOffset;
      return {
        duration: 180,
        easing: cubicOut,
        css: (t, u) =>
          `opacity: ${t}; transform: translateX(${u * offset}px); will-change: opacity, transform;`,
      };
    }

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
        return `position: fixed; left: ${fixedLeft}px; top: ${fixedTop}px; width: ${cardRect.width}px; height: ${cardRect.height}px; transform-origin: top left; transform: translate(${shellInverse * translateX}px, ${shellInverse * translateY}px) scale(${scaleX + shellProgress * (1 - scaleX)}, ${scaleY + shellProgress * (1 - scaleY)}); background-color: hsl(var(--sidebar)); --sidebar-card-content-opacity: ${contentProgress}; --sidebar-card-content-y: ${(1 - contentProgress) * 4}px; will-change: transform;`;
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
    if (previousTabId !== 'overview' && nextTabId !== 'overview') {
      const tabOrder = TAB_DEFINITIONS.map(({ id }) => id).filter((id) => id !== 'overview');
      sidebarTabSwitchDirection =
        tabOrder.indexOf(nextTabId) > tabOrder.indexOf(previousTabId) ? 'right' : 'left';
    } else {
      sidebarTabSwitchDirection = 'none';
    }
    if (previousTabId === 'agents' && nextTabId !== 'agents') agentSearchQuery = '';
    if (previousTabId === 'context' && nextTabId !== 'context') contextSearchQuery = '';
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

  function createBrowser() {
    panelLayoutManager.openBrowserPanel();
  }

  function createTerminal() {
    appStore.dispatch(openTerminalOverlay(workspaceId));
  }

  let pendingLauncherFocusTabId = $state<LauncherTabId | null>(null);

  function dismissExpandedCard(restoreLauncherFocus: boolean) {
    const expandedTabId = [...selectedTabs].find((tabId) => tabId !== 'overview') as
      LauncherTabId | undefined;
    if (!expandedTabId) return;
    pendingLauncherFocusTabId = restoreLauncherFocus ? expandedTabId : null;
    handleTabClick(expandedTabId);
  }

  function handleExpandedOverlayClick(event: MouseEvent) {
    if ((event.target as Element).closest('.sidebar-expanded-card')) return;
    dismissExpandedCard(false);
  }

  function handleExpandedFooterClick(event: MouseEvent) {
    if (event.target instanceof Element && event.target.closest('[data-sidebar-tab-strip]')) return;
    dismissExpandedCard(false);
  }

  function isTabSelected(tabId: TabId): boolean {
    return selectedTabs.has(tabId);
  }

  const stagedChanges$ = selectStagedWorkingChanges(workspaceIdStore);
  const unstagedChanges$ = selectUnstagedWorkingChanges(workspaceIdStore);
  const panelLayoutManager = $derived(getPanelLayoutManager(panelLayoutId));
  const panelLayoutIdStore = writable(panelLayoutId);
  $effect(() => panelLayoutIdStore.set(panelLayoutId));
  const activeTab$ = selectActiveTab(panelLayoutIdStore);
  const allPanelTabs$ = selectAllTabs(panelLayoutIdStore);
  const focusedContentType = $derived($activeTab$?.type ?? null);
  const focusedContentNoteId = $derived($activeTab$?.noteId ?? null);
  const focusedContentAgentId = $derived($activeTab$?.agentId ?? null);
  const focusedContentFilePath = $derived($activeTab$?.filePath ?? null);
  const focusedContentDiffPath = $derived($activeTab$?.diffPath ?? null);

  $effect(() => {
    workspaceId;
    agentSearchQuery = '';
    contextSearchQuery = '';
  });

  const effectiveSelectedNoteId = $derived(
    focusedContentType === 'note' ? focusedContentNoteId : null,
  );
  const effectiveSelectedAgentId = $derived(
    focusedContentType === 'agent' ? focusedContentAgentId : null,
  );
  const effectiveSelectedFile = $derived(
    focusedContentType === 'file' ? focusedContentFilePath : null,
  );
  const effectiveActiveFilePath = $derived(
    focusedContentType === 'diff' ? focusedContentDiffPath : null,
  );
  const effectiveActiveFileStaged = $derived.by(() => {
    if (!effectiveActiveFilePath) return null;
    if (
      $stagedChanges$.some(
        (change) =>
          change.file === effectiveActiveFilePath ||
          change.relativePath === effectiveActiveFilePath,
      )
    ) {
      return true;
    }
    if (
      $unstagedChanges$.some(
        (change) =>
          change.file === effectiveActiveFilePath ||
          change.relativePath === effectiveActiveFilePath,
      )
    ) {
      return false;
    }
    return null;
  });
  const effectiveIsAllChangesViewActive = $derived(focusedContentType === 'local-changes');

  type PaneOpenEvent = MouseEvent | KeyboardEvent;

  function isAdjacentOpen(event?: PaneOpenEvent): boolean {
    return event ? isCmdClickModifier({ event }) : false;
  }

  function handleOpenAgentInPanel(agentId: string, event?: PaneOpenEvent) {
    if (!$allWorkspaceAgents.some((agent) => agent.id === agentId)) return;
    const sourcePanelId = selectFocusedPanelId.select(appStore.state, panelLayoutId) ?? undefined;
    const openInAdjacentPanel = isAdjacentOpen(event);
    appStore.dispatch(
      openAgentTabRequested(workspaceId, {
        agentId,
        sourcePanelId,
        panelLayoutId,
        ...(openInAdjacentPanel ? { openInAdjacentPanel: true } : {}),
      }),
    );
  }

  function handleOpenNoteInPanel(noteId: string, event?: PaneOpenEvent) {
    const note = $notes.find((n) => n.id === noteId);
    const title = note?.title || m.workspace_addContext_note_label();
    const tab = {
      type: 'note',
      title,
      closable: true,
      noteId,
      workspaceId,
    } as const;
    if (isAdjacentOpen(event)) {
      const sourcePanelId = selectFocusedPanelId.select(appStore.state, panelLayoutId) ?? undefined;
      panelLayoutManager.openTabInAdjacentOrSplit(tab, sourcePanelId, { force: true });
    } else {
      panelLayoutManager.openUserTab(tab);
    }

    // Mark note as read when opened to clear unread indicator
    appStore.dispatch(markNoteRead(workspaceId, noteId));
  }

  function handleOpenFileInPanel(filePath: string, event?: PaneOpenEvent) {
    const fileName = filePath.split('/').pop() || filePath;
    const tab = {
      type: 'file',
      title: fileName,
      closable: true,
      filePath,
      workspaceId,
    } as const;
    if (isAdjacentOpen(event)) {
      const sourcePanelId = selectFocusedPanelId.select(appStore.state, panelLayoutId) ?? undefined;
      panelLayoutManager.openTabInAdjacentOrSplit(tab, sourcePanelId, { force: true });
    } else {
      panelLayoutManager.openTab(tab);
    }
  }

  function handleOpenCodeReviewInPanel() {
    panelLayoutManager.openTab({
      type: 'code-review',
      title: m.workspace_multiSelectSidebar_codeReview_label(),
      closable: true,
      workspaceId,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function handleArchiveWorkspace() {
    if (!$workspace) return;
    const { toast } = await import('svelte-sonner');
    const workspaceTitle = $workspace.title || m.workspace_multiSelectSidebar_space_label();

    const result = await workspaceClient.archive($workspace.id);
    if (result.ok) {
      appStore.dispatch(loadWorkspacesRequested());
      toast.warning(
        m.workspace_multiSelectSidebar_archivedSpace_toast({ title: workspaceTitle }),
        withToastCountdown(
          {
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
          },
          { pauseOnHover: false },
        ),
      );
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
  let bottomLaunchersElement: HTMLDivElement | null = $state(null);
  let expandedOverlayTop = $state(88);
  let expandedOverlayBottom = $state(68);

  function updateExpandedOverlayBounds() {
    if (!sidebarElement) return;
    const sidebarRect = sidebarElement.getBoundingClientRect();
    if (sidebarRect.height <= 0) return;
    const localHeight = sidebarElement.clientHeight || sidebarRect.height;
    const viewportPixelsPerCssPixel = sidebarRect.height / localHeight;

    const identityBoundary = sidebarElement.querySelector<HTMLElement>(
      '[data-sidebar-repository-branch-metadata]',
    );
    const progressBoundary = sidebarElement.querySelector<HTMLElement>(
      '[data-workspace-task-progress]',
    );
    const boundaryBottom = Math.max(
      identityBoundary?.getBoundingClientRect().bottom ?? sidebarRect.top,
      progressBoundary?.getBoundingClientRect().bottom ?? sidebarRect.top,
    );
    const bottomLauncherTop =
      bottomLaunchersElement?.getBoundingClientRect().top ?? sidebarRect.bottom;
    const nextBottom = Math.max(
      0,
      Math.round((sidebarRect.bottom - bottomLauncherTop) / viewportPixelsPerCssPixel),
    );
    const maxTop = Math.max(0, Math.round(localHeight - nextBottom - 96));

    expandedOverlayTop = Math.min(
      maxTop,
      Math.max(0, Math.round((boundaryBottom - sidebarRect.top) / viewportPixelsPerCssPixel + 4)),
    );
    expandedOverlayBottom = nextBottom;
  }

  function updateLauncherIconLimit() {
    const stack = sidebarElement?.querySelector<HTMLElement>('[data-sidebar-launcher-icons]');
    if (!stack || stack.clientWidth <= 0) return;
    const overflowWidth = Math.max(
      LAUNCHER_TARGET_SIZE,
      ...[...stack.querySelectorAll<HTMLElement>('.launcher-overflow-button')].map(
        (button) => button.scrollWidth,
      ),
    );
    launcherIconLimit = getLauncherPreviewLimit(
      stack.clientWidth,
      overflowWidth,
      LAUNCHER_ICON_LIMIT,
      LAUNCHER_TARGET_SIZE,
      LAUNCHER_STEP_SIZE,
    );
  }

  onMount(() => {
    // Measurement is deferred to ResizeObserver's guaranteed initial
    // delivery (after layout, pre-paint) instead of running synchronously
    // here: mount happens mid-flush on workspace switches, where the
    // getBoundingClientRect sweep forces a reflow.
    let cancelRead: (() => void) | null = null;
    const measure = () => {
      updateExpandedOverlayBounds();
      updateLauncherIconLimit();
    };
    if (typeof ResizeObserver === 'undefined' || !sidebarElement) {
      cancelRead = scheduleLayoutRead(() => {
        cancelRead = null;
        measure();
      });
      return () => cancelRead?.();
    }

    const observer = new ResizeObserver(measure);
    observer.observe(sidebarElement);
    const titleRegion = sidebarElement.querySelector<HTMLElement>('[data-workspace-title-region]');
    if (titleRegion) observer.observe(titleRegion);
    if (bottomLaunchersElement) observer.observe(bottomLaunchersElement);
    return () => observer.disconnect();
  });

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
      sidebarTabSwitchDirection = 'none';
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
  const orderedSelectedCards = $derived(
    orderedSelectedTabs.map((tabId) => ({ tabId, workspaceId })),
  );
  const isLauncherOverview = $derived(isTabSelected('overview'));

  $effect(() => {
    if (isLauncherOverview) return;
    return pushEscapeLayer(() => dismissExpandedCard(true));
  });

  $effect(() => {
    if (!isLauncherOverview || !pendingLauncherFocusTabId) return;
    const tabId = pendingLauncherFocusTabId;
    pendingLauncherFocusTabId = null;
    void tick().then(() => {
      sidebarElement
        ?.querySelector<HTMLButtonElement>(
          `[data-sidebar-launcher="${tabId}"] button[aria-expanded="false"]`,
        )
        ?.focus();
    });
  });
</script>

{#snippet launcherAgentAvatar(item: AgentAvatarStackItem)}
  {@const launcherItem = launcherAgents.find(({ agent }) => agent.id === item.agentId)}
  {#if launcherItem}
    {@const { agent, preview } = launcherItem}
    <SidebarLauncherHoverCard
      title={agent.name || `${m.workspace_fileChanges_agent_label()} ${agent.id.slice(0, 8)}`}
      status={getAgentAvatarStateLabel(item.state ?? 'idle')}
      statusTone={getLauncherStatusTone(item.state ?? 'idle')}
      rows={[
        { label: m.chat_agentThread_you_label(), text: preview.lastUserMessage },
        { label: m.workspace_fileChanges_agent_label(), text: preview.response },
      ]}
      emptyText={m.layout_sidebarNav_noMessages_label()}
      kind="agent"
      gridPosition="start"
      delayDuration={launcherHoverDelay}
      open={openLauncherHoverKey === `agent:${agent.id}`}
      onOpenChange={(open) => {
        handleLauncherHoverOpenChange(`agent:${agent.id}`, open);
        if (open && agent.messages.length === 0) void loadChatTranscript(agent.id);
      }}
    >
      <Button
        variant="plain"
        class="launcher-agent-avatar-button pointer-events-auto relative flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm p-0! outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        aria-label={agent.name || m.workspace_fileChanges_agent_label()}
        data-sidebar-agent={agent.id}
        data-sidebar-agent-state={item.state ?? 'idle'}
        data-launcher-preview-item
        onpointerdown={(event) => event.stopPropagation()}
        onclick={(event) => {
          event.stopPropagation();
          handleOpenAgentInPanel(agent.id, event);
        }}
      >
        <AgentAvatarWithState
          agentId={item.agentId}
          specialist={item.specialist}
          state={item.state ?? 'idle'}
          variant="standard"
        />
      </Button>
    </SidebarLauncherHoverCard>
  {/if}
{/snippet}

<div
  bind:this={sidebarElement}
  class={cn('relative flex h-full flex-col overflow-hidden bg-transparent', className)}
>
  <!-- Fixed Top Section: Progress Card -->
  <div class="shrink-0 px-6 pb-2 pt-5" data-workspace-title-region>
    <WorkspaceProgressCard {workspaceId} onOpenNote={handleOpenNoteInPanel} />
  </div>

  {#if !isNewWorkspaceSession}
    <div
      class={cn(
        'sidebar-stage grid min-h-0 flex-1',
        isLauncherOverview ? 'grid-rows-[minmax(0,1fr)_232px]' : 'grid-rows-[minmax(0,1fr)_0px]',
      )}
      data-sidebar-stage
    >
      <div class={isLauncherOverview ? 'min-h-0 overflow-hidden' : 'min-h-0 overflow-visible'}>
        {#if isLauncherOverview}
          <div class="h-full min-h-0" aria-hidden="true"></div>
        {:else}
          <!-- One expanded tile fills the body beneath the workspace identity. -->
          {@html '<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->'}
          <div
            role="presentation"
            class="sidebar-expanded-card-shell absolute inset-x-0 z-20 grid min-h-0 min-w-0 overflow-hidden px-4 pb-1 pt-3"
            style={`top: ${expandedOverlayTop}px; bottom: ${expandedOverlayBottom}px;`}
            data-sidebar-overlay
            data-sidebar-switch-direction={sidebarTabSwitchDirection}
            onclick={handleExpandedOverlayClick}
          >
            {#each orderedSelectedCards as selectedCard (`${selectedCard.workspaceId}:${selectedCard.tabId}`)}
              {@const { tabId, workspaceId: cardWorkspaceId } = selectedCard}
              {@const tab = TAB_DEFINITIONS.find((t) => t.id === tabId)}
              <div
                class="sidebar-expanded-card relative z-10 flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-sidebar"
                data-sidebar-card-surface
                data-sidebar-card-workspace={cardWorkspaceId}
                data-sidebar-card-tab={tabId}
                in:cardMorph|global={{
                  tabId: tabId as LauncherTabId,
                  direction: 'expand',
                  cardWorkspaceId,
                }}
                out:cardMorph|global={{
                  tabId: tabId as LauncherTabId,
                  direction: 'collapse',
                  cardWorkspaceId,
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
                          {#if tabId === 'agents'}
                            <SidebarExpandableSearch
                              bind:query={agentSearchQuery}
                              scope="agents"
                              placeholder={m.workspace_multiSelectSidebar_searchAgents_placeholder()}
                            />
                            {#if onCreateAgent || onCreateAgentWithSpecialist}
                              <CreateAgentSection
                                onCreate={onCreateAgent}
                                onCreateWithSpecialist={onCreateAgentWithSpecialist}
                                compact
                              />
                            {/if}
                          {:else if tabId === 'context'}
                            <SidebarExpandableSearch
                              bind:query={contextSearchQuery}
                              scope="context"
                              placeholder={m.workspace_multiSelectSidebar_searchContext_placeholder()}
                            />
                            <AddContextSection onAddNote={onCreateNote} compact />
                          {:else if tabId === 'browser'}
                            <SidebarHeaderAction
                              icon="plus"
                              label={m.menu_new_browser()}
                              onclick={createBrowser}
                            />
                          {:else if tabId === 'shell'}
                            <SidebarHeaderAction
                              icon="plus"
                              label={m.menu_new_terminal()}
                              onclick={createTerminal}
                            />
                          {:else if tabId === 'changes' && workspacePrRows.length > 0}
                            <SidebarPrDropdown rows={workspacePrRows} {workspaceId} side="bottom" />
                          {/if}
                          <SidebarHeaderAction
                            icon="close"
                            label={m.ui_tab_close_ariaLabel()}
                            onclick={() => dismissExpandedCard(true)}
                          />
                        </span>
                      </h6>
                      {#if tabId !== 'agents' && tabId !== 'shell'}
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
                            {m.workspace_multiSelectSidebar_contextAndMetadataLiveIn_before()}
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
                      data-sidebar-expanded-scroll
                      use:scrollFade
                    >
                      {#if tabId === 'agents'}
                        <div class="px-4 transition-all duration-200" data-testid="agent-panel">
                          <WorkspaceAgentsList
                            agents={$allWorkspaceAgents}
                            loading={$agentsLoading}
                            searchQuery={agentSearchQuery}
                            runningAgentIds={runningLauncherAgents.map((agent) => agent.id)}
                            selectedAgentId={effectiveSelectedAgentId}
                            retiredCount={$retiredCount$}
                            retiredAgentsLoaded={$retiredAgentsLoaded$}
                            loadingRetired={$loadingRetired$}
                            onLoadRetired={() => {
                              appStore.dispatch(fetchRetiredAgentsRequested(workspaceId));
                            }}
                            onSelect={({ agentId, event }) =>
                              handleOpenAgentInPanel(agentId, event)}
                            onRestoreRetired={({ agentId }) => {
                              appStore.dispatch(restoreRetiredAgentRequested(workspaceId, agentId));
                            }}
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
                            openPanelTabs={$allPanelTabs$}
                            activePanelTab={$activeTab$}
                            searchQuery={contextSearchQuery}
                            showAddSection={false}
                          />
                        </div>
                      {:else if tabId === 'changes'}
                        <div
                          class="flex h-full flex-1 flex-col px-4 transition-all duration-200"
                          data-sidebar-changes-panel
                        >
                          <div class="w-full flex-1">
                            <SidebarChangesPanel
                              {workspaceId}
                              activeFilePath={effectiveActiveFilePath}
                              activeFileStaged={effectiveActiveFileStaged}
                              isAllChangesViewActive={effectiveIsAllChangesViewActive}
                              onOpenChange={(change, event) => {
                                const sourcePanelId =
                                  selectFocusedPanelId.select(appStore.state, panelLayoutId) ??
                                  undefined;
                                appStore.dispatch(
                                  openWorkspaceDiff(workspaceId, change as never, {
                                    filePath: change.relativePath || change.file,
                                    changeId: change.id,
                                    openInAdjacentPanel: isAdjacentOpen(event),
                                    sourcePanelId,
                                  }),
                                );
                              }}
                              onOpenFullPanel={onAcceptChanges}
                              onOpenNote={handleOpenNoteInPanel}
                              onOpenCodeReview={handleOpenCodeReviewInPanel}
                              openPanelTabs={$allPanelTabs$}
                              activePanelTab={$activeTab$}
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
                      {:else if tabId === 'browser'}
                        <SidebarBrowserList {workspaceId} {panelLayoutId} />
                      {:else if tabId === 'shell'}
                        <WorkspaceShellList {workspaceId} />
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
          <div class="grid h-56 w-full auto-rows-fr grid-cols-2 gap-3" data-sidebar-launcher-grid>
            {#each TAB_DEFINITIONS.filter((definition) => definition.id in LAUNCHER_GRID_POSITIONS) as tab (tab.id)}
              <div
                class="group/launcher relative flex h-full min-h-0 w-full min-w-0 cursor-pointer overflow-hidden rounded-lg border border-border bg-sidebar p-2 text-foreground transition-colors"
                data-sidebar-launcher={tab.id}
                data-sidebar-card-surface
                data-launcher-top-inset="8"
                data-launcher-inline-inset="8"
              >
                <Button
                  variant="plain"
                  class="launcher-tile-action absolute inset-0 z-0 h-auto cursor-pointer rounded-lg outline-none focus-visible:bg-muted/50"
                  onclick={() => handleTabClick(tab.id)}
                  data-testid={isAgentLauncherTab(tab.id) ? 'agent-panel-toggle' : undefined}
                  aria-expanded="false"
                  aria-label={isAgentLauncherTab(tab.id)
                    ? undefined
                    : m.ui_vscodePanel_expand_ariaLabel()}
                  aria-labelledby={isAgentLauncherTab(tab.id)
                    ? `sidebar-launcher-label-${tab.id}-${workspaceId} sidebar-launcher-agent-count-${workspaceId}${$hasUnreadForegroundAgents$ ? ` sidebar-launcher-agents-unread-${workspaceId}` : ''}`
                    : undefined}
                ></Button>
                <div
                  class="pointer-events-none relative z-10 flex h-full min-h-0 w-full min-w-0 flex-col justify-between"
                >
                  <div
                    class={tab.id === 'agents'
                      ? 'flex h-9 w-full min-w-0 items-center overflow-hidden ps-2 text-muted-foreground'
                      : LAUNCHER_ICON_STACK_CLASS}
                    style={tab.id === 'agents'
                      ? undefined
                      : `grid-template-columns: ${launcherGridTemplateColumns(tab.id)};`}
                    data-sidebar-launcher-icons
                    data-launcher-pack="left"
                    data-launcher-layout="horizontal"
                    data-launcher-target-size={tab.id === 'agents'
                      ? LAUNCHER_VISIBLE_SIZE
                      : LAUNCHER_TARGET_SIZE}
                    data-launcher-visible-size={LAUNCHER_VISIBLE_SIZE}
                    data-launcher-step-size={LAUNCHER_STEP_SIZE}
                    data-launcher-visible-offset={LAUNCHER_VISIBLE_OFFSET}
                  >
                    {#if tab.id === 'agents'}
                      <AgentAvatarStack
                        items={launcherAgentStackItems}
                        maxVisible={LAUNCHER_ICON_LIMIT}
                        adaptive
                        align="start"
                        variant="standard"
                        interactive
                        itemContent={launcherAgentAvatar}
                        overflowTestId="sidebar-agent-overflow"
                      />
                    {:else if tab.id === 'context'}
                      {#each launcherNotes as note, index (note.id)}
                        {@const isSpec = isSpecNote(note.id as string)}
                        <div
                          class={isSpec ? 'flex h-9 items-center' : 'contents'}
                          data-context-spec-summary-row={isSpec ? 'true' : undefined}
                        >
                          <SidebarLauncherHoverCard
                            title={note.title || m.chat_mentions_untitledNote_label()}
                            rows={[{ text: getNoteLauncherPreview(note) }]}
                            emptyText="Empty note"
                            kind="note"
                            gridPosition="start"
                            delayDuration={launcherHoverDelay}
                            open={openLauncherHoverKey === `note:${note.id}`}
                            onOpenChange={(open) =>
                              handleLauncherHoverOpenChange(`note:${note.id}`, open)}
                          >
                            <Button
                              variant="plain"
                              class={LAUNCHER_ICON_BUTTON_CLASS}
                              onclick={(event) => handleOpenNoteInPanel(note.id as string, event)}
                              aria-label={note.title || m.chat_mentions_untitledNote_label()}
                              data-sidebar-context={note.id}
                              data-launcher-leading-item={index === 0 ? 'true' : undefined}
                              data-launcher-preview-item
                            >
                              <span class={LAUNCHER_GLYPH_CLASS} data-sidebar-launcher-glyph>
                                <ResourceIconTile
                                  kind="note"
                                  class="transition-colors group-hover/preview:bg-background/70! group-focus-visible/preview:bg-background/80!"
                                />
                              </span>
                            </Button>
                          </SidebarLauncherHoverCard>
                          {#if isSpec}
                            <span
                              class="pointer-events-none whitespace-nowrap text-[11px] leading-none font-medium text-muted-foreground /* a11y-ignore: product requires an 11px compact Context summary */"
                              data-context-capability-summary
                              >{m.workspace_multiSelectSidebar_contextSummary_label()}</span
                            >
                          {/if}
                        </div>
                      {/each}
                      {#if launcherNoteOverflowCount > 0}
                        <Button
                          variant="plain"
                          class={LAUNCHER_OVERFLOW_BUTTON_CLASS}
                          style={`${LAUNCHER_OVERFLOW_STYLE} justify-self: start; height: ${LAUNCHER_VISIBLE_SIZE}px;`}
                          onclick={() => handleTabClick('context')}
                          aria-label={launcherNoteOverflowLabel}
                          data-sidebar-context-overflow={launcherNoteOverflowCount}
                          data-launcher-preview-item
                        >
                          <span aria-hidden="true">+{launcherNoteOverflowCount}</span>
                        </Button>
                      {/if}
                    {:else if tab.id === 'changes'}
                      <span
                        class="pointer-events-none flex size-9 shrink-0 items-center justify-center"
                        data-sidebar-changes-resource
                        data-launcher-leading-item="true"
                      >
                        <ResourceIconTile kind="changes" variant="emphasized" />
                      </span>
                    {/if}
                  </div>
                  <div
                    class={cn('flex h-7 min-w-0 items-center pl-2', 'justify-between gap-2')}
                    data-sidebar-label-row
                  >
                    <span
                      id={`sidebar-launcher-label-${tab.id}-${workspaceId}`}
                      data-sidebar-launcher-label
                      class={cn(
                        'truncate text-sm font-semibold',
                        tab.id === 'changes' ? 'min-w-0 flex-1' : '',
                      )}>{tab.label}</span
                    >
                    {#if tab.id === 'agents' && $hasUnreadForegroundAgents$}
                      <span
                        id={`sidebar-launcher-agents-unread-${workspaceId}`}
                        class="mr-auto size-1.5 shrink-0 rounded-full bg-[hsl(var(--workspace-status-unread))] forced-colors:bg-[CanvasText]"
                        role="img"
                        aria-label={m.workspace_multiSelectSidebar_agentsUnread_ariaLabel()}
                        data-sidebar-agents-unread-dot
                      ></span>
                    {/if}
                    {#if tab.id === 'changes' && workspacePrRows.length > 0}
                      <SidebarPrDropdown rows={workspacePrRows} {workspaceId} class="ml-auto" />
                    {/if}
                    {#if tab.id === 'agents'}
                      <span id={`sidebar-launcher-agent-count-${workspaceId}`} class="sr-only">
                        {launcherAgentCountLabel}
                      </span>
                    {/if}
                    {#if tab.id === 'files' && $fileExplorerWorkspacePath}
                      <span class="pointer-events-auto relative z-20 cursor-pointer">
                        <OpenComboButton
                          filePath={$fileExplorerWorkspacePath}
                          {workspaceId}
                          isDirectory={true}
                          side="top"
                          variant="sidebar"
                        >
                          <span
                            class="inline-flex size-7 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground focus-visible:text-foreground"
                            data-files-open-in
                          >
                            <Fa icon={faArrowUpRightFromSquare} class="size-4!" />
                            <span class="sr-only">{m.ui_openCombo_openInApp_tooltip()}</span>
                          </span>
                        </OpenComboButton>
                      </span>
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
  <!-- Compact launchers stay fixed; only collapsed tabs resize beneath an expanded card. -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    bind:this={bottomLaunchersElement}
    role="presentation"
    class={cn(
      'relative z-30 w-full shrink-0 pb-3 transition-all duration-500',
      isLauncherOverview ? 'grid gap-3 px-6 pt-3' : 'px-4 pt-2',
      isLauncherOverview ? (isNewWorkspaceSession ? 'grid-cols-1' : 'grid-cols-2') : '',
    )}
    data-sidebar-compact-bottom-row={isLauncherOverview || undefined}
    data-sidebar-expanded-footer={!isLauncherOverview || undefined}
    onclick={isLauncherOverview ? undefined : handleExpandedFooterClick}
  >
    {#if isLauncherOverview}
      {#if !isNewWorkspaceSession}
        <SidebarBrowserLauncher
          {workspaceId}
          {panelLayoutId}
          onExpand={() => handleTabClick('browser')}
          expanded={selectedTabs.has('browser')}
        />
      {/if}
      <WorkspaceTerminalDock
        {workspaceId}
        onExpand={() => handleTabClick('shell')}
        expanded={selectedTabs.has('shell')}
      />
    {:else}
      <SidebarExpandedTabStrip
        tabs={expandedStripTabs}
        activeTabId={orderedSelectedTabs[0]}
        closeLabel={m.ui_tab_close_ariaLabel()}
        onActivate={(tabId) => handleTabClick(tabId)}
      />
    {/if}
  </div>
</div>

<style>
  @media (forced-colors: active) {
    :global(.launcher-icon-button:focus-visible) {
      color: HighlightText;
    }

    :global(.launcher-icon-button:focus-visible) .launcher-glyph {
      background: Highlight;
      color: HighlightText;
    }

    :global(.launcher-overflow-button:focus-visible) {
      color: Highlight;
    }

    :global(.expanded-card-action:focus-visible),
    :global(.launcher-tile-action:focus-visible) {
      background: Highlight;
      color: HighlightText;
    }
  }
</style>
