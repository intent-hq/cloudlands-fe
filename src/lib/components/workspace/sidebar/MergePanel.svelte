<script lang="ts">
  /**
   * MergePanel - Merge drawer content for sidebar changes panel.
   * Shows merge options (via PR or git), squash/push toggles, and merge/auto-fill buttons.
   */
  import { AcceptChangesClient } from '$features/accept-changes/accept-changes.client';
  import type { CommitInfo, TrackedChange } from '$features/file-tracking/types';
  import type { PRInfo } from '$lib/components/file-tracking/accept-changes/types';
  import {
    refreshRequested,
  } from '$lib/store/slices/changes/changes-slice';
  import {
    clearOlderCommits as ftClearOlderCommits,
  } from '$lib/store/slices/changes/changes-slice';
  import { loadGitStatus } from '$lib/store/slices/git/git-slice';
  import { selectExecutorState } from '$lib/store/slices/background-agent-executor/background-agent-executor-selectors';
  import {
    cancelExecution,
    executeBackgroundAgent,
  } from '$lib/store/slices/background-agent-executor/background-agent-executor-slice';
  import {
    setSidebarMergeWhenReady,
  } from '$lib/store/slices/changes/changes-slice';
  import {
    refreshPRStatusRequested,
  } from '$lib/store/slices/pr-status/pr-status-slice';
  import {
    selectWorkspaceById,
  } from '$lib/store/slices/workspace/workspace-selectors';
  import {
    setWorkspaceEntity,
  } from '$lib/store/slices/workspace/workspace-slice';
  import { workspaceClient } from '$lib/store/slices/workspace/utils/workspace.client';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { selectSidebarMergeWhenReady } from '$lib/store/slices/changes/changes-selectors';
  import BranchSelector from '$lib/components/workspace/initializer/BranchSelector.svelte';
  import { Button } from '$lib/components/ui/button';
  import Switch from '$lib/components/ui/switch/switch.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import Tooltip from '$lib/components/ui/tooltip/Tooltip.svelte';
  import { toast } from '$lib/components/ui/toast';
  import { trackGitOp } from '$lib/services/analytics';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import {
    faCheck,
    faCodeMerge,
    faEye,
    faRobot,
    faSpinner,
    faStop,
  } from '@fortawesome/free-solid-svg-icons';
  import { readable, writable } from 'svelte/store';
  import Fa from 'svelte-fa';

  const dispatch = getDispatch();

  interface Props {
    workspaceId: string;
    hasOpenPR: boolean;
    hasRemote: boolean;
    pullRequests: PRInfo[];
    hasStaged: boolean;
    hasCommits: boolean;
    allCommits: CommitInfo[];
    stagedChanges: TrackedChange[];
    trunkBranch: string;
    targetBranch: string;
    repoPath: string;
    repoType: 'local' | 'github';
    commitMessage: string;
    onCommitMessageChange?: (value: string) => void;
    onMergeComplete?: () => void;
    onOpenRebaseTerminal?: () => void;
  }

  let {
    workspaceId,
    hasOpenPR,
    hasRemote,
    pullRequests,
    hasStaged,
    hasCommits,
    allCommits,
    stagedChanges,
    trunkBranch,
    targetBranch,
    repoPath,
    repoType,
    commitMessage,
    onCommitMessageChange,
    onMergeComplete,
    onOpenRebaseTerminal,
  }: Props = $props();

  // Redux selectors at component init
  const workspaceIdStore = writable('');
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  const workspace = selectWorkspaceById(workspaceIdStore);
  const mergeExecState$ = selectExecutorState(workspaceIdStore, readable('commit-merge'));
  const mergeWhenReady$ = selectSidebarMergeWhenReady(workspaceIdStore);

  // Derived from Redux
  const isGeneratingMerge = $derived($mergeExecState$.status === 'running');
  const mergeAgentId = $derived($mergeExecState$.agentId);
  const mergeWhenReady = $derived($mergeWhenReady$);

  // Local state
  let isMergingToTrunk = $state(false);
  let mergeOptions = $state({ squash: false, viaPR: false, mergingPR: false, pushAfter: true });

  // Auto-update defaults when reactive conditions change
  import { untrack } from 'svelte';
  $effect(() => {
    const shouldMergeViaPR = hasOpenPR && hasRemote;
    const shouldPush = hasRemote;
    untrack(() => {
      mergeOptions.viaPR = shouldMergeViaPR;
      mergeOptions.pushAfter = shouldPush;
    });
  });

  // Expose mergeOptions and isMergingToTrunk for parent auto-action coordination
  export function getMergeOptions() {
    return mergeOptions;
  }
  export function triggerMerge(opts?: { squash?: boolean; localOnly?: boolean }) {
    handleMergeToTrunk(opts);
  }

  async function persistWorkspaceChanges(changes: Record<string, unknown>) {
    const result = await workspaceClient.update({ id: workspaceId as WorkspaceId, ...changes });
    if (result.ok) {
      dispatch(setWorkspaceEntity(result.data));
    }
    return result;
  }

  function dispatchPostMergeUpdate(update: Record<string, unknown>) {
    window.dispatchEvent(
      new CustomEvent('workspace:post-merge-update', {
        detail: { workspaceId, ...update },
      }),
    );
  }

  async function handleAutoFillMerge() {
    if (isGeneratingMerge) {
      dispatch(cancelExecution(workspaceId, 'commit-merge'));
    } else {
      const state = getReduxStore().getState();
      const ws = selectWorkspaceById.select(state, workspaceId);
      if (ws) {
        dispatch(executeBackgroundAgent(ws.id, 'commit-merge'));
      }
    }
  }

  function handleStopGeneratingMerge() {
    dispatch(cancelExecution(workspaceId, 'commit-merge'));
    dispatch(setSidebarMergeWhenReady(workspaceId, false));
  }

  function toggleMergeWhenReady() {
    dispatch(setSidebarMergeWhenReady(workspaceId, !mergeWhenReady));
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

  async function handleMergeToTrunk(options?: {
    squash?: boolean;
    rebaseFirst?: boolean;
    localOnly?: boolean;
  }) {
    if (!workspaceId) return;

    if (hasStaged) {
      if (!commitMessage.trim()) {
        toast.error('Please enter a commit message for staged changes');
        return;
      }
      const commitResult = await AcceptChangesClient.execute(workspaceId as WorkspaceId, 'commit', {
        commitMessage: commitMessage.trim(),
      });
      trackGitOp('commit', { workspaceId, success: commitResult.success, trigger: 'manual' });
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

      trackGitOp('merge', { workspaceId, success: result.success, trigger: 'manual' });

      if (result.success) {
        dispatchPostMergeUpdate({
          isMergedToTrunk: true,
          mergeHeadSha: allCommits[0]?.hash ?? null,
        });
        onMergeComplete?.();
        onCommitMessageChange?.('');
        try {
          await Promise.all([
            Promise.resolve(getReduxStore().dispatch(loadGitStatus(workspaceId, true))),
            getReduxStore().dispatch(refreshRequested(workspaceId)),
          ]);
        } catch { /* Refresh failed but merge succeeded */ }
        if (result.result?.autoRebased && result.result?.newBaseSha) {
          try {
            await persistWorkspaceChanges({ baseCommitSha: result.result.newBaseSha });
            dispatch(ftClearOlderCommits(workspaceId));
          } catch { console.error('Failed to update baseCommitSha after auto-rebase'); }
        }
        if (result.result?.autoRebased) {
          toast.success(`Changes rebased and merged into ${targetBranch}`);
        } else {
          toast.success(`Changes merged into ${targetBranch}`);
        }
        celebrateMerge();
      } else {
        const errorMsg = result.error || '';
        const needsRebase = errorMsg.includes('Conflicts detected') || errorMsg.includes('behind') || errorMsg.includes('Please rebase');
        if (needsRebase && !options?.rebaseFirst) {
          toast.error('Conflicts detected', {
            description: 'Rebase your branch in the terminal to resolve conflicts.',
            action: { label: 'Rebase in Terminal', onClick: () => onOpenRebaseTerminal?.() },
            duration: 10000,
          });
        } else {
          toast.error(result.error || 'Failed to merge');
        }
      }
    } catch {
      trackGitOp('merge', { workspaceId, success: false, trigger: 'manual' });
      toast.error('Failed to merge to trunk');
    } finally {
      isMergingToTrunk = false;
    }
  }

  async function handleMergePROnGitHub(options?: { mergeMethod?: 'merge' | 'squash' | 'rebase' }) {
    if (!workspaceId) return;
    const openPR = pullRequests.find((pr) => pr.status === 'open' || pr.status === 'draft');
    if (!openPR) { toast.error('No open pull request to merge'); return; }

    mergeOptions.mergingPR = true;
    try {
      const result = await AcceptChangesClient.mergePR(workspaceId as WorkspaceId, openPR.number, {
        mergeMethod: options?.mergeMethod || (mergeOptions.squash ? 'squash' : 'merge'),
      });
      trackGitOp('merge-pr', {
        workspaceId, success: result.success, trigger: 'manual',
        prNumber: openPR.number,
        mergeMethod: options?.mergeMethod || (mergeOptions.squash ? 'squash' : 'merge'),
      });
      if (result.success) {
        dispatchPostMergeUpdate({
          isMergedToTrunk: true,
          mergeHeadSha: allCommits[0]?.hash ?? null,
        });
        onMergeComplete?.();
        try {
          await Promise.all([
            Promise.resolve(getReduxStore().dispatch(loadGitStatus(workspaceId, true))),
            getReduxStore().dispatch(refreshRequested(workspaceId)),
            Promise.resolve(dispatch(refreshPRStatusRequested(workspaceId, true, false))),
          ]);
        } catch { /* Refresh failed but merge succeeded */ }
        toast.success(`PR #${openPR.number} merged on GitHub`);
        celebrateMerge();
      } else {
        toast.error(result.error || 'Failed to merge PR on GitHub');
      }
    } catch {
      trackGitOp('merge-pr', { workspaceId, success: false, trigger: 'manual' });
      toast.error('Failed to merge PR on GitHub');
    } finally {
      mergeOptions.mergingPR = false;
    }
  }

  function celebrateMerge() {
    // Dynamic import to avoid loading confetti until needed
    import('canvas-confetti').then(({ default: confetti }) => {
      const duration = 2000;
      const end = Date.now() + duration;
      const frame = () => {
        confetti({ particleCount: 2, angle: 60, spread: 55, origin: { x: 0, y: 0.7 }, colors: ['#10b981', '#34d399', '#6ee7b7', '#a7f3d0'] });
        confetti({ particleCount: 2, angle: 120, spread: 55, origin: { x: 1, y: 0.7 }, colors: ['#10b981', '#34d399', '#6ee7b7', '#a7f3d0'] });
        if (Date.now() < end) requestAnimationFrame(frame);
      };
      frame();
    }).catch(() => { /* confetti not available */ });
  }
</script>

<!-- Via PR / Via git toggle - only show when there's an open PR -->
{#if hasOpenPR && hasRemote}
  <div class="flex items-center rounded-md border border-border overflow-hidden w-fit">
    <button
      class="px-2.5 py-1 text-xs font-medium transition-colors {mergeOptions.viaPR
        ? 'bg-primary text-primary-foreground'
        : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted'}"
      onclick={() => (mergeOptions.viaPR = true)}
    >
      Via PR
    </button>
    <button
      class="px-2.5 py-1 text-xs font-medium transition-colors border-l border-border {!mergeOptions.viaPR
        ? 'bg-primary text-primary-foreground'
        : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted'}"
      onclick={() => (mergeOptions.viaPR = false)}
    >
      Via git
    </button>
  </div>
{/if}

{#if mergeOptions.viaPR && hasOpenPR && hasRemote}
  <!-- GitHub merge: merge the PR via the GitHub API -->
  {@const openPR = pullRequests.find(
    (pr) => pr.status === 'open' || pr.status === 'draft',
  )}
  {#if openPR}
    <p class="text-xs text-subtle">
      PR #{openPR.number} will be merged on GitHub into
      <span class="font-medium text-foreground"
        >{targetBranch || trunkBranch || 'main'}</span
      >.
    </p>

    <!-- Squash toggle -->
    {@const totalCommitsGH = allCommits.length + (hasStaged ? 1 : 0)}
    {#if totalCommitsGH > 1}
      <Tooltip
        content="Combine all {totalCommitsGH} commits into one called &quot;Squashed commit from {$workspace?.branch ||
          'branch'}&quot;. Keeps the target branch history clean."
        side="top"
        align="start"
        contentClass="w-[14rem]"
      >
        <div class="flex items-center gap-1.5">
          <Switch
            id="squash-merge-github-toggle"
            bind:checked={mergeOptions.squash}
            disabled={mergeOptions.mergingPR}
            size="sm"
          />
          <label
            for="squash-merge-github-toggle"
            class="text-xs text-subtle cursor-pointer select-none"
          >
            Squash commits
          </label>
        </div>
      </Tooltip>
    {/if}

    {#if hasStaged}
      <p class="text-xs text-amber-500">
        You have staged changes that haven't been committed. They won't be included in
        this merge.
      </p>
    {/if}

    <div class="flex items-center gap-2 flex-wrap w-full">
      <Button
        variant="default"
        size="xs"
        onclick={() =>
          handleMergePROnGitHub({ mergeMethod: mergeOptions.squash ? 'squash' : 'merge' })}
        disabled={mergeOptions.mergingPR}
      >
        {#if mergeOptions.mergingPR}
          <Fa icon={faSpinner} size="xs" class="animate-spin" />
          <span>Merging on GitHub...</span>
        {:else}
          <Fa icon={faCodeMerge} size="xs" class="opacity-50" />
          <span>{mergeOptions.squash ? 'Squash & Merge PR' : 'Merge PR'}</span>
        {/if}
      </Button>
    </div>
  {/if}
{:else}
  <!-- Git merge -->
  {@const mergeStaged = hasStaged
    ? `${stagedChanges.length} staged file${stagedChanges.length === 1 ? '' : 's'}`
    : ''}
  {@const mergeCommits = hasCommits
    ? `${allCommits.length} commit${allCommits.length === 1 ? '' : 's'}`
    : ''}
  {@const mergeParts = [mergeStaged, mergeCommits].filter(Boolean)}
  {#if mergeParts.length > 0}
    <p class="text-xs text-subtle">
      {mergeParts.join(' and ')} will be merged into
      <span class="font-medium text-foreground"
        >{targetBranch || trunkBranch || 'trunk'}</span
      >.
    </p>
  {/if}

  <!-- Commit message for staged changes -->
  {#if hasStaged}
    <div>
      <span class="text-xs text-subtle mb-1 block">Commit Message</span>
      <div class="relative">
        <Textarea
          value={commitMessage}
          oninput={(e) => onCommitMessageChange?.((e.target as HTMLTextAreaElement).value)}
          onkeydown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleMergeToTrunk({ squash: mergeOptions.squash, localOnly: !mergeOptions.pushAfter });
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
    <span class="text-xs text-subtle mb-1 block">Target Branch</span>
    <BranchSelector
      variant="default"
      value={targetBranch}
      {repoPath}
      {repoType}
      onchange={(_e) => {
        // Parent handles targetBranch updates
      }}
    />
  </div>

  <!-- Options: squash + push toggles -->
  {@const totalCommitsToMerge = allCommits.length + (hasStaged ? 1 : 0)}
  <div class="flex flex-col gap-1.5">
    {#if totalCommitsToMerge > 1}
      <Tooltip
        content="Combine all {totalCommitsToMerge} commits into one called &quot;Squashed commit from {$workspace?.branch ||
          'branch'}&quot;. Keeps the target branch history clean."
        side="top"
        align="start"
        contentClass="w-[14rem]"
      >
        <div class="flex items-center gap-1.5">
          <Switch
            id="squash-merge-toggle"
            bind:checked={mergeOptions.squash}
            disabled={isMergingToTrunk || (isGeneratingMerge && mergeWhenReady)}
            size="sm"
          />
          <label
            for="squash-merge-toggle"
            class="text-xs text-subtle cursor-pointer select-none"
          >
            Squash commits
          </label>
        </div>
      </Tooltip>
    {/if}
    {#if hasRemote}
      <Tooltip
        content={mergeOptions.pushAfter
          ? 'Changes will be pushed to the remote repository after merging. Uncheck to only merge locally.'
          : 'Changes will only be merged on your machine, and you can push later.'}
        side="top"
        align="start"
        contentClass="w-[14rem]"
      >
        <div class="flex items-center gap-1.5">
          <Switch
            id="push-after-merge-toggle"
            bind:checked={mergeOptions.pushAfter}
            disabled={isMergingToTrunk || (isGeneratingMerge && mergeWhenReady)}
            size="sm"
          />
          <label
            for="push-after-merge-toggle"
            class="text-xs text-subtle cursor-pointer select-none"
          >
            Push to remote
          </label>
        </div>
      </Tooltip>
    {/if}
  </div>

  <!-- Buttons -->
  <div class="flex items-center gap-2 flex-wrap w-full">
    <!-- Submit button -->
    <Button
      variant="default"
      size="xs"
      onclick={() =>
        handleMergeToTrunk({ squash: mergeOptions.squash, localOnly: !mergeOptions.pushAfter })}
      disabled={isMergingToTrunk ||
        (hasStaged && !commitMessage.trim()) ||
        (isGeneratingMerge && mergeWhenReady)}
    >
      {#if isMergingToTrunk || (isGeneratingMerge && mergeWhenReady)}
        <Fa icon={faSpinner} size="xs" class="animate-spin" />
        <span>{isMergingToTrunk ? 'Merging...' : 'Will merge when done...'}</span>
      {:else}
        <Fa icon={faCodeMerge} size="xs" class="opacity-50" />
        <span>{mergeOptions.squash ? 'Squash & Merge' : 'Merge'}</span>
      {/if}
    </Button>
    <!-- Auto-fill button -->
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
