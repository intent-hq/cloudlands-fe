<script lang="ts">
  /**
   * ChangeTimeline - Main timeline component
   * Shows changes organized by location: local, branch, remote branch, trunk
   */
  import { fly, slide } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import {
    faPlus,
    faMinus,
    faCodeCommit,
    faSpinner,
    faRobot,
    faArrowRight,
    faCodePullRequest,
    faFolderOpen,
    faEye,
    faChevronRight,
    faUser,
    faCheck,
    faStop,
    faWandMagicSparkles,
    faRotateRight,
    faHistory,
    faCodeMerge,
    faRocket,
    faCheckCircle,
    faLink,
    faArrowUpRightFromSquare,
  } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Input } from '$lib/components/ui/input';
  import FileActionsDropdown from '$lib/components/ui/FileActionsDropdown.svelte';
  import type { LocalCommitInfo } from '$features/accept-changes/types';
  import FileRow from './FileRow.svelte';
  import CommitNode from './CommitNode.svelte';
  import PRNode from './PRNode.svelte';
  import {
    type UIFileChange,
    type PRInfo,
    groupFilesByAgent,
    type AgentChangeGroup,
  } from './types';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { sessionStore } from '$features/agent/browser';
  import type { Workspace } from '$shared/types';
  import StartNewWorkspaceSection from './StartNewWorkspaceSection.svelte';
  import { handleLink } from '$features/navigation/link-handler';
  import type { WorkspaceId } from '$shared/types/branded-ids';

  interface Props {
    workspaceId: string;
    workspace?: Workspace | null;
    workspaceTitle?: string;
    branch: string;
    targetBranch: string;
    availableBranches?: string[];
    unstagedFiles: UIFileChange[];
    stagedFiles: UIFileChange[];
    commits: LocalCommitInfo[];
    prs: PRInfo[];
    commitMessage?: string;
    prTitle?: string;
    prDescription?: string;
    isGeneratingMessage?: boolean;
    isGeneratingPR?: boolean;
    generatingMessagePreview?: string;
    generatingPRPreview?: string;
    generatingMessageStatus?: string;
    generatingPRStatus?: string;
    isCommitting?: boolean;
    isPushing?: boolean;
    isCreatingPR?: boolean;
    isExporting?: boolean;
    onFileClick?: (path: string, commitHash?: string, staged?: boolean) => void;
    onStage?: (path: string) => void;
    onUnstage?: (path: string) => void;
    onRevert?: (path: string) => void;
    onStageAll?: () => void;
    onUnstageAll?: () => void;
    /** Batch stage multiple paths at once (used for per-group staging) */
    onStageGroup?: (paths: string[]) => void;
    /** Batch unstage multiple paths at once (used for per-group unstaging) */
    onUnstageGroup?: (paths: string[]) => void;
    onCommitMessageChange?: (message: string) => void;
    onGenerateMessage?: () => void;
    onCommit?: () => void;
    onPush?: () => void;
    onAddToPR?: (includeCommit: boolean) => void;
    onTargetBranchChange?: (branch: string) => void;
    onPRTitleChange?: (title: string) => void;
    onPRDescriptionChange?: (description: string) => void;
    onGeneratePR?: (context: {
      includeStagedFiles: boolean;
      includeCommitHashes: string[];
      targetBranch: string;
    }) => void;
    onCreatePR?: () => void;
    onPickExportFolder?: () => Promise<string | undefined>;
    onExport?: (path: string) => void;
    defaultExportPath?: string;
    onOpenCommit?: (hash: string) => void;
    onOpenPR?: (url: string) => void;
    onOpenLocalChanges?: () => void;
    commitMessageAgentId?: string | null;
    prDescriptionAgentId?: string | null;
    onViewCommitThoughtProcess?: () => void;
    onViewPRThoughtProcess?: () => void;
    onAutofillAndCommit?: () => void;
    onAutofillAndAddToPR?: () => void;
    onAutofillAndCreatePR?: (context: {
      includeStagedFiles: boolean;
      includeCommitHashes: string[];
      targetBranch: string;
    }) => void;
    isAutofillAndCommitting?: boolean;
    isAutofillAndCreatingPR?: boolean;
    onStopGeneratingMessage?: () => void;
    onStopGeneratingPR?: () => void;
    /** Background operation state for optimistic UI */
    backgroundOperation?: {
      type: 'commit' | 'add-to-pr' | 'create-pr';
      phase: 'generating' | 'executing';
      label?: string;
    } | null;
    /** Code review */
    onReviewStaged?: () => void;
    onReReview?: () => void;
    onOpenReview?: () => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onOpenArchivedReview?: (review: any) => void;
    isReviewingCode?: boolean;
    reviewStatus?: 'idle' | 'running' | 'complete' | 'error' | 'stale';
    hasExistingReview?: boolean;
    reviewCommentCount?: number;
    reviewHasCritical?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reviewArchive?: any[];
    /** Merge to trunk */
    onMergeToTrunk?: (options?: { squash?: boolean }) => void;
    onAutofillAndMerge?: (options?: { squash?: boolean }) => void;
    isMergingToTrunk?: boolean;
    /** Completion actions */
    onStartNewSpace?: () => void;
    onCreateWorkspace?: (prompt: string) => void;
    isCreatingWorkspace?: boolean;
    /** Whether the workspace has been merged to trunk (local merge completed) */
    isMergedToTrunk?: boolean;
    /** Whether the repo has a remote configured */
    hasRemote?: boolean;
    /** Callback to add a git remote */
    onAddRemote?: (remoteUrl: string) => Promise<void>;
  }

  let {
    workspaceId,
    workspace = null,
    workspaceTitle = '',
    branch,
    targetBranch = $bindable(''),
    availableBranches = [],
    unstagedFiles,
    stagedFiles,
    commits,
    prs,
    commitMessage = $bindable(''),
    prTitle = $bindable(''),
    prDescription = $bindable(''),
    isGeneratingMessage = false,
    isGeneratingPR = false,
    generatingMessagePreview = '',
    generatingPRPreview = '',
    generatingMessageStatus = '',
    generatingPRStatus = '',
    isCommitting = false,
    isPushing = false,
    isCreatingPR = false,
    isExporting = false,
    onFileClick,
    onStage,
    onUnstage,
    onRevert,
    onStageAll,
    onUnstageAll,
    onStageGroup,
    onUnstageGroup,
    onCommitMessageChange,
    onGenerateMessage,
    onCommit,
    onPush,
    onAddToPR,
    onTargetBranchChange,
    onPRTitleChange,
    onPRDescriptionChange,
    onGeneratePR,
    onCreatePR,
    onPickExportFolder,
    onExport,
    defaultExportPath,
    onOpenCommit,
    onOpenPR,
    onOpenLocalChanges,
    commitMessageAgentId,
    prDescriptionAgentId,
    onViewCommitThoughtProcess,
    onViewPRThoughtProcess,
    onAutofillAndCommit,
    onAutofillAndAddToPR,
    onAutofillAndCreatePR,
    isAutofillAndCommitting = false,
    isAutofillAndCreatingPR = false,
    onStopGeneratingMessage,
    onStopGeneratingPR,
    backgroundOperation = null,
    onReviewStaged,
    onReReview,
    onOpenReview,
    onOpenArchivedReview,
    isReviewingCode = false,
    reviewStatus = 'idle',
    hasExistingReview = false,
    reviewCommentCount = 0,
    reviewHasCritical = false,
    reviewArchive = [],
    onMergeToTrunk,
    onAutofillAndMerge,
    isMergingToTrunk = false,
    onStartNewSpace,
    onCreateWorkspace,
    isCreatingWorkspace = false,
    isMergedToTrunk = false,
    hasRemote = true,
    onAddRemote,
  }: Props = $props();

  // Export folder state - default to the repository path if provided
  // Note: We intentionally capture defaultExportPath at initialization as the initial value
  // svelte-ignore state_referenced_locally
  let exportFolderPath = $state<string | null>(defaultExportPath ?? null);

  // Connect remote state
  let connectRemoteOpen = $state(false);
  let connectRemoteUrl = $state('');
  let isAddingRemote = $state(false);

  async function handleAddRemote() {
    if (!connectRemoteUrl.trim() || !onAddRemote) return;
    isAddingRemote = true;
    try {
      await onAddRemote(connectRemoteUrl.trim());
      connectRemoteOpen = false;
      connectRemoteUrl = '';
    } catch {
      // Error handling is done by the parent
    } finally {
      isAddingRemote = false;
    }
  }

  // Expansion states - initialized based on current stagedFiles length
  // Note: We intentionally capture stagedFiles.length at init for initial expansion state
  // svelte-ignore state_referenced_locally
  let unstagedExpanded = $state(!stagedFiles.length);
  let commitDrawerOpen = $state(false);
  let exportDrawerOpen = $state(false);
  let pushDrawerOpen = $state(false);
  let prDrawerOpen = $state(false);
  let mergeDrawerOpen = $state(false);
  let addToPRDrawerOpen = $state(false);
  let selectedCommitIndex = $state<number | null>(null);

  // Agent group expansion states - tracks which agent groups are collapsed
  let collapsedAgentGroups = $state<Set<string>>(new Set());

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

  // Group files by agent - staged files
  const stagedByAgent = $derived<AgentChangeGroup[]>(groupFilesByAgent(stagedFiles));
  const unstagedByAgent = $derived<AgentChangeGroup[]>(groupFilesByAgent(unstagedFiles));

  // Helper to get the display name for an agent, preferring session store name over attribution name
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
    return group.agentName || 'Agent';
  }

  // Show grouped UI if there's any agent attribution (not just manual changes)
  const hasAnyAgentAttribution = $derived(
    stagedByAgent.some((g) => g.agentId !== null) ||
      unstagedByAgent.some((g) => g.agentId !== null),
  );

  // Open agent in drawer
  // Handles both agent IDs (UUIDs) and agent names (legacy data)
  function openAgent(e: MouseEvent, agentIdOrName: string) {
    // Check if this looks like a UUID (agent-xxx or just a UUID pattern)
    const isUUID = /^(agent-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      agentIdOrName,
    );

    let resolvedAgentId = agentIdOrName;

    // If it doesn't look like a UUID, try to find the agent by name
    if (!isUUID) {
      const sessions = sessionStore.getAllSessions();
      const matchingAgent = sessions.find((s) => s.name === agentIdOrName);
      if (matchingAgent) {
        // Handle both string IDs and object IDs (e.g., Proxy objects)
        const agentId = matchingAgent.id;
        resolvedAgentId =
          typeof agentId === 'object' && agentId
            ? (agentId as any).id || (agentId as any).agentId || String(agentId)
            : String(agentId);
      }
    }

    const panelElement = (e.target as HTMLElement)?.closest('[data-panel-id]');
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    const openInAdjacentPanel = e.metaKey || e.ctrlKey;
    window.dispatchEvent(
      new CustomEvent('workspace:open-agent', {
        detail: { agentId: resolvedAgentId, sourcePanelId, openInAdjacentPanel },
      }),
    );
  }

  // Computed - split commits by push status
  const hasUnstaged = $derived(unstagedFiles.length > 0);
  const hasStaged = $derived(stagedFiles.length > 0);
  const hasLocalChanges = $derived(hasUnstaged || hasStaged);

  // Local commits (not pushed)
  const localCommits = $derived(commits.filter((c) => !c.isPushed));
  const hasLocalCommits = $derived(localCommits.length > 0);

  // Check if we have any content pushed to trunk (via PR)
  const hasPRs = $derived(prs.length > 0);
  const hasPushedToTrunk = $derived(prs.some((pr) => pr.status === 'merged'));

  // Remote branch commits (pushed but NOT if they're already in a PR - they'll be nested inside the PR)
  const remoteCommits = $derived(commits.filter((c) => c.isPushed));
  // Only show remote commits separately if there's no PR (otherwise they're nested in the PR)
  const hasRemoteCommitsToShow = $derived(remoteCommits.length > 0 && !hasPRs);

  // Sections - show remote section if there are remote commits to show OR if there are PRs (only when remote exists)
  const hasRemoteSection = $derived(hasRemote && (hasRemoteCommitsToShow || hasPRs));
  const hasAnyContent = $derived(hasLocalChanges || commits.length > 0 || hasPRs);

  // Can edit target branch only if nothing has been pushed yet
  const canEditTargetBranch = $derived(remoteCommits.length === 0 && !hasPRs);

  // All done state - everything is merged and clean
  const isAllDone = $derived(isMergedToTrunk && !hasLocalChanges && !hasLocalCommits);

  // Track previous counts to detect when commits are pushed or PRs are created
  let prevPRCount = $state(0);
  let prevRemoteCount = $state(0);
  let hasInitialized = $state(false);

  $effect(() => {
    // Initialize counts on first run, then detect changes
    if (!hasInitialized) {
      prevRemoteCount = remoteCommits.length;
      prevPRCount = prs.length;
      hasInitialized = true;
      return;
    }

    // When commits are pushed (remote count increases), close push drawer
    if (remoteCommits.length > prevRemoteCount) {
      pushDrawerOpen = false;
      selectedCommitIndex = null;
    }
    prevRemoteCount = remoteCommits.length;

    // When a PR is created (prs count increases), close the PR drawer
    if (prs.length > prevPRCount) {
      prDrawerOpen = false;
      selectedCommitIndex = null;
    }
    prevPRCount = prs.length;
  });

  // Close drawers immediately when autofill-and-submit starts (optimistic UX)
  let prevAutofillCommitting = false;
  let prevAutofillCreatingPR = false;
  $effect(() => {
    // Close commit drawer when autofill-and-commit starts
    if (isAutofillAndCommitting && !prevAutofillCommitting) {
      commitDrawerOpen = false;
    }
    prevAutofillCommitting = isAutofillAndCommitting;

    // Close PR drawer when autofill-and-create-PR starts
    if (isAutofillAndCreatingPR && !prevAutofillCreatingPR) {
      prDrawerOpen = false;
      selectedCommitIndex = null;
    }
    prevAutofillCreatingPR = isAutofillAndCreatingPR;
  });

  function handleMessageInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    commitMessage = target.value;
    onCommitMessageChange?.(target.value);
  }

  function handlePRTitleInput(e: Event) {
    const target = e.target as HTMLInputElement;
    prTitle = target.value;
    onPRTitleChange?.(target.value);
  }

  function handlePRDescriptionInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    prDescription = target.value;
    onPRDescriptionChange?.(target.value);
  }

  function closeAllDrawers() {
    commitDrawerOpen = false;
    exportDrawerOpen = false;
    pushDrawerOpen = false;
    prDrawerOpen = false;
    mergeDrawerOpen = false;
    addToPRDrawerOpen = false;
  }

  function toggleDrawer(drawer: 'commit' | 'export' | 'push' | 'pr' | 'merge' | 'addToPR') {
    const wasOpen =
      drawer === 'commit'
        ? commitDrawerOpen
        : drawer === 'export'
          ? exportDrawerOpen
          : drawer === 'push'
            ? pushDrawerOpen
            : drawer === 'pr'
              ? prDrawerOpen
              : drawer === 'addToPR'
                ? addToPRDrawerOpen
                : mergeDrawerOpen;
    closeAllDrawers();
    selectedCommitIndex = null;
    if (!wasOpen) {
      if (drawer === 'commit') commitDrawerOpen = true;
      else if (drawer === 'export') exportDrawerOpen = true;
      else if (drawer === 'push') pushDrawerOpen = true;
      else if (drawer === 'merge') mergeDrawerOpen = true;
      else if (drawer === 'pr') prDrawerOpen = true;
      else if (drawer === 'addToPR') addToPRDrawerOpen = true;
    }
  }

  function selectCommitAndToggle(index: number, drawer: 'push' | 'pr') {
    const isSameCommit = selectedCommitIndex === index;
    const wasOpen = drawer === 'push' ? pushDrawerOpen : prDrawerOpen;

    closeAllDrawers();

    if (isSameCommit && wasOpen) {
      selectedCommitIndex = null;
    } else {
      selectedCommitIndex = index;
      if (drawer === 'push') pushDrawerOpen = true;
      else prDrawerOpen = true;
    }
  }

  function selectCommitAndToggleMerge(index: number) {
    const isSameCommit = selectedCommitIndex === index;
    const wasOpen = mergeDrawerOpen;

    closeAllDrawers();

    if (isSameCommit && wasOpen) {
      selectedCommitIndex = null;
    } else {
      selectedCommitIndex = index;
      mergeDrawerOpen = true;
    }
  }

  function handleGeneratePR() {
    // Build context based on selectedCommitIndex
    const isFromStaged = selectedCommitIndex === null;
    const isFromLocalCommit =
      selectedCommitIndex !== null && selectedCommitIndex < localCommits.length;
    const localCommitIdx = isFromLocalCommit ? selectedCommitIndex : null;
    const remoteCommitIdx =
      selectedCommitIndex !== null && selectedCommitIndex >= localCommits.length
        ? selectedCommitIndex - localCommits.length
        : null;

    // Determine which commits to include
    let includeCommitHashes: string[] = [];

    if (isFromStaged) {
      // Include all local and remote commits
      includeCommitHashes = [...localCommits, ...remoteCommits].map((c) => c.hash);
    } else if (isFromLocalCommit && localCommitIdx !== null) {
      // Include this local commit and all after it (older), plus all remote
      includeCommitHashes = [
        ...localCommits.slice(localCommitIdx).map((c) => c.hash),
        ...remoteCommits.map((c) => c.hash),
      ];
    } else if (remoteCommitIdx !== null) {
      // Include this remote commit and all after it (older)
      includeCommitHashes = remoteCommits.slice(remoteCommitIdx).map((c) => c.hash);
    }

    onGeneratePR?.({
      includeStagedFiles: isFromStaged && hasStaged,
      includeCommitHashes,
      targetBranch,
    });
  }
</script>

{#snippet prForm()}
  {@const isFromStaged = selectedCommitIndex === null}
  {@const isFromLocalCommit =
    selectedCommitIndex !== null && selectedCommitIndex < localCommits.length}
  {@const localCommitIndex = isFromLocalCommit ? selectedCommitIndex : null}
  {@const remoteCommitIndex =
    selectedCommitIndex !== null && selectedCommitIndex >= localCommits.length
      ? selectedCommitIndex - localCommits.length
      : null}
  {@const includedLocalCount = isFromStaged
    ? localCommits.length
    : isFromLocalCommit
      ? localCommits.length - localCommitIndex!
      : 0}
  {@const includedRemoteCount =
    remoteCommitIndex !== null ? remoteCommits.length - remoteCommitIndex : remoteCommits.length}
  {@const stagedDescription =
    isFromStaged && hasStaged
      ? `${stagedFiles.length} staged file${stagedFiles.length === 1 ? '' : 's'}`
      : ''}
  {@const localDescription =
    includedLocalCount > 0
      ? `${includedLocalCount} local commit${includedLocalCount === 1 ? '' : 's'}`
      : ''}
  {@const remoteDescription =
    includedRemoteCount > 0
      ? `${includedRemoteCount} pushed commit${includedRemoteCount === 1 ? '' : 's'}`
      : ''}
  {@const parts = [stagedDescription, localDescription, remoteDescription].filter(Boolean)}
  {@const isStreamingPR = isGeneratingPR || isAutofillAndCreatingPR}
  {@const prContext = (() => {
    // Build context for PR creation - same logic as handleGeneratePR
    let includeCommitHashes: string[] = [];
    if (isFromStaged) {
      includeCommitHashes = [...localCommits, ...remoteCommits].map((c) => c.hash);
    } else if (isFromLocalCommit && localCommitIndex !== null) {
      includeCommitHashes = [
        ...localCommits.slice(localCommitIndex).map((c) => c.hash),
        ...remoteCommits.map((c) => c.hash),
      ];
    } else if (remoteCommitIndex !== null) {
      includeCommitHashes = remoteCommits.slice(remoteCommitIndex).map((c) => c.hash);
    }
    return {
      includeStagedFiles: isFromStaged && hasStaged,
      includeCommitHashes,
      targetBranch,
    };
  })()}
  <div class="space-y-3">
    {#if parts.length > 0}
      <p class="text-xs text-muted-foreground">
        {parts.join(', ')} will be included in this PR.
      </p>
    {/if}
    <div>
      {#if !isStreamingPR}
        <span class="text-xs text-muted-foreground mb-1 block">Title</span>
        <Input
          value={prTitle}
          oninput={handlePRTitleInput}
          placeholder="PR title..."
          class="text-sm h-8"
        />
      {/if}
    </div>
    <div>
      <span class="text-xs text-muted-foreground mb-1 block">Description</span>
      <div class="relative">
        <Textarea
          value={isStreamingPR ? generatingPRPreview || '' : prDescription}
          oninput={handlePRDescriptionInput}
          placeholder="Describe your changes..."
          doesExpandToFit
          minHeight={120}
          maxHeight={300}
          readonly={isStreamingPR}
          class="text-sm transition-all duration-200 {isStreamingPR
            ? 'border-primary/40 bg-muted/20 cursor-default'
            : ''}"
        />
        {#if isStreamingPR || prDescriptionAgentId}
          <!-- Subtle streaming indicator / thought process button -->
          <div class="absolute bottom-2 right-2 flex items-center gap-3 text-muted-foreground">
            {#if isStreamingPR}
              <div class="flex gap-1">
                <span
                  class="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse"
                  style="animation-delay: 0ms"
                ></span>
                <span
                  class="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse"
                  style="animation-delay: 150ms"
                ></span>
                <span
                  class="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse"
                  style="animation-delay: 300ms"
                ></span>
              </div>
            {/if}
            {#if prDescriptionAgentId}
              <Button
                variant="ghost"
                size="icon-xs"
                class="h-6 w-6 text-muted-foreground hover:text-foreground"
                onclick={onViewPRThoughtProcess}
                tooltip="View thought process"
                tooltipSide="top"
                tooltipDelayDuration={0}
              >
                <Fa icon={faEye} class="h-4 w-4" />
              </Button>
            {/if}
            {#if isStreamingPR}
              <Button
                variant="ghost"
                size="icon-xs"
                class="h-6 w-6 text-muted-foreground hover:text-destructive-foreground"
                onclick={onStopGeneratingPR}
                tooltip="Stop generating"
                tooltipSide="top"
                tooltipDelayDuration={0}
              >
                <Fa icon={faStop} class="h-4 w-4" />
              </Button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
    <div>
      <span class="text-xs text-muted-foreground mb-1 block">Target Branch</span>
      {#if canEditTargetBranch}
        <select
          class="w-full h-8 px-2 text-sm bg-background border border-input rounded-md"
          bind:value={targetBranch}
          onchange={() => onTargetBranchChange?.(targetBranch)}
        >
          {#each availableBranches as b (b)}
            <option value={b}>{b}</option>
          {/each}
        </select>
      {:else}
        <div
          class="h-8 px-2 text-sm bg-muted/50 border border-input rounded-md flex items-center text-muted-foreground"
        >
          {targetBranch}
        </div>
      {/if}
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <Button
        variant="default"
        size="xs"
        onclick={onCreatePR}
        disabled={!prTitle.trim() || isCreatingPR || isAutofillAndCreatingPR}
      >
        {#if isCreatingPR}
          <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
        {:else}
          <Fa icon={faCodePullRequest} class="h-3 w-3 opacity-50" />
        {/if}
        <span>Create PR</span>
      </Button>
      <Button
        variant="outline"
        size="xs"
        onclick={handleGeneratePR}
        disabled={isGeneratingPR || isAutofillAndCreatingPR}
        tooltip="Generate a title and description"
        tooltipSide="bottom"
        tooltipDelayDuration={0}
      >
        {#if isGeneratingPR}
          <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
        {:else}
          <Fa icon={faRobot} class="h-3 w-3 opacity-50" />
        {/if}
        <span>Auto-fill</span>
      </Button>
      <Button
        variant="outline"
        size="xs"
        onclick={() => {
          onAutofillAndCreatePR?.(prContext);
          // Close the drawer so the action bar progress is visible
          prDrawerOpen = false;
        }}
        disabled={isAutofillAndCreatingPR || isGeneratingPR || isCreatingPR}
        tooltip="Generate a title and description, then create the PR automatically in the background"
        tooltipSide="bottom"
        tooltipDelayDuration={0}
      >
        {#if isAutofillAndCreatingPR}
          <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
        {:else}
          <Fa icon={faRobot} class="h-3 w-3 opacity-50" />
        {/if}
        <span>Auto-fill & Create</span>
      </Button>
    </div>
  </div>
{/snippet}

<div class="w-full p-6">
  {#if !hasAnyContent}
    <div class="text-center py-8 text-sm text-muted-foreground">No changes to show</div>
  {:else}
    <div class="relative">
      <!-- Timeline vertical line -->
      <div class="absolute left-5 top-3 bottom-0 w-px bg-border"></div>

      <!-- ==================== BACKGROUND OPERATION SECTION ==================== -->
      <!-- Show when a background operation is in progress and there are no local changes (to show progress for commit-only PRs) -->
      {#if (backgroundOperation || isAutofillAndCommitting || isAutofillAndCreatingPR) && !hasLocalChanges}
        <div class="relative mb-6">
          <!-- Timeline dot -->
          <div
            class="absolute left-6 top-3.5 mt-0.5 w-2 h-2 -ml-1 rounded-full bg-primary z-10 transform -translate-x-1/2 -translate-y-1/2 animate-pulse"
          ></div>

          <!-- Progress Card -->
          <div class="pl-10 pr-3">
            <div
              class="border border-border bg-muted/30 rounded-lg p-3"
              transition:slide={{ duration: 150 }}
            >
              <div class="flex gap-1">
                <div class="flex items-center gap-2 text-sm">
                  {#if backgroundOperation?.phase === 'executing'}
                    <!-- Executing phase: show success indicator -->
                    <div class="relative text-green-600 dark:text-green-400">
                      <Fa icon={faCheck} class="h-4 w-4" />
                      <span
                        class="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse"
                      ></span>
                    </div>
                    <span class="text-green-600 dark:text-green-400 font-medium">
                      {#if backgroundOperation.type === 'commit'}
                        Committing changes...
                      {:else if backgroundOperation.type === 'add-to-pr'}
                        Pushing to PR...
                      {:else}
                        Creating PR...
                      {/if}
                    </span>
                  {:else}
                    <!-- Generating phase: show spinner -->
                    <Fa icon={faSpinner} class="h-4 w-4 animate-spin text-primary" />
                    <span class="font-medium">
                      {#if isAutofillAndCreatingPR || backgroundOperation?.type === 'create-pr'}
                        {generatingPRStatus || 'Generating PR description...'}
                      {:else}
                        {generatingMessageStatus || 'Generating commit message...'}
                      {/if}
                    </span>
                  {/if}
                </div>
                {#if backgroundOperation?.phase !== 'executing'}
                  <!-- Second line: Streaming preview and stop button -->
                  <div class="flex items-center gap-2">
                    {#if (isAutofillAndCreatingPR || backgroundOperation?.type === 'create-pr') && generatingPRPreview}
                      <span class="flex-1 text-xs text-muted-foreground/70 truncate">
                        {generatingPRPreview.split('\n').pop()?.slice(0, 80) || ''}
                      </span>
                    {:else if !isAutofillAndCreatingPR && backgroundOperation?.type !== 'create-pr' && generatingMessagePreview}
                      <span class="flex-1 text-xs text-muted-foreground/70 truncate">
                        {generatingMessagePreview.split('\n').pop()?.slice(0, 80) || ''}
                      </span>
                    {:else}
                      <span class="flex-1 text-xs text-muted-foreground/50 italic">
                        Waiting for response...
                      </span>
                    {/if}
                    <!-- Stop button with label -->
                    <Button
                      variant="ghost"
                      size="xs"
                      class="h-5 px-2 text-muted-foreground hover:text-destructive-foreground"
                      onclick={isAutofillAndCreatingPR || backgroundOperation?.type === 'create-pr'
                        ? onStopGeneratingPR
                        : onStopGeneratingMessage}
                    >
                      <Fa icon={faStop} class="h-3 w-3" />
                      <!-- <span>Stop</span> -->
                    </Button>
                  </div>
                {/if}
              </div>
            </div>
          </div>
        </div>
      {/if}

      <!-- ==================== LOCAL CHANGES SECTION ==================== -->
      {#if hasLocalChanges}
        <div class="relative mb-9">
          <!-- Timeline dot -->
          <div
            class="absolute left-6 top-3.5 mt-0.5 w-2 h-2 -ml-1 rounded-full bg-border z-10 transform -translate-x-1/2 -translate-y-1/2"
          ></div>

          <!-- Section Header -->
          <div class="pl-10 pr-3 pt-0.5 pb-2 flex items-center justify-between">
            <span class="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wide">
              Local changes
            </span>
            <div class="flex items-center gap-1">
              {#if hasStaged}
                {#if isReviewingCode}
                  <Button
                    variant="ghost-light"
                    size="xs"
                    onclick={onOpenReview}
                    class="text-muted-foreground hover:text-foreground gap-1"
                  >
                    <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
                    <span>Reviewing...</span>
                  </Button>
                {:else if hasExistingReview && reviewStatus === 'complete'}
                  <Button
                    variant="ghost-light"
                    size="xs"
                    onclick={onOpenReview}
                    class="text-muted-foreground hover:text-foreground gap-1"
                  >
                    {#if reviewCommentCount > 0}
                      <Fa
                        icon={faWandMagicSparkles}
                        class="h-3 w-3 {reviewHasCritical ? 'text-red-500' : 'text-green-500'}"
                      />
                      <span>{reviewCommentCount} comment{reviewCommentCount === 1 ? '' : 's'}</span>
                    {:else}
                      <Fa icon={faWandMagicSparkles} class="h-3 w-3 text-green-500" />
                      <span>View Review</span>
                    {/if}
                  </Button>
                {:else if hasExistingReview && reviewStatus === 'stale'}
                  <Button
                    variant="ghost-light"
                    size="xs"
                    onclick={onReReview}
                    class="text-muted-foreground hover:text-foreground gap-1"
                    tooltip="Staged files have changed. Click to generate a new review."
                  >
                    <Fa icon={faRotateRight} class="h-3 w-3 text-yellow-500" />
                    <span>Re-review</span>
                  </Button>
                {:else if onReviewStaged}
                  <Button
                    variant="ghost-light"
                    size="xs"
                    onclick={onReviewStaged}
                    class="text-muted-foreground hover:text-foreground gap-1"
                  >
                    <Fa icon={faWandMagicSparkles} class="h-3 w-3" />
                    <span>Review staged changes</span>
                  </Button>
                {/if}

                {#if reviewArchive.length > 0}
                  <Button
                    variant="ghost-light"
                    size="xs"
                    class="text-muted-foreground hover:text-foreground px-1"
                    tooltip="Previous reviews"
                    onclick={() => {
                      // For now, open the most recent archived review
                      // TODO: Add a proper dropdown menu
                      if (onOpenArchivedReview && reviewArchive[0]) {
                        onOpenArchivedReview(reviewArchive[0]);
                      }
                    }}
                  >
                    <Fa icon={faHistory} class="h-3 w-3" />
                  </Button>
                {/if}
              {/if}
              {#if onOpenLocalChanges}
                <Button
                  variant="ghost-light"
                  size="xs"
                  onclick={onOpenLocalChanges}
                  class="text-muted-foreground hover:text-foreground"
                >
                  <Fa icon={faEye} class="h-3 w-3" />
                  <span>View All</span>
                </Button>
              {/if}
            </div>
          </div>

          <!-- Local Changes Card -->
          <div class="pl-10 pr-3">
            <div class="w-full">
              <div
                class="relative border border-border bg-background z-10 rounded-md overflow-hidden shadow-xs divide-y divide-border"
              >
                <!-- Staged Files - grouped by agent -->
                {#if hasStaged}
                  <div class="">
                    {#if hasAnyAgentAttribution}
                      <!-- Grouped view with agent headers -->
                      <div class="space-y-2">
                        {#each stagedByAgent as group (group.agentId ?? 'manual')}
                          {@const isCollapsed = isAgentGroupCollapsed(group.agentId)}
                          <div class="space-y-px">
                            <!-- Agent header -->
                            <div
                              class="flex items-center gap-1 group/agent-header bg-sidebar/50 px-3 py-1"
                            >
                              <button
                                type="button"
                                class="group/row flex items-center gap-2 flex-1 py-1 text-left hover:bg-muted/30 rounded -mx-1 px-1"
                                onclick={() => toggleAgentGroup(group.agentId)}
                              >
                                <Fa
                                  icon={faChevronRight}
                                  class="h-2.5! w-2.5! text-muted-foreground/50 group-hover/row:text-muted-foreground shrink-0 transition-transform {!isCollapsed &&
                                    'rotate-90'}"
                                />
                                {#if group.agentId}
                                  <AuggieAvatar
                                    class="-mt-1 -mr-0.5"
                                    faceSeed={group.agentId}
                                    colorSeed={group.agentId}
                                    size={18}
                                  />
                                {:else}
                                  <Fa
                                    icon={faUser}
                                    class="h-3 w-3 text-muted-foreground/30 ml-0.5 mr-0.5"
                                  />
                                {/if}
                                <span class="text-xs font-medium truncate">
                                  {getAgentDisplayName(group)}
                                </span>
                              </button>
                              {#if onUnstageGroup || onUnstage}
                                <Button
                                  variant="ghost-light"
                                  size="xs"
                                  class="opacity-0 group-hover/agent-header:opacity-100 transition-opacity shrink-0"
                                  tooltip="Unstage all files in this group"
                                  onclick={(e: MouseEvent) => {
                                    e.stopPropagation();
                                    const paths = group.files.map((f) => f.path);
                                    if (onUnstageGroup) {
                                      onUnstageGroup(paths);
                                    } else {
                                      paths.forEach((p) => onUnstage?.(p));
                                    }
                                  }}
                                >
                                  <Fa icon={faMinus} class="h-2.5 w-2.5" />
                                  <span>Unstage All</span>
                                </Button>
                              {/if}
                              {#if group.agentId}
                                <Button
                                  variant="ghost-light"
                                  size="icon-xs"
                                  class="-mr-1 opacity-0 group-hover/agent-header:opacity-100 transition-opacity shrink-0"
                                  tooltip="Open agent"
                                  onclick={(e: MouseEvent) => {
                                    e.stopPropagation();
                                    openAgent(e, group.agentId!);
                                  }}
                                >
                                  <Fa icon={faArrowRight} class="h-2.5 w-2.5" />
                                </Button>
                              {/if}
                              <span
                                class="text-xs text-muted-foreground shrink-0 absolute right-3 group-hover/agent-header:opacity-0 pointer-events-none"
                              >
                                {group.files.length} file{group.files.length === 1 ? '' : 's'}
                              </span>
                            </div>
                            <!-- Files in group -->
                            {#if !isCollapsed}
                              <div class="pl-5" transition:slide={{ duration: 150 }}>
                                {#each group.files as file (file.path)}
                                  <div
                                    class="w-full px-3"
                                    transition:slide={{ axis: 'y', duration: 200 }}
                                  >
                                    <FileRow
                                      {file}
                                      showStageAction
                                      {onFileClick}
                                      {onStage}
                                      {onUnstage}
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
                        {#each stagedFiles as file (file.path)}
                          <div class="w-full px-3" transition:slide={{ axis: 'y', duration: 200 }}>
                            <FileRow {file} showStageAction {onFileClick} {onStage} {onUnstage} />
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/if}

                <!-- Unstaged Files - grouped by agent -->
                <!-- {#if hasUnstaged} -->
                <div
                  class="bg-muted/30 pl-3 pr-1.5"
                  transition:slide={{ axis: 'y', duration: 200 }}
                >
                  <button
                    type="button"
                    class="flex items-center justify-between w-full cursor-pointer gap-2"
                    onclick={() => (unstagedExpanded = !unstagedExpanded)}
                  >
                    <div class="flex items-center gap-2">
                      <span class="text-xs text-muted-foreground py-1"
                        >{unstagedFiles.length ? unstagedFiles.length : 'No'} unstaged file{unstagedFiles.length ===
                        1
                          ? ''
                          : 's'}</span
                      >
                    </div>
                    <div class="flex items-center gap-px">
                      {#if hasStaged && onUnstageAll}
                        <Button
                          variant="ghost-light"
                          size="xs"
                          onclick={(e) => {
                            e.stopPropagation();
                            onUnstageAll();
                          }}
                        >
                          <Fa icon={faMinus} class="h-2.5 w-2.5" />
                          <span>Unstage All</span>
                        </Button>
                      {/if}
                      {#if unstagedFiles.length > 0 && onStageAll}
                        <Button
                          variant="ghost-light"
                          size="xs"
                          onclick={(e) => {
                            e.stopPropagation();
                            onStageAll();
                          }}
                        >
                          <Fa icon={faPlus} class="h-2.5 w-2.5" />
                          <span>Stage All</span>
                        </Button>
                      {/if}
                    </div>
                  </button>

                  {#if unstagedExpanded}
                    {#if hasAnyAgentAttribution}
                      <!-- Grouped view with agent headers -->
                      <div class="space-y-2" transition:slide={{ duration: 150 }}>
                        {#each unstagedByAgent as group (group.agentId ?? 'manual')}
                          {@const isCollapsed = isAgentGroupCollapsed(group.agentId)}
                          <div class="space-y-px">
                            <!-- Agent header -->
                            <div class="flex items-center gap-1 group/agent-header">
                              <button
                                type="button"
                                class="group/row flex items-center gap-2 flex-1 py-1 text-left hover:bg-muted/30 rounded -mx-1 px-1"
                                onclick={(e) => {
                                  e.stopPropagation();
                                  toggleAgentGroup(group.agentId);
                                }}
                              >
                                <Fa
                                  icon={faChevronRight}
                                  class="h-2.5! w-2.5! text-muted-foreground/50 group-hover/row:text-muted-foreground shrink-0 transition-transform {!isCollapsed &&
                                    'rotate-90'}"
                                />
                                {#if group.agentId}
                                  <AuggieAvatar
                                    class="-mt-1"
                                    faceSeed={group.agentId}
                                    colorSeed={group.agentId}
                                    size={18}
                                  />
                                {:else}
                                  <Fa icon={faUser} class="h-3 w-3 text-muted-foreground" />
                                {/if}
                                <span class="text-xs font-medium truncate">
                                  {getAgentDisplayName(group)}
                                </span>
                              </button>
                              {#if onStageGroup || onStage}
                                <Button
                                  variant="ghost-light"
                                  size="xs"
                                  class="opacity-0 group-hover/agent-header:opacity-100 transition-opacity shrink-0"
                                  tooltip="Stage all files in this group"
                                  onclick={(e: MouseEvent) => {
                                    e.stopPropagation();
                                    const paths = group.files.map((f) => f.path);
                                    if (onStageGroup) {
                                      onStageGroup(paths);
                                    } else {
                                      paths.forEach((p) => onStage?.(p));
                                    }
                                  }}
                                >
                                  <Fa icon={faPlus} class="h-2.5 w-2.5" />
                                  <span>Stage All</span>
                                </Button>
                              {/if}
                              {#if group.agentId}
                                <Button
                                  variant="ghost-light"
                                  size="icon-xs"
                                  class="-mr-1 opacity-0 group-hover/agent-header:opacity-100 transition-opacity shrink-0"
                                  tooltip="Open agent"
                                  onclick={(e: MouseEvent) => {
                                    e.stopPropagation();
                                    openAgent(e, group.agentId!);
                                  }}
                                >
                                  <Fa icon={faArrowRight} class="h-2.5 w-2.5" />
                                </Button>
                              {/if}
                              <span
                                class="text-xs text-muted-foreground shrink-0 absolute right-3 group-hover/agent-header:opacity-0 pointer-events-none"
                              >
                                {group.files.length} file{group.files.length === 1 ? '' : 's'}
                              </span>
                            </div>
                            <!-- Files in group -->
                            {#if !isCollapsed}
                              <div class="pl-5" transition:slide={{ duration: 150 }}>
                                {#each group.files as file (file.path)}
                                  <div
                                    class="w-full px-3"
                                    transition:fly={{ x: -6, duration: 200 }}
                                  >
                                    <FileRow
                                      {file}
                                      muted
                                      showStageAction
                                      showRevertAction
                                      {onFileClick}
                                      {onStage}
                                      {onUnstage}
                                      {onRevert}
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
                      <div class="space-y-px" transition:slide={{ duration: 150 }}>
                        {#each unstagedFiles as file (file.path)}
                          <div class="w-full px-3" transition:fly={{ x: -6, duration: 200 }}>
                            <FileRow
                              {file}
                              muted
                              showStageAction
                              showRevertAction
                              {onFileClick}
                              {onStage}
                              {onUnstage}
                              {onRevert}
                            />
                          </div>
                        {/each}
                      </div>
                    {/if}
                  {/if}
                </div>
                <!-- {/if} -->
              </div>
              <!-- Action bar at bottom -->
              <div class="pb-1 pt-2 -mt-1 bg-muted/30 rounded-b-lg">
                <div class="flex items-center gap-3 px-3 min-w-0 w-full">
                  {#if backgroundOperation || isAutofillAndCommitting || isAutofillAndCreatingPR}
                    <!-- Background operation in progress - stacked layout -->
                    <div class="flex gap-1 flex-1 min-w-0">
                      <div class="flex items-start gap-2 text-xs flex-1">
                        {#if backgroundOperation?.phase === 'executing'}
                          <!-- Executing phase: show success indicator -->
                          <div class="relative flex text-green-600 dark:text-green-400">
                            <Fa icon={faCheck} class="h-3 w-3 shrink-0" />
                            <span
                              class="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse"
                            ></span>
                          </div>
                          <span class="truncate flex-1">
                            {#if backgroundOperation.type === 'commit'}
                              Committing...
                            {:else if backgroundOperation.type === 'add-to-pr'}
                              Pushing to PR...
                            {:else}
                              Creating PR...
                            {/if}
                          </span>
                        {:else}
                          <!-- Generating phase: show spinner -->
                          <Fa
                            icon={faSpinner}
                            class="h-3 w-3 animate-spin text-muted-foreground shrink-0"
                          />
                          <span class="text-muted-foreground truncate flex-1">
                            {#if isAutofillAndCreatingPR || backgroundOperation?.type === 'create-pr'}
                              {generatingPRStatus || 'Generating PR description...'}
                            {:else}
                              {generatingMessageStatus ||
                                (hasPRs
                                  ? 'Adding to PR in background...'
                                  : 'Committing in background...')}
                            {/if}
                          </span>
                        {/if}
                      </div>
                      {#if backgroundOperation?.phase !== 'executing'}
                        <!-- Second line: Streaming preview and stop button -->
                        <div class="flex items-center gap-2 flex-1">
                          {#if (isAutofillAndCreatingPR || backgroundOperation?.type === 'create-pr') && generatingPRPreview}
                            <span class="flex-1 text-xs text-muted-foreground/70 truncate">
                              {generatingPRPreview.split('\n').pop()?.slice(0, 60) || ''}
                            </span>
                          {:else if !isAutofillAndCreatingPR && backgroundOperation?.type !== 'create-pr' && generatingMessagePreview}
                            <span class="flex-1 text-xs text-muted-foreground/70 truncate">
                              {generatingMessagePreview.split('\n').pop()?.slice(0, 60) || ''}
                            </span>
                          {:else}
                            <span class="flex-1 text-xs text-muted-foreground/50 italic">
                              Waiting for response...
                            </span>
                          {/if}
                          <!-- Stop button with label -->
                          <Button
                            variant="ghost"
                            size="xs"
                            class="h-5 px-1.5 text-muted-foreground hover:text-destructive-foreground"
                            onclick={isAutofillAndCreatingPR ||
                            backgroundOperation?.type === 'create-pr'
                              ? onStopGeneratingPR
                              : onStopGeneratingMessage}
                          >
                            <Fa icon={faStop} class="h-3 w-3" />
                            <!-- <span>Stop</span> -->
                          </Button>
                        </div>
                      {/if}
                    </div>
                  {:else if hasStaged}
                    <!-- Always show Commit option -->
                    <Button
                      variant="ghost-light"
                      class="py-0! {commitDrawerOpen ? 'bg-background' : ''}"
                      size="xs"
                      onclick={() => toggleDrawer('commit')}
                    >
                      <Fa icon={faCodeCommit} class="h-3 w-3 opacity-50" />
                      <span>Commit</span>
                    </Button>
                    {#if hasRemote}
                      {#if hasPRs}
                        <!-- PR exists, show Add to PR option -->
                        <Button
                          variant="ghost-light"
                          class="py-0! {addToPRDrawerOpen ? 'bg-background' : ''}"
                          size="xs"
                          onclick={() => toggleDrawer('addToPR')}
                        >
                          <Fa icon={faCodePullRequest} class="h-3 w-3 opacity-50" />
                          <span>Add to PR</span>
                        </Button>
                      {:else}
                        <!-- No PR yet, show Create PR option -->
                        <Button
                          variant="ghost-light"
                          class="py-0! {prDrawerOpen && selectedCommitIndex === null
                            ? 'bg-background'
                            : ''}"
                          size="xs"
                          onclick={() => {
                            selectedCommitIndex = null;
                            toggleDrawer('pr');
                          }}
                        >
                          <Fa icon={faCodePullRequest} class="h-3 w-3 opacity-50" />
                          <span>Create PR</span>
                        </Button>
                      {/if}
                    {/if}
                    <!-- Show Merge to trunk - can merge staged files + any commits -->
                    <Button
                      variant="ghost-light"
                      class="py-0! {mergeDrawerOpen && selectedCommitIndex === null
                        ? 'bg-background'
                        : ''}"
                      size="xs"
                      onclick={() => {
                        selectedCommitIndex = null;
                        toggleDrawer('merge');
                      }}
                    >
                      <Fa icon={faCodeMerge} class="h-3 w-3 opacity-50" />
                      <span>Merge to trunk</span>
                    </Button>
                  {:else}
                    <p class="text-xs text-muted-foreground pt-[0.3rem]">
                      <button class="underline cursor-pointer" onclick={onStageAll}
                        >Stage files</button
                      > to commit and create a pull request
                    </p>
                  {/if}

                  <Button
                    variant="ghost-light"
                    class="py-0! {exportDrawerOpen ? 'bg-background' : ''}"
                    size="xs"
                    onclick={() => toggleDrawer('export')}
                  >
                    <Fa icon={faFolderOpen} class="h-3 w-3 opacity-50" />
                    <span>Copy changes to folder</span>
                  </Button>
                </div>

                <!-- Commit drawer -->
                {#if commitDrawerOpen}
                  {@const isStreamingCommit = isGeneratingMessage || isAutofillAndCommitting}
                  <div class="p-3" transition:slide={{ duration: 150 }}>
                    <div class="relative mb-2">
                      <Textarea
                        value={isStreamingCommit ? generatingMessagePreview || '' : commitMessage}
                        oninput={handleMessageInput}
                        placeholder="Commit message..."
                        doesExpandToFit
                        minHeight={120}
                        maxHeight={300}
                        readonly={isStreamingCommit}
                        class="text-sm transition-all duration-200 {isStreamingCommit
                          ? 'border-primary/40 bg-muted/20 cursor-default'
                          : ''}"
                      />
                      {#if isStreamingCommit || commitMessageAgentId}
                        <!-- Subtle streaming indicator / thought process button -->
                        <div
                          class="absolute bottom-2 right-2 flex items-center gap-3 text-muted-foreground"
                        >
                          {#if isStreamingCommit}
                            <div class="flex gap-1">
                              <span
                                class="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse"
                                style="animation-delay: 0ms"
                              ></span>
                              <span
                                class="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse"
                                style="animation-delay: 150ms"
                              ></span>
                              <span
                                class="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse"
                                style="animation-delay: 300ms"
                              ></span>
                            </div>
                          {/if}
                          {#if commitMessageAgentId}
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              class="h-6 w-6 text-muted-foreground hover:text-foreground"
                              onclick={onViewCommitThoughtProcess}
                              tooltip="View thought process"
                              tooltipSide="top"
                              tooltipDelayDuration={0}
                            >
                              <Fa icon={faEye} class="h-4 w-4" />
                            </Button>
                          {/if}
                          {#if isStreamingCommit}
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              class="h-6 w-6 text-muted-foreground hover:text-destructive-foreground"
                              onclick={onStopGeneratingMessage}
                              tooltip="Stop generating"
                              tooltipSide="top"
                              tooltipDelayDuration={0}
                            >
                              <Fa icon={faStop} class="h-4 w-4" />
                            </Button>
                          {/if}
                        </div>
                      {/if}
                    </div>
                    <div class="flex items-center gap-2 flex-wrap">
                      <Button
                        variant="default"
                        size="xs"
                        onclick={onCommit}
                        disabled={!commitMessage.trim() || isCommitting || isAutofillAndCommitting}
                      >
                        {#if isCommitting}
                          <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
                        {:else}
                          <Fa icon={faCodeCommit} class="h-3 w-3 opacity-50" />
                        {/if}
                        <span>Commit</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        onclick={onGenerateMessage}
                        disabled={isGeneratingMessage || isAutofillAndCommitting}
                        tooltip="Generate a commit message"
                        tooltipSide="bottom"
                        tooltipDelayDuration={0}
                      >
                        {#if isGeneratingMessage}
                          <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
                        {:else}
                          <Fa icon={faRobot} class="h-3 w-3 opacity-50" />
                        {/if}
                        <span>Auto-fill</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        onclick={onAutofillAndCommit}
                        disabled={isAutofillAndCommitting || isGeneratingMessage || isCommitting}
                        tooltip="Generate a commit message, then commit automatically in the background"
                        tooltipSide="bottom"
                        tooltipDelayDuration={0}
                      >
                        {#if isAutofillAndCommitting}
                          <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
                        {:else}
                          <Fa icon={faRobot} class="h-3 w-3 opacity-50" />
                        {/if}
                        <span>Auto-fill & Commit</span>
                      </Button>
                    </div>
                  </div>
                {/if}

                <!-- Add to PR drawer (only when remote exists) -->
                {#if hasRemote && addToPRDrawerOpen}
                  <div class="p-3" transition:slide={{ duration: 150 }}>
                    {#if isGeneratingMessage || isAutofillAndCommitting}
                      <!-- Streaming preview while generating -->
                      <div
                        class="mb-2 rounded-md border border-border bg-muted/30 p-3"
                        transition:slide={{ duration: 150 }}
                      >
                        <div class="flex items-center justify-between mb-2">
                          <div class="flex items-center gap-2 text-xs text-muted-foreground">
                            <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
                            <span>{generatingMessageStatus || 'Generating commit message...'}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="xs"
                            class="h-5 px-1.5 text-muted-foreground hover:text-destructive-foreground"
                            onclick={onStopGeneratingMessage}
                            tooltip="Stop generating"
                            tooltipSide="left"
                          >
                            <Fa icon={faStop} class="h-3 w-3" />
                          </Button>
                        </div>
                        {#if generatingMessagePreview}
                          <div class="text-sm text-foreground/80 line-clamp-2 whitespace-pre-wrap">
                            {generatingMessagePreview}
                          </div>
                        {:else}
                          <div class="flex gap-1">
                            <div class="h-3 w-16 bg-muted rounded animate-pulse"></div>
                            <div class="h-3 w-24 bg-muted rounded animate-pulse"></div>
                            <div class="h-3 w-12 bg-muted rounded animate-pulse"></div>
                          </div>
                        {/if}
                      </div>
                    {:else}
                      <!-- Normal Add to PR form -->
                      <textarea
                        class="w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                        rows="3"
                        placeholder="Commit message..."
                        bind:value={commitMessage}
                      ></textarea>
                      <div class="flex items-center gap-2 flex-wrap mt-2">
                        <Button
                          variant="default"
                          size="xs"
                          onclick={() => onAddToPR?.(true)}
                          disabled={!commitMessage.trim() || isCommitting || isPushing}
                        >
                          {#if isCommitting || isPushing}
                            <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
                          {:else}
                            <Fa icon={faCodePullRequest} class="h-3 w-3 opacity-50" />
                          {/if}
                          <span>Add to PR</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="xs"
                          onclick={onGenerateMessage}
                          disabled={isGeneratingMessage || isAutofillAndCommitting}
                          tooltip="Generate a commit message"
                          tooltipSide="bottom"
                          tooltipDelayDuration={0}
                        >
                          {#if isGeneratingMessage}
                            <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
                          {:else}
                            <Fa icon={faRobot} class="h-3 w-3 opacity-50" />
                          {/if}
                          <span>Auto-fill</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="xs"
                          onclick={onAutofillAndAddToPR}
                          disabled={isAutofillAndCommitting ||
                            isGeneratingMessage ||
                            isCommitting ||
                            isPushing}
                          tooltip="Generate a commit message, then add to PR automatically in the background"
                          tooltipSide="bottom"
                          tooltipDelayDuration={0}
                        >
                          {#if isAutofillAndCommitting}
                            <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
                          {:else}
                            <Fa icon={faRobot} class="h-3 w-3 opacity-50" />
                          {/if}
                          <span>Auto-fill & Add</span>
                        </Button>
                      </div>
                    {/if}
                  </div>
                {/if}

                <!-- Export drawer -->
                {#if exportDrawerOpen}
                  <div class="p-3 space-y-2" transition:slide={{ duration: 150 }}>
                    <button
                      type="button"
                      class="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded border border-border/50 bg-background hover:bg-muted/30 transition-colors"
                      onclick={async () => {
                        const path = await onPickExportFolder?.();
                        if (path) exportFolderPath = path;
                      }}
                    >
                      <Fa icon={faFolderOpen} class="h-3 w-3 text-muted-foreground shrink-0" />
                      <span
                        class="text-sm truncate flex-1 {exportFolderPath
                          ? ''
                          : 'text-muted-foreground'}"
                      >
                        {exportFolderPath || 'Choose folder...'}
                      </span>
                    </button>
                    <div class="flex items-center gap-2">
                      <Button
                        variant="default"
                        size="xs"
                        onclick={() => exportFolderPath && onExport?.(exportFolderPath)}
                        disabled={isExporting || !exportFolderPath}
                      >
                        {#if isExporting}
                          <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
                        {/if}
                        <span>Copy changes over</span>
                      </Button>
                      {#if exportFolderPath}
                        <FileActionsDropdown
                          filePath={exportFolderPath}
                          {workspaceId}
                          isDirectory={true}
                          size="xs"
                          workspaceFolderPath={exportFolderPath}
                        />
                      {/if}
                    </div>
                  </div>
                {/if}

                <!-- Create PR drawer (for uncommitted changes, only when remote exists) -->
                {#if hasRemote && prDrawerOpen && selectedCommitIndex === null}
                  <div class="p-3" transition:slide={{ duration: 150 }}>
                    {@render prForm()}
                  </div>
                {/if}

                <!-- Merge to trunk drawer (for staged files section) -->
                {#if mergeDrawerOpen && selectedCommitIndex === null}
                  {@const totalExistingCommits = localCommits.length + remoteCommits.length}
                  {@const totalAfterCommit = totalExistingCommits + (hasStaged ? 1 : 0)}
                  <div class="p-3" transition:slide={{ duration: 150 }}>
                    <p class="text-xs text-muted-foreground mb-3">
                      {#if hasStaged && totalExistingCommits === 0}
                        Commit staged files and merge directly into <span class="font-medium"
                          >{targetBranch}</span
                        >.
                      {:else if hasStaged}
                        Commit staged files and merge with {totalExistingCommits} existing commit{totalExistingCommits >
                        1
                          ? 's'
                          : ''} into <span class="font-medium">{targetBranch}</span>.
                      {:else}
                        Merge {localCommits.length} commit{localCommits.length > 1
                          ? 's'
                          : ''}{remoteCommits.length > 0
                          ? ` (plus ${remoteCommits.length} already pushed)`
                          : ''} into <span class="font-medium">{targetBranch}</span>.
                      {/if}
                      {#if hasPRs}
                        <span class="text-amber-600 dark:text-amber-400"
                          >The open PR will need to be closed manually.</span
                        >
                      {/if}
                    </p>
                    <div class="flex items-center gap-2">
                      <Button
                        variant="default"
                        size="xs"
                        onclick={() => (hasStaged ? onAutofillAndMerge?.() : onMergeToTrunk?.())}
                        disabled={isMergingToTrunk}
                      >
                        {#if isMergingToTrunk}
                          <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
                        {:else}
                          <Fa icon={faCodeMerge} class="h-3 w-3 opacity-50" />
                        {/if}
                        <span>Merge</span>
                      </Button>
                      {#if totalAfterCommit > 1}
                        <Button
                          variant="outline"
                          size="xs"
                          onclick={() =>
                            hasStaged
                              ? onAutofillAndMerge?.({ squash: true })
                              : onMergeToTrunk?.({ squash: true })}
                          disabled={isMergingToTrunk}
                        >
                          {#if isMergingToTrunk}
                            <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
                          {:else}
                            <Fa icon={faCodeMerge} class="h-3 w-3 opacity-50" />
                          {/if}
                          <span>Squash & Merge</span>
                        </Button>
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>
            </div>
          </div>
        </div>
      {/if}

      <!-- ==================== BRANCH SECTION (local commits not pushed) ==================== -->
      {#if hasLocalCommits}
        <div class="relative mb-9">
          <!-- Timeline dot -->
          <div
            class="absolute left-6 top-3.5 mt-0.5 w-2 h-2 -ml-1 rounded-full bg-border z-10 transform -translate-x-1/2 -translate-y-1/2"
          ></div>

          <!-- Section Header -->
          <div
            class="pl-10 pr-3 py-2 text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wide flex items-center"
          >
            <div class="flex-1">On local branch</div>
            <span class="font-normal ml-1">{branch}</span>
          </div>

          <!-- Local Commits with action bars -->
          <div class="pl-10 pr-3 pb-3">
            <div class="space-y-3">
              {#each localCommits as commit, index (commit.hash)}
                {@const commitsFromHere = localCommits.length - index}
                {@const isSelectedForAction = selectedCommitIndex === index}
                <div class="w-full">
                  <div
                    class="border border-border rounded-md overflow-hidden shadow-xs bg-background relative z-10"
                    transition:fly={{ y: 6, duration: 200 }}
                  >
                    <CommitNode {commit} noBorder {onFileClick} />
                  </div>

                  <!-- Action bar at bottom of commit -->
                  <div class="py-0.5 bg-muted/30 pt-2 -mt-1 rounded-b-lg">
                    <div class="flex items-center gap-1 px-3">
                      {#if backgroundOperation || isAutofillAndCommitting || isAutofillAndCreatingPR}
                        <!-- Background operation in progress -->
                        <div class="flex gap-1 flex-1">
                          <div class="flex items-center gap-2 text-xs flex-1">
                            {#if backgroundOperation?.phase === 'executing'}
                              <div class="relative text-green-600 dark:text-green-400">
                                <Fa icon={faCheck} class="h-3 w-3" />
                                <span
                                  class="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse"
                                ></span>
                              </div>
                              <span class="flex-1 text-left text-green-600 dark:text-green-400">
                                {#if backgroundOperation.type === 'commit'}
                                  Committing...
                                {:else if backgroundOperation.type === 'add-to-pr'}
                                  Pushing to PR...
                                {:else}
                                  Creating PR...
                                {/if}
                              </span>
                            {:else}
                              <Fa
                                icon={faSpinner}
                                class="h-3 w-3 animate-spin text-muted-foreground"
                              />
                              <span class="flex-1 text-left text-muted-foreground">
                                {#if isAutofillAndCreatingPR || backgroundOperation?.type === 'create-pr'}
                                  {generatingPRStatus || 'Generating PR description...'}
                                {:else}
                                  {generatingMessageStatus || 'Generating commit message...'}
                                {/if}
                              </span>
                            {/if}
                          </div>
                          {#if backgroundOperation?.phase !== 'executing'}
                            <div class="flex-1 flex items-center gap-2">
                              {#if (isAutofillAndCreatingPR || backgroundOperation?.type === 'create-pr') && generatingPRPreview}
                                <span
                                  class="flex-1 text-left text-xs text-muted-foreground/70 truncate"
                                >
                                  {generatingPRPreview.split('\n').pop()?.slice(0, 60) || ''}
                                </span>
                              {:else if !isAutofillAndCreatingPR && backgroundOperation?.type !== 'create-pr' && generatingMessagePreview}
                                <span
                                  class="flex-1 text-left text-xs text-muted-foreground/70 truncate"
                                >
                                  {generatingMessagePreview.split('\n').pop()?.slice(0, 60) || ''}
                                </span>
                              {:else}
                                <span
                                  class="flex-1 text-left text-xs text-muted-foreground/50 italic"
                                >
                                  Waiting for response...
                                </span>
                              {/if}
                              <Button
                                variant="ghost"
                                size="xs"
                                class="h-5 px-1.5 text-muted-foreground hover:text-destructive-foreground"
                                onclick={isAutofillAndCreatingPR ||
                                backgroundOperation?.type === 'create-pr'
                                  ? onStopGeneratingPR
                                  : onStopGeneratingMessage}
                              >
                                <Fa icon={faStop} class="h-3 w-3" />
                                <span>Stop</span>
                              </Button>
                            </div>
                          {/if}
                        </div>
                      {:else if hasRemote && hasPRs}
                        <!-- When PR exists and remote available, show Add to PR and Merge to trunk -->
                        <Button
                          variant="ghost-light"
                          class="py-0! {isSelectedForAction && pushDrawerOpen
                            ? 'bg-background'
                            : ''}"
                          size="xs"
                          onclick={() => selectCommitAndToggle(index, 'push')}
                        >
                          <Fa icon={faCodePullRequest} class="h-3 w-3 opacity-50" />
                          <span>Add to PR</span>
                        </Button>
                        <Button
                          variant="ghost-light"
                          class="py-0! {isSelectedForAction && mergeDrawerOpen
                            ? 'bg-background'
                            : ''}"
                          size="xs"
                          onclick={() => selectCommitAndToggleMerge(index)}
                        >
                          <Fa icon={faCodeMerge} class="h-3 w-3 opacity-50" />
                          <span>Merge to trunk</span>
                        </Button>
                      {:else}
                        <!-- No PR (or no remote), show available options -->
                        {#if hasRemote}
                          <Button
                            variant="ghost-light"
                            class="py-0! {isSelectedForAction && pushDrawerOpen
                              ? 'bg-background'
                              : ''}"
                            size="xs"
                            onclick={() => selectCommitAndToggle(index, 'push')}
                          >
                            <Fa icon={faArrowRight} class="h-3 w-3 opacity-50" />
                            <span>Push to remote</span>
                          </Button>
                          <Button
                            variant="ghost-light"
                            class="py-0! {isSelectedForAction && prDrawerOpen ? 'bg-background' : ''}"
                            size="xs"
                            onclick={() => selectCommitAndToggle(index, 'pr')}
                          >
                            <Fa icon={faCodePullRequest} class="h-3 w-3 opacity-50" />
                            <span>Create PR</span>
                          </Button>
                        {/if}
                        <Button
                          variant="ghost-light"
                          class="py-0! {isSelectedForAction && mergeDrawerOpen
                            ? 'bg-background'
                            : ''}"
                          size="xs"
                          onclick={() => selectCommitAndToggleMerge(index)}
                        >
                          <Fa icon={faCodeMerge} class="h-3 w-3 opacity-50" />
                          <span>Merge to trunk</span>
                        </Button>
                      {/if}
                    </div>

                    <!-- Push/Add to PR drawer for this commit (only when remote exists) -->
                    {#if hasRemote && isSelectedForAction && pushDrawerOpen}
                      <div class="p-3" transition:slide={{ duration: 150 }}>
                        <p class="text-xs text-muted-foreground mb-2">
                          {#if hasPRs}
                            Add {commitsFromHere} commit{commitsFromHere > 1 ? 's' : ''} to the open PR
                          {:else}
                            Push {commitsFromHere} commit{commitsFromHere > 1 ? 's' : ''} to origin/{branch}
                          {/if}
                        </p>
                        <Button
                          variant="default"
                          size="xs"
                          onclick={() => (hasPRs ? onAddToPR?.(false) : onPush?.())}
                          disabled={isPushing}
                        >
                          {#if isPushing}
                            <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
                          {:else if hasPRs}
                            <Fa icon={faCodePullRequest} class="h-3 w-3 opacity-50" />
                          {:else}
                            <Fa icon={faArrowRight} class="h-3 w-3 opacity-50" />
                          {/if}
                          <span>{hasPRs ? 'Add to PR' : 'Push to remote'}</span>
                        </Button>
                      </div>
                    {/if}

                    <!-- Create PR drawer for this commit (only when no PR and remote exists) -->
                    {#if hasRemote && isSelectedForAction && prDrawerOpen && !hasPRs}
                      <div class="p-3" transition:slide={{ duration: 150 }}>
                        {@render prForm()}
                      </div>
                    {/if}

                    <!-- Merge to trunk drawer for this commit -->
                    {#if isSelectedForAction && mergeDrawerOpen}
                      {@const totalCommitsToMerge = commitsFromHere + remoteCommits.length}
                      <div class="p-3" transition:slide={{ duration: 150 }}>
                        <p class="text-xs text-muted-foreground mb-3">
                          Merge {commitsFromHere} commit{commitsFromHere > 1
                            ? 's'
                            : ''}{remoteCommits.length > 0
                            ? ` (plus ${remoteCommits.length} already pushed)`
                            : ''} into <span class="font-medium">{targetBranch}</span>.
                          {#if hasPRs}
                            <span class="text-amber-600 dark:text-amber-400"
                              >The open PR will need to be closed manually.</span
                            >
                          {/if}
                        </p>
                        <div class="flex items-center gap-2">
                          <Button
                            variant="default"
                            size="xs"
                            onclick={() => onMergeToTrunk?.()}
                            disabled={isMergingToTrunk}
                          >
                            {#if isMergingToTrunk}
                              <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
                            {:else}
                              <Fa icon={faCodeMerge} class="h-3 w-3 opacity-50" />
                            {/if}
                            <span>Merge</span>
                          </Button>
                          {#if totalCommitsToMerge > 1}
                            <Button
                              variant="outline"
                              size="xs"
                              onclick={() => onMergeToTrunk?.({ squash: true })}
                              disabled={isMergingToTrunk}
                            >
                              {#if isMergingToTrunk}
                                <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
                              {:else}
                                <Fa icon={faCodeMerge} class="h-3 w-3 opacity-50" />
                              {/if}
                              <span>Squash & Merge</span>
                            </Button>
                          {/if}
                        </div>
                      </div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </div>
      {/if}

      <!-- ==================== REMOTE BRANCH SECTION ==================== -->
      {#if hasRemoteSection}
        <div class="relative mb-9">
          <!-- Timeline dot -->
          <div
            class="absolute left-6 top-3.5 mt-0.5 w-2 h-2 -ml-1 rounded-full bg-border z-10 transform -translate-x-1/2 -translate-y-1/2"
          ></div>

          <!-- Section Header -->
          <div
            class="pl-10 pr-3 py-2 text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wide flex items-center"
          >
            <div class="flex-1">Pushed to remote branch</div>
            <span class="font-normal ml-1">origin/{branch}</span>
          </div>

          <!-- Merge to trunk action (at top of remote section) -->
          {#if true}
            {@const totalBranchCommits = localCommits.length + remoteCommits.length}
            <div class="pl-10 pr-3 pb-2">
              <div class="py-0.5 bg-muted/30 rounded-lg">
                <div class="flex items-center gap-1 px-3 py-0.5">
                  <Button
                    variant="ghost-light"
                    class="py-0! {mergeDrawerOpen && selectedCommitIndex === -1
                      ? 'bg-background'
                      : ''}"
                    size="xs"
                    onclick={() => selectCommitAndToggleMerge(-1)}
                  >
                    <Fa icon={faCodeMerge} class="h-3 w-3 opacity-50" />
                    <span>Merge to trunk</span>
                  </Button>
                </div>

                {#if mergeDrawerOpen && selectedCommitIndex === -1}
                  <div class="p-3" transition:slide={{ duration: 150 }}>
                    <p class="text-xs text-muted-foreground mb-2">
                      Merge {totalBranchCommits} commit{totalBranchCommits > 1 ? 's' : ''} directly into
                      <span class="font-medium">{targetBranch}</span>.
                      {#if hasPRs}
                        <span class="text-amber-600 dark:text-amber-400"
                          >The open PR will need to be closed manually.</span
                        >
                      {/if}
                    </p>
                    <div class="flex items-center gap-2">
                      <Button
                        variant="default"
                        size="xs"
                        onclick={() => onMergeToTrunk?.()}
                        disabled={isMergingToTrunk}
                      >
                        {#if isMergingToTrunk}
                          <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
                        {:else}
                          <Fa icon={faCodeMerge} class="h-3 w-3 opacity-50" />
                        {/if}
                        <span>Merge</span>
                      </Button>
                      {#if totalBranchCommits > 1}
                        <Button
                          variant="outline"
                          size="xs"
                          onclick={() => onMergeToTrunk?.({ squash: true })}
                          disabled={isMergingToTrunk}
                        >
                          {#if isMergingToTrunk}
                            <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
                          {:else}
                            <Fa icon={faCodeMerge} class="h-3 w-3 opacity-50" />
                          {/if}
                          <span>Squash & Merge</span>
                        </Button>
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>
            </div>
          {/if}

          <!-- Remote Commits with action bars (only shown if no PR, otherwise they're nested in the PR) -->
          {#if hasRemoteCommitsToShow}
            <div class="pl-10 pr-3 pb-3">
              <div class="space-y-3">
                {#each remoteCommits as commit, index (commit.hash)}
                  {@const remoteCommitIndex = localCommits.length + index}
                  {@const isSelectedForAction = selectedCommitIndex === remoteCommitIndex}
                  <div class="w-full">
                    <div
                      class="border border-border rounded-md overflow-hidden shadow-xs bg-background relative z-10"
                    >
                      <CommitNode
                        {commit}
                        noBorder
                        showViewAction
                        {onFileClick}
                        onView={onOpenCommit}
                      />
                    </div>
                    <!-- Action bar at bottom of commit -->
                    <div class="py-0.5 bg-muted/30 pt-2 -mt-1 rounded-b-lg">
                      <div class="flex items-center gap-1 px-3 py-0.5">
                        <Button
                          variant="ghost-light"
                          class="py-0! {isSelectedForAction && prDrawerOpen ? 'bg-background' : ''}"
                          size="xs"
                          onclick={() => selectCommitAndToggle(remoteCommitIndex, 'pr')}
                        >
                          <Fa icon={faCodePullRequest} class="h-3 w-3 opacity-50" />
                          <span>Create PR</span>
                        </Button>
                      </div>

                      <!-- Create PR drawer for this commit -->
                      {#if isSelectedForAction && prDrawerOpen}
                        <div class="p-3" transition:slide={{ duration: 150 }}>
                          {@render prForm()}
                        </div>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Pull Requests -->
          {#if hasPRs}
            <div class="pl-10 pr-3 pb-3 space-y-3">
              {#each prs as pr (pr.number)}
                <PRNode {pr} {onFileClick} {onOpenPR} {onOpenCommit} />
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <!-- ==================== CONNECT REMOTE SECTION ==================== -->
      {#if !hasRemote && onAddRemote}
        <div class="relative mb-9">
          <!-- Timeline dot -->
          <div
            class="absolute left-6 top-3.5 mt-0.5 w-2 h-2 -ml-1 rounded-full bg-border z-10 transform -translate-x-1/2 -translate-y-1/2"
          ></div>

          <!-- Section Header -->
          <div
            class="pl-10 pr-3 py-2 text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wide flex items-center"
          >
            <div class="flex-1">Connect remote</div>
          </div>

          <div class="pl-10 pr-3 pb-3">
            <div class="border border-border rounded-md overflow-hidden shadow-xs bg-background p-3 space-y-3">
              <p class="text-xs text-muted-foreground">
                Add a git remote to enable pushing and pull requests.
              </p>
              {#if connectRemoteOpen}
                <div transition:slide={{ duration: 150 }} class="space-y-3">
                  <div>
                    <span class="text-xs text-muted-foreground mb-1 block">Remote URL</span>
                    <input
                      type="text"
                      class="w-full px-2.5 py-1.5 text-sm bg-muted/30 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
                      placeholder="https://github.com/user/repo.git"
                      bind:value={connectRemoteUrl}
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
                      disabled={isAddingRemote || !connectRemoteUrl.trim()}
                    >
                      {#if isAddingRemote}
                        <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
                        <span>Adding...</span>
                      {:else}
                        <Fa icon={faLink} class="h-3 w-3 opacity-50" />
                        <span>Add Remote</span>
                      {/if}
                    </Button>
                    <Button
                      variant="ghost-light"
                      size="xs"
                      onclick={() => { connectRemoteOpen = false; connectRemoteUrl = ''; }}
                    >
                      Cancel
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
                      <Fa icon={faArrowUpRightFromSquare} class="h-2.5 w-2.5 opacity-70" />
                    </a>
                  </p>
                </div>
              {:else}
                <Button
                  variant="outline"
                  size="xs"
                  onclick={() => { connectRemoteOpen = true; }}
                >
                  <Fa icon={faLink} class="h-3 w-3 opacity-50" />
                  <span>Connect Remote</span>
                </Button>
              {/if}
            </div>
          </div>
        </div>
      {/if}

      <!-- ==================== TRUNK SECTION ==================== -->
      {#if hasPushedToTrunk || isAllDone}
        <div class="relative mb-9">
          <!-- Timeline dot - green when all done -->
          <div
            class="absolute left-6 top-3.5 mt-0.5 w-2 h-2 -ml-1 rounded-full z-10 transform -translate-x-1/2 -translate-y-1/2 {isAllDone
              ? 'bg-green-500'
              : 'bg-border'}"
          ></div>

          <!-- Section Header -->
          <div
            class="pl-10 pr-3 py-2 text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wide flex items-center"
          >
            <div class="flex-1">{isAllDone ? 'Merged to trunk' : 'Pushed to trunk'}</div>
            <span class="font-normal ml-1">{targetBranch}</span>
          </div>

          <div class="pl-10 pr-3 pb-3">
            {#if isAllDone}
              <!-- All Done - Completion Card -->
              <div class="border border-green-500/20 bg-green-500/5 rounded-lg p-4">
                <div class="flex items-start gap-3">
                  <div
                    class="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center shrink-0"
                  >
                    <Fa icon={faCheckCircle} class="h-4 w-4 text-green-500" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <h3 class="text-sm font-medium text-foreground">All done!</h3>
                    <p class="text-xs text-muted-foreground mt-0.5">
                      Your changes have been merged into {targetBranch}. Ready to start something
                      new?
                    </p>
                    {#if onStartNewSpace}
                      <div class="flex items-center gap-2 mt-3">
                        <Button variant="default" size="sm" onclick={onStartNewSpace}>
                          <Fa icon={faRocket} class="h-3 w-3 opacity-70" />
                          <span>Start new Space</span>
                        </Button>
                      </div>
                    {/if}
                  </div>
                </div>
              </div>
            {:else}
              <p class="text-xs text-muted-foreground">
                Changes have been merged into {targetBranch}
              </p>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/if}
  <StartNewWorkspaceSection
    {workspace}
    {workspaceTitle}
    {onCreateWorkspace}
    isCreating={isCreatingWorkspace}
  />
</div>
