<script lang="ts">
  /**
   * SidebarChangesPanel - Timeline-based changes panel
   * Shows the git workflow as a vertical timeline: Unstaged → Staged → Commits → PRs
   */
  import { AcceptChangesClient } from '$features/accept-changes/accept-changes.client';
  import { backgroundGitActionsService } from '$features/accept-changes/background-git-actions.service';
  import type { UndoCommitMetadata } from '$features/accept-changes/types';
  import { agentService } from '$features/agent/agent.service';
  import {
    createCommitMessageExecutor,
    createPRDescriptionExecutor,
    getDeferredResults,
    hasDeferredResults,
  } from '$features/agent/background-agent-executor.svelte';
  import { sessionStore } from '$features/agent/browser';
  import { createAgentLockStore } from '$features/file-tracking/agent-lock.store.svelte';
  import { fileTrackingStore } from '$features/file-tracking/file-tracking.store.svelte';
  import { ChangeStage, type TrackedChange } from '$features/file-tracking/types';
  import {
    refreshPRStatus,
    registerWindowFocusRefresh,
    startPRStatusPolling,
  } from '$features/git-tracking/pr-status.service';
  import { gitCache } from '$features/git/git-cache';
  import { gitClient } from '$features/git/git.client';
  import { gitStore } from '$features/git/git.store.svelte';
  import { githubAuthStore } from '$features/github-auth/renderer/github-auth.store.svelte';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-manager.svelte';
  import { handleLink } from '$features/navigation/link-handler';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { getTransientUIStore } from '$features/workspace/transient-ui-state.store.svelte';
  import { terminalOverlayStore } from '$lib/stores/terminal-overlay.store.svelte';
  import GitHubAuthBanner from '$lib/components/GitHubAuthBanner.svelte';
  import FileRow from '$lib/components/file-tracking/accept-changes/FileRow.svelte';
  import {
    type AgentChangeGroup,
    groupFilesByAgent,
    type PRInfo,
    type UIFileChange,
  } from '$lib/components/file-tracking/accept-changes/types';
  import GitBranchIcon from '$lib/components/icons/GitBranchIcon.svelte';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import Header from '$lib/components/ui/Header.svelte';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Switch } from '$lib/components/ui/switch';
  import { Textarea } from '$lib/components/ui/textarea';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
  import { toast } from '$lib/components/ui/toast';
  import ExportErrorToast from '$lib/components/ui/toast/ExportErrorToast.svelte';
  import ExportSuccessToast from '$lib/components/ui/toast/ExportSuccessToast.svelte';
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import BranchSelector from '$lib/components/workspace/initializer/BranchSelector.svelte';
  import { dialog, invoke, isElectron } from '$lib/electron-bridge';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import { faNote } from '$lib/icons/faNote';
  import { track, getFileExtension } from '$lib/services/analytics';
  import { createWorkspaceSettingsStore } from '$lib/stores/workspace-settings.store.svelte';
  import { logger } from '$lib/utils/client-logger';
  import { SYSTEM_CHANNELS, WORKSPACE_CHANNELS } from '$shared/ipc/channels';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import {
    faArrowDown,
    faArrowsRotate,
    faArrowUpFromBracket,
    faArrowUpRightFromSquare,
    faCheck,
    faChevronDown,
    faCloud,
    faCodeCommit,
    faCodeMerge,
    faCodePullRequest,
    faEye,
    faFlag,
    faFolderOpen,
    faLink,
    faLock,
    faMinus,
    faPlus,
    faRobot,
    faRocket,
    faRotateLeft,
    faSpinner,
    faStop,
    faUser,
  } from '@fortawesome/free-solid-svg-icons';
  import confetti from 'canvas-confetti';
  import { onMount, tick, untrack } from 'svelte';
  import Fa from 'svelte-fa';
  import { flip } from 'svelte/animate';
  import { quintOut } from 'svelte/easing';
  import { crossfade, slide } from 'svelte/transition';
  import DividerButton from './DividerButton.svelte';
  import DividerPanel from './DividerPanel.svelte';
  import TimelineDivider from './TimelineDivider.svelte';
  import TimelineSection from './TimelineSection.svelte';

  interface Props {
    workspaceId: string;
    /** Path of the currently active/selected file (for highlighting) */
    activeFilePath?: string | null;
    /** Whether the active file is from the staged list (true) or unstaged list (false) */
    activeFileStaged?: boolean | null;
    isAllChangesViewActive?: boolean;
    onOpenChange?: (change: TrackedChange) => void;
    onOpenFullPanel?: () => void;
    onOpenNote?: (noteId: string) => void;
    /** Callback to open the code review panel */
    onOpenCodeReview?: () => void;
  }

  let {
    workspaceId,
    activeFilePath = null,
    activeFileStaged = null,
    isAllChangesViewActive = false,
    onOpenChange,
    onOpenFullPanel,
    onOpenNote,
    onOpenCodeReview,
  }: Props = $props();

  // Get transient UI store lazily to avoid creating $state during effect flush
  // NOTE: We cache the store reference at initialization time (not in an effect)
  // because getTransientUIStore creates a new store with $state if one doesn't exist,
  // and creating $state during effect evaluation triggers effect_update_depth_exceeded.
  let cachedTransientStore: ReturnType<typeof getTransientUIStore> | null = null;
  // Track the workspaceId the cache was created for to detect changes
  // NOTE: Using a plain variable (not $state) to avoid reactive dependency loops
  let cachedWorkspaceId: string | null = null;
  function getTransientStore() {
    // Invalidate cache if workspaceId changed
    if (cachedWorkspaceId !== null && cachedWorkspaceId !== workspaceId) {
      cachedTransientStore = null;
      cachedWorkspaceId = null;
    }
    if (!cachedTransientStore && workspaceId) {
      cachedTransientStore = getTransientUIStore(workspaceId);
      cachedWorkspaceId = workspaceId;
    }
    return cachedTransientStore;
  }
  // Pre-initialize the cache immediately at component creation time (before effects run)
  if (workspaceId) {
    cachedTransientStore = getTransientUIStore(workspaceId);
    cachedWorkspaceId = workspaceId;
  }

  /**
   * Check if a file should be highlighted as active
   * We need to match both the path AND the staged status to distinguish
   * between the same file appearing in both lists
   */
  function isFileActive(filePath: string, isStaged: boolean): boolean {
    if (!activeFilePath) return false;
    // If activeFileStaged is explicitly false (not null), match both path and staged status
    // If activeFileStaged is null, don't highlight anything (for committed changes)
    if (activeFileStaged === null) return false;
    // Otherwise, match both path and staged status
    return filePath === activeFilePath && isStaged === activeFileStaged;
  }

  // Helper to get linked note for an agent
  function getLinkedNoteId(agentId: string | null): string | undefined {
    if (!agentId) return undefined;
    const session = agentService.getSession(agentId);
    return session?.metadata?.taskNoteId as string | undefined;
  }

  // Get panel layout manager for opening browser tabs
  const panelLayoutManager = $derived(getPanelLayoutManager(workspaceId));

  /**
   * Check if an agent group should be locked (prevent manual stage/commit).
   * A group is locked when:
   * 1. Auto-commit is enabled AND
   * 2. The agent is actively working (streaming) OR
   * 3. The agent's linked task is not in a terminal status (complete/cancelled)
   *
   * Uses the precomputed lockedAgentIds set for proper reactivity.
   */
  function isAgentGroupLocked(agentId: string | null): boolean {
    if (!agentId) return false;
    return lockedAgentIds.has(agentId);
  }

  // Combined loading state: store loading OR workspace mismatch (switching)
  // This ensures skeleton shows during workspace transitions instead of showing stale data
  const isLoading = $derived(
    fileTrackingStore.loading ||
      (workspaceId && fileTrackingStore.currentWorkspaceId !== workspaceId),
  );

  // Only use store data if workspace IDs match - prevents showing stale data during rapid switches
  const storeHasCorrectWorkspace = $derived(fileTrackingStore.currentWorkspaceId === workspaceId);

  // Get data from stores - use defensive checks for reactive updates
  // CRITICAL: Only use store data when it's for the correct workspace
  const workingChanges = $derived(
    storeHasCorrectWorkspace
      ? (fileTrackingStore.workingChanges ?? { unstaged: [], staged: [] })
      : { unstaged: [], staged: [] },
  );
  const unstagedChanges = $derived(workingChanges?.unstaged ?? []);
  const stagedChanges = $derived(workingChanges?.staged ?? []);

  // Auto-commit settings
  let workspaceSettings = $derived(workspaceId ? createWorkspaceSettingsStore(workspaceId) : null);
  const autoCommitEnabled = $derived(workspaceSettings?.autoCommitEnabled ?? true);

  // Agent lock store - provides reactive locked agent/file state
  const agentLockStore = $derived(createAgentLockStore(workspaceId));
  const lockedAgentIds = $derived(agentLockStore.lockedAgentIds);

  // Validate gitStore data belongs to current workspace (defense in depth)
  const gitStoreHasCorrectWorkspace = $derived(gitStore.dataWorkspaceId === workspaceId);

  // Git status - use defensive checks for array operations during reactive updates
  const unpushedCount = $derived(gitStoreHasCorrectWorkspace ? gitStore.ahead : 0);
  const allCommits = $derived(fileTrackingStore.commits ?? []);
  const commits = $derived((allCommits ?? []).filter((c) => !c.isPushed));
  const pushedCommits = $derived((allCommits ?? []).filter((c) => c.isPushed));
  const boundarySha = $derived(fileTrackingStore.boundarySha);
  const olderCommits = $derived(fileTrackingStore.olderCommits ?? []);
  const loadingOlderCommits = $derived(fileTrackingStore.loadingOlderCommits);

  // Context menu state for commits
  let commitContextMenu: { x: number; y: number; commitHash: string } | null = $state(null);

  function handleCommitContextMenu(e: MouseEvent, commitHash: string) {
    e.preventDefault();
    e.stopPropagation();
    commitContextMenu = { x: e.clientX, y: e.clientY, commitHash };
  }

  function closeCommitContextMenu() {
    commitContextMenu = null;
  }

  function getCommitContextMenuItems(commitHash: string): SidebarMenuEntry[] {
    const isCurrentBase = workspace?.baseCommitSha === commitHash;
    const items: SidebarMenuEntry[] = [
      {
        id: 'set-base-commit',
        label: isCurrentBase ? 'Base commit (current)' : 'Set as base commit',
        icon: faFlag,
        disabled: isCurrentBase,
        onClick: () => {
          handleSetBaseCommit(commitHash);
          closeCommitContextMenu();
        },
      },
    ];
    // If user has a manually-set base commit, offer to clear it
    if (workspace?.baseCommitSha) {
      items.push(
        { type: 'separator' as const },
        {
          id: 'clear-base-commit',
          label: 'Reset to default base',
          icon: faRotateLeft,
          onClick: () => {
            handleClearBaseCommit();
            closeCommitContextMenu();
          },
        },
      );
    }
    return items;
  }

  async function handleSetBaseCommit(commitHash: string) {
    if (!workspace) return;
    try {
      const result = await workspaceStore.update(workspace.id, { baseCommitSha: commitHash });
      if (result.ok) {
        fileTrackingStore.clearOlderCommits();
        await fileTrackingStore.refresh();
        toast.success('Base commit updated — only newer commits will be shown');
      } else {
        toast.error('Failed to update base commit');
      }
    } catch (error) {
      logger.error('Failed to set base commit', error as Error);
      toast.error('Failed to update base commit');
    }
  }

  async function handleClearBaseCommit() {
    if (!workspace) return;
    try {
      const result = await workspaceStore.update(workspace.id, { baseCommitSha: '' });
      if (result.ok) {
        fileTrackingStore.clearOlderCommits();
        await fileTrackingStore.refresh();
        toast.success('Base commit reset to default');
      } else {
        toast.error('Failed to reset base commit');
      }
    } catch (error) {
      logger.error('Failed to clear base commit', error as Error);
      toast.error('Failed to reset base commit');
    }
  }

  // Workspace info for branch
  const workspace = $derived(workspaceStore.findById(workspaceId as WorkspaceId));

  // Pull requests from workspace - use pullRequests array if available, else derive from activePullRequest
  // Construct the correct PR URL from repository info and PR number
  // This is more reliable than using the stored URL which may be incorrect
  const constructPrUrl = (prNumber: number, fallbackUrl?: string): string => {
    if (workspace?.repositoryOwner && workspace?.repositoryName) {
      return `https://github.com/${workspace.repositoryOwner}/${workspace.repositoryName}/pull/${prNumber}`;
    }
    // Fallback to stored URL if we don't have repo info
    return fallbackUrl || '';
  };

  // Helper to convert PullRequestStatus enum to PRDisplayStatus
  const toPRDisplayStatus = (status: string): 'open' | 'merged' | 'closed' | 'draft' => {
    if (status === 'Open') return 'open';
    if (status === 'Merged') return 'merged';
    if (status === 'Draft') return 'draft';
    return 'closed';
  };

  const pullRequests = $derived.by<PRInfo[]>(() => {
    // Use workspace.pullRequests if available and non-empty
    if (workspace?.pullRequests && workspace.pullRequests.length > 0) {
      const mapped = workspace.pullRequests.map((pr) => {
        return {
          number: pr.number,
          // Use || to fall back to PR #number if title is empty string
          title: pr.title || `PR #${pr.number}`,
          url: constructPrUrl(pr.number, pr.url),
          htmlUrl: constructPrUrl(pr.number, pr.url),
          status: toPRDisplayStatus(pr.status),
          createdAt: pr.createdAt,
          updatedAt: pr.updatedAt,
        };
      });
      return mapped;
    }
    // Fall back to activePullRequest for backwards compatibility
    if (workspace?.activePullRequest) {
      return [
        {
          number: workspace.activePullRequest.number,
          // Use || to fall back to PR #number if title is empty string
          title: workspace.activePullRequest.title || `PR #${workspace.activePullRequest.number}`,
          url: constructPrUrl(workspace.activePullRequest.number, workspace.activePullRequest.url),
          htmlUrl: constructPrUrl(
            workspace.activePullRequest.number,
            workspace.activePullRequest.url,
          ),
          status: toPRDisplayStatus(workspace.activePullRequest.status),
          createdAt: workspace.activePullRequest.createdAt,
          updatedAt: workspace.activePullRequest.updatedAt,
        },
      ];
    }
    return [];
  });
  const trunkBranch = $derived(workspace?.baseRef || 'main');
  const hasPushedCommits = $derived(pushedCommits.length > 0);

  // Truncation state - when there are more changes than we can display
  // Only show truncation warning if there are actual working changes being truncated
  // (not just when there are many committed changes)
  const rawChangesTruncated = $derived(
    storeHasCorrectWorkspace ? fileTrackingStore.changesTruncated : false,
  );
  const totalChangesCount = $derived(
    storeHasCorrectWorkspace ? fileTrackingStore.totalChangesCount : 0,
  );
  const workingChangesCount = $derived(unstagedChanges.length + stagedChanges.length);
  // Only show truncation banner if we're actually truncating working changes
  // (i.e., there are working changes AND the total exceeds what we can show)
  const changesTruncated = $derived(rawChangesTruncated && workingChangesCount > 0);
  const hiddenChangesCount = $derived(
    changesTruncated ? totalChangesCount - workingChangesCount : 0,
  );

  // Check if PR is merged - used to hide merge button
  const isPRMerged = $derived(pullRequests.length > 0 && pullRequests[0].status === 'merged');

  // Check if ALL PRs are merged - used to show archive button
  const areAllPRsMerged = $derived(
    pullRequests.length > 0 && pullRequests.every((pr) => pr.status === 'merged'),
  );

  // Check if there's an open PR - used to conditionally show Create PR vs Push Commits button
  const hasOpenPR = $derived(
    pullRequests.some((pr) => pr.status === 'open' || pr.status === 'draft'),
  );

  // Check if there are unpushed commits - commits is already filtered to unpushed only
  const hasUnpushedCommits = $derived(commits.length > 0);

  // Check if branches have diverged (need force push)
  const isDiverged = $derived(gitStore.status?.diverged ?? false);

  // Branch state detection
  const isBehind = $derived(gitStore.behind > 0 && gitStore.ahead === 0 && !isDiverged);
  const behindCount = $derived(gitStore.behind);

  // Note: PR status is automatically refreshed by AcceptChangesService.getStatus()
  // which fetches from GitHub and emits workspace:updated events.
  // The layout listens for these events and calls workspaceStore.updateLocalWorkspace().

  // Repository info for branch selector
  const repoPath = $derived(workspace?.repositoryPath || workspace?.worktreePath || '');
  const repoType = $derived<'local' | 'github'>(workspace?.isRemote ? 'github' : 'local');

  // Loading states
  let isStaging = $state(false);
  let isCommitting = $state(false);
  let hasLoadedForWorkspace = $state(false);
  let lastWorkspaceId: string | null = $state(null);

  // Drawer/form states (collapsed by default)
  let commitDrawerOpen = $state(false);
  let prDrawerOpen = $state(false);
  let isCreatingPR = $state(false);
  let exportDrawerOpen = $state(false);
  let isExporting = $state(false);
  let mergeDrawerOpen = $state(false);
  let isMergingToTrunk = $state(false);
  let isMergedToTrunk = $state(false);
  // Track HEAD SHA at merge time to detect if user made new commits after merge
  // If new commits exist, hide the reset button to prevent data loss
  let mergeHeadSha = $state<string | null>(null);
  let isPushing = $state(false);
  let isResettingToTrunk = $state(false);
  const githubAuthState = $derived(githubAuthStore.state);
  let pendingActionAfterAuth = $state<'create-pr' | 'refresh-pr' | null>(null);
  let pendingPRWorkspaceId: string | null = null;
  let authBannerKey = $state(0); // Key to force re-mount the banner with autoStart

  // PR status refresh state
  let isRefreshingPR = $state(false);

  // Force push state
  let forcePushDrawerOpen = $state(false);
  let isForcePushing = $state(false);

  // Pull state
  let isPulling = $state(false);

  // Git status refresh state
  let isRefreshingGitStatus = $state(false);

  // Track ahead of trunk for detecting merged commits
  let aheadOfTrunk = $state<number | null>(null);

  // Track whether the repo has a remote configured (used to adapt UI for local-only repos)
  let hasRemote = $state(true);

  // Track whether branch content has been squash-merged to trunk (via tree hash matching)
  let isContentMergedToTrunk = $state(false);

  // Track whether user has reset to trunk after merge (enables Create PR button again)
  let hasResetToTrunk = $state(false);

  // Clear hasResetToTrunk when PRs transition away from all-merged state
  // (e.g., new PR created after reset) so future merges show post-merge UI normally
  $effect(() => {
    if (pullRequests.length > 0 && !areAllPRsMerged) {
      hasResetToTrunk = false;
    }
  });

  // Clear merge state when user makes new commits after an in-session merge
  $effect(() => {
    if (mergeHeadSha && allCommits[0]?.hash && mergeHeadSha !== allCommits[0].hash) {
      // User made new commits after merge — exit post-merge state
      isMergedToTrunk = false;
      mergeHeadSha = null;
      isContentMergedToTrunk = false;
    }
  });

  // Connect remote state
  let connectRemoteDrawerOpen = $state(false);
  let remoteUrl = $state('');
  let isAddingRemote = $state(false);

  // Branch rename state
  let isEditingBranch = $state(false);
  let editedBranch = $state('');
  let branchInputRef: HTMLInputElement | null = $state(null);
  let isSavingBranch = $state(false);

  // Initialize GitHub auth state on mount
  onMount(() => {
    githubAuthStore.initialize();

    // Check if store is already loaded for this workspace on mount
    // This handles the case where the accordion is expanded after the store has already initialized
    const storeWsId = fileTrackingStore.currentWorkspaceId;
    const storeLoading = fileTrackingStore.loading;
    if (!storeLoading && storeWsId === workspaceId) {
      logger.debug(
        '[SidebarChangesPanel] Store already loaded on mount, setting hasLoadedForWorkspace',
        {
          workspaceId,
          storeWorkspaceId: storeWsId,
        },
      );
      hasLoadedForWorkspace = true;
    }
  });

  // Note: git:status-changed listener has been moved to gitStore.initEventListener()
  // which is initialized at workspace level in +page.svelte, ensuring it works
  // regardless of which sidebar panel is active.

  // Consolidated effect for managing hasLoadedForWorkspace
  // This single effect handles both workspace changes AND load state changes
  // to avoid race conditions between separate effects
  $effect(() => {
    const storeWsId = fileTrackingStore.currentWorkspaceId;
    const storeLoading = fileTrackingStore.loading;
    const workspaceChanged = lastWorkspaceId !== workspaceId;

    logger.debug('[SidebarChangesPanel] Checking load state', {
      workspaceId,
      storeWorkspaceId: storeWsId,
      storeLoading,
      isLoading,
      hasLoadedForWorkspace,
      workspaceChanged,
      lastWorkspaceId,
      idsMatch: storeWsId === workspaceId,
    });

    // If workspace changed, update tracking and reset loaded state
    if (workspaceChanged) {
      lastWorkspaceId = workspaceId;
      // Reset form state that is workspace-specific to prevent leaking between workspaces
      targetBranch = '';
      exportPath = '';
      // Reset merge/reset state to prevent stale flags from enabling destructive actions on wrong workspace
      hasResetToTrunk = false;
      isMergedToTrunk = false;
      mergeHeadSha = null;
      isContentMergedToTrunk = false;
      aheadOfTrunk = null;
      isResettingToTrunk = false;
      hasRemote = true;
      // Only reset to false if the new workspace isn't already loaded
      // This prevents a brief flash when accordion is first opened for an already-loaded workspace
      if (storeLoading || storeWsId !== workspaceId) {
        hasLoadedForWorkspace = false;
      } else {
        // Workspace data is already loaded, set to true immediately
        hasLoadedForWorkspace = true;
      }
    } else if (!isLoading && storeWsId === workspaceId && !hasLoadedForWorkspace) {
      // Loading finished for current workspace
      hasLoadedForWorkspace = true;
    }
  });

  // Check for deferred results when workspace becomes active
  // This restores commit messages or PR descriptions that were generated while
  // the user was in a different workspace
  $effect(() => {
    // React to workspace ID changes
    const wsId = workspaceId;
    if (!wsId) return;

    // Use untrack to avoid creating dependencies on the state we're updating
    untrack(() => {
      // Check for deferred commit messages - only drain cache if commitMessage is empty
      // This prevents silently discarding deferred results when user already has a message
      if (!commitMessage && hasDeferredResults(wsId, 'commit')) {
        const deferredCommitMessages = getDeferredResults(wsId, 'commit');
        if (deferredCommitMessages.length > 0) {
          // Use the most recent result (last in array)
          const restoredMessage = deferredCommitMessages[deferredCommitMessages.length - 1];
          if (restoredMessage) {
            commitMessage = restoredMessage;
            logger.info('[SidebarChangesPanel] Restored deferred commit message', {
              workspaceId: wsId,
            });
            // Note: toast notification removed - superseded by git:op-completed cross-workspace toasts
          }
        }
      }

      // Check for deferred PR descriptions - only drain cache if PR fields are empty
      // This prevents silently discarding deferred results when user already has content
      if (!prTitle && !prDescription && hasDeferredResults(wsId, 'pr')) {
        const deferredPRDescriptions = getDeferredResults(wsId, 'pr');
        if (deferredPRDescriptions.length > 0) {
          // Use the most recent result (last in array)
          const restoredPR = deferredPRDescriptions[deferredPRDescriptions.length - 1];
          if (restoredPR) {
            // Parse the result to extract title and description (same as prExecutor.onResult)
            const lines = restoredPR.trim().split('\n');
            const titleLine = lines[0]?.replace(/^#\s*/, '').trim();
            const descriptionLines = lines.slice(1).join('\n').trim();

            if (titleLine) {
              prTitle = titleLine;
            }
            if (descriptionLines) {
              prDescription = descriptionLines;
            }
            logger.info('[SidebarChangesPanel] Restored deferred PR description', {
              workspaceId: wsId,
            });

            // Auto-create PR if createPRWhenReady was persisted in transient store
            const transientStore = getTransientStore();
            if (transientStore?.sidebarChanges.createPRWhenReady) {
              logger.info('[SidebarChangesPanel] Auto-creating PR after deferred result restored', {
                workspaceId: wsId,
              });
              createPRWhenReady = false;
              transientStore.setSidebarCreatePRWhenReady(false);
              isCreatingPR = true;
              handleCreatePR(wsId)
                .then(() => {
                  prDrawerOpen = false;
                })
                .catch((error) => {
                  logger.error('[SidebarChangesPanel] Failed to auto-create PR after deferred result', { error });
                  prDrawerOpen = false;
                })
                .finally(() => {
                  isCreatingPR = false;
                });
            }
          }
        }
      }
    });
  });

  // Handle manual PR status refresh
  async function handleRefreshPRStatus() {
    if (isRefreshingPR) return;
    isRefreshingPR = true;
    const refreshStart = Date.now();
    await tick();

    try {
      // Check GitHub authentication first
      if (!githubAuthState.isAuthenticated) {
        try {
          await githubAuthStore.initialize();
        } catch (error) {
          logger.warn('[SidebarChangesPanel] Failed to refresh GitHub auth state', error);
        }
      }

      if (!githubAuthState.isAuthenticated) {
        pendingActionAfterAuth = 'refresh-pr';
        toast.info('Connect to GitHub using the banner below');
        return;
      }

      // Fetch remote changes first to update remote tracking branches
      // This ensures divergence detection works correctly
      try {
        const fetchResult = await gitClient.fetch(workspaceId as WorkspaceId);
        if (!fetchResult.ok) {
          // Log but don't block - fetch failures (network, auth) shouldn't prevent status refresh
          logger.warn('[SidebarChangesPanel] Git fetch failed:', { error: fetchResult.error });
        }
      } catch (error) {
        logger.warn('[SidebarChangesPanel] Git fetch error:', error);
      }

      // Refresh git status after fetch to get updated ahead/behind counts
      gitCache.invalidate(`git-status-${workspaceId}`);
      await gitStore.loadStatus(workspaceId as WorkspaceId, true);

      // Now refresh PR status
      const result = await refreshPRStatus(workspaceId as WorkspaceId, { force: true });
      if (!result.success) {
        logger.warn('[SidebarChangesPanel] Failed to refresh PR status:', result.error);
        toast.error(result.error || 'Failed to refresh PR status');
      } else if (result.skipped) {
        toast.info(result.skipReason || 'PR refresh skipped');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh PR status';
      logger.warn('[SidebarChangesPanel] Failed to refresh PR status:', error);
      toast.error(message);
    } finally {
      const elapsed = Date.now() - refreshStart;
      if (elapsed < 300) {
        await new Promise((resolve) => setTimeout(resolve, 300 - elapsed));
      }
      isRefreshingPR = false;
    }
  }

  // Handle manual git status refresh
  async function handleRefreshGitStatus() {
    if (isRefreshingGitStatus) return;
    isRefreshingGitStatus = true;
    const refreshWsId = workspaceId;
    const refreshStart = Date.now();

    // Timeout for git refresh operations (90 seconds)
    // This prevents infinite spinner if git operations hang (network issues, credentials, etc.)
    const REFRESH_TIMEOUT_MS = 90_000;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      // Invalidate cache and refresh stores
      gitCache.invalidate(`git-status-${workspaceId}`);

      // Create a timeout promise to prevent infinite spinner
      // We track the timeoutId so we can clear it when operations complete
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Git refresh timed out')),
          REFRESH_TIMEOUT_MS,
        );
      });

      // Race the refresh operations against the timeout
      await Promise.race([
        Promise.all([
          gitStore.loadStatus(workspaceId as WorkspaceId, true),
          fileTrackingStore.refresh(),
          // Also refresh aheadOfTrunk, hasRemote, and isContentMergedToTrunk for merged state detection
          AcceptChangesClient.getStatus(workspaceId as WorkspaceId).then((status) => {
            if (workspaceId !== refreshWsId) return; // workspace changed, discard stale update
            aheadOfTrunk = status.aheadOfTrunk;
            hasRemote = status.hasRemote;
            isContentMergedToTrunk = status.isContentMergedToTrunk ?? false;
          }),
        ]),
        timeoutPromise,
      ]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('timed out')) {
        logger.warn(
          '[SidebarChangesPanel] Git refresh timed out - this may indicate network issues or pending credential prompts',
        );
      } else {
        logger.warn('[SidebarChangesPanel] Failed to refresh git status:', error);
      }
    } finally {
      // Clear the timeout to prevent memory leaks
      if (timeoutId) clearTimeout(timeoutId);

      // Ensure minimum visible duration for the spinner
      const elapsed = Date.now() - refreshStart;
      if (elapsed < 300) {
        await new Promise((resolve) => setTimeout(resolve, 300 - elapsed));
      }
      isRefreshingGitStatus = false;
    }
  }

  // Fetch aheadOfTrunk status when workspace changes or git status refreshes
  // This is used to detect if commits have been merged to trunk
  $effect(() => {
    const wsId = workspaceId;
    if (!wsId) {
      aheadOfTrunk = null;
      isContentMergedToTrunk = false;
      return;
    }

    // Re-fetch when workspace changes or when hasLoadedForWorkspace becomes true
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    hasLoadedForWorkspace;

    AcceptChangesClient.getStatus(wsId as WorkspaceId)
      .then((status) => {
        if (workspaceId !== wsId) return; // workspace changed, discard stale update
        aheadOfTrunk = status.aheadOfTrunk;
        hasRemote = status.hasRemote;
        isContentMergedToTrunk = status.isContentMergedToTrunk ?? false;
      })
      .catch((error) => {
        logger.warn('[SidebarChangesPanel] Failed to fetch aheadOfTrunk:', error);
        aheadOfTrunk = null;
        isContentMergedToTrunk = false;
      });
  });

  // Branch editing functions
  function startEditingBranch() {
    if (!workspace) return;
    isEditingBranch = true;
    editedBranch = workspace.branch || '';
    tick().then(() => {
      if (branchInputRef) {
        branchInputRef.focus();
        branchInputRef.select();
      }
    });
  }

  async function saveBranch() {
    // Guard against double-calls (blur + keydown/clickOutside can fire together)
    if (isSavingBranch) {
      return;
    }

    if (!workspace || !editedBranch.trim()) {
      isEditingBranch = false;
      return;
    }

    const newBranch = editedBranch.trim();
    if (newBranch === workspace.branch) {
      isEditingBranch = false;
      return;
    }

    // Validate branch name format
    const validationError = getBranchNameValidationError(newBranch);
    if (validationError) {
      logger.error('Invalid branch name format', { branchName: newBranch, error: validationError });
      toast.error(validationError);
      editedBranch = workspace.branch || '';
      isEditingBranch = false;
      return;
    }

    isSavingBranch = true;
    try {
      const result = await window.electronAPI.invoke(WORKSPACE_CHANNELS.RENAME_BRANCH, {
        id: workspace.id,
        newBranchName: newBranch,
      });

      if (result.success) {
        // Update workspace store with new branch
        await workspaceStore.update(workspace.id, { branch: newBranch });
      } else {
        logger.error('Failed to rename branch', { error: result.error });
        toast.error(result.error || 'Failed to rename branch');
        editedBranch = workspace.branch || '';
      }
    } catch (error) {
      logger.error('Error renaming branch:', error);
      toast.error('Failed to rename branch');
      editedBranch = workspace.branch || '';
    } finally {
      isEditingBranch = false;
      isSavingBranch = false;
    }
  }

  function handleBranchKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveBranch();
    } else if (e.key === 'Escape') {
      isEditingBranch = false;
      editedBranch = workspace?.branch || '';
    }
  }

  /**
   * Validate a git branch name according to git-check-ref-format rules.
   * Returns an error message if invalid, undefined if valid.
   */
  function getBranchNameValidationError(name: string): string | undefined {
    if (!name || name.trim().length === 0) {
      return 'Branch name cannot be empty';
    }

    // Cannot contain spaces
    if (name.includes(' ')) {
      return 'Branch name cannot contain spaces';
    }

    // Cannot contain certain special characters
    if (/[~^:\\?*\[@{]/.test(name)) {
      return 'Branch name contains invalid characters';
    }

    // Cannot start with a dot
    if (name.startsWith('.')) {
      return "Branch name cannot start with '.'";
    }

    // Cannot end with .lock
    if (name.endsWith('.lock')) {
      return "Branch name cannot end with '.lock'";
    }

    // Cannot contain consecutive dots
    if (name.includes('..')) {
      return "Branch name cannot contain '..'";
    }

    // Cannot start or end with a slash
    if (name.startsWith('/') || name.endsWith('/')) {
      return 'Branch name cannot start or end with /';
    }

    // Cannot contain consecutive slashes
    if (name.includes('//')) {
      return 'Branch name cannot contain consecutive slashes';
    }

    // Cannot start with a dash
    if (name.startsWith('-')) {
      return "Branch name cannot start with '-'";
    }

    // Maximum length
    if (name.length > 250) {
      return 'Branch name is too long (max 250 characters)';
    }

    return undefined;
  }

  function handleBranchClickOutside(e: MouseEvent) {
    if (isEditingBranch && branchInputRef && !branchInputRef.contains(e.target as Node)) {
      saveBranch();
    }
  }

  $effect(() => {
    if (isEditingBranch) {
      document.addEventListener('mousedown', handleBranchClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleBranchClickOutside);
      };
    }
  });

  // Set up PR status polling and window focus refresh when we have an active PR
  $effect(() => {
    if (workspace?.activePullRequest) {
      // Start polling
      const stopPolling = startPRStatusPolling(workspaceId as WorkspaceId);
      // Register window focus listener
      const unregisterFocus = registerWindowFocusRefresh(workspaceId as WorkspaceId);

      return () => {
        stopPolling();
        unregisterFocus();
      };
    }
  });

  // Track if we've already triggered PR discovery for this workspace
  let hasTriggeredPRDiscovery = $state(false);

  // Reset discovery tracking when workspace changes
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    workspaceId; // Dependency
    hasTriggeredPRDiscovery = false;
  });

  // Automatically discover PRs when workspace loads with pushed commits but no active PR
  // This ensures that PRs created externally (via GitHub website, CLI, etc.) are discovered
  $effect(() => {
    // Only run once per workspace, after data has loaded
    if (hasTriggeredPRDiscovery || !hasLoadedForWorkspace) return;

    // Need pushed commits to check for PRs (indicates branch exists on remote)
    if (pushedCommits.length === 0) return;

    // Skip if we already have an active PR
    if (workspace?.activePullRequest) return;

    // Check if GitHub is authenticated
    if (!githubAuthState.isAuthenticated) return;

    // Mark as triggered to prevent multiple calls
    hasTriggeredPRDiscovery = true;

    // Trigger PR discovery in background (don't await)
    logger.info('[SidebarChangesPanel] Auto-discovering PRs for workspace with pushed commits', {
      workspaceId,
      pushedCommitsCount: pushedCommits.length,
    });
    refreshPRStatus(workspaceId as WorkspaceId, { force: false }).catch((err) => {
      logger.warn('[SidebarChangesPanel] Auto PR discovery failed', err);
    });
  });

  // Listen for github:auth-success from layout to retry pending actions
  $effect(() => {
    const handler = async (event: Event) => {
      const customEvent = event as CustomEvent<{ workspaceId: string; operation: string }>;
      const { workspaceId: eventWorkspaceId, operation } = customEvent.detail || {};
      // Only handle if this sidebar matches the workspace and operation is push (create-pr uses push)
      if (eventWorkspaceId === workspaceId && operation === 'push') {
        // Refresh auth state first to ensure it's up to date
        try {
          await githubAuthStore.initialize();
        } catch (e) {
          console.warn('[SidebarChangesPanel] Failed to refresh auth state', e);
        }
        // Now retry the PR creation with captured workspace ID
        handleCreatePR(pendingPRWorkspaceId ?? undefined);
        pendingPRWorkspaceId = null;
      }
    };
    window.addEventListener('github:auth-success', handler);
    return () => {
      window.removeEventListener('github:auth-success', handler);
    };
  });

  // "Submit when ready" toggle states
  let commitWhenReady = $state(false);
  let createPRWhenReady = $state(false);
  let mergeWhenReady = $state(false);

  // Squash merge option
  let squashMerge = $state(false);

  // Merge via PR toggle: when true, merge through GitHub API; when false, merge via git
  let mergeViaPR = $state(false);
  let isMergingPROnGitHub = $state(false);
  // Push to remote after merging via git (default: true when remote exists)
  let pushAfterMerge = $state(true);

  // Auto-update defaults when PR/remote state changes
  // Read reactive deps outside untrack so the effect re-runs; write inside untrack to avoid loops
  $effect(() => {
    const shouldMergeViaPR = hasOpenPR && hasRemote;
    const shouldPush = hasRemote;
    untrack(() => {
      mergeViaPR = shouldMergeViaPR;
      pushAfterMerge = shouldPush;
    });
  });

  // Auto-close drawers when their conditions become unavailable
  $effect(() => {
    // Read reactive values first to establish dependencies
    const shouldCloseCommit = commitDrawerOpen && !hasStaged;
    const shouldCloseExport = exportDrawerOpen && !hasStaged && !hasUnstaged;
    const shouldClosePR = prDrawerOpen && !hasStaged && !hasCommits;
    const shouldCloseMerge = mergeDrawerOpen && !hasStaged && !hasCommits;

    // Perform mutations in untrack to avoid unsafe state mutation errors
    untrack(() => {
      if (shouldCloseCommit) commitDrawerOpen = false;
      if (shouldCloseExport) exportDrawerOpen = false;
      if (shouldClosePR) prDrawerOpen = false;
      if (shouldCloseMerge) mergeDrawerOpen = false;
    });
  });

  // Inline form states
  let commitMessage = $state('');
  let prTitle = $state('');
  let prDescription = $state('');
  let targetBranch = $state('');
  let exportPath = $state('');

  // Initialize target branch from trunk
  $effect(() => {
    // Read reactive value first
    const shouldInit = !targetBranch && trunkBranch;
    const newBranch = trunkBranch;

    untrack(() => {
      if (shouldInit) {
        targetBranch = newBranch;
      }
    });
  });

  // Initialize export path from repository path
  $effect(() => {
    // Read reactive value first
    const shouldInit = !exportPath && repoPath;
    const newPath = repoPath;

    untrack(() => {
      if (shouldInit) {
        exportPath = newPath;
      }
    });
  });

  // Commit message executor for auto-fill
  const commitExecutor = createCommitMessageExecutor({
    onResult: async (result, context) => {
      commitMessage = result;
      // Auto-commit if "commit when ready" is toggled on
      if (commitWhenReady) {
        commitWhenReady = false;
        // Set committing state immediately so UI shows submitting feedback
        isCommitting = true;
        // Use the workspace ID from the executor context to handle the case where
        // user navigated to a different workspace while commit message was generating
        await handleCommit(context?.workspaceId);
        commitDrawerOpen = false;
      }
    },
    onError: (error) => {
      commitWhenReady = false;
      // Don't show toast for "all models exhausted" - it's shown in chat
      const isModelsExhausted =
        error.message.includes('No available models') ||
        error.message.includes('all models exhausted') ||
        error.message.includes('All models unavailable');
      if (!isModelsExhausted) {
        toast.error(`Failed to generate: ${error.message}`);
      }
    },
  });

  const isGenerating = $derived(commitExecutor.status === 'running' && commitExecutor.currentWorkspaceId === workspaceId);
  const commitAgentId = $derived(commitExecutor.currentWorkspaceId === workspaceId ? commitExecutor.agentId : null);

  // PR description executor for auto-fill
  const prExecutor = createPRDescriptionExecutor({
    onResult: async (result, context) => {
      // Parse the result to extract title and description
      const lines = result.trim().split('\n');
      const titleLine = lines[0]?.replace(/^#\s*/, '').trim();
      const descriptionLines = lines.slice(1).join('\n').trim();

      if (titleLine) {
        prTitle = titleLine;
      }
      if (descriptionLines) {
        prDescription = descriptionLines;
      }

      // Auto-create PR if "create when ready" is toggled on
      if (createPRWhenReady) {
        createPRWhenReady = false;
        // Clear transient store BEFORE calling handleCreatePR to prevent double-creation
        // when navigating back (the deferred result path at lines 623-637 also checks this flag)
        getTransientStore()?.setSidebarCreatePRWhenReady(false);
        // Set creating state immediately so UI shows submitting feedback
        isCreatingPR = true;
        // Use the workspace ID and targetBranch from the executor context (may differ from current state if user navigated)
        // Note: executionContext may be undefined on restore paths (e.g., reconnect after app restart) -
        // in that case we fall back to the current targetBranch state which should be correct since user is in this workspace
        if (!context?.executionContext?.targetBranch) {
          logger.warn('[SidebarChangesPanel] Auto-PR: executionContext.targetBranch undefined, using current state', {
            workspaceId: context?.workspaceId,
            fallbackTargetBranch: targetBranch,
          });
        }
        await handleCreatePR(context?.workspaceId, context?.executionContext?.targetBranch);
        prDrawerOpen = false;
      }
    },
    onError: (error) => {
      createPRWhenReady = false;
      // Don't show toast for "all models exhausted" - it's shown in chat
      const isModelsExhausted =
        error.message.includes('No available models') ||
        error.message.includes('all models exhausted') ||
        error.message.includes('All models unavailable');
      if (!isModelsExhausted) {
        toast.error(`Failed to generate: ${error.message}`);
      }
    },
  });

  const isGeneratingPR = $derived(prExecutor.status === 'running' && prExecutor.currentWorkspaceId === workspaceId);
  const prAgentId = $derived(prExecutor.currentWorkspaceId === workspaceId ? prExecutor.agentId : null);

  // Track whether we've already reconnected to the PR executor to avoid infinite loops
  let hasReconnectedPRExecutor = false;

  // Sync createPRWhenReady and prExecutor state to transient store
  $effect(() => {
    // Read the value to create dependency
    const currentCreatePRWhenReady = createPRWhenReady;
    const transientStore = untrack(() => getTransientStore());
    if (!transientStore) return;

    untrack(() => {
      if (currentCreatePRWhenReady !== transientStore.sidebarChanges.createPRWhenReady) {
        transientStore.setSidebarCreatePRWhenReady(currentCreatePRWhenReady);
      }
    });
  });

  // Sync PR executor state to transient store
  $effect(() => {
    // Read reactive values to create dependencies
    const currentAgentId = prExecutor.agentId;
    const currentStatus = prExecutor.status;
    const currentResult = prExecutor.result;
    const transientStore = untrack(() => getTransientStore());
    if (!transientStore) return;

    untrack(() => {
      if (currentAgentId) {
        transientStore.setSidebarPRExecutorState({
          agentId: currentAgentId,
          status: currentStatus,
          result: currentResult,
          error: prExecutor.error?.message || null,
        });
      } else if (currentStatus !== 'running' && currentStatus !== 'initializing') {
        // Clear stale PR executor state when executor is reset (canceled or completed)
        // This prevents the reconnect logic from finding stale state on next mount
        transientStore.setSidebarPRExecutorState(null);
      }
    });
  });

  // Reconnect to running PR executor on mount
  $effect(() => {
    const transientStore = untrack(() => getTransientStore());
    const stored = transientStore?.sidebarChanges;
    if (!stored || hasReconnectedPRExecutor) return;

    // Only reconnect if we have a stored executor state with an agentId
    if (stored.prDescriptionExecutor?.agentId) {
      const { agentId, status: savedStatus, result } = stored.prDescriptionExecutor;

      // Skip reconnection if executor already has an agentId
      if (prExecutor.agentId) {
        logger.debug('[SidebarChangesPanel] PR executor already has agentId, skipping reconnect', {
          currentAgentId: prExecutor.agentId,
          storedAgentId: agentId,
        });
        hasReconnectedPRExecutor = true;
        return;
      }

      // Only reconnect if still running OR if we have a result but executor doesn't have it yet
      if (savedStatus === 'running' || savedStatus === 'initializing') {
        hasReconnectedPRExecutor = true;
        // Restore createPRWhenReady from transient store
        if (stored.createPRWhenReady) {
          createPRWhenReady = true;
        }
        logger.info('[SidebarChangesPanel] Reconnecting to running PR executor', {
          agentId,
          savedStatus,
          createPRWhenReady: stored.createPRWhenReady,
        });

        prExecutor.reconnect(workspaceId, agentId, { status: savedStatus, result }).then((reconnectResult) => {
          // If reconnect failed (agent gone), clear state
          if (reconnectResult === null && !prExecutor.result && prExecutor.agentId === agentId) {
            logger.info('[SidebarChangesPanel] PR executor reconnect failed, clearing state');
            createPRWhenReady = false;
            getTransientStore()?.clearSidebarExecutorStates();
          }
        });
      } else if (result && !prExecutor.result) {
        // Restore completed result only if executor doesn't have it
        hasReconnectedPRExecutor = true;
        // Restore createPRWhenReady so we can auto-trigger PR creation
        if (stored.createPRWhenReady) {
          createPRWhenReady = true;
        }
        logger.info('[SidebarChangesPanel] Restoring completed PR executor result', {
          agentId,
          createPRWhenReady: stored.createPRWhenReady,
        });
        prExecutor.reconnect(workspaceId, agentId, { status: savedStatus, result });
      }
    }
  });

  // Merge commit message executor for auto-fill
  const mergeExecutor = createCommitMessageExecutor({
    onResult: async (result) => {
      commitMessage = result;
      // Auto-merge if "merge when ready" is toggled on
      if (mergeWhenReady) {
        mergeWhenReady = false;
        // Set merging state immediately so UI shows submitting feedback
        isMergingToTrunk = true;
        await handleMergeToTrunk({ squash: squashMerge, localOnly: !pushAfterMerge });
        mergeDrawerOpen = false;
      }
    },
    onError: (error) => {
      mergeWhenReady = false;
      // Don't show toast for "all models exhausted" - it's shown in chat
      const isModelsExhausted =
        error.message.includes('No available models') ||
        error.message.includes('all models exhausted') ||
        error.message.includes('All models unavailable');
      if (!isModelsExhausted) {
        toast.error(`Failed to generate: ${error.message}`);
      }
    },
  });

  const isGeneratingMerge = $derived(mergeExecutor.status === 'running' && mergeExecutor.currentWorkspaceId === workspaceId);
  const mergeAgentId = $derived(mergeExecutor.currentWorkspaceId === workspaceId ? mergeExecutor.agentId : null);

  // Computed
  const hasUnstaged = $derived(unstagedChanges.length > 0);
  const hasStaged = $derived(stagedChanges.length > 0);
  const hasCommits = $derived(allCommits.length > 0);
  const hasPRs = $derived(pullRequests.length > 0);

  // Total stats for "View All Changes" button
  // Count unique file paths across unstaged, staged, and committed changes
  const totalFilesChanged = $derived.by(() => {
    const uniquePaths = new Set<string>();
    for (const change of unstagedChanges) {
      uniquePaths.add(change.relativePath);
    }
    for (const change of stagedChanges) {
      uniquePaths.add(change.relativePath);
    }
    for (const commit of allCommits) {
      for (const file of commit.files || []) {
        uniquePaths.add(file.path);
      }
    }
    return uniquePaths.size;
  });
  const totalAdditions = $derived(
    unstagedChanges.reduce((sum, c) => sum + (c.stats?.additions || 0), 0) +
      stagedChanges.reduce((sum, c) => sum + (c.stats?.additions || 0), 0) +
      allCommits.reduce(
        (sum, c) => sum + (c.files?.reduce((fs, f) => fs + (f.additions || 0), 0) || 0),
        0,
      ),
  );
  const totalDeletions = $derived(
    unstagedChanges.reduce((sum, c) => sum + (c.stats?.deletions || 0), 0) +
      stagedChanges.reduce((sum, c) => sum + (c.stats?.deletions || 0), 0) +
      allCommits.reduce(
        (sum, c) => sum + (c.files?.reduce((fs, f) => fs + (f.deletions || 0), 0) || 0),
        0,
      ),
  );
  const hasAnyChanges = $derived(totalFilesChanged > 0);

  // Check if workspace is "completed" - commits have been merged to trunk
  // This persists across refreshes since it's based on actual git state
  const hasNoLocalChanges = $derived(!hasUnstaged && !hasStaged && commits.length === 0);
  // Workspace is completed when: no local changes and commits have been merged to trunk
  // For remote repos: pushed commits exist and they've been merged to trunk
  // For local-only repos: no commits remain ahead of trunk (all merged locally)
  const isWorkspaceCompleted = $derived(
    hasNoLocalChanges &&
      aheadOfTrunk === 0 &&
      (hasRemote ? hasPushedCommits : allCommits.length === 0),
  );

  // Note: mergeHeadSha is ONLY set during in-session merges (see merge handlers below at lines ~2354/~2423).
  // For external merges (areAllPRsMerged, isContentMergedToTrunk), we do NOT capture mergeHeadSha
  // because detection may happen after the user made new commits, and capturing HEAD at detection
  // time would record the wrong SHA (the new commit, not the actual merge point).
  // Instead, the reset button uses isContentMergedToTrunk as a guard for external merges.

  // Open all changes in main panel
  function handleOpenAllChanges() {
    window.dispatchEvent(new CustomEvent('workspace:open-local-changes'));
  }

  // Open code review panel via callback or fallback to event dispatch
  function handleOpenCodeReviewClick() {
    if (onOpenCodeReview) {
      onOpenCodeReview();
    } else {
      // Fallback for non-panel layout (old WorkspaceContent)
      window.dispatchEvent(
        new CustomEvent('workspace:open-code-review', {
          detail: {
            result: null,
            agentId: null,
            stagedFiles: stagedChanges.map((c) => c.relativePath),
            status: 'idle',
          },
        }),
      );
      // Trigger the review after component mounts
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('workspace:trigger-code-review'));
      }, 100);
    }
  }

  // Convert TrackedChange to UIFileChange for FileRow component
  function toUIFileChange(change: TrackedChange, staged: boolean): UIFileChange {
    return {
      path: change.relativePath,
      additions: change.stats.additions,
      deletions: change.stats.deletions,
      staged,
      status: change.status as 'added' | 'modified' | 'deleted' | 'renamed' | undefined,
      attribution: change.attribution?.agent
        ? {
            agentId: change.attribution.agent.agentId,
            agentName: change.attribution.agent.agentName,
            sessionId: change.attribution.agent.sessionId,
            turnNumber: change.attribution.agent.turnNumber,
            timestamp: change.attribution.timestamp,
          }
        : undefined,
    };
  }

  // Group files by agent
  const unstagedByAgent = $derived<AgentChangeGroup[]>(
    groupFilesByAgent(unstagedChanges.map((c) => toUIFileChange(c, false))),
  );

  // Get set of file paths that have unstaged changes
  // Files with both staged and unstaged changes should only show in unstaged
  // (common when pre-commit hooks modify files after staging)
  const unstagedFilePaths = $derived(new Set(unstagedChanges.map((c) => c.relativePath)));

  // Filter staged files to exclude those that also have unstaged changes
  // Then group by agent
  const stagedByAgent = $derived<AgentChangeGroup[]>(
    groupFilesByAgent(
      stagedChanges
        .filter((c) => !unstagedFilePaths.has(c.relativePath))
        .map((c) => toUIFileChange(c, true)),
    ),
  );

  // Check if we have any agent attribution
  const hasAnyAgentAttribution = $derived(
    unstagedChanges.some((c) => c.attribution?.agent) ||
      stagedChanges.some((c) => c.attribution?.agent),
  );

  // Note: lockedAgentIds and lockedFilePaths are now provided by the shared agentLockStore
  // (created near the top of the script block)

  // --- Group commit queue ---
  // Allows users to click commit on multiple groups in sequence.
  // Each entry is { groupKey, section, group } where section is 'unstaged' | 'staged'.
  type GroupCommitQueueEntry = {
    groupKey: string;
    section: 'unstaged' | 'staged';
    group: AgentChangeGroup;
  };
  let groupCommitQueue = $state<GroupCommitQueueEntry[]>([]);
  let groupCommitActive = $state<string | null>(null); // groupKey currently being committed

  function getGroupKey(group: AgentChangeGroup, section: 'unstaged' | 'staged'): string {
    return `${section}:${group.agentId ?? 'manual'}`;
  }

  function getGroupCommitState(group: AgentChangeGroup, section: 'unstaged' | 'staged'): 'idle' | 'active' | 'queued' {
    const key = getGroupKey(group, section);
    if (groupCommitActive === key) return 'active';
    if (groupCommitQueue.some((e) => e.groupKey === key)) return 'queued';
    return 'idle';
  }

  function getGroupQueuePosition(group: AgentChangeGroup, section: 'unstaged' | 'staged'): number {
    const key = getGroupKey(group, section);
    const idx = groupCommitQueue.findIndex((e) => e.groupKey === key);
    return idx + 1; // 1-based, 0 means not queued
  }

  function enqueueGroupCommit(group: AgentChangeGroup, section: 'unstaged' | 'staged') {
    const key = getGroupKey(group, section);
    // Don't enqueue if already active or queued
    if (groupCommitActive === key || groupCommitQueue.some((e) => e.groupKey === key)) return;
    // Don't allow committing locked groups
    if (group.agentId && lockedAgentIds.has(group.agentId)) return;

    groupCommitQueue = [...groupCommitQueue, { groupKey: key, section, group }];

    // If nothing is currently processing, start
    if (!groupCommitActive) {
      processGroupCommitQueue();
    }
  }

  function cancelGroupCommit(group: AgentChangeGroup, section: 'unstaged' | 'staged') {
    const key = getGroupKey(group, section);
    // Can only cancel queued items, not the active one
    if (groupCommitActive === key) return;
    groupCommitQueue = groupCommitQueue.filter((e) => e.groupKey !== key);
  }

  async function processGroupCommitQueue() {
    while (groupCommitQueue.length > 0) {
      const next = groupCommitQueue[0];
      groupCommitActive = next.groupKey;
      // Remove from queue (it's now active)
      groupCommitQueue = groupCommitQueue.slice(1);

      try {
        await commitSingleGroup(next.group, next.section);
      } catch (error) {
        logger.error('Group commit failed', error as Error);
        toast.error('Commit failed', {
          description: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    groupCommitActive = null;
  }

  async function commitSingleGroup(group: AgentChangeGroup, section: 'unstaged' | 'staged') {
    const paths = group.files.map((f) => f.path);
    const pathSet = new Set(paths);
    const message = group.agentId
      ? (getAgentDisplayName(group) || group.agentName || 'Agent changes')
      : 'Manual changes';

    // To commit only this group's files, we need to ensure only these files are staged.
    // git commit commits ALL staged files, so we must temporarily unstage other files.
    const otherStagedPaths = stagedChanges
      .filter((c) => !pathSet.has(c.relativePath))
      .map((c) => c.relativePath);

    try {
      // Temporarily unstage other files so only this group gets committed
      if (otherStagedPaths.length > 0) {
        await fileTrackingStore.unstageByPath(otherStagedPaths);
      }

      // Stage this group's files if they're currently unstaged
      if (section === 'unstaged') {
        await fileTrackingStore.stageByPath(paths);
      }

      // Now only this group's files are staged — commit
      const result = await AcceptChangesClient.execute(workspaceId as WorkspaceId, 'commit', {
        commitMessage: message,
      });

      if (!result.success) {
        throw new Error(result.error || 'Commit failed');
      }
    } finally {
      // Re-stage other files that were temporarily unstaged
      if (otherStagedPaths.length > 0) {
        try {
          await fileTrackingStore.stageByPath(otherStagedPaths);
        } catch (restageError) {
          logger.error('Failed to re-stage files after group commit', restageError as Error);
        }
      }

      // Always refresh stores regardless of success/failure
      // so the UI reflects the current git state
      await Promise.all([
        gitStore.loadStatus(workspaceId as WorkspaceId, true),
        fileTrackingStore.refresh(),
      ]).catch(() => {});
    }
  }

  // Collapsed state for agent groups
  let collapsedAgentGroups = $state(new Set<string>());

  function toggleAgentGroup(agentId: string | null) {
    const key = agentId ?? 'manual';
    const newSet = new Set(collapsedAgentGroups);
    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
    }
    collapsedAgentGroups = newSet;
  }

  function isAgentGroupCollapsed(agentId: string | null): boolean {
    return collapsedAgentGroups.has(agentId ?? 'manual');
  }

  // Multi-select state for bulk staging/unstaging
  // Keys are "{staged}:{path}" to distinguish between same file in staged vs unstaged
  let selectedFiles = $state(new Set<string>());
  let lastClickedFile = $state<{ path: string; staged: boolean } | null>(null);
  // Focused file for keyboard navigation (separate from selection)
  let focusedFile = $state<{ path: string; staged: boolean } | null>(null);

  // Get selected unstaged files
  const selectedUnstagedFiles = $derived(
    Array.from(selectedFiles)
      .filter((key) => key.startsWith('unstaged:'))
      .map((key) => key.slice('unstaged:'.length)),
  );

  // Get selected staged files
  const selectedStagedFiles = $derived(
    Array.from(selectedFiles)
      .filter((key) => key.startsWith('staged:'))
      .map((key) => key.slice('staged:'.length)),
  );

  /**
   * Handle file selection with shift+click for range selection.
   * Shift+click selects a range from the last clicked file to the current file.
   */
  function handleSelectClick(path: string, staged: boolean, event: MouseEvent) {
    if (!event.shiftKey) return;

    const key = `${staged ? 'staged' : 'unstaged'}:${path}`;
    const changes = staged ? stagedChanges : unstagedChanges;
    const allKeys = changes.map((c) => `${staged ? 'staged' : 'unstaged'}:${c.relativePath}`);

    // Create new Set to trigger reactivity
    const newSelection = new Set(selectedFiles);

    if (lastClickedFile && lastClickedFile.staged === staged) {
      // Range selection: select all files between lastClickedFile and current
      const lastKey = `${staged ? 'staged' : 'unstaged'}:${lastClickedFile.path}`;
      const lastIndex = allKeys.indexOf(lastKey);
      const currentIndex = allKeys.indexOf(key);

      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);

        for (let i = start; i <= end; i++) {
          newSelection.add(allKeys[i]);
        }
      }
    } else {
      // No previous selection or different list - just select this file
      newSelection.add(key);
    }

    selectedFiles = newSelection;
    lastClickedFile = { path, staged };
  }

  /** Track last clicked file for shift+click range selection and clear selection */
  function trackLastClicked(path: string, staged: boolean) {
    // Clear any existing selection when clicking a file normally
    if (selectedFiles.size > 0) {
      clearSelection();
    }
    lastClickedFile = { path, staged };
    // Also set keyboard focus to the clicked file
    focusedFile = { path, staged };
  }

  /** Check if a file is selected */
  function isFileSelected(path: string, staged: boolean): boolean {
    const key = `${staged ? 'staged' : 'unstaged'}:${path}`;
    return selectedFiles.has(key);
  }

  /** Clear all selections */
  function clearSelection() {
    selectedFiles = new Set();
  }

  // Clear selection when workspace changes
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    workspaceId;
    clearSelection();
  });

  // ============================================================================
  // KEYBOARD NAVIGATION (VSCode-style)
  // ============================================================================

  // Reference to the changes panel container for focus management
  let changesPanelContainer: HTMLDivElement | undefined = $state(undefined);

  // Get all files as a flat list for keyboard navigation
  // Order: unstaged files first, then staged files
  const allFilesFlat = $derived([
    ...unstagedChanges.map((c) => ({ path: c.relativePath, staged: false })),
    ...stagedChanges.map((c) => ({ path: c.relativePath, staged: true })),
  ]);

  // Get the index of the focused file in the flat list
  const focusedIndex = $derived(() => {
    if (!focusedFile) return -1;
    return allFilesFlat.findIndex(
      (f) => f.path === focusedFile!.path && f.staged === focusedFile!.staged,
    );
  });

  // Scroll focused item into view
  function scrollFocusedIntoView(path: string, staged: boolean) {
    const key = `${staged ? 'staged' : 'unstaged'}:${path}`;
    const element = changesPanelContainer?.querySelector(`[data-file-key="${key}"]`);
    if (element) {
      element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // Set focus to a file by index
  function setFocusedByIndex(index: number) {
    if (index >= 0 && index < allFilesFlat.length) {
      const file = allFilesFlat[index];
      focusedFile = { path: file.path, staged: file.staged };
      scrollFocusedIntoView(file.path, file.staged);
    }
  }

  // Handle keyboard navigation
  function handleChangesKeydown(e: KeyboardEvent) {
    // Don't handle if we're in an input or textarea
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    const fileCount = allFilesFlat.length;
    if (fileCount === 0) return;

    const currentIndex = focusedIndex();

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        if (currentIndex === -1) {
          // No focus yet, focus first item
          setFocusedByIndex(0);
        } else if (currentIndex < fileCount - 1) {
          const newIndex = currentIndex + 1;
          if (e.shiftKey) {
            // Extend selection
            extendSelectionTo(newIndex);
          } else {
            setFocusedByIndex(newIndex);
          }
        }
        break;
      }

      case 'ArrowUp': {
        e.preventDefault();
        if (currentIndex === -1) {
          // No focus yet, focus last item
          setFocusedByIndex(fileCount - 1);
        } else if (currentIndex > 0) {
          const newIndex = currentIndex - 1;
          if (e.shiftKey) {
            // Extend selection
            extendSelectionTo(newIndex);
          } else {
            setFocusedByIndex(newIndex);
          }
        }
        break;
      }

      case 'Home': {
        e.preventDefault();
        if (e.shiftKey) {
          extendSelectionTo(0);
        } else {
          setFocusedByIndex(0);
        }
        break;
      }

      case 'End': {
        e.preventDefault();
        if (e.shiftKey) {
          extendSelectionTo(fileCount - 1);
        } else {
          setFocusedByIndex(fileCount - 1);
        }
        break;
      }

      case 'Enter':
      case ' ': {
        // Open the focused file
        e.preventDefault();
        if (focusedFile) {
          const change = focusedFile.staged
            ? stagedChanges.find((c) => c.relativePath === focusedFile!.path)
            : unstagedChanges.find((c) => c.relativePath === focusedFile!.path);
          if (change) {
            handleFileClick(focusedFile.path, undefined, focusedFile.staged);
          }
        }
        break;
      }

      case 'Escape': {
        if (selectedFiles.size > 0) {
          e.preventDefault();
          clearSelection();
        }
        break;
      }

      case 'a': {
        // Cmd/Ctrl+A to select all in current section
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          if (focusedFile) {
            selectAllInSection(focusedFile.staged);
          }
        } else {
          // Type-ahead search
          handleTypeAhead(e.key, currentIndex, fileCount);
        }
        break;
      }

      default: {
        // Type-ahead search: single printable character jumps to matching item
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          handleTypeAhead(e.key, currentIndex, fileCount);
        }
        break;
      }
    }
  }

  // Extend selection from anchor to target index
  function extendSelectionTo(targetIndex: number) {
    if (targetIndex < 0 || targetIndex >= allFilesFlat.length) return;

    const targetFile = allFilesFlat[targetIndex];
    const newSelection = new Set(selectedFiles);

    // If we have a last clicked file (anchor), select range from anchor to target
    if (lastClickedFile) {
      const anchorIndex = allFilesFlat.findIndex(
        (f) => f.path === lastClickedFile!.path && f.staged === lastClickedFile!.staged,
      );

      if (anchorIndex !== -1) {
        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);

        for (let i = start; i <= end; i++) {
          const file = allFilesFlat[i];
          const key = `${file.staged ? 'staged' : 'unstaged'}:${file.path}`;
          newSelection.add(key);
        }
      }
    } else {
      // No anchor, just add the target
      const key = `${targetFile.staged ? 'staged' : 'unstaged'}:${targetFile.path}`;
      newSelection.add(key);
      lastClickedFile = { path: targetFile.path, staged: targetFile.staged };
    }

    selectedFiles = newSelection;
    focusedFile = { path: targetFile.path, staged: targetFile.staged };
    scrollFocusedIntoView(targetFile.path, targetFile.staged);
  }

  // Select all files in a section (staged or unstaged)
  function selectAllInSection(staged: boolean) {
    const changes = staged ? stagedChanges : unstagedChanges;
    const newSelection = new Set(selectedFiles);

    for (const change of changes) {
      const key = `${staged ? 'staged' : 'unstaged'}:${change.relativePath}`;
      newSelection.add(key);
    }

    selectedFiles = newSelection;
  }

  // Type-ahead search state
  let typeAheadBuffer = $state('');
  let typeAheadTimeout: ReturnType<typeof setTimeout> | null = null;

  function handleTypeAhead(key: string, currentIndex: number, fileCount: number) {
    // Clear previous timeout
    if (typeAheadTimeout) {
      clearTimeout(typeAheadTimeout);
    }

    // Add to buffer
    typeAheadBuffer += key.toLowerCase();

    // Set timeout to clear buffer after 500ms of no typing
    typeAheadTimeout = setTimeout(() => {
      typeAheadBuffer = '';
    }, 500);

    // Find matching item
    const searchStr = typeAheadBuffer;

    // Start searching from current position + 1, wrap around
    for (let offset = 1; offset <= fileCount; offset++) {
      const idx = (currentIndex + offset) % fileCount;
      const file = allFilesFlat[idx];
      const fileName = file.path.split('/').pop()?.toLowerCase() || '';

      if (fileName.startsWith(searchStr)) {
        setFocusedByIndex(idx);
        return;
      }
    }

    // If no match found with multi-char, try just the last character
    if (searchStr.length > 1) {
      const lastChar = searchStr[searchStr.length - 1];
      for (let offset = 1; offset <= fileCount; offset++) {
        const idx = (currentIndex + offset) % fileCount;
        const file = allFilesFlat[idx];
        const fileName = file.path.split('/').pop()?.toLowerCase() || '';

        if (fileName.startsWith(lastChar)) {
          setFocusedByIndex(idx);
          typeAheadBuffer = lastChar;
          return;
        }
      }
    }
  }

  // Check if a file is focused (for keyboard navigation highlight)
  function isFileFocused(path: string, staged: boolean): boolean {
    return focusedFile?.path === path && focusedFile?.staged === staged;
  }

  // Helper to get the display name for an agent
  function getAgentDisplayName(group: AgentChangeGroup): string {
    if (!group.agentId) return 'Manual Changes';

    // Try to find the session by ID first
    const sessions = sessionStore.getAllSessions();
    const session = sessions.find((s) => {
      const id = typeof s.id === 'object' ? (s.id as any).id || String(s.id) : String(s.id);
      return id === group.agentId;
    });

    if (session?.name && session.name !== 'New Workspace Agent') {
      return session.name;
    }

    // Fall back to attribution name
    return 'Agent';
  }

  // Find original TrackedChange from path
  function findChange(path: string, staged: boolean): TrackedChange | undefined {
    const list = staged ? stagedChanges : unstagedChanges;
    return list.find((c) => c.relativePath === path);
  }

  // Actions
  /**
   * Stage all unstaged changes, excluding locked agent changes.
   * Locked changes are those belonging to agents with auto-commit enabled
   * that are actively working or have pending auto-commits.
   */
  async function handleStageAll() {
    isStaging = true;
    try {
      // Filter out changes belonging to locked agents
      const unlockedChanges = unstagedChanges.filter((c) => {
        const agentId = c.attribution?.agent?.agentId;
        return !agentId || !lockedAgentIds.has(agentId);
      });
      const paths = unlockedChanges.map((c) => c.relativePath);
      if (paths.length > 0) {
        await fileTrackingStore.stageByPath(paths);
      }
    } finally {
      isStaging = false;
    }
  }

  /**
   * Check if a file at the given path belongs to a locked agent.
   * Used to prevent manual operations on files that should be auto-committed.
   */
  function isFileLockedByAgent(filePath: string, staged: boolean): boolean {
    const changes = staged ? stagedChanges : unstagedChanges;
    const change = changes.find((c) => c.relativePath === filePath || c.file === filePath);
    if (!change) return false;
    const agentId = change.attribution?.agent?.agentId;
    return agentId ? lockedAgentIds.has(agentId) : false;
  }

  async function handleStageFile(path: string) {
    // If this file is selected and there are other selected unstaged files, stage them all
    const filesToStage =
      isFileSelected(path, false) && selectedUnstagedFiles.length > 0
        ? selectedUnstagedFiles.filter((p) => !isFileLockedByAgent(p, false))
        : [path];

    // Don't allow staging files from locked agents
    if (filesToStage.length === 1 && isFileLockedByAgent(path, false)) {
      logger.warn('Cannot stage file from locked agent', { path });
      return;
    }

    await fileTrackingStore.stageByPath(filesToStage);
    clearSelection();

    // Wait for Svelte's reactive updates to complete
    await tick();

    // After staging, update the selection to the staged version (only for single file)
    if (filesToStage.length === 1) {
      const stagedChange = fileTrackingStore.workingChanges.staged.find(
        (c) => c.relativePath === path || c.file === path,
      );
      if (stagedChange) {
        logger.info('[handleStageFile] Updating selection to staged version', { path });
        window.dispatchEvent(
          new CustomEvent('workspace:open-diff', {
            detail: {
              change: stagedChange,
              filePath: stagedChange.relativePath || stagedChange.file,
              changeId: stagedChange.id,
              staged: true,
              forceUpdate: true, // Don't toggle, just update
            },
          }),
        );
      }
    }
  }

  async function handleUnstageFile(path: string) {
    // If this file is selected and there are other selected staged files, unstage them all
    const filesToUnstage =
      isFileSelected(path, true) && selectedStagedFiles.length > 0
        ? selectedStagedFiles.filter((p) => !isFileLockedByAgent(p, true))
        : [path];

    // Don't allow unstaging files from locked agents
    if (filesToUnstage.length === 1 && isFileLockedByAgent(path, true)) {
      logger.warn('Cannot unstage file from locked agent', { path });
      return;
    }

    await fileTrackingStore.unstageByPath(filesToUnstage);
    clearSelection();

    // Wait for Svelte's reactive updates to complete
    await tick();

    // After unstaging, update the selection to the unstaged version (only for single file)
    if (filesToUnstage.length === 1) {
      const unstagedChange = fileTrackingStore.workingChanges.unstaged.find(
        (c) => c.relativePath === path || c.file === path,
      );
      if (unstagedChange) {
        logger.info('[handleUnstageFile] Updating selection to unstaged version', { path });
        window.dispatchEvent(
          new CustomEvent('workspace:open-diff', {
            detail: {
              change: unstagedChange,
              filePath: unstagedChange.relativePath || unstagedChange.file,
              changeId: unstagedChange.id,
              staged: false,
              forceUpdate: true, // Don't toggle, just update
            },
          }),
        );
      }
    }
  }

  async function handleRevertFile(path: string) {
    // If this file is selected and there are other selected unstaged files, revert them all
    const filesToRevert =
      isFileSelected(path, false) && selectedUnstagedFiles.length > 0
        ? selectedUnstagedFiles.filter((p) => !isFileLockedByAgent(p, false))
        : [path];

    // Don't allow reverting files from locked agents
    if (filesToRevert.length === 1 && isFileLockedByAgent(path, false)) {
      logger.warn('Cannot revert file from locked agent', { path });
      return;
    }

    await fileTrackingStore.revertByPath(filesToRevert);
    clearSelection();
  }

  /**
   * Unstage all staged changes, excluding locked agent changes.
   */
  async function handleUnstageAll() {
    isStaging = true;
    try {
      // Filter out changes belonging to locked agents
      const unlockedChanges = stagedChanges.filter((c) => {
        const agentId = c.attribution?.agent?.agentId;
        return !agentId || !lockedAgentIds.has(agentId);
      });
      const paths = unlockedChanges.map((c) => c.relativePath);
      if (paths.length > 0) {
        await fileTrackingStore.unstageByPath(paths);
      }
    } finally {
      isStaging = false;
    }
  }

  /**
   * Stage all files in an agent group.
   * Prevents staging if the group is locked (auto-commit enabled and agent active).
   */
  async function handleStageGroup(group: AgentChangeGroup) {
    // Don't allow staging locked groups
    if (group.agentId && lockedAgentIds.has(group.agentId)) {
      logger.warn('Cannot stage locked agent group', { agentId: group.agentId });
      return;
    }
    const paths = group.files.map((f) => f.path);
    await fileTrackingStore.stageByPath(paths);
  }

  /**
   * Unstage all files in an agent group.
   * Prevents unstaging if the group is locked.
   */
  async function handleUnstageGroup(group: AgentChangeGroup) {
    // Don't allow unstaging locked groups
    if (group.agentId && lockedAgentIds.has(group.agentId)) {
      logger.warn('Cannot unstage locked agent group', { agentId: group.agentId });
      return;
    }
    const paths = group.files.map((f) => f.path);
    await fileTrackingStore.unstageByPath(paths);
  }

  /**
   * Handle manual commit for an agent group.
   * Stages all files and commits with the agent's task name as the message.
   * Prevents commit if the group is locked.
   */
  async function handleCommitGroup(group: AgentChangeGroup) {
    // Don't allow committing locked groups
    if (group.agentId && lockedAgentIds.has(group.agentId)) {
      logger.warn('Cannot commit locked agent group', { agentId: group.agentId });
      return;
    }
    const paths = group.files.map((f) => f.path);
    const commitMessage = group.agentName || 'Agent changes';

    try {
      // Stage files first
      await fileTrackingStore.stageByPath(paths);

      // Commit with agent name as message
      const result = await AcceptChangesClient.execute(workspaceId as WorkspaceId, 'commit', {
        commitMessage,
      });

      if (result.success) {
        // Toast is handled by git:op-completed event in +layout.svelte
      } else {
        toast.error('Commit failed', {
          description: result.error || 'Unknown error',
        });
      }
    } catch (error) {
      logger.error('Failed to commit agent group', error as Error);
      toast.error('Commit failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  function openCommitInBrowser(hash: string, event?: MouseEvent) {
    const repoOwner = workspace?.repositoryOwner;
    const repoName = workspace?.repositoryName;
    let commitUrl: string | null = null;

    if (repoOwner && repoName) {
      commitUrl = `https://github.com/${repoOwner}/${repoName}/commit/${hash}`;
    }

    if (commitUrl) {
      handleLink(commitUrl, { workspaceId: workspaceId as WorkspaceId, event });
    }
  }

  async function handleCreatePR(targetWorkspaceId?: string, targetBranchOverride?: string) {
    if (!prTitle.trim()) return;

    const wsId = targetWorkspaceId ?? workspaceId;

    if (!githubAuthState.isAuthenticated) {
      try {
        await githubAuthStore.initialize();
      } catch (error) {
        console.warn('[SidebarChangesPanel] Failed to refresh GitHub auth state', error);
      }
    }

    if (!githubAuthState.isAuthenticated) {
      pendingActionAfterAuth = 'create-pr';
      pendingPRWorkspaceId = wsId;
      toast.info('Connect to GitHub using the banner below');
      return;
    }

    isCreatingPR = true;
    try {
      const result = await backgroundGitActionsService.createPR({
        workspaceId: wsId,
        prTitle: prTitle.trim(),
        prDescription: prDescription.trim(),
        targetBranch: targetBranchOverride ?? targetBranch,
        hasStaged,
      });

      // Track analytics event for both success and failure
      track('Created Pull Request', {
        workspace_id: workspaceId,
        success: result.success,
      });

      if (result.success) {
        const createdPrTitle = prTitle.trim();
        prTitle = '';
        prDescription = '';
        prDrawerOpen = false;
      } else if (result.needsAuth) {
        pendingActionAfterAuth = 'create-pr';
        pendingPRWorkspaceId = wsId;
        toast.info('Connect to GitHub using the banner below');
      } else {
        toast.error(result.error || 'Failed to create pull request');
      }
    } catch (error) {
      toast.error('Failed to create pull request');
    } finally {
      isCreatingPR = false;
    }
  }

  async function handleAutoFill() {
    if (isGenerating) {
      commitExecutor.cancel();
    } else {
      const workspace = workspaceStore.findById(workspaceId as WorkspaceId);
      if (workspace) {
        await commitExecutor.execute(workspace);
      }
    }
  }

  async function handleCommit(targetWorkspaceId?: string) {
    const wsId = targetWorkspaceId ?? workspaceId;
    if (!commitMessage.trim()) return;
    isCommitting = true;
    try {
      const result = await backgroundGitActionsService.commit({
        workspaceId: wsId,
        commitMessage: commitMessage.trim(),
      });
      // Track analytics event for both success and failure
      track('Committed Changes', {
        workspace_id: workspaceId,
        success: result.success,
      });

      if (result.success) {
        commitMessage = '';
        commitDrawerOpen = false;
        // Toast is handled by git:op-completed event in +layout.svelte
      } else {
        toast.error(result.error || 'Failed to commit');
      }
    } catch (error) {
      toast.error('Failed to commit');
    } finally {
      isCommitting = false;
    }
  }

  async function handleAutoFillPR() {
    if (isGeneratingPR) {
      prExecutor.cancel();
    } else {
      const workspace = workspaceStore.findById(workspaceId as WorkspaceId);
      if (workspace) {
        await prExecutor.execute(workspace, {
          includeStagedFiles: hasStaged,
          includeCommitHashes: commits.map((c) => c.hash),
          targetBranch,
        });
      }
    }
  }

  function handleStopGenerating() {
    commitExecutor.cancel();
    commitWhenReady = false;
  }

  function handleStopGeneratingPR() {
    prExecutor.cancel();
    createPRWhenReady = false;
  }

  async function handleAutoFillMerge() {
    if (isGeneratingMerge) {
      mergeExecutor.cancel();
    } else {
      const workspace = workspaceStore.findById(workspaceId as WorkspaceId);
      if (workspace) {
        await mergeExecutor.execute(workspace);
      }
    }
  }

  function handleStopGeneratingMerge() {
    mergeExecutor.cancel();
    mergeWhenReady = false;
  }

  function toggleMergeWhenReady() {
    mergeWhenReady = !mergeWhenReady;
  }

  function viewMergeThoughtProcess(e?: MouseEvent) {
    if (mergeAgentId) {
      const panelElement = (e?.target as HTMLElement | null)?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
      const openInAdjacentPanel = e?.metaKey || e?.ctrlKey || false;
      window.dispatchEvent(
        new CustomEvent('workspace:open-agent', {
          detail: { agentId: mergeAgentId, sourcePanelId, openInAdjacentPanel },
        }),
      );
    }
  }

  // Celebrate successful merge with confetti
  function celebrateMerge() {
    const duration = 2000;
    const end = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: 2,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
        colors: ['#10b981', '#34d399', '#6ee7b7', '#a7f3d0'],
      });
      confetti({
        particleCount: 2,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
        colors: ['#10b981', '#34d399', '#6ee7b7', '#a7f3d0'],
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };

    frame();
  }

  async function handlePickExportFolder(): Promise<string | undefined> {
    try {
      const result = await window.electronAPI?.invoke('dialog:open', {
        directory: true,
        title: 'Select Export Folder',
      });

      if (result && typeof result === 'object' && 'data' in result) {
        if (!result.data?.canceled && result.data?.filePaths?.[0]) {
          return result.data.filePaths[0];
        }
      } else if (result && typeof result === 'string') {
        return result;
      }
      return undefined;
    } catch (error) {
      toast.error('Failed to open folder picker');
      return undefined;
    }
  }

  async function handleExport() {
    if (!exportPath.trim()) {
      // Pick folder first
      const selectedPath = await handlePickExportFolder();
      if (selectedPath) {
        exportPath = selectedPath;
      } else {
        return;
      }
    }

    const exportedToPath = exportPath; // Save before clearing

    // Check if destination has local changes
    try {
      const { hasChanges, isGitRepo } = await AcceptChangesClient.checkPathHasChanges(exportPath);
      if (isGitRepo && hasChanges) {
        // Ask user to confirm applying on top of local changes
        const result = await dialog.message(
          'The destination folder has uncommitted changes. Do you want to apply the exported files on top of your existing changes?',
          {
            title: 'Local Changes Detected',
            type: 'warning',
            buttons: ['Cancel', 'Apply on Top'],
          },
        );
        // result is the button index - 0 = Cancel, 1 = Apply on Top
        if (result === 0) {
          return;
        }
      }
    } catch (e) {
      // If check fails, proceed anyway
    }

    isExporting = true;
    try {
      const result = await AcceptChangesClient.exportFiles(workspaceId as WorkspaceId, exportPath, {
        preserveStructure: true,
      });

      if (!result.success) {
        // Show error toast with OpenComboButton so user can open folder to resolve issues
        toast.custom(ExportErrorToast, {
          componentProps: {
            message: result.error || 'Failed to export files',
            exportPath: exportedToPath,
          },
          duration: 15000,
        });
        return;
      }

      // Show success toast with OpenComboButton
      toast.custom(ExportSuccessToast, {
        componentProps: { exportPath: exportedToPath },
        duration: 10000,
      });
      exportDrawerOpen = false;
      exportPath = '';
    } catch (error) {
      toast.error('Failed to export files');
    } finally {
      isExporting = false;
    }
  }

  async function handleAddRemote() {
    if (!workspaceId || !remoteUrl.trim()) return;
    isAddingRemote = true;
    try {
      const status = await AcceptChangesClient.addRemote(
        workspaceId as WorkspaceId,
        remoteUrl.trim(),
      );
      hasRemote = status.hasRemote;
      aheadOfTrunk = status.aheadOfTrunk;
      isContentMergedToTrunk = status.isContentMergedToTrunk ?? false;
      connectRemoteDrawerOpen = false;
      remoteUrl = '';
      toast.success('Remote added successfully');
    } catch (error) {
      toast.error(`Failed to add remote: ${(error as Error).message}`);
    } finally {
      isAddingRemote = false;
    }
  }

  async function handleMergeToTrunk(options?: { squash?: boolean; rebaseFirst?: boolean; localOnly?: boolean }) {
    if (!workspaceId) return;

    // If there are staged changes, commit them first
    if (hasStaged) {
      if (!commitMessage.trim()) {
        toast.error('Please enter a commit message for staged changes');
        return;
      }
      const commitResult = await AcceptChangesClient.execute(workspaceId as WorkspaceId, 'commit', {
        commitMessage: commitMessage.trim(),
      });
      if (!commitResult.success) {
        toast.error(commitResult.error || 'Failed to commit staged changes');
        return;
      }
    }

    isMergingToTrunk = true;
    try {
      const result = await AcceptChangesClient.execute(workspaceId as WorkspaceId, 'merge', {
        targetBranch,
        mergeStrategy: options?.squash ? 'squash' : 'merge',
        rebaseFirst: options?.rebaseFirst,
        localOnly: options?.localOnly,
      });

      if (result.success) {
        isMergedToTrunk = true;
        // Record HEAD at merge time - if user makes new commits, we'll hide reset button
        mergeHeadSha = allCommits[0]?.hash ?? null;
        mergeDrawerOpen = false;
        commitMessage = '';
        // Refresh stores to update UI before showing success toast
        try {
          await Promise.all([
            gitStore.loadStatus(workspaceId as WorkspaceId, true),
            fileTrackingStore.refresh(),
          ]);
        } catch {
          // Refresh failed but merge succeeded - UI will update on next refresh
        }
        // If auto-rebased, update baseCommitSha to the new fork point (trunk tip at rebase time)
        // This ensures the sidebar shows only the rebased commits, not stale/duplicate old SHAs
        if (result.result?.autoRebased && result.result?.newBaseSha) {
          try {
            await workspaceStore.update(workspaceId as WorkspaceId, { baseCommitSha: result.result.newBaseSha });
            // Clear older commits pagination cache which may reference commits from old history
            fileTrackingStore.clearOlderCommits();
          } catch (err) {
            console.error('Failed to update baseCommitSha after auto-rebase');
            // Non-fatal - merge succeeded, sidebar may show stale commits until next refresh
          }
        }
        // Show different message if we auto-rebased before merging
        if (result.result?.autoRebased) {
          toast.success(`Changes rebased and merged into ${targetBranch}`);
        } else {
          toast.success(`Changes merged into ${targetBranch}`);
        }
        celebrateMerge();
      } else {
        // Check if this is a conflict/rebase error that requires manual resolution
        const errorMsg = result.error || '';
        const needsRebase =
          errorMsg.includes('Conflicts detected') ||
          errorMsg.includes('behind') ||
          errorMsg.includes('Please rebase');

        if (needsRebase && !options?.rebaseFirst) {
          // Show toast with action to open terminal and run rebase
          toast.error('Conflicts detected', {
            description: 'Rebase your branch in the terminal to resolve conflicts.',
            action: {
              label: 'Rebase in Terminal',
              onClick: () => openRebaseTerminal(),
            },
            duration: 10000,
          });
        } else {
          toast.error(result.error || 'Failed to merge');
        }
      }
    } catch (error) {
      toast.error('Failed to merge to trunk');
    } finally {
      isMergingToTrunk = false;
    }
  }

  async function handleMergePROnGitHub(options?: { mergeMethod?: 'merge' | 'squash' | 'rebase' }) {
    if (!workspaceId) return;
    const openPR = pullRequests.find((pr) => pr.status === 'open' || pr.status === 'draft');
    if (!openPR) {
      toast.error('No open pull request to merge');
      return;
    }

    isMergingPROnGitHub = true;
    try {
      const result = await AcceptChangesClient.mergePR(
        workspaceId as WorkspaceId,
        openPR.number,
        { mergeMethod: options?.mergeMethod || (squashMerge ? 'squash' : 'merge') },
      );

      // Track analytics event for both success and failure
      track('Merged Pull Request on GitHub', {
        workspace_id: workspaceId,
        pr_number: openPR.number,
        merge_method: options?.mergeMethod || (squashMerge ? 'squash' : 'merge'),
        success: result.success,
      });

      if (result.success) {
        isMergedToTrunk = true;
        // Record HEAD at merge time - if user makes new commits, we'll hide reset button
        mergeHeadSha = allCommits[0]?.hash ?? null;
        mergeDrawerOpen = false;
        // Refresh stores to update UI
        try {
          await Promise.all([
            gitStore.loadStatus(workspaceId as WorkspaceId, true),
            fileTrackingStore.refresh(),
          ]);
        } catch {
          // Refresh failed but merge succeeded
        }
        toast.success(`PR #${openPR.number} merged on GitHub`);
        celebrateMerge();
      } else {
        toast.error(result.error || 'Failed to merge PR on GitHub');
      }
    } catch (error) {
      toast.error('Failed to merge PR on GitHub');
    } finally {
      isMergingPROnGitHub = false;
    }
  }

  /**
   * Opens a terminal to run the rebase command, so the user can see the output
   * and resolve any conflicts if needed.
   */
  async function openRebaseTerminal() {
    if (!workspaceId) return;

    const worktreePath = workspace?.worktreePath || workspace?.repositoryPath;
    if (!worktreePath) {
      toast.error('Cannot find space path');
      return;
    }

    try {
      // Rebase command: fetch origin first, then rebase onto origin/trunk
      const rebaseCommand = `git fetch origin ${targetBranch || trunkBranch} && git rebase origin/${targetBranch || trunkBranch}`;

      // Create terminal with the rebase command
      const result = await window.electronAPI.invoke('terminal:createWithCommand', {
        workspaceId,
        command: rebaseCommand,
        cwd: worktreePath,
        title: `Rebase onto ${targetBranch || trunkBranch}`,
      });

      if (result.ok && result.terminalId) {
        // Open the terminal in the quake terminal bar
        const terminalTitle = `Rebase onto ${targetBranch || trunkBranch}`;
        terminalOverlayStore.addTerminal(result.terminalId, terminalTitle);
        terminalOverlayStore.open(workspaceId, result.terminalId);

        toast.success('Rebase started in terminal', {
          description: 'After rebase completes, retry the merge.',
        });
      } else {
        toast.error(result.error || 'Failed to open terminal');
      }
    } catch (error) {
      logger.error('Failed to open rebase terminal', error as Error);
      toast.error('Failed to open terminal');
    }
  }

  /**
   * Opens a terminal to run the git pull command, so the user can see the output
   * and resolve any conflicts if needed.
   */
  async function openPullTerminal() {
    if (!workspaceId) return;

    const worktreePath = workspace?.worktreePath || workspace?.repositoryPath;
    if (!worktreePath) {
      toast.error('Cannot find space path');
      return;
    }

    try {
      // Use workspace.branch which is the remote feature branch name (e.g., "add-dark-mode")
      // This is different from the local worktree branch name (e.g., "dark-mode-6inv")
      // The push targets workspace.branch, so we need to pull from the same remote branch
      const remoteBranch = workspace?.branch || 'HEAD';
      const pullCommand = `git pull --rebase origin ${remoteBranch}`;

      // Create terminal with the pull command
      const result = await window.electronAPI.invoke('terminal:createWithCommand', {
        workspaceId,
        command: pullCommand,
        cwd: worktreePath,
        title: `Pull from origin/${remoteBranch}`,
      });

      if (result.ok && result.terminalId) {
        // Open the terminal in the quake terminal bar
        terminalOverlayStore.addTerminal(result.terminalId, `Pull from origin/${remoteBranch}`);
        terminalOverlayStore.open(workspaceId, result.terminalId);

        toast.success('Pull started in terminal', {
          description: 'After pull completes, click Refresh then retry push.',
          action: {
            label: 'Refresh',
            onClick: async () => {
              gitCache.invalidate(`git-status-${workspaceId}`);
              await Promise.all([
                gitStore.loadStatus(workspaceId as WorkspaceId, true),
                fileTrackingStore.refresh(),
              ]);
              toast.success('Git status refreshed');
            },
          },
          duration: 30000, // Keep toast visible longer
        });
      } else {
        toast.error(result.error || 'Failed to open terminal');
      }
    } catch (error) {
      logger.error('Failed to open pull terminal', error as Error);
      toast.error('Failed to open terminal');
    }
  }

  function toggleCommitWhenReady() {
    commitWhenReady = !commitWhenReady;
  }

  function toggleCreatePRWhenReady() {
    createPRWhenReady = !createPRWhenReady;
  }

  function viewCommitThoughtProcess(e?: MouseEvent) {
    if (commitAgentId) {
      const panelElement = (e?.target as HTMLElement | null)?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
      const openInAdjacentPanel = e?.metaKey || e?.ctrlKey || false;
      window.dispatchEvent(
        new CustomEvent('workspace:open-agent', {
          detail: { agentId: commitAgentId, sourcePanelId, openInAdjacentPanel },
        }),
      );
    }
  }

  function viewPRThoughtProcess(e?: MouseEvent) {
    if (prAgentId) {
      const panelElement = (e?.target as HTMLElement | null)?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
      const openInAdjacentPanel = e?.metaKey || e?.ctrlKey || false;
      window.dispatchEvent(
        new CustomEvent('workspace:open-agent', {
          detail: { agentId: prAgentId, sourcePanelId, openInAdjacentPanel },
        }),
      );
    }
  }

  function handleFileClick(path: string, _commitHash?: string, staged?: boolean) {
    const change = findChange(path, staged ?? false);
    if (change) onOpenChange?.(change);
  }

  /**
   * Open a file in the panel (file viewer tab).
   */
  function handleOpenFile(relativePath: string) {
    const fileName = relativePath.split('/').pop() || relativePath;

    panelLayoutManager.openTab({
      type: 'file',
      title: fileName,
      closable: true,
      filePath: relativePath,
      workspaceId,
    });

    track('Opened File', {
      workspace_id: workspaceId,
      file_extension: getFileExtension(relativePath),
      source: 'sidebar',
    });
  }

  // Push commits to remote
  // Track which commit is being operated on
  let operatingOnCommitHash: string | null = $state(null);
  let isUndoing = $state(false);
  let isUndoingCommit = $state(false);

  // Track which commits are expanded to show files
  let expandedCommits = $state<Set<string>>(new Set());

  // Track which PRs are expanded to show files
  let expandedPRs = $state<Set<number>>(new Set());

  // Compute PR files by aggregating files from all pushed commits
  // Deduplicate by path and keep the latest additions/deletions (from newest commit)
  const prFiles = $derived.by((): UIFileChange[] => {
    if (pushedCommits.length === 0) return [];

    // Build a map of path -> file info
    // We iterate oldest to newest so newer commits override older ones
    const fileMap = new Map<string, { additions: number; deletions: number }>();

    // Sort commits by timestamp (oldest first) so newer changes override
    const sortedCommits = [...pushedCommits].sort((a, b) => a.timestamp - b.timestamp);

    for (const commit of sortedCommits) {
      for (const file of commit.files ?? []) {
        // Accumulate additions/deletions across all commits
        const existing = fileMap.get(file.path);
        if (existing) {
          fileMap.set(file.path, {
            additions: existing.additions + (file.additions || 0),
            deletions: existing.deletions + (file.deletions || 0),
          });
        } else {
          fileMap.set(file.path, {
            additions: file.additions || 0,
            deletions: file.deletions || 0,
          });
        }
      }
    }

    // Convert to UIFileChange array
    return Array.from(fileMap.entries()).map(([path, stats]) => ({
      path,
      additions: stats.additions,
      deletions: stats.deletions,
      staged: false,
    }));
  });

  // Total PR additions and deletions
  const prTotalAdditions = $derived(prFiles.reduce((sum, f) => sum + f.additions, 0));
  const prTotalDeletions = $derived(prFiles.reduce((sum, f) => sum + f.deletions, 0));

  function togglePRExpanded(prNumber: number) {
    const newSet = new Set(expandedPRs);
    if (newSet.has(prNumber)) {
      newSet.delete(prNumber);
    } else {
      newSet.add(prNumber);
    }
    expandedPRs = newSet;
  }

  // Handle click on a file in the PR expanded list
  // Shows the diff between base branch and current state
  async function handlePRFileClick(filePath: string) {
    logger.info('[handlePRFileClick] File clicked in PR', { filePath });

    if (!workspaceId || !workspace) return;

    try {
      const baseRef = workspace.baseRef || 'main';

      // Fetch old content (from base branch) and new content (current HEAD)
      const [oldContentResult, newContentResult] = await Promise.all([
        window.electronAPI?.invoke('git:show-file', {
          workspaceId,
          filePath,
          ref: baseRef,
        }) as Promise<{ success: boolean; data?: string; error?: string }>,
        window.electronAPI?.invoke('git:show-file', {
          workspaceId,
          filePath,
          ref: 'HEAD',
        }) as Promise<{ success: boolean; data?: string; error?: string }>,
      ]);

      const oldContent = oldContentResult?.success ? oldContentResult.data || '' : '';
      const newContent = newContentResult?.success ? newContentResult.data || '' : '';

      logger.info('[handlePRFileClick] Content fetched', {
        filePath,
        baseRef,
        oldContentLength: oldContent.length,
        newContentLength: newContent.length,
      });

      // Find file stats from prFiles
      const fileStats = prFiles.find((f) => f.path === filePath);

      // Create a change object to show in the diff viewer
      const change: TrackedChange = {
        id: `pr-file:${filePath}`,
        file: filePath,
        relativePath: filePath,
        stage: ChangeStage.Committed,
        stats: {
          additions: fileStats?.additions ?? 0,
          deletions: fileStats?.deletions ?? 0,
        },
        content: {
          oldContent,
          newContent,
          diff: '',
        },
        commitHash: 'PR', // Indicate this is a PR file view
        attribution: {
          timestamp: Date.now(),
        },
      };

      logger.info('[handlePRFileClick] Dispatching workspace:open-diff event', {
        changeId: change.id,
        stage: change.stage,
      });

      // Dispatch event to open the diff viewer
      window.dispatchEvent(
        new CustomEvent('workspace:open-diff', {
          detail: { change, workspaceId },
        }),
      );
    } catch (error) {
      logger.error('[handlePRFileClick] Failed to fetch file content', { error, filePath });
    }
  }

  // Inline editing state for commit messages
  let editingCommitHash: string | null = $state(null);
  let editingCommitValue = $state('');
  let editCommitInputRef: HTMLInputElement | null = $state(null);

  // Check if commit can have its message amended (only the most recent/HEAD commit)
  function canAmendCommit(index: number): boolean {
    // Only the first commit (HEAD) can be amended with git commit --amend
    return index === 0 && allCommits.length > 0;
  }

  // Start editing a commit message
  async function startEditingCommit(commit: { hash: string; message: string }) {
    editingCommitHash = commit.hash;
    editingCommitValue = commit.message;
    await tick();
    editCommitInputRef?.focus();
    editCommitInputRef?.select();
  }

  // Save the edited commit message
  async function saveCommitEdit() {
    // Use worktreePath for git commands - this is the actual worktree where commits live
    const gitPath = workspace?.worktreePath || workspace?.repositoryPath;
    if (editingCommitHash && editingCommitValue.trim() && workspaceId && gitPath) {
      const trimmed = editingCommitValue.trim();
      const commit = allCommits.find((c) => c.hash === editingCommitHash);
      if (commit && trimmed !== commit.message) {
        try {
          const wasPushed = commit.isPushed;

          // Use git commit --amend to change the message
          // Escape the message for shell safety
          const escapedMessage = trimmed.replace(/"/g, '\\"').replace(/\$/g, '\\$');
          const result = (await invoke(SYSTEM_CHANNELS.EXECUTE_COMMAND, {
            command: `git commit --amend -m "${escapedMessage}"`,
            cwd: gitPath,
          })) as { success: boolean; error?: string };

          if (!result.success) {
            throw new Error(result.error || 'Failed to amend commit');
          }

          // If the commit was pushed, we need to force push to update the remote
          if (wasPushed) {
            // First try regular force push
            let pushResult = (await invoke(SYSTEM_CHANNELS.EXECUTE_COMMAND, {
              command: 'git push --force-with-lease',
              cwd: gitPath,
            })) as { success: boolean; error?: string; data?: { stderr?: string } };

            // If push fails because no upstream is set, set it and try again
            if (
              !pushResult.success &&
              pushResult.data?.stderr?.includes('has no upstream branch')
            ) {
              // Get current branch name
              const branchResult = (await invoke(SYSTEM_CHANNELS.EXECUTE_COMMAND, {
                command: 'git rev-parse --abbrev-ref HEAD',
                cwd: gitPath,
              })) as { success: boolean; data?: { stdout?: string } };

              if (branchResult.success && branchResult.data?.stdout) {
                const branchName = branchResult.data.stdout.trim();
                pushResult = (await invoke(SYSTEM_CHANNELS.EXECUTE_COMMAND, {
                  command: `git push --force-with-lease --set-upstream origin ${branchName}`,
                  cwd: gitPath,
                })) as { success: boolean; error?: string; data?: { stderr?: string } };
              }
            }

            if (!pushResult.success) {
              throw new Error(pushResult.error || 'Failed to push amended commit');
            }
          }

          // Refresh the commits list and git status
          gitCache.invalidate(`git-status-${workspaceId}`);
          await Promise.all([
            gitStore.loadStatus(workspaceId as WorkspaceId, true),
            fileTrackingStore.refresh(),
          ]);
          toast.success(wasPushed ? 'Commit message updated and pushed' : 'Commit message updated');
        } catch (error) {
          logger.error('[saveCommitEdit] Failed to amend commit message', { error });
          toast.error('Failed to update commit message');
        }
      }
    }
    cancelCommitEdit();
  }

  // Cancel editing commit message
  function cancelCommitEdit() {
    editingCommitHash = null;
    editingCommitValue = '';
  }

  // Handle keyboard events during commit message editing
  function handleCommitEditKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveCommitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelCommitEdit();
    }
  }

  // Handle double-click on commit message
  function handleCommitMessageDoubleClick(
    e: MouseEvent,
    commit: { hash: string; message: string },
    index: number,
  ) {
    if (canAmendCommit(index)) {
      e.stopPropagation();
      e.preventDefault();
      startEditingCommit(commit);
    }
  }

  function toggleCommitExpanded(hash: string) {
    const newSet = new Set(expandedCommits);
    if (newSet.has(hash)) {
      newSet.delete(hash);
    } else {
      newSet.add(hash);
    }
    expandedCommits = newSet;
  }

  async function handleCommitFileClick(filePath: string, commitHash: string) {
    // When a file in a commit is clicked, show the diff in the main panel
    logger.info('[handleCommitFileClick] File clicked in commit', { filePath, commitHash });

    // Find the commit to get file details
    const commit = allCommits.find((c) => c.hash === commitHash);
    if (commit && workspaceId) {
      const file = commit.files?.find((f) => f.path === filePath);
      if (file) {
        try {
          logger.info('[handleCommitFileClick] Fetching content from commit', {
            filePath,
            commitHash,
          });

          // Fetch the new content at the commit
          const newContentResult = (await invoke('git:show-file', {
            workspaceId,
            filePath,
            ref: commitHash,
          })) as { success: boolean; data?: string; error?: string };

          // Fetch the old content at the parent commit
          const oldContentResult = (await invoke('git:show-file', {
            workspaceId,
            filePath,
            ref: `${commitHash}^`,
          })) as { success: boolean; data?: string; error?: string };

          const newContent = newContentResult?.success ? newContentResult.data || '' : '';
          const oldContent = oldContentResult?.success ? oldContentResult.data || '' : '';

          logger.info('[handleCommitFileClick] Content fetched', {
            filePath,
            commitHash,
            newContentLength: newContent.length,
            oldContentLength: oldContent.length,
          });

          // Create a TrackedChange object for the commit file
          const change: TrackedChange = {
            id: `commit-${commitHash}-${filePath}`,
            file: filePath,
            relativePath: filePath,
            status: 'modified' as const,
            stage: ChangeStage.Committed,
            commitHash,
            stats: {
              additions: file.additions || 0,
              deletions: file.deletions || 0,
            },
            content: {
              oldContent,
              newContent,
              diff: '',
            },
            attribution: {
              timestamp: Date.now(),
            },
          };

          logger.info('[handleCommitFileClick] Dispatching workspace:open-diff event', {
            changeId: change.id,
            stage: change.stage,
            commitHash: change.commitHash,
          });

          // Dispatch event to show the commit diff in the main panel
          window.dispatchEvent(
            new CustomEvent('workspace:open-diff', {
              detail: {
                change,
                filePath,
                changeId: change.id,
              },
            }),
          );
        } catch (error) {
          logger.error('Failed to load commit diff', { filePath, commitHash, error });
        }
      }
    }
  }

  // Commits are ordered newest-first (index 0 = most recent)
  // For push: push from the clicked commit to the oldest unpushed (index goes UP in array)
  // For undo: undo from the newest (index 0) to the clicked commit (inclusive)

  // Get the number of unpushed commits from this index to the end (older commits)
  function getCommitsToPushCount(commitIndex: number): number {
    let count = 0;
    for (let i = commitIndex; i < allCommits.length; i++) {
      if (!allCommits[i].isPushed) {
        count++;
      }
    }
    return count;
  }

  // Get the number of pushed commits from index 0 to this index (inclusive) that would be undone
  function getCommitsToUndoCount(commitIndex: number): number {
    let count = 0;
    for (let i = 0; i <= commitIndex; i++) {
      if (allCommits[i].isPushed) {
        count++;
      }
    }
    return count;
  }

  // Get tooltip for push button
  function getPushTooltip(commitIndex: number): string {
    const hasPR = pullRequests.length > 0;
    const count = getCommitsToPushCount(commitIndex);
    const branchName = workspace?.branch;
    const branchSuffix = branchName ? ` (origin/${branchName})` : '';
    const commitWord = count === 1 ? 'commit' : 'commits';

    if (hasPR) {
      return count === 1
        ? `Add commit to PR${branchSuffix}`
        : `Add ${count} ${commitWord} to PR${branchSuffix}`;
    } else {
      return count === 1
        ? `Push commit to remote${branchSuffix}`
        : `Push ${count} ${commitWord} to remote${branchSuffix}`;
    }
  }

  // Get tooltip for undo push button
  function getUndoTooltip(commitIndex: number): string {
    const count = getCommitsToUndoCount(commitIndex);
    const branchName = workspace?.branch;
    const branchSuffix = branchName ? ` (origin/${branchName})` : '';
    const commitWord = count === 1 ? 'commit' : 'commits';

    return count === 1
      ? `Undo push from remote${branchSuffix}`
      : `Undo ${count} ${commitWord} from remote${branchSuffix}`;
  }

  async function handlePushCommits(commitIndex: number) {
    if (!workspaceId) return;

    const commit = allCommits[commitIndex];
    operatingOnCommitHash = commit.hash;
    isPushing = true;

    try {
      const result = await AcceptChangesClient.execute(workspaceId as WorkspaceId, 'push', {
        targetBranch: workspace?.branch,
        upToCommitHash: commit.hash,
      });

      const commitCount = getCommitsToPushCount(commitIndex);

      // Track analytics event for both success and failure
      track('Pushed Changes', {
        workspace_id: workspaceId,
        commit_count: commitCount,
        has_pr: pullRequests.length > 0,
        success: result.success,
      });

      if (result.success) {
        // Invalidate cache and refresh stores to update UI
        // Success toast is shown by the cross-workspace toast system via git:op-completed
        gitCache.invalidate(`git-status-${workspaceId}`);
        try {
          await Promise.all([
            gitStore.loadStatus(workspaceId as WorkspaceId, true),
            fileTrackingStore.refresh(),
          ]);
        } catch {
          // Refresh failed but push succeeded - UI will update on next refresh
        }
      } else {
        const errorMsg = result.error || 'Failed to push';
        // Check if this is a diverged branch error - offer to pull in terminal
        if (errorMsg.includes('Pull the latest changes') || errorMsg.includes('behind')) {
          toast.error('Remote has new commits', {
            description: 'Pull the latest changes before pushing.',
            action: {
              label: 'Pull in Terminal',
              onClick: () => openPullTerminal(),
            },
            duration: 10000,
          });
        } else {
          toast.error(errorMsg);
        }
      }
    } catch (error) {
      toast.error('Failed to push commits');
    } finally {
      isPushing = false;
      operatingOnCommitHash = null;
    }
  }

  /**
   * Push all unpushed commits to add them to the existing PR.
   * Used when an open PR exists and there are unpushed commits.
   */
  async function handlePushAllUnpushed() {
    if (!workspaceId || commits.length === 0) return;

    // commits[0] is the newest unpushed commit (commits is already filtered to unpushed only)
    // We need to find its index in allCommits to use handlePushCommits
    const newestUnpushedHash = commits[0].hash;
    const indexInAllCommits = allCommits.findIndex((c) => c.hash === newestUnpushedHash);
    if (indexInAllCommits === -1) return;

    await handlePushCommits(indexInAllCommits);
  }

  /**
   * Force push when branches have diverged.
   * Uses --force-with-lease to safely overwrite remote commits.
   */
  async function handleForcePush() {
    isForcePushing = true;
    try {
      const result = await gitStore.push(workspaceId as WorkspaceId, true);
      if (result.ok) {
        toast.warning('Force push completed');
        forcePushDrawerOpen = false;
        // Invalidate cache and refresh stores to update UI
        gitCache.invalidate(`git-status-${workspaceId}`);
        Promise.all([
          gitStore.loadStatus(workspaceId as WorkspaceId, true),
          fileTrackingStore.refresh(),
        ]);
      } else {
        toast.error(result.error || 'Force push failed');
      }
    } catch (error) {
      logger.error('Force push failed', error as Error);
      toast.error('Force push failed');
    } finally {
      isForcePushing = false;
    }
  }

  /**
   * Pull remote commits when local is behind.
   */
  async function handlePull() {
    isPulling = true;
    try {
      const result = await gitStore.pull(workspaceId as WorkspaceId);
      if (result.ok) {
        toast.success('Pulled remote commits successfully');
        // Refresh status
        gitCache.invalidateWorkspace(workspaceId as WorkspaceId);
        await gitStore.loadStatus(workspaceId as WorkspaceId, true);
      } else {
        toast.error(`Failed to pull: ${result.error}`);
      }
    } catch (error) {
      toast.error(`Pull failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      isPulling = false;
    }
  }

  async function handleUndoPush(commitIndex: number) {
    if (!workspaceId) return;

    const commit = allCommits[commitIndex];
    const commitCount = getCommitsToUndoCount(commitIndex);

    // Find the commit hash to reset to (the one after this commit in the array = older commit)
    // Since commits are newest-first, the "next" index is the older commit we want to keep
    const nextCommitIndex = commitIndex + 1;
    let resetToHash: string;

    if (nextCommitIndex < allCommits.length) {
      resetToHash = allCommits[nextCommitIndex].hash;
    } else {
      // This is the oldest commit in the workspace, reset to the base commit (trunk)
      // This will remove all workspace commits from remote
      if (workspace?.baseCommitSha) {
        resetToHash = workspace.baseCommitSha;
      } else {
        // No base commit available, can't safely undo
        toast.error('Cannot undo - no base commit reference available');
        return;
      }
    }

    operatingOnCommitHash = commit.hash;
    isUndoing = true;

    try {
      const result = await AcceptChangesClient.execute(workspaceId as WorkspaceId, 'undo-push', {
        upToCommitHash: resetToHash,
      });

      if (result.success) {
        const commitWord = commitCount === 1 ? 'commit' : 'commits';
        toast.warning(`${commitCount} ${commitWord} removed from remote`);

        // Track undo push after confirmed success
        track('Undid Push', { workspace_id: workspaceId });
        // Invalidate cache and refresh stores to update UI (don't await - let UI update reactively)
        gitCache.invalidate(`git-status-${workspaceId}`);
        Promise.all([
          gitStore.loadStatus(workspaceId as WorkspaceId, true),
          fileTrackingStore.refresh(),
        ]);
      } else {
        toast.error(result.error || 'Failed to undo push');
      }
    } catch (error) {
      toast.error('Failed to undo push');
    } finally {
      isUndoing = false;
      operatingOnCommitHash = null;
    }
  }

  // Get the number of unpushed commits from index 0 to this index (inclusive) that would be undone
  function getLocalCommitsToUndoCount(commitIndex: number): number {
    let count = 0;
    for (let i = 0; i <= commitIndex; i++) {
      if (!allCommits[i].isPushed) {
        count++;
      }
    }
    return count;
  }

  // Get tooltip for undo commit button (local commits)
  function getUndoCommitTooltip(commitIndex: number): string {
    const count = getLocalCommitsToUndoCount(commitIndex);
    const commitWord = count === 1 ? 'commit' : 'commits';

    return count === 1
      ? 'Undo commit (bring changes back to staging)'
      : `Undo ${count} ${commitWord} (bring changes back to staging)`;
  }

  async function handleUndoCommit(commitIndex: number) {
    if (!workspaceId) return;

    const commit = allCommits[commitIndex];
    const commitCount = getLocalCommitsToUndoCount(commitIndex);

    // Find the commit hash to reset to (the one after this commit in the array = older commit)
    // Since commits are newest-first, the "next" index is the older commit we want to keep
    const nextCommitIndex = commitIndex + 1;
    let resetToHash: string;

    if (nextCommitIndex < allCommits.length) {
      resetToHash = allCommits[nextCommitIndex].hash;
    } else {
      // This is the oldest commit in the workspace, reset to the base commit (trunk)
      if (workspace?.baseCommitSha) {
        resetToHash = workspace.baseCommitSha;
      } else {
        toast.error('Cannot undo - no base commit reference available');
        return;
      }
    }

    // Collect metadata from commits being undone (from index 0 to commitIndex, excluding pushed)
    // This metadata is used to restore agent attributions after the soft reset
    const undoCommitsMetadata: UndoCommitMetadata[] = [];
    for (let i = 0; i <= commitIndex; i++) {
      const c = allCommits[i];
      if (!c.isPushed) {
        undoCommitsMetadata.push({
          hash: c.hash,
          agentId: c.agentId,
          linkedNoteId: c.linkedNoteId,
          files: c.files?.map((f) => f.path),
        });
      }
    }

    operatingOnCommitHash = commit.hash;
    isUndoingCommit = true;

    try {
      const result = await AcceptChangesClient.execute(workspaceId as WorkspaceId, 'undo-commit', {
        upToCommitHash: resetToHash,
        undoCommitsMetadata,
      });

      if (result.success) {
        const commitWord = commitCount === 1 ? 'commit' : 'commits';
        toast.warning(`${commitCount} ${commitWord} undone - changes moved to staging`);

        // Track undo commit after confirmed success
        track('Undid Commit', { workspace_id: workspaceId, commit_count: commitCount });
        // Invalidate cache and refresh stores to update UI (don't await - let UI update reactively)
        gitCache.invalidate(`git-status-${workspaceId}`);
        Promise.all([
          gitStore.loadStatus(workspaceId as WorkspaceId, true),
          fileTrackingStore.refresh(),
        ]);
      } else {
        toast.error(result.error || 'Failed to undo commit');
      }
    } catch (error) {
      toast.error('Failed to undo commit');
    } finally {
      isUndoingCommit = false;
      operatingOnCommitHash = null;
    }
  }

  function handleGitHubAuthSuccess() {
    const action = pendingActionAfterAuth;
    pendingActionAfterAuth = null;

    if (githubAuthState.isAuthenticated) {
      if (action === 'create-pr') {
        handleCreatePR(pendingPRWorkspaceId ?? undefined);
        pendingPRWorkspaceId = null;
      } else if (action === 'refresh-pr') {
        handleRefreshPRStatus();
      }
    }
  }

  // Start new workspace with same repo after merge, archiving the current one
  async function handleStartNewSpace() {
    const repo = workspace?.repositoryPath;
    const currentWorkspaceId = workspace?.id;

    // Archive the current workspace first
    if (currentWorkspaceId) {
      const archiveResult = await workspaceStore.archive(currentWorkspaceId);
      if (!archiveResult.ok) {
        toast.error('Failed to archive workspace');
        return;
      }
    }

    // Pre-fill the create form with the current repo info via sessionStorage
    if (repo) {
      sessionStorage.setItem(
        'workspace-prefill',
        JSON.stringify({ repoPath: repo }),
      );
    }

    // Navigate to home page with ?create=true to expand and focus the create form
    const { goto } = await import('$app/navigation');
    await goto('/?create=true');
  }

  // Reset workspace branch to trunk HEAD and continue working
  async function handleResetAndContinue() {
    if (!workspaceId || !workspace) return;

    const capturedWsId = workspaceId;
    isResettingToTrunk = true;
    try {
      const result = await AcceptChangesClient.resetToTrunk(workspaceId as WorkspaceId);

      // If workspace changed during the async call, discard stale updates
      if (workspaceId !== capturedWsId) return;

      if (result.success && result.result?.newHeadSha) {
        // Reset succeeded - now try UI follow-up (non-fatal)
        try {
          // Update baseCommitSha - this is the critical step that "resets" the sidebar boundary
          await workspaceStore.update(workspace.id, { baseCommitSha: result.result.newHeadSha });

          // Clear older commits pagination cache which may reference commits from old history
          fileTrackingStore.clearOlderCommits();

          // Refresh all stores in parallel
          await Promise.all([
            gitStore.loadStatus(workspaceId as WorkspaceId, true),
            fileTrackingStore.refresh(),
          ]);

          // Also refresh aheadOfTrunk and isContentMergedToTrunk to ensure button hides itself
          const resetWsId = workspaceId;
          AcceptChangesClient.getStatus(workspaceId as WorkspaceId).then((s) => {
            if (workspaceId !== resetWsId) return; // workspace changed, discard stale update
            aheadOfTrunk = s.aheadOfTrunk;
            hasRemote = s.hasRemote;
            isContentMergedToTrunk = s.isContentMergedToTrunk ?? false;
          }).catch((err) => {
            console.error('Failed to refresh accept-changes status after reset:', err);
          });

          // Clear merge flags
          isMergedToTrunk = false;
          mergeHeadSha = null;
          isContentMergedToTrunk = false;
          hasResetToTrunk = true;

          toast.success('Workspace reset — ready for new changes');
        } catch (uiError) {
          console.error('Failed to refresh UI after workspace reset:', uiError);
          // Reset succeeded but UI update failed - still clear merge flags since reset did happen
          isMergedToTrunk = false;
          mergeHeadSha = null;
          isContentMergedToTrunk = false;
          hasResetToTrunk = true;
          toast.success('Workspace reset successful. Reload to see updated state.');
        }
      } else {
        toast.error(result.error || 'Failed to reset workspace');
      }
    } catch (error) {
      toast.error('Failed to reset workspace');
    } finally {
      isResettingToTrunk = false;
    }
  }

  // Open the commit changeset view showing all files changed in a commit
  function handleOpenCommitChangeset(commitHash: string, commitMessage: string) {
    window.dispatchEvent(
      new CustomEvent('workspace:open-commit-changeset', {
        detail: { commitHash, commitMessage },
      }),
    );
  }

  // Determine if trunk can be changed (only before first push)
  const canChangeTrunk = $derived(!hasPushedCommits && unpushedCount === 0);

  // Track if we're in the middle of a workspace switch to disable animations
  let isWorkspaceSwitching = $state(false);
  let workspaceSwitchTimeout: ReturnType<typeof setTimeout> | null = null;

  // Detect workspace switches and temporarily disable animations
  $effect(() => {
    // Read workspaceId to create dependency
    void workspaceId;

    // When workspace changes, set switching flag and clear after a short delay
    untrack(() => {
      if (workspaceSwitchTimeout) {
        clearTimeout(workspaceSwitchTimeout);
      }
      isWorkspaceSwitching = true;
      workspaceSwitchTimeout = setTimeout(() => {
        isWorkspaceSwitching = false;
        workspaceSwitchTimeout = null;
      }, 300); // Disable animations for 300ms during workspace switch
    });
  });

  // Safe crossfade that guards against NaN/Infinity values during workspace switches
  export const [send, receive] = crossfade({
    duration: () => (isWorkspaceSwitching ? 0 : 200),

    fallback(node) {
      // During workspace switches, skip animations entirely
      if (isWorkspaceSwitching) {
        return {
          duration: 0,
          css: () => '',
        };
      }

      // Guard against 0-dimension elements that cause NaN/Infinity
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return {
          duration: 0,
          css: () => '',
        };
      }

      return slide(node, { duration: 200, easing: quintOut, delay: 0, axis: 'y' });
    },
  });
</script>

<div class="flex flex-col h-full flex-1 min-h-0 max-h-full">
  <div class="flex-1 flex flex-col min-h-0">
    {#if !hasLoadedForWorkspace}
      <!-- Loading skeleton with timeline (shown during initial load or workspace switch) -->
      <div class="flex-1 overflow-y-auto pt-3 pb-20 pl-3 pr-3">
        <div class="relative">
          <div class="absolute left-0 top-2 bottom-2 w-px bg-border/30"></div>
          {#each Array(4) as _, i (i)}
            <div class="relative pl-4 mb-4">
              <div class="absolute -left-1 top-1 w-2 h-2 rounded-full bg-muted"></div>
              <Skeleton class="h-3 w-16 mb-2" />
              {#if i < 2}
                <Skeleton class="h-5 w-full rounded mb-1" />
                <Skeleton class="h-5 w-3/4 rounded" />
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {:else}
      <!-- Timeline layout - always show all sections -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        bind:this={changesPanelContainer}
        class="sidebar-changes-container min-h-full flex flex-col flex-1 overflow-y-auto pl-3 pr-3 outline-none"
        tabindex="0"
        role="listbox"
        aria-label="File changes"
        onkeydown={handleChangesKeydown}
      >
        <div class="branch-labels w-full flex justify-between mb-1 mt-1">
          <p class="text-muted-foreground/80 leading-snug text-[0.82rem]">Your code lives in:</p>
          <p class="text-muted-foreground/80 leading-snug text-[0.82rem]">
            and will be merged into:
          </p>
        </div>

        <!-- Branch display/edit with trunk branch picker -->
        <div
          class="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-muted-foreground text-xs mb-3 -ml-0.5"
        >
          <!-- Working branch -->
          <div class="flex items-center gap-1 shrink-0">
            <GitBranchIcon size={12} class="shrink-0 text-muted-foreground/60" />
            {#if isEditingBranch}
              <input
                bind:this={branchInputRef}
                type="text"
                bind:value={editedBranch}
                onblur={saveBranch}
                onkeydown={handleBranchKeydown}
                disabled={isSavingBranch}
                class="text-[0.82rem] text-foreground bg-none
                       px-1 py-0.5 rounded
                       outline-none min-w-[60px] max-w-[150px] leading-normal
                       focus:ring-none! focus:outline-none!
                       transition-all duration-150 disabled:opacity-50"
                placeholder="branch name"
                style="width: {Math.max(60, Math.min(150, (editedBranch || '').length * 6 + 20))}px"
              />
            {:else}
              <Tooltip
                content="Working on the {workspace?.branch ||
                  'no branch'} branch. Click to change name."
                side="right"
              >
                <button
                  class="text-[0.82rem] text-muted-foreground bg-transparent
                         border-none px-1 py-0.5 rounded cursor-pointer text-left
                         max-w-full overflow-hidden text-ellipsis whitespace-nowrap
                         transition-all duration-150 leading-normal
                         hover:text-foreground hover:opacity-80
                         focus-visible:outline focus-visible:outline-1
                         focus-visible:outline-primary/50 focus-visible:outline-offset-[-1px]
                         disabled:cursor-default disabled:opacity-50"
                  onclick={startEditingBranch}
                  disabled={!workspace || isSavingBranch}
                >
                  {#if workspace}
                    {workspace.branch || 'no branch'}
                  {/if}
                </button>
              </Tooltip>
            {/if}
          </div>

          <!-- <span class="text-muted-foreground/40 mx-auto">→</span> -->
          <div
            class="relative flex-1 ml-0.5 mr-1.5 bg-muted-foreground/70 text-muted-foreground h-px flex items-end opacity-30"
          >
            <span class="absolute -right-0.5 top-1/2 transform -translate-y-1/2">→</span>
          </div>

          <!-- Trunk branch picker -->
          <div class="flex items-center gap-1 shrink-0 min-w-0 max-w-[min(100%,_10rem)]">
            <Tooltip
              class="min-w-0 max-w-full"
              content={canChangeTrunk
                ? 'Trunk branch - click to change'
                : 'Trunk branch (cannot change after pushing)'}
              side="right"
            >
              <div class="flex items-center min-w-0 max-w-full">
                <BranchSelector
                  variant="ghost"
                  value={trunkBranch}
                  {repoPath}
                  {repoType}
                  disabled={!canChangeTrunk}
                  dropUp={false}
                  portal={true}
                  triggerClass="pl-0 pr-0 h-6 text-[0.82rem]"
                  hasTriggerIcon={false}
                  onchange={async (e) => {
                    try {
                      const result = await workspaceStore.update(workspaceId as WorkspaceId, {
                        baseRef: e.detail.branch,
                      });
                      if (!result.ok) {
                        toast.error('Failed to update base branch');
                      }
                    } catch (err) {
                      console.error('[SidebarChangesPanel] Update error:', err);
                      toast.error('Failed to update base branch');
                    }
                  }}
                />
              </div>
            </Tooltip>
          </div>
        </div>

        <div class="flex items-center mb-4 -ml-1 gap-1.25 h-7">
          <button
            type="button"
            class="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50 cursor-pointer z-10"
            onclick={handleRefreshGitStatus}
            disabled={isRefreshingGitStatus}
            title="Refresh git status"
          >
            <Fa
              icon={faArrowsRotate}
              class="text-muted-foreground/60 {isRefreshingGitStatus ? 'animate-spin' : ''}"
              size={10}
            />
          </button>

          <!-- View All Changes Button -->
          {#if hasAnyChanges}
            {@const isActive = isAllChangesViewActive}
            <button
              onclick={handleOpenAllChanges}
              class="flex flex-1 items-center border gap-2 pr-2 py-1.5 text-muted-foreground rounded-sm transition-colors group cursor-pointer min-w-0 {isActive
                ? 'bg-background text-foreground border-border shadow-xs pl-2'
                : 'border-transparent'}
                "
            >
              <div class="flex items-center gap-1.5 flex-1 min-w-0">
                <!-- <Fa icon={faFolderOpen} class="opacity-30" size="xs" /> -->
                <span class="text-[0.82rem] truncate min-w-0 text-left flex-1">
                  {totalFilesChanged} file{totalFilesChanged !== 1 ? 's' : ''} changed in Space
                </span>
                <!-- <LineChangesBadge additions={totalAdditions} deletions={totalDeletions} size="xs" /> -->
              </div>
            </button>
          {:else}
            <div
              class="flex flex-1 items-center gap-2 pr-2 py-1.5 text-muted-foreground rounded-sm transition-colors group cursor-pointer min-w-0"
            >
              <span class="text-[0.82rem] truncate min-w-0 text-left flex-1">No changes yet</span>
            </div>
          {/if}

          <!-- Code Review Button -->
          <!-- {#if hasAnyChanges}
            <Tooltip content="Open AI code review" side="bottom">
              <button
                onclick={handleOpenCodeReviewClick}
                class="flex items-center gap-1.5 px-2 py-1.5 text-muted-foreground hover:text-foreground rounded-sm transition-colors cursor-pointer border border-transparent hover:border-border hover:bg-background"
              >
                <Fa icon={faMagnifyingGlass} class="opacity-50" size="xs" />
                <span class="text-xs">Review</span>
              </button>
            </Tooltip>
          {/if} -->
        </div>

        <!-- Truncation warning banner -->
        {#if changesTruncated}
          <div
            class="mb-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-md text-xs text-amber-600 dark:text-amber-400"
          >
            <span class="font-medium"
              >Showing {unstagedChanges.length + stagedChanges.length} of {totalChangesCount} changes.</span
            >
            {#if hiddenChangesCount > 0}
              <span class="opacity-80">
                {hiddenChangesCount} older change{hiddenChangesCount !== 1 ? 's' : ''} hidden to improve
                performance.
              </span>
            {/if}
          </div>
        {/if}

        <div class="relative flex-1 flex flex-col pb-2 w-full">
          <!-- Vertical timeline line -->
          <div class="absolute left-1 top-2 bottom-0 w-px bg-border dark:bg-border/50"></div>

          <!-- UNSTAGED SECTION -->
          <div>
            <TimelineSection
              title="Unstaged"
              subtitle="New"
              active={hasUnstaged}
              activeColor="bg-amber-500"
            >
              {#snippet action()}
                <!-- Auto-commit toggle -->
                <div class="flex items-center justify-between gap-2 -my-0.5">
                  <Tooltip
                    content={autoCommitEnabled
                      ? 'Agent changes will be committed automatically when finished'
                      : 'Agent changes need to be committed manually'}
                    side="right"
                    contentClass="w-[12rem]"
                    disableHoverableContent={false}
                    disableCloseOnTriggerClick={true}
                  >
                    <Toggle
                      variant="switch"
                      size="xs"
                      onLabel="Auto-commit"
                      offLabel="Auto-commit"
                      pressed={autoCommitEnabled}
                      class="font-normal text-muted-foreground/50 flex-row-reverse -mr-1 whitespace-nowrap"
                      onclick={() => {
                        if (workspaceSettings) {
                          // Toggle is about to flip pressed, so we set the opposite of current
                          workspaceSettings.autoCommitEnabled = !autoCommitEnabled;
                        }
                      }}
                    />
                  </Tooltip>
                </div>
              {/snippet}

              {#if hasUnstaged}
                {#if hasAnyAgentAttribution}
                  <!-- Grouped view with agent headers -->
                  <div class="space-y-1">
                    {#each unstagedByAgent as group (group.agentId ?? 'manual')}
                      {@const isCollapsed = isAgentGroupCollapsed(group.agentId)}
                      {@const isLocked = isAgentGroupLocked(group.agentId)}
                      {@const commitState = getGroupCommitState(group, 'unstaged')}
                      {@const queuePos = getGroupQueuePosition(group, 'unstaged')}
                      <div class="space-y-px">
                        <!-- Agent header -->
                        <div
                          class="relative group/agent-header flex items-center gap-1.5 py-0.5 -ml-1 px-1"
                        >
                          <button
                            type="button"
                            class="group/row flex items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer rounded px-1 -mx-1"
                            onclick={() => toggleAgentGroup(group.agentId)}
                          >
                            <!-- Lock icon for locked groups -->
                            {#if isLocked}
                              <Tooltip
                                content="These changes will auto-commit when agent completes"
                                align="start"
                              >
                                <Fa
                                  icon={faLock}
                                  class="text-muted-foreground/50 shrink-0"
                                  size={10}
                                />
                              </Tooltip>
                            {/if}
                            <span
                              class="text-[0.82rem] opacity-50 truncate flex-1 {isLocked
                                ? 'opacity-40'
                                : ''}"
                            >
                              {getAgentDisplayName(group)}
                            </span>
                            {#if group.agentId}
                              {@const hasAnyActions = !isLocked || getLinkedNoteId(group.agentId)}
                              <AuggieAvatar
                                class="-mt-0.5 {hasAnyActions
                                  ? 'group-hover/agent-header:opacity-0'
                                  : ''}"
                                faceSeed={group.agentId}
                                colorSeed={group.agentId}
                                size={15}
                              />
                            {:else}
                              <Fa icon={faUser} class="h-2.5 w-2.5 text-muted-foreground/30 {!isLocked ? 'group-hover/agent-header:opacity-0' : ''}" />
                            {/if}
                          </button>
                          <!-- Action buttons - linked note always visible, staging controls hidden when locked -->
                          <div
                            class="bg-sidebar absolute top-1/2 right-1 transform translate-x-1 transition-transform {commitState !== 'idle' ? 'translate-x-0 opacity-100' : 'group-hover/agent-header:translate-x-0'} -translate-y-1/2 {commitState !== 'idle' ? '' : 'opacity-0 group-hover/agent-header:opacity-100'} flex items-center pl-0.25"
                          >
                            {#if group.agentId && getLinkedNoteId(group.agentId)}
                              <Button
                                variant="ghost-light"
                                size="icon-xs"
                                class="h-5 w-5"
                                tooltip="Open linked note"
                                onclick={(e: MouseEvent) => {
                                  e.stopPropagation();
                                  const noteId = getLinkedNoteId(group.agentId);
                                  if (noteId) onOpenNote?.(noteId);
                                }}
                              >
                                <Fa icon={faNote} class="h-2.5! w-2.5!" />
                              </Button>
                            {/if}
                            {#if !isLocked}
                              <Button
                                variant="ghost-light"
                                size="icon-xs"
                                class="h-5 w-5"
                                tooltip="Approve all"
                                onclick={(e: MouseEvent) => {
                                  e.stopPropagation();
                                  handleStageGroup(group);
                                }}
                              >
                                <Fa icon={faPlus} class="h-2.5! w-2.5!" />
                              </Button>
                              <!-- Commit group button with queue state -->
                              {#if commitState === 'active'}
                                <Tooltip content="Committing..." side="top">
                                  <span class="h-5 w-5 flex items-center justify-center">
                                    <Fa icon={faSpinner} class="h-2.5! w-2.5! animate-spin text-primary" />
                                  </span>
                                </Tooltip>
                              {:else if commitState === 'queued'}
                                <Button
                                  variant="ghost-light"
                                  size="icon-xs"
                                  class="h-5 w-5 relative"
                                  tooltip="Queued — click to cancel"
                                  onclick={(e: MouseEvent) => {
                                    e.stopPropagation();
                                    cancelGroupCommit(group, 'unstaged');
                                  }}
                                >
                                  <span class="text-[9px] font-semibold text-primary leading-none">{queuePos}</span>
                                </Button>
                              {:else}
                                <Button
                                  variant="ghost-light"
                                  size="icon-xs"
                                  class="h-5 w-5"
                                  tooltip="Stage & commit"
                                  onclick={(e: MouseEvent) => {
                                    e.stopPropagation();
                                    enqueueGroupCommit(group, 'unstaged');
                                  }}
                                >
                                  <Fa icon={faCodeCommit} class="h-2.5! w-2.5!" />
                                </Button>
                              {/if}
                            {/if}
                          </div>
                        </div>
                        <!-- Files in group -->
                        {#if !isCollapsed}
                          <div class="pl-1" transition:slide={{ duration: 150 }}>
                            {#each group.files as file (file.path)}
                              <div
                                data-file-key="unstaged:{file.path}"
                                in:receive|global={{ key: file.path }}
                                out:send|global={{ key: file.path }}
                              >
                                <FileRow
                                  {file}
                                  showStageAction={!isLocked}
                                  showRevertAction={!isLocked}
                                  locked={isLocked}
                                  active={isFileActive(file.path, false)}
                                  selected={isFileSelected(file.path, false)}
                                  focused={isFileFocused(file.path, false)}
                                  onFileClick={(path, commitHash) => {
                                    trackLastClicked(path, false);
                                    handleFileClick(path, commitHash, false);
                                  }}
                                  onSelectClick={(path, e) => handleSelectClick(path, false, e)}
                                  onStage={handleStageFile}
                                  onRevert={handleRevertFile}
                                  onOpenFile={handleOpenFile}
                                />
                              </div>
                            {/each}
                          </div>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {:else}
                  <!-- Flat view when no agent attribution -->
                  <div class="space-y-px">
                    {#each unstagedChanges as change (change.id)}
                      <div
                        data-file-key="unstaged:{change.relativePath}"
                        in:receive|global={{ key: change.relativePath }}
                        out:send|global={{ key: change.relativePath }}
                        animate:flip={{ duration: isWorkspaceSwitching ? 0 : 100 }}
                      >
                        <FileRow
                          file={toUIFileChange(change, false)}
                          showStageAction
                          showRevertAction
                          active={isFileActive(change.relativePath, false)}
                          selected={isFileSelected(change.relativePath, false)}
                          focused={isFileFocused(change.relativePath, false)}
                          onFileClick={(path, commitHash) => {
                            trackLastClicked(path, false);
                            handleFileClick(path, commitHash, false);
                          }}
                          onSelectClick={(path, e) => handleSelectClick(path, false, e)}
                          onStage={handleStageFile}
                          onRevert={handleRevertFile}
                          onOpenFile={handleOpenFile}
                        />
                      </div>
                    {/each}
                  </div>
                {/if}
              {/if}
            </TimelineSection>
          </div>

          <!-- Divider with Stage all / Unstage all buttons -->
          <div>
            <TimelineDivider>
              {#if hasUnstaged}
                <DividerButton onclick={handleStageAll} disabled={isStaging} loading={isStaging}>
                  Stage all
                </DividerButton>
              {/if}
              {#if hasStaged}
                <DividerButton
                  onclick={handleUnstageAll}
                  disabled={isStaging}
                  loading={isStaging}
                  arrowUp
                >
                  Unstage all
                </DividerButton>
              {/if}
            </TimelineDivider>
          </div>

          <!-- STAGED SECTION -->
          <div>
            <TimelineSection
              title="Staged"
              subtitle="Approved"
              active={hasStaged}
              activeColor="bg-emerald-500"
            >
              {#if hasStaged}
                {#if hasAnyAgentAttribution}
                  <!-- Grouped view with agent headers -->
                  <div class="space-y-1">
                    {#each stagedByAgent as group (group.agentId ?? 'manual')}
                      {@const isCollapsed = isAgentGroupCollapsed(group.agentId)}
                      {@const isLocked = isAgentGroupLocked(group.agentId)}
                      {@const commitState = getGroupCommitState(group, 'staged')}
                      {@const queuePos = getGroupQueuePosition(group, 'staged')}
                      <div class="space-y-px">
                        <!-- Agent header -->
                        <div
                          class="relative group/agent-header flex items-center gap-1.5 py-0.5 -ml-1 px-1"
                        >
                          <button
                            type="button"
                            class="group/row flex items-center gap-1.5 flex-1 min-w-0 text-left cursor-pointer rounded px-1 -mx-1"
                            onclick={() => toggleAgentGroup(group.agentId)}
                          >
                            <span class="text-[0.82rem] opacity-50 truncate flex-1">
                              {getAgentDisplayName(group)}
                            </span>

                            {#if group.agentId}
                              {@const hasAnyActions = !isLocked || getLinkedNoteId(group.agentId)}
                              <AuggieAvatar
                                class="-mt-0.5 {hasAnyActions
                                  ? 'group-hover/agent-header:opacity-0'
                                  : ''}"
                                faceSeed={group.agentId}
                                colorSeed={group.agentId}
                                size={15}
                              />
                            {:else}
                              <Fa
                                icon={faUser}
                                class="h-2.5 w-2.5 ml-1 mr-1 text-muted-foreground/30 {!isLocked ? 'group-hover/agent-header:opacity-0' : ''}"
                              />
                            {/if}
                          </button>
                          <!-- Action buttons - linked note always visible, staging controls hidden when locked -->
                          <div
                            class="bg-sidebar absolute top-1/2 right-1 transform translate-x-1 transition-transform {commitState !== 'idle' ? 'translate-x-0 opacity-100' : 'group-hover/agent-header:translate-x-0'} -translate-y-1/2 {commitState !== 'idle' ? '' : 'opacity-0 group-hover/agent-header:opacity-100'} flex items-center gap-0.5"
                          >
                            {#if group.agentId && getLinkedNoteId(group.agentId)}
                              <Button
                                variant="ghost-light"
                                size="icon-xs"
                                class="h-5 w-5"
                                tooltip="Open linked note"
                                onclick={(e: MouseEvent) => {
                                  e.stopPropagation();
                                  const noteId = getLinkedNoteId(group.agentId);
                                  if (noteId) onOpenNote?.(noteId);
                                }}
                              >
                                <Fa icon={faNote} class="h-2.5! w-2.5!" />
                              </Button>
                            {/if}
                            {#if !isLocked}
                              <Button
                                variant="ghost-light"
                                size="icon-xs"
                                class="h-5 w-5"
                                tooltip="Unapprove all"
                                onclick={(e: MouseEvent) => {
                                  e.stopPropagation();
                                  handleUnstageGroup(group);
                                }}
                              >
                                <Fa icon={faMinus} class="h-2.5! w-2.5!" />
                              </Button>
                              <!-- Commit group button with queue state -->
                              {#if commitState === 'active'}
                                <Tooltip content="Committing..." side="top">
                                  <span class="h-5 w-5 flex items-center justify-center">
                                    <Fa icon={faSpinner} class="h-2.5! w-2.5! animate-spin text-primary" />
                                  </span>
                                </Tooltip>
                              {:else if commitState === 'queued'}
                                <Button
                                  variant="ghost-light"
                                  size="icon-xs"
                                  class="h-5 w-5 relative"
                                  tooltip="Queued — click to cancel"
                                  onclick={(e: MouseEvent) => {
                                    e.stopPropagation();
                                    cancelGroupCommit(group, 'staged');
                                  }}
                                >
                                  <span class="text-[9px] font-semibold text-primary leading-none">{queuePos}</span>
                                </Button>
                              {:else}
                                <Button
                                  variant="ghost-light"
                                  size="icon-xs"
                                  class="h-5 w-5"
                                  tooltip="Commit"
                                  onclick={(e: MouseEvent) => {
                                    e.stopPropagation();
                                    enqueueGroupCommit(group, 'staged');
                                  }}
                                >
                                  <Fa icon={faCodeCommit} class="h-2.5! w-2.5!" />
                                </Button>
                              {/if}
                            {/if}
                          </div>
                        </div>
                        <!-- Files in group -->
                        {#if !isCollapsed}
                          <div class="pl-1" transition:slide={{ duration: 150 }}>
                            {#each group.files as file (file.path)}
                              <div
                                data-file-key="staged:{file.path}"
                                in:receive|global={{ key: file.path }}
                                out:send|global={{ key: file.path }}
                              >
                                <FileRow
                                  {file}
                                  showStageAction={!isLocked}
                                  locked={isLocked}
                                  active={isFileActive(file.path, true)}
                                  selected={isFileSelected(file.path, true)}
                                  focused={isFileFocused(file.path, true)}
                                  onFileClick={(path, commitHash) => {
                                    trackLastClicked(path, true);
                                    handleFileClick(path, commitHash, true);
                                  }}
                                  onSelectClick={(path, e) => handleSelectClick(path, true, e)}
                                  onUnstage={handleUnstageFile}
                                  onOpenFile={handleOpenFile}
                                />
                              </div>
                            {/each}
                          </div>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {:else}
                  <!-- Flat view when no agent attribution -->
                  <div class="space-y-px">
                    {#each stagedChanges as change (change.id)}
                      <div
                        data-file-key="staged:{change.relativePath}"
                        in:receive|global={{ key: change.relativePath }}
                        out:send|global={{ key: change.relativePath }}
                      >
                        <FileRow
                          file={toUIFileChange(change, true)}
                          showStageAction
                          active={isFileActive(change.relativePath, true)}
                          selected={isFileSelected(change.relativePath, true)}
                          focused={isFileFocused(change.relativePath, true)}
                          onFileClick={(path, commitHash) => {
                            trackLastClicked(path, true);
                            handleFileClick(path, commitHash, true);
                          }}
                          onSelectClick={(path, e) => handleSelectClick(path, true, e)}
                          onUnstage={handleUnstageFile}
                          onOpenFile={handleOpenFile}
                        />
                      </div>
                    {/each}
                  </div>
                {/if}
              {/if}
            </TimelineSection>
          </div>

          <!-- Divider with Commit and Export buttons -->
          <TimelineDivider>
            <div class="w-full flex gap-1">
              <DividerButton
                tooltipContents={!hasStaged ? 'No staged changes to commit' : ''}
                onclick={() => {
                  commitDrawerOpen = !commitDrawerOpen;
                  if (commitDrawerOpen) exportDrawerOpen = false;
                }}
                expanded={commitDrawerOpen}
                disabled={!hasStaged}
              >
                Commit
              </DividerButton>
              <DividerButton
                tooltipContents={!hasStaged && !hasUnstaged ? 'No changes to export' : ''}
                onclick={() => {
                  exportDrawerOpen = !exportDrawerOpen;
                  if (exportDrawerOpen) commitDrawerOpen = false;
                }}
                expanded={exportDrawerOpen}
                disabled={!hasStaged && !hasUnstaged}
                arrowRight
              >
                Export
              </DividerButton>
            </div>
            <DividerPanel open={commitDrawerOpen}>
              {#if hasStaged}
                <p class="text-xs text-muted-foreground">
                  {stagedChanges.length} staged file{stagedChanges.length === 1 ? '' : 's'} will be committed.
                </p>
              {/if}
              <div class="relative">
                <Textarea
                  value={commitMessage}
                  oninput={(e) => (commitMessage = (e.target as HTMLTextAreaElement).value)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleCommit();
                    }
                  }}
                  placeholder="Commit message..."
                  doesExpandToFit
                  minHeight={60}
                  maxHeight={150}
                  readonly={isGenerating}
                  class="text-sm {isGenerating ? 'border-primary/40 bg-muted/20' : ''}"
                />
              </div>
              <div class="flex items-center gap-2 flex-wrap w-full">
                <!-- Submit button - show pending state when commitWhenReady is toggled during generation -->
                <Button
                  variant="default"
                  size="xs"
                  onclick={() => handleCommit()}
                  disabled={!commitMessage.trim() ||
                    isCommitting ||
                    (isGenerating && commitWhenReady)}
                >
                  {#if isCommitting || (isGenerating && commitWhenReady)}
                    <Fa icon={faSpinner} size="xs" class="animate-spin" />
                    <span>{isCommitting ? 'Committing...' : 'Will commit when done...'}</span>
                  {:else}
                    <Fa icon={faCodeCommit} size="xs" class="opacity-50" />
                    <span>Commit</span>
                  {/if}
                </Button>
                <!-- Auto-fill button with eye/stop icons when generating -->
                {#if isGenerating}
                  <div class="flex items-center">
                    <Button
                      variant="outline"
                      size="xs"
                      class="rounded-r-none border-r-0"
                      onclick={handleStopGenerating}
                    >
                      <Fa icon={faSpinner} size="xs" class="animate-spin" />
                      <span class="mr-1">Auto-fill</span>
                      <Fa icon={faStop} size="xs" />
                    </Button>
                    {#if commitAgentId}
                      <Button
                        variant="outline"
                        size="icon-xs"
                        class="rounded-none h-7!"
                        onclick={viewCommitThoughtProcess}
                        tooltip="View thought process"
                        tooltipSide="top"
                        tooltipDelayDuration={0}
                      >
                        <Fa icon={faEye} size="xs" />
                      </Button>
                    {/if}

                    <Button
                      variant={commitWhenReady ? 'default' : 'outline'}
                      size="xs"
                      class="rounded-l-none border-l-0"
                      onclick={toggleCommitWhenReady}
                    >
                      {#if commitWhenReady}
                        <Fa icon={faCheck} size="xs" />
                      {/if}
                      Auto-commit when done
                    </Button>
                  </div>
                {:else}
                  <div class="flex items-center">
                    <Button
                      variant="outline"
                      size="xs"
                      class={commitAgentId ? 'rounded-r-none border-r-0' : ''}
                      onclick={handleAutoFill}
                    >
                      <Fa icon={faRobot} size="xs" class="opacity-50" />
                      <span>Auto-fill</span>
                    </Button>
                    {#if commitAgentId}
                      <Button
                        variant="outline"
                        size="icon-xs"
                        class="rounded-l-none border-l-0 h-7!"
                        onclick={viewCommitThoughtProcess}
                        tooltip="View thought process"
                        tooltipSide="top"
                        tooltipDelayDuration={0}
                      >
                        <Fa icon={faEye} size="xs" />
                      </Button>
                    {/if}
                  </div>
                {/if}
              </div>
            </DividerPanel>
            <!-- Export Panel -->
            <DividerPanel open={exportDrawerOpen}>
              {@const unstagedCount = unstagedChanges.length}
              {@const stagedCount = stagedChanges.length}
              {@const commitCount = allCommits.length}
              {@const unstagedText =
                unstagedCount > 0
                  ? `${unstagedCount} unstaged file${unstagedCount === 1 ? '' : 's'}`
                  : ''}
              {@const stagedText =
                stagedCount > 0 ? `${stagedCount} staged file${stagedCount === 1 ? '' : 's'}` : ''}
              {@const commitText =
                commitCount > 0 ? `${commitCount} commit${commitCount === 1 ? '' : 's'}` : ''}
              {@const parts = [unstagedText, stagedText, commitText].filter(Boolean)}
              <p class="text-xs text-muted-foreground">
                Export files to a folder outside this workspace. This copies files while preserving
                directory structure, allowing you to use them in another project or share
                externally.
              </p>
              {#if parts.length > 0}
                <p class="text-xs text-muted-foreground/70 mt-1">
                  {parts.join(' and ')} will be exported.
                </p>
              {/if}
              <div class="mt-2">
                <span class="text-xs text-muted-foreground mb-1 block">Destination Folder</span>
                <div class="relative">
                  <input
                    type="text"
                    class="w-full px-2.5 py-1.5 pr-8 text-sm bg-muted/30 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
                    placeholder="Select folder..."
                    bind:value={exportPath}
                    readonly
                  />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    class="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                    onclick={async () => {
                      const path = await handlePickExportFolder();
                      if (path) exportPath = path;
                    }}
                  >
                    <Fa icon={faFolderOpen} size="xs" class="opacity-50" />
                  </Button>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <Button variant="default" size="xs" onclick={handleExport} disabled={isExporting}>
                  {#if isExporting}
                    <Fa icon={faSpinner} size="xs" class="animate-spin" />
                    <span>Exporting...</span>
                  {:else}
                    <Fa icon={faFolderOpen} size="xs" class="opacity-50" />
                    <span>Export Files</span>
                  {/if}
                </Button>
              </div>
            </DividerPanel>
          </TimelineDivider>

          <!-- COMMITS SECTION -->
          <TimelineSection title="Commits" active={allCommits.length > 0} activeColor="bg-blue-500">
            {#if allCommits.length > 0}
              <div class="space-y-0.5">
                {#each allCommits as commit, index (commit.hash)}
                  <!-- Divider between local and pushed commits (only when remote exists) -->
                  {#if hasRemote && commit.isPushed && index > 0 && !allCommits[index - 1].isPushed && commits.length > 0}
                    <div class="flex items-center gap-2 px-1 py-1.5">
                      <div class="flex-1 h-px bg-border"></div>
                      <span class="text-xs text-muted-foreground">Pushed to remote</span>
                      <div class="flex-1 h-px bg-border"></div>
                    </div>
                  {/if}
                  {@const isOperatingOnThis = operatingOnCommitHash === commit.hash}
                  {@const isExpanded = expandedCommits.has(commit.hash)}
                  {@const files = (commit.files ?? []).map((f) => ({
                    path: f.path,
                    additions: f.additions,
                    deletions: f.deletions,
                    staged: false,
                  })) as UIFileChange[]}
                  <div>
                    <!-- Commit header -->
                    <div
                      class="relative flex items-center gap-2 py-0.5 group w-full rounded px-1 -mx-1"
                      oncontextmenu={(e) => handleCommitContextMenu(e, commit.hash)}
                    >
                      {#if commit.files && commit.files.length > 0}
                        <Button
                          variant="ghost-light"
                          size="icon-xs"
                          class="absolute left-0.75 bg-sidebar {commit.agentId
                            ? 'opacity-0 group-hover:opacity-100'
                            : 'opacity-0 group-hover:opacity-100'} hover:text-foreground! -ml-1"
                          onclick={(e: MouseEvent) => {
                            e.stopPropagation();
                            toggleCommitExpanded(commit.hash);
                          }}
                          title="Toggle file list"
                        >
                          <Fa
                            icon={faChevronDown}
                            size={12}
                            class="text-muted-foreground/60 shrink-0 transition-transform {isExpanded
                              ? 'rotate-0'
                              : '-rotate-90'}"
                          />
                          <LineChangesBadge
                            additions={commit.files.reduce((sum, f) => sum + (f.additions || 0), 0)}
                            deletions={commit.files.reduce((sum, f) => sum + (f.deletions || 0), 0)}
                            size="xs"
                          />
                        </Button>
                      {/if}

                      <!-- Show auggie avatar instead of commit icon when made by an agent - hides on hover to show chevron -->
                      {#if commit.agentId}
                        <span
                          class="shrink-0 group-hover:opacity-0 transition-opacity pointer-events-none"
                        >
                          <AuggieAvatar
                            faceSeed={commit.agentId}
                            colorSeed={commit.agentId}
                            size={14}
                            class="mr-[-2px]"
                          />
                        </span>
                      {:else}
                        <Fa
                          icon={faCodeCommit}
                          size="xs"
                          class="text-muted-foreground/40 shrink-0"
                        />
                      {/if}
                      {#if editingCommitHash === commit.hash}
                        <!-- Inline edit mode for commit message -->
                        <input
                          bind:this={editCommitInputRef}
                          type="text"
                          bind:value={editingCommitValue}
                          onblur={saveCommitEdit}
                          onkeydown={handleCommitEditKeydown}
                          class="flex-1 text-[0.82rem] text-muted-foreground bg-transparent border-none outline-none! ring-0! focus:ring-0! focus:outline-none! focus-visible:ring-0! focus-visible:outline-none! min-w-0"
                          onclick={(e) => e.stopPropagation()}
                        />
                      {:else}
                        <button
                          type="button"
                          class="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer {commit.isPushed &&
                          !commit.agentId
                            ? 'pr-5'
                            : ''}"
                          onclick={() => handleOpenCommitChangeset(commit.hash, commit.message)}
                          ondblclick={(e) => handleCommitMessageDoubleClick(e, commit, index)}
                        >
                          <span
                            class="text-[0.82rem] text-muted-foreground truncate flex-1 {canAmendCommit(
                              index,
                            )
                              ? ''
                              : ''}"
                            title={commit.message}
                          >
                            {commit.message}
                          </span>
                        </button>
                      {/if}

                      <!-- Right side: Cloud icon for pushed commits (fades on hover, only when remote exists) -->
                      {#if hasRemote && commit.isPushed && !commit.agentId}
                        <span
                          class="absolute right-0 shrink-0 group-hover:opacity-0 transition-opacity"
                        >
                          <Fa icon={faCloud} class="text-muted-foreground/30 p-0.5" size={15} />
                        </span>
                      {/if}

                      <div
                        class="absolute -right-1 pl-1 bg-sidebar flex items-center {isOperatingOnThis
                          ? ''
                          : 'opacity-0 group-hover:opacity-100'} transition-opacity"
                      >
                        {#if hasRemote && commit.isPushed}
                          <!-- External link button to open commit in browser (only for pushed commits) -->
                          <Button
                            variant="ghost-light"
                            size="icon-xs"
                            class="{!isOperatingOnThis &&
                              'opacity-0!'} group-hover:opacity-100! transition-opacity shrink-0"
                            onclick={(e: MouseEvent) => openCommitInBrowser(commit.hash, e)}
                            tooltip="Open in browser"
                            tooltipSide="top"
                          >
                            <Fa
                              icon={faArrowUpRightFromSquare}
                              size="xs"
                              class="text-muted-foreground"
                            />
                          </Button>
                          <!-- Undo push button - absolutely positioned to overlap cloud icon -->
                          <div
                            class="{!isOperatingOnThis &&
                              'opacity-0'} group-hover:opacity-100 transition-opacity"
                          >
                            <Button
                              variant="ghost-light"
                              size="icon-xs"
                              onclick={() => handleUndoPush(index)}
                              disabled={isPushing || isUndoing}
                              tooltip={getUndoTooltip(index)}
                              tooltipSide="top"
                            >
                              {#if isOperatingOnThis && isUndoing}
                                <Fa
                                  icon={faSpinner}
                                  size="xs"
                                  class="animate-spin text-muted-foreground"
                                />
                              {:else}
                                <Fa icon={faRotateLeft} size="xs" class="text-muted-foreground" />
                              {/if}
                            </Button>
                          </div>
                        {:else}
                          <!-- Undo commit button for unpushed commits -->
                          <Button
                            variant="ghost-light"
                            size="icon-xs"
                            class="{!isOperatingOnThis &&
                              'opacity-0!'} group-hover:opacity-100! transition-opacity shrink-0"
                            onclick={() => handleUndoCommit(index)}
                            disabled={isPushing || isUndoing || isUndoingCommit}
                            tooltip={getUndoCommitTooltip(index)}
                            tooltipSide="top"
                          >
                            {#if isOperatingOnThis && isUndoingCommit}
                              <Fa
                                icon={faSpinner}
                                size="xs"
                                class="animate-spin text-muted-foreground"
                              />
                            {:else}
                              <Fa icon={faRotateLeft} size="xs" class="text-muted-foreground" />
                            {/if}
                          </Button>
                          <!-- Push button for unpushed commits (only when remote exists) -->
                          {#if hasRemote}
                            <Button
                              variant="ghost-light"
                              size="icon-xs"
                              class="{!isOperatingOnThis &&
                                'opacity-0!'} group-hover:opacity-100! transition-opacity shrink-0"
                              onclick={() => handlePushCommits(index)}
                              disabled={isPushing || isUndoing || isUndoingCommit}
                              tooltip={getPushTooltip(index)}
                              tooltipSide="top"
                            >
                              {#if isOperatingOnThis && isPushing}
                                <Fa
                                  icon={faSpinner}
                                  size="xs"
                                  class="animate-spin text-muted-foreground"
                                />
                              {:else}
                                <Fa
                                  icon={faArrowUpFromBracket}
                                  size="xs"
                                  class="text-muted-foreground"
                                />
                              {/if}
                            </Button>
                          {/if}
                        {/if}
                      </div>
                    </div>

                    <!-- Expanded panel content -->
                    {#if isExpanded}
                      {@const linkedNoteId =
                        commit.linkedNoteId || getLinkedNoteId(commit.agentId ?? null)}
                      <div
                        class="pl-5 pr-1.5 pb-0.5 pt-0.5 space-y-px"
                        transition:slide={{ duration: 150 }}
                      >
                        <!-- Files list -->
                        {#each files as file (file.path)}
                          <FileRow
                            {file}
                            muted={true}
                            active={activeFilePath === file.path && activeFileStaged === null}
                            onFileClick={(filePath) => {
                              handleCommitFileClick(filePath, commit.hash).catch((error) => {
                                logger.error('Error in handleCommitFileClick', { error });
                              });
                            }}
                            onOpenFile={handleOpenFile}
                          />
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}

            <!-- Workspace start boundary marker + show previous toggle -->
            {#if boundarySha}
              <button
                class="group/boundary relative w-full cursor-pointer {allCommits.length > 0
                  ? 'mt-2'
                  : ''}"
                disabled={loadingOlderCommits}
                onclick={() => {
                  if (olderCommits.length > 0) {
                    fileTrackingStore.clearOlderCommits();
                  } else {
                    fileTrackingStore.loadOlderCommits(boundarySha);
                  }
                }}
              >
                <div
                  class="relative flex items-center gap-2 px-1 pr-3 w-fit bg-sidebar mr-auto py-2 z-10 group-hover/boundary:opacity-100 {olderCommits.length >
                  0
                    ? 'opacity-100'
                    : 'opacity-0'}"
                >
                  <span
                    class="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-sidebar select-none"
                  >
                    Workspace start
                    {#if loadingOlderCommits}
                      <Fa icon={faSpinner} class="opacity-50 animate-spin" size="xs" />
                    {:else}
                      <Fa
                        icon={faChevronDown}
                        size="xs"
                        class="opacity-50 transition-transform {olderCommits.length > 0
                          ? 'rotate-180'
                          : ''}"
                      />
                    {/if}
                  </span>
                </div>
                <div class="absolute top-4.5 left-0 right-0 flex-1 border-t border-border/50"></div>
              </button>
            {/if}

            <!-- Older commits (dimmed, below boundary) -->
            {#if olderCommits.length > 0}
              <div class="space-y-0.5 opacity-60 hover:opacity-100 transition-opacity">
                {#each olderCommits as commit (commit.hash)}
                  {@const isExpanded = expandedCommits.has(commit.hash)}
                  {@const files = (commit.files ?? []).map((f) => ({
                    path: f.path,
                    additions: f.additions,
                    deletions: f.deletions,
                    staged: false,
                  })) as UIFileChange[]}
                  <div>
                    <div
                      class="relative flex items-center gap-2 py-0.5 group w-full rounded px-1 -mx-1"
                      oncontextmenu={(e) => handleCommitContextMenu(e, commit.hash)}
                    >
                      {#if commit.files && commit.files.length > 0}
                        <Button
                          variant="ghost-light"
                          size="icon-xs"
                          class="absolute left-0.75 bg-sidebar opacity-0 group-hover:opacity-100 hover:text-foreground! -ml-1"
                          onclick={(e: MouseEvent) => {
                            e.stopPropagation();
                            toggleCommitExpanded(commit.hash);
                          }}
                          title="Toggle file list"
                        >
                          <Fa
                            icon={faChevronDown}
                            size={12}
                            class="text-muted-foreground/60 shrink-0 transition-transform {isExpanded
                              ? 'rotate-0'
                              : '-rotate-90'}"
                          />
                          <LineChangesBadge
                            additions={commit.files.reduce((sum, f) => sum + (f.additions || 0), 0)}
                            deletions={commit.files.reduce((sum, f) => sum + (f.deletions || 0), 0)}
                            size="xs"
                          />
                        </Button>
                      {/if}

                      <Fa icon={faCodeCommit} size="xs" class="text-muted-foreground/40 shrink-0" />
                      <button
                        type="button"
                        class="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
                        onclick={() => handleOpenCommitChangeset(commit.hash, commit.message)}
                      >
                        <span
                          class="text-[0.82rem] text-muted-foreground truncate flex-1"
                          title={commit.message}
                        >
                          {commit.message}
                        </span>
                      </button>
                    </div>

                    {#if isExpanded}
                      <div
                        class="pl-5 pr-1.5 pb-0.5 pt-0.5 space-y-px"
                        transition:slide={{ duration: 150 }}
                      >
                        {#each files as file (file.path)}
                          <FileRow
                            {file}
                            muted={true}
                            active={activeFilePath === file.path && activeFileStaged === null}
                            onFileClick={(filePath) => {
                              handleCommitFileClick(filePath, commit.hash).catch((error) => {
                                logger.error('Error in handleCommitFileClick', { error });
                              });
                            }}
                            onOpenFile={handleOpenFile}
                          />
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}

            <!-- Load more previous commits -->
            {#if olderCommits.length > 0}
              <button
                class="w-full text-[11px] text-muted-foreground/40 hover:text-muted-foreground py-1 transition-colors cursor-pointer"
                disabled={loadingOlderCommits}
                onclick={() => {
                  const lastOlder = olderCommits[olderCommits.length - 1];
                  if (lastOlder) fileTrackingStore.loadOlderCommits(lastOlder.hash);
                }}
              >
                {#if loadingOlderCommits}
                  <Fa icon={faSpinner} class="animate-spin mr-1" size="xs" />
                {/if}
                Show more previous commits
              </button>
            {/if}
          </TimelineSection>

          {#snippet mergePanelContent()}
            <!-- Via PR / Via git toggle - only show when there's an open PR -->
            {#if hasOpenPR && hasRemote}
              <div class="flex items-center rounded-md border border-border overflow-hidden w-fit">
                <button
                  class="px-2.5 py-1 text-xs font-medium transition-colors {mergeViaPR
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted'}"
                  onclick={() => (mergeViaPR = true)}
                >
                  Via PR
                </button>
                <button
                  class="px-2.5 py-1 text-xs font-medium transition-colors border-l border-border {!mergeViaPR
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted'}"
                  onclick={() => (mergeViaPR = false)}
                >
                  Via git
                </button>
              </div>
            {/if}

            {#if mergeViaPR && hasOpenPR && hasRemote}
              <!-- GitHub merge: merge the PR via the GitHub API -->
              {@const openPR = pullRequests.find((pr) => pr.status === 'open' || pr.status === 'draft')}
              {#if openPR}
                <p class="text-xs text-muted-foreground">
                  PR #{openPR.number} will be merged on GitHub into <span class="font-medium text-foreground">{targetBranch || trunkBranch || 'main'}</span>.
                </p>

                <!-- Squash toggle -->
                {@const totalCommitsGH = allCommits.length + (hasStaged ? 1 : 0)}
                {#if totalCommitsGH > 1}
                  <Tooltip
                    content="Combine all {totalCommitsGH} commits into one called &quot;Squashed commit from {workspace?.branch || 'branch'}&quot;. Keeps the target branch history clean."
                    side="top"
                    align="start"
                    contentClass="w-[14rem]"
                  >
                    <div class="flex items-center gap-1.5">
                      <Switch
                        id="squash-merge-github-toggle"
                        bind:checked={squashMerge}
                        disabled={isMergingPROnGitHub}
                        size="sm"
                      />
                      <label
                        for="squash-merge-github-toggle"
                        class="text-xs text-muted-foreground cursor-pointer select-none"
                      >
                        Squash commits
                      </label>
                    </div>
                  </Tooltip>
                {/if}

                {#if hasStaged}
                  <p class="text-xs text-amber-500">
                    You have staged changes that haven't been committed. They won't be included in this merge.
                  </p>
                {/if}

                <div class="flex items-center gap-2 flex-wrap w-full">
                  <Button
                    variant="default"
                    size="xs"
                    onclick={() => handleMergePROnGitHub({ mergeMethod: squashMerge ? 'squash' : 'merge' })}
                    disabled={isMergingPROnGitHub}
                  >
                    {#if isMergingPROnGitHub}
                      <Fa icon={faSpinner} size="xs" class="animate-spin" />
                      <span>Merging on GitHub...</span>
                    {:else}
                      <Fa icon={faCodeMerge} size="xs" class="opacity-50" />
                      <span>{squashMerge ? 'Squash & Merge PR' : 'Merge PR'}</span>
                    {/if}
                  </Button>
                </div>
              {/if}
            {:else}
              <!-- Git merge -->
              <!-- What will be included description -->
              {@const mergeStaged = hasStaged
                ? `${stagedChanges.length} staged file${stagedChanges.length === 1 ? '' : 's'}`
                : ''}
              {@const mergeCommits = hasCommits
                ? `${allCommits.length} commit${allCommits.length === 1 ? '' : 's'}`
                : ''}
              {@const mergeParts = [mergeStaged, mergeCommits].filter(Boolean)}
              {#if mergeParts.length > 0}
                <p class="text-xs text-muted-foreground">
                  {mergeParts.join(' and ')} will be merged into <span class="font-medium text-foreground">{targetBranch ||
                    trunkBranch ||
                    'trunk'}</span>.
                </p>
              {/if}

              <!-- Commit message for staged changes -->
              {#if hasStaged}
                <div>
                  <span class="text-xs text-muted-foreground mb-1 block">Commit Message</span>
                  <div class="relative">
                    <Textarea
                      value={commitMessage}
                      oninput={(e) => (commitMessage = (e.target as HTMLTextAreaElement).value)}
                      onkeydown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          handleMergeToTrunk({ squash: squashMerge, localOnly: !pushAfterMerge });
                        }
                      }}
                      placeholder="Commit message for staged changes..."
                      doesExpandToFit
                      minHeight={60}
                      maxHeight={150}
                      readonly={isGeneratingMerge}
                      class="text-sm {isGeneratingMerge ? 'border-primary/40 bg-muted/20' : ''}"
                    />
                  </div>
                </div>
              {/if}

              <!-- Target Branch -->
              <div>
                <span class="text-xs text-muted-foreground mb-1 block">Target Branch</span>
                <BranchSelector
                  variant="default"
                  value={targetBranch}
                  {repoPath}
                  {repoType}
                  onchange={(e) => {
                    targetBranch = e.detail.branch;
                  }}
                />
              </div>

              <!-- Options: squash + push toggles -->
              {@const totalCommitsToMerge = allCommits.length + (hasStaged ? 1 : 0)}
              <div class="flex flex-col gap-1.5">
                {#if totalCommitsToMerge > 1}
                  <Tooltip
                    content="Combine all {totalCommitsToMerge} commits into one called &quot;Squashed commit from {workspace?.branch || 'branch'}&quot;. Keeps the target branch history clean."
                    side="top"
                    align="start"
                    contentClass="w-[14rem]"
                  >
                    <div class="flex items-center gap-1.5">
                      <Switch
                        id="squash-merge-toggle"
                        bind:checked={squashMerge}
                        disabled={isMergingToTrunk || (isGeneratingMerge && mergeWhenReady)}
                        size="sm"
                      />
                      <label
                        for="squash-merge-toggle"
                        class="text-xs text-muted-foreground cursor-pointer select-none"
                      >
                        Squash commits
                      </label>
                    </div>
                  </Tooltip>
                {/if}
                {#if hasRemote}
                  <Tooltip
                    content={pushAfterMerge
                      ? 'Changes will be pushed to the remote repository after merging. Uncheck to only merge locally.'
                      : 'Changes will only be merged on your machine, and you can push later.'}
                    side="top"
                    align="start"
                    contentClass="w-[14rem]"
                  >
                    <div class="flex items-center gap-1.5">
                      <Switch
                        id="push-after-merge-toggle"
                        bind:checked={pushAfterMerge}
                        disabled={isMergingToTrunk || (isGeneratingMerge && mergeWhenReady)}
                        size="sm"
                      />
                      <label
                        for="push-after-merge-toggle"
                        class="text-xs text-muted-foreground cursor-pointer select-none"
                      >
                        Push to remote
                      </label>
                    </div>
                  </Tooltip>
                {/if}
              </div>

              <!-- Buttons -->
              <div class="flex items-center gap-2 flex-wrap w-full">
                <!-- Submit button - show pending state when mergeWhenReady is toggled during generation -->
                <Button
                  variant="default"
                  size="xs"
                  onclick={() => handleMergeToTrunk({ squash: squashMerge, localOnly: !pushAfterMerge })}
                  disabled={isMergingToTrunk ||
                    (hasStaged && !commitMessage.trim()) ||
                    (isGeneratingMerge && mergeWhenReady)}
                >
                  {#if isMergingToTrunk || (isGeneratingMerge && mergeWhenReady)}
                    <Fa icon={faSpinner} size="xs" class="animate-spin" />
                    <span>{isMergingToTrunk ? 'Merging...' : 'Will merge when done...'}</span>
                  {:else}
                    <Fa icon={faCodeMerge} size="xs" class="opacity-50" />
                    <span>{squashMerge ? 'Squash & Merge' : 'Merge'}</span>
                  {/if}
                </Button>
                <!-- Auto-fill button with eye/stop icons when generating (only show if staged changes need commit message) -->
                {#if hasStaged}
                  {#if isGeneratingMerge}
                    <div class="flex items-center">
                      <Button
                        variant="outline"
                        size="xs"
                        class="rounded-r-none border-r-0"
                        onclick={handleStopGeneratingMerge}
                      >
                        <Fa icon={faSpinner} size="xs" class="animate-spin" />
                        <span class="mr-1">Auto-fill</span>
                        <Fa icon={faStop} size="xs" />
                      </Button>
                      {#if mergeAgentId}
                        <Button
                          variant="outline"
                          size="icon-xs"
                          class="rounded-none h-7!"
                          onclick={viewMergeThoughtProcess}
                          tooltip="View thought process"
                          tooltipSide="top"
                          tooltipDelayDuration={0}
                        >
                          <Fa icon={faEye} size="xs" />
                        </Button>
                      {/if}

                      <Button
                        variant={mergeWhenReady ? 'default' : 'outline'}
                        size="xs"
                        class="rounded-l-none border-l-0"
                        onclick={toggleMergeWhenReady}
                      >
                        {#if mergeWhenReady}
                          <Fa icon={faCheck} size="xs" />
                        {/if}
                        Auto-merge when done
                      </Button>
                    </div>
                  {:else}
                    <div class="flex items-center">
                      <Button
                        variant="outline"
                        size="xs"
                        class={mergeAgentId ? 'rounded-r-none border-r-0' : ''}
                        onclick={handleAutoFillMerge}
                      >
                        <Fa icon={faRobot} size="xs" class="opacity-50" />
                        <span>Auto-fill</span>
                      </Button>
                      {#if mergeAgentId}
                        <Button
                          variant="outline"
                          size="icon-xs"
                          class="rounded-l-none border-l-0 h-7!"
                          onclick={viewMergeThoughtProcess}
                          tooltip="View thought process"
                          tooltipSide="top"
                          tooltipDelayDuration={0}
                        >
                          <Fa icon={faEye} size="xs" />
                        </Button>
                      {/if}
                    </div>
                  {/if}
                {/if}
              </div>
            {/if}
          {/snippet}

          <!-- Divider with Create PR, Push Commits button, or Synced status (only when remote exists) -->
          {#if hasRemote}
          <TimelineDivider>
            {#if hasOpenPR && hasUnpushedCommits && unpushedCount > 0 && !isDiverged && !isBehind}
              <!-- Show Push Commits button when open PR exists, there are unpushed commits, branches haven't diverged, and we're not behind -->
              <DividerButton
                onclick={handlePushAllUnpushed}
                disabled={isPushing}
                loading={isPushing}
              >
                Push {unpushedCount} Commit{unpushedCount === 1 ? '' : 's'}
              </DividerButton>
            {:else if !hasOpenPR && !(isMergedToTrunk || isWorkspaceCompleted || (areAllPRsMerged && !hasResetToTrunk) || isContentMergedToTrunk)}
              <!-- Show Create PR + Merge buttons when no open PR and not post-merge -->
              <div class="w-full flex gap-1">
                <DividerButton
                  tooltipContents={!hasStaged && !hasCommits
                    ? 'No staged changes or commits to create PR from'
                    : ''}
                  onclick={() => {
                    const wasOpen = prDrawerOpen;
                    prDrawerOpen = !prDrawerOpen;
                    if (prDrawerOpen) mergeDrawerOpen = false;
                    // Track when PR creator is opened (not closed)
                    if (!wasOpen) {
                      track('Opened PR Creator', {
                        workspace_id: workspaceId,
                      });
                    }
                  }}
                  expanded={prDrawerOpen}
                  disabled={!hasStaged && !hasCommits}
                >
                  Create PR
                </DividerButton>
                <DividerButton
                  tooltipContents={!hasStaged && !hasCommits
                    ? 'No staged changes or commits to merge'
                    : ''}
                  onclick={() => {
                    mergeDrawerOpen = !mergeDrawerOpen;
                    if (mergeDrawerOpen) prDrawerOpen = false;
                  }}
                  expanded={mergeDrawerOpen}
                  disabled={!hasStaged && !hasCommits}
                >
                  Merge
                </DividerButton>
              </div>
              <DividerPanel open={prDrawerOpen}>
                <!-- GitHub Auth Banner - show when not authenticated -->
                {#if !githubAuthState.isAuthenticated}
                  <GitHubAuthBanner
                    onSuccess={() => {
                      // Auth succeeded, user can now create PR
                    }}
                  />
                {:else}
                  <!-- What will be included description -->
                  {@const stagedDescription = hasStaged
                    ? `${stagedChanges.length} staged file${stagedChanges.length === 1 ? '' : 's'}`
                    : ''}
                  {@const commitDescription = hasCommits
                    ? `${allCommits.length} commit${allCommits.length === 1 ? '' : 's'}`
                    : ''}
                  {@const prParts = [stagedDescription, commitDescription].filter(Boolean)}
                  {#if prParts.length > 0}
                    <p class="text-xs text-muted-foreground">
                      {prParts.join(' and ')} will be included in this PR.
                    </p>
                  {/if}

                  <!-- Title -->
                  {#if !isGeneratingPR}
                    <div>
                      <span class="text-xs text-muted-foreground mb-1 block">Title</span>
                      <input
                        type="text"
                        class="w-full px-2.5 py-1.5 text-sm bg-muted/30 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
                        placeholder="PR title..."
                        bind:value={prTitle}
                      />
                    </div>
                  {/if}

                  <!-- Description -->
                  <div>
                    <span class="text-xs text-muted-foreground mb-1 block">Description</span>
                    <div class="relative">
                      <Textarea
                        value={prDescription}
                        oninput={(e) => (prDescription = (e.target as HTMLTextAreaElement).value)}
                        placeholder="Describe your changes..."
                        doesExpandToFit
                        minHeight={80}
                        maxHeight={200}
                        readonly={isGeneratingPR}
                        class="text-sm {isGeneratingPR ? 'border-primary/40 bg-muted/20' : ''}"
                      />
                    </div>
                  </div>

                  <!-- Target Branch -->
                  <div>
                    <span class="text-xs text-muted-foreground mb-1 block">Target Branch</span>
                    <BranchSelector
                      variant="default"
                      value={targetBranch}
                      {repoPath}
                      {repoType}
                      onchange={(e) => {
                        targetBranch = e.detail.branch;
                      }}
                    />
                  </div>

                  <!-- Buttons -->
                  <div class="flex items-center gap-2 flex-wrap w-full">
                    <!-- Submit button - show pending state when createPRWhenReady is toggled during generation -->
                    <Button
                      variant="default"
                      size="xs"
                      onclick={() => handleCreatePR()}
                      disabled={!prTitle.trim() ||
                        isCreatingPR ||
                        (isGeneratingPR && createPRWhenReady)}
                    >
                      {#if isCreatingPR || (isGeneratingPR && createPRWhenReady)}
                        <Fa icon={faSpinner} size="xs" class="animate-spin" />
                        <span>{isCreatingPR ? 'Creating PR...' : 'Will create when done...'}</span>
                      {:else}
                        <Fa icon={faCodePullRequest} size="xs" class="opacity-50" />
                        <span>Create PR</span>
                      {/if}
                    </Button>
                    <!-- Auto-fill button with eye/stop icons when generating -->
                    {#if isGeneratingPR}
                      <div class="flex items-center">
                        <Button
                          variant="outline"
                          size="xs"
                          class="rounded-r-none border-r-0"
                          onclick={handleStopGeneratingPR}
                        >
                          <Fa icon={faSpinner} size="xs" class="animate-spin" />
                          <span class="mr-1">Auto-fill</span>
                          <Fa icon={faStop} size="xs" />
                        </Button>
                        {#if prAgentId}
                          <Button
                            variant="outline"
                            size="icon-xs"
                            class="rounded-none h-7!"
                            onclick={viewPRThoughtProcess}
                            tooltip="View thought process"
                            tooltipSide="top"
                            tooltipDelayDuration={0}
                          >
                            <Fa icon={faEye} size="xs" />
                          </Button>
                        {/if}

                        <Button
                          variant={createPRWhenReady ? 'default' : 'outline'}
                          size="xs"
                          class="rounded-l-none border-l-0"
                          onclick={toggleCreatePRWhenReady}
                        >
                          {#if createPRWhenReady}
                            <Fa icon={faCheck} size="xs" />
                          {/if}
                          Create PR when done
                        </Button>
                      </div>
                    {:else}
                      <div class="flex items-center">
                        <Button
                          variant="outline"
                          size="xs"
                          class={prAgentId ? 'rounded-r-none border-r-0' : ''}
                          onclick={handleAutoFillPR}
                        >
                          <Fa icon={faRobot} size="xs" class="opacity-50" />
                          <span>Auto-fill</span>
                        </Button>
                        {#if prAgentId}
                          <Button
                            variant="outline"
                            size="icon-xs"
                            class="rounded-l-none border-l-0 h-7!"
                            onclick={viewPRThoughtProcess}
                            tooltip="View thought process"
                            tooltipSide="top"
                            tooltipDelayDuration={0}
                          >
                            <Fa icon={faEye} size="xs" />
                          </Button>
                        {/if}
                      </div>
                    {/if}
                  </div>
                {/if}
              </DividerPanel>
              <DividerPanel open={mergeDrawerOpen}>
                {@render mergePanelContent()}
              </DividerPanel>
            {:else if isBehind}
              <!-- Show Pull Commits button when remote is ahead and local is not -->
              <DividerButton
                onclick={handlePull}
                disabled={isPulling}
                loading={isPulling}
                showArrow={false}
              >
                Pull {behindCount} Commit{behindCount === 1 ? '' : 's'}
                <Fa icon={faArrowDown} size="xs" class="text-muted-foreground/50 rotate-180" />
              </DividerButton>
            {:else if !isDiverged && !isBehind}
              <!-- Synced - only when truly synced -->
              <span
                class="relative z-20 text-xs text-muted-foreground/60 flex items-center gap-1 py-1.5 px-3 rounded-md bg-background"
              >
                <Fa icon={faCheck} size="xs" />
                <span>Synced</span>
              </span>
            {/if}

            <!-- Force Push Section - shown when branches have diverged -->
            {#if isDiverged}
              <DividerButton
                onclick={() => {
                  forcePushDrawerOpen = !forcePushDrawerOpen;
                }}
                expanded={forcePushDrawerOpen}
                showArrow={true}
              >
                Force Push
              </DividerButton>
              <DividerPanel open={forcePushDrawerOpen}>
                <p class="text-xs text-muted-foreground">
                  Your local <span class="font-medium">{workspace?.branch || 'branch'}</span> is {gitStore.ahead} commit{gitStore.ahead === 1 ? '' : 's'} ahead and {gitStore.behind} commit{gitStore.behind === 1 ? '' : 's'} behind <span class="font-medium">origin/{workspace?.branch || 'branch'}</span>. Force pushing will overwrite the GitHub version with your local commits.
                </p>
                <div class="flex items-center gap-2">
                  <Button
                    variant="default"
                    size="xs"
                    onclick={handleForcePush}
                    disabled={isForcePushing}
                  >
                    {#if isForcePushing}
                      <Fa icon={faSpinner} size="xs" class="animate-spin" />
                      <span>Pushing...</span>
                    {:else}
                      <span>Force Push</span>
                    {/if}
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    onclick={() => {
                      forcePushDrawerOpen = false;
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </DividerPanel>
            {/if}
          </TimelineDivider>

          <!-- PULL REQUESTS SECTION - slides in when PRs exist -->
          {#if hasPRs}
          <div transition:slide={{ duration: 200 }}>
          <TimelineSection title="Pull Requests" active={hasPRs} activeColor="bg-purple-500">
            {#snippet action()}
              {#if hasPRs || githubAuthState.isAuthenticated}
                <button
                  type="button"
                  class="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50 cursor-pointer"
                  onclick={() => {
                    if (!githubAuthState.isAuthenticated) {
                      // Trigger the auth banner by incrementing the key with autoStart
                      pendingActionAfterAuth = 'refresh-pr';
                      authBannerKey++;
                    } else {
                      handleRefreshPRStatus();
                    }
                  }}
                  disabled={isRefreshingPR}
                  title={githubAuthState.isAuthenticated
                    ? 'Refresh PR status'
                    : 'Connect to GitHub'}
                >
                  <Fa
                    icon={faArrowsRotate}
                    class="opacity-50 text-[8px] {isRefreshingPR ? 'animate-spin' : ''}"
                  />
                </button>
              {/if}
            {/snippet}
            {#if !githubAuthState.isAuthenticated}
              {#key authBannerKey}
                <GitHubAuthBanner
                  message="Connect to GitHub"
                  onSuccess={handleGitHubAuthSuccess}
                  autoStart={authBannerKey > 0}
                />
              {/key}
            {/if}
            {#if hasPRs}
              <div class="space-y-0.5">
                {#each pullRequests as pr (pr.number)}
                  {@const statusColor =
                    pr.status === 'open'
                      ? 'text-emerald-500'
                      : pr.status === 'merged'
                        ? 'text-purple-500'
                        : pr.status === 'closed'
                          ? 'text-red-500'
                          : 'text-muted-foreground'}
                  {@const statusIcon = pr.status === 'merged' ? faCodeMerge : faCodePullRequest}
                  {@const isPRExpanded = expandedPRs.has(pr.number)}
                  {@const hasPRFiles = prFiles.length > 0}
                  <div>
                    <!-- PR header -->
                    <div
                      class="relative flex items-center gap-2 py-0.5 group w-full rounded px-1 -mx-1"
                    >
                      {#if hasPRFiles}
                        <Button
                          variant="ghost-light"
                          size="icon-xs"
                          class="absolute left-0.75 bg-sidebar opacity-0 group-hover:opacity-100 hover:text-foreground! -ml-1"
                          onclick={(e: MouseEvent) => {
                            e.stopPropagation();
                            togglePRExpanded(pr.number);
                          }}
                          title="Toggle file list"
                        >
                          <Fa
                            icon={faChevronDown}
                            size={12}
                            class="text-muted-foreground/60 shrink-0 transition-transform {isPRExpanded
                              ? 'rotate-0'
                              : '-rotate-90'}"
                          />
                          <LineChangesBadge
                            additions={prTotalAdditions}
                            deletions={prTotalDeletions}
                            size="xs"
                          />
                        </Button>
                      {/if}

                      <Fa icon={statusIcon} size="xs" class="{statusColor} shrink-0" />
                      <button
                        type="button"
                        class="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
                        onclick={onOpenFullPanel}
                      >
                        <span class="text-[0.82rem] text-muted-foreground truncate flex-1"
                          >{pr.title}</span
                        >
                        <span class="text-[10px] text-muted-foreground/40">#{pr.number}</span>
                        {#if pr.status === 'merged'}
                          <span class="text-[10px] text-purple-500 font-medium">Merged</span>
                        {:else if pr.status === 'closed'}
                          <span class="text-[10px] text-red-500 font-medium">Closed</span>
                        {/if}
                      </button>

                      <div
                        class="absolute -right-1 pl-1 bg-sidebar flex items-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Button
                          variant="ghost-light"
                          size="icon-xs"
                          class="shrink-0"
                          onclick={() => handleLink(pr.url, { workspaceId: workspaceId as WorkspaceId, forceExternal: true })}
                          tooltip="Open in browser"
                          tooltipSide="top"
                        >
                          <Fa icon={faArrowUpRightFromSquare} size="xs" />
                        </Button>
                      </div>
                    </div>

                    <!-- Expanded panel content - PR files -->
                    {#if isPRExpanded}
                      <div
                        class="pl-5 pr-1.5 pb-0.5 pt-0.5 space-y-px"
                        transition:slide={{ duration: 150 }}
                      >
                        {#each prFiles as file (file.path)}
                          <FileRow
                            {file}
                            muted={true}
                            active={activeFilePath === file.path && activeFileStaged === null}
                            onFileClick={(filePath) => {
                              handlePRFileClick(filePath).catch((error) => {
                                logger.error('Error in handlePRFileClick', { error });
                              });
                            }}
                            onOpenFile={handleOpenFile}
                          />
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </TimelineSection>
          </div>
          {/if}
          {/if}

          <!-- Divider with Merge button - hide when PR is already merged, when merge is in upper section, or post-merge -->
          {#if !isPRMerged && (!hasRemote || hasOpenPR) && !(isMergedToTrunk || isWorkspaceCompleted || (areAllPRsMerged && !hasResetToTrunk) || isContentMergedToTrunk)}
            <TimelineDivider>
              {#if !hasRemote}
                <div class="w-full flex gap-1">
                  <DividerButton
                    tooltipContents={!hasStaged && !hasCommits
                      ? 'No staged changes or commits to merge'
                      : ''}
                    onclick={() => {
                      mergeDrawerOpen = !mergeDrawerOpen;
                      if (mergeDrawerOpen) connectRemoteDrawerOpen = false;
                    }}
                    expanded={mergeDrawerOpen}
                    disabled={!hasStaged && !hasCommits}
                  >
                    Merge
                  </DividerButton>
                  <DividerButton
                    onclick={() => {
                      connectRemoteDrawerOpen = !connectRemoteDrawerOpen;
                      if (connectRemoteDrawerOpen) mergeDrawerOpen = false;
                    }}
                    expanded={connectRemoteDrawerOpen}
                    icon={faLink}
                    arrowRight
                  >
                    Connect Remote
                  </DividerButton>
                </div>
              {:else if hasOpenPR}
                <DividerButton
                  tooltipContents={!hasStaged && !hasCommits
                    ? 'No staged changes or commits to merge'
                    : ''}
                  onclick={() => {
                    mergeDrawerOpen = !mergeDrawerOpen;
                  }}
                  expanded={mergeDrawerOpen}
                  disabled={!hasStaged && !hasCommits}
                >
                  Merge
                </DividerButton>
              {/if}
              <DividerPanel open={connectRemoteDrawerOpen}>
                <p class="text-xs text-muted-foreground">
                  Add a git remote to enable pushing and pull requests.
                </p>
                <div>
                  <span class="text-xs text-muted-foreground mb-1 block">Remote URL</span>
                  <input
                    type="text"
                    class="w-full px-2.5 py-1.5 text-sm bg-muted/30 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
                    placeholder="https://github.com/user/repo.git"
                    bind:value={remoteUrl}
                    onkeydown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddRemote();
                      }
                    }}
                  />
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="default"
                    size="xs"
                    onclick={handleAddRemote}
                    disabled={isAddingRemote || !remoteUrl.trim()}
                  >
                    {#if isAddingRemote}
                      <Fa icon={faSpinner} size="xs" class="animate-spin" />
                      <span>Adding...</span>
                    {:else}
                      <Fa icon={faLink} size="xs" class="opacity-50" />
                      <span>Add Remote</span>
                    {/if}
                  </Button>
                </div>
                <p class="text-xs text-muted-foreground">
                  Don't have a repo?
                  <a
                    href="https://github.com/new"
                    class="text-primary hover:underline inline-flex items-center gap-0.5"
                    onclick={(e) => { e.preventDefault(); handleLink('https://github.com/new', { workspaceId: workspaceId as WorkspaceId, event: e }); }}
                  >
                    Create one on GitHub
                    <Fa icon={faArrowUpRightFromSquare} size="xs" class="opacity-70" />
                  </a>
                </p>
              </DividerPanel>
              <DividerPanel open={mergeDrawerOpen}>
                {@render mergePanelContent()}
              </DividerPanel>
            </TimelineDivider>
          {/if}

          <!-- Post-merge options - shown when workspace is completed (commits merged to trunk) -->
          <!-- Also shown immediately after direct merge to trunk (isMergedToTrunk), when all PRs are merged on GitHub (areAllPRsMerged), or when squash merge detected via tree hash (isContentMergedToTrunk) -->
          <!-- Hidden when new commits were made after merge (mergeHeadSha no longer matches HEAD) - indicates user is actively working -->
          <!-- areAllPRsMerged is gated by hasResetToTrunk to allow creating new PRs after reset -->
          {#if (isMergedToTrunk || isWorkspaceCompleted || (areAllPRsMerged && !hasResetToTrunk) || isContentMergedToTrunk) && (!mergeHeadSha || mergeHeadSha === allCommits[0]?.hash)}
            <div class="mt-4 pt-4 border-t border-border/50 ml-4 space-y-3">
              <!-- Reset and continue button - hidden when already at trunk HEAD, when there are uncommitted changes,
                   or when we can't confirm no new commits were made since merge (prevents data loss) -->
              {#if aheadOfTrunk != null && aheadOfTrunk !== 0 && !hasStaged && !hasUnstaged && (mergeHeadSha ? mergeHeadSha === allCommits[0]?.hash : isContentMergedToTrunk)}
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    class="w-full gap-2"
                    onclick={handleResetAndContinue}
                    disabled={isResettingToTrunk}
                  >
                    {#if isResettingToTrunk}
                      <Fa icon={faSpinner} size="sm" class="animate-spin text-muted-foreground" />
                      <span>Resetting...</span>
                    {:else}
                      <Fa icon={faRotateLeft} size="sm" class="text-primary" />
                      <span>Reset and continue working</span>
                    {/if}
                  </Button>
                  <p class="text-xs text-muted-foreground text-center mt-2">
                    Reset branch to {trunkBranch} and keep working
                  </p>
                </div>
              {/if}
              <!-- Archive and start new space button -->
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  class="w-full gap-2"
                  onclick={handleStartNewSpace}
                >
                  <Fa icon={faRocket} size="sm" class="text-primary" />
                  <span>Archive and start new space</span>
                </Button>
                <p class="text-xs text-muted-foreground text-center mt-2">
                  Continue working on this repo in a fresh workspace
                </p>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

{#if commitContextMenu}
  <SidebarContextMenu
    x={commitContextMenu.x}
    y={commitContextMenu.y}
    items={getCommitContextMenuItems(commitContextMenu.commitHash)}
    onClickOutside={closeCommitContextMenu}
  />
{/if}

<style>
  .sidebar-changes-container {
    container-type: inline-size;
  }

  @container (max-width: 250px) {
    .branch-labels {
      display: none;
    }
  }
</style>
