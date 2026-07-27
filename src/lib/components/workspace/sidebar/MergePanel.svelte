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
  clearOlderCommits as ftClearOlderCommits,
  setSidebarMergeWhenReady,
} from '$store/renderer/slices/changes/changes-slice';

  import { loadGitStatus } from '$store/renderer/slices/git/git-slice';
  import { selectExecutorState } from '$store/renderer/slices/background-agent-executor/background-agent-executor-selectors';
  import {
  cancelExecution,
  executeBackgroundAgent,
} from '$store/renderer/slices/background-agent-executor/background-agent-executor-slice';

  import { refreshPRStatusRequested } from '$store/renderer/slices/pr-status/pr-status-slice';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';


  import { selectSidebarMergeWhenReady } from '$store/renderer/slices/changes/changes-selectors';
  import BranchSelector from '$lib/components/workspace/initializer/BranchSelector.svelte';
  import { Button } from '$lib/components/ui/button';
  import Switch from '$lib/components/ui/switch/switch.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import Tooltip from '$lib/components/ui/tooltip/Tooltip.svelte';
  import { toast } from '$lib/components/ui/toast';
  import { m } from '$shared/paraglide/messages.js';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import {
  faCheck,
  faCodeMerge,
  faEye,
  faRobot,
  faSpinner,
  faStop,
} from '@fortawesome/free-solid-svg-icons';
  import {
  readable,
  writable,
} from 'svelte/store';
  import Fa from 'svelte-fa';
	import { store as appStore } from '$store/renderer/store';


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

  // Local state
  let isMergingToTrunk = $state(false);
  let mergeOptions = $state({ squash: false, viaPR: false, mergingPR: false, pushAfter: true });

  // Auto-update defaults when reactive conditions change
  import { untrack } from 'svelte';
  import { dispatchWindowEvent } from '$lib/utils/window-events';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
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
      appStore.dispatch(setWorkspaceEntity(result.data));
    }
    return result;
  }

  function dispatchPostMergeUpdate(update: Record<string, unknown>) {
    dispatchWindowEvent('workspace:post-merge-update', { workspaceId, ...update });
  }

  async function handleAutoFillMerge() {
    if (isGeneratingMerge) {
      appStore.dispatch(cancelExecution(workspaceId, 'commit-merge'));
    } else {
      const state = appStore.state;
      const ws = selectWorkspaceById.select(state, workspaceId);
      if (ws) {
        appStore.dispatch(executeBackgroundAgent(ws.id, 'commit-merge'));
      }
    }
  }

  function handleStopGeneratingMerge() {
    appStore.dispatch(cancelExecution(workspaceId, 'commit-merge'));
    appStore.dispatch(setSidebarMergeWhenReady(workspaceId, false));
  }

  function toggleMergeWhenReady() {
    appStore.dispatch(setSidebarMergeWhenReady(workspaceId, !$mergeWhenReady$));
  }

  function viewMergeThoughtProcess(e?: MouseEvent) {
    if (mergeAgentId) {
      const panelElement = (e?.target as HTMLElement | null)?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
      const openInAdjacentPanel = e?.metaKey || e?.ctrlKey || false;
      appStore.dispatch(
        openAgentTabRequested(workspaceId, {
          agentId: mergeAgentId,
          sourcePanelId,
          openInAdjacentPanel,
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
        toast.error(m.workspace_mergePanel_commitMessageRequired_error());
        return;
      }
      const commitResult = await AcceptChangesClient.execute(workspaceId as WorkspaceId, 'commit', {
        commitMessage: commitMessage.trim(),
      });
      if (!commitResult.success) {
        toast.error(commitResult.error || m.workspace_mergePanel_commitFailed_error());
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
        dispatchPostMergeUpdate({
          isMergedToTrunk: true,
          mergeHeadSha: allCommits[0]?.hash ?? null,
        });
        onMergeComplete?.();
        onCommitMessageChange?.('');
        try {
          await Promise.all([
            Promise.resolve(appStore.dispatch(loadGitStatus(workspaceId, true))),
            appStore.dispatch(refreshRequested(workspaceId, true)),
          ]);
        } catch { /* Refresh failed but merge succeeded */ }
        if (result.result?.autoRebased && result.result?.newBaseSha) {
          try {
            await persistWorkspaceChanges({ baseCommitSha: result.result.newBaseSha });
            appStore.dispatch(ftClearOlderCommits(workspaceId));
          } catch { console.error('Failed to update baseCommitSha after auto-rebase'); }
        }
        if (result.result?.autoRebased) {
          toast.success(m.workspace_mergePanel_rebasedAndMerged_label({ branch: targetBranch }));
        } else {
          toast.success(m.workspace_mergePanel_merged_label({ branch: targetBranch }));
        }
        celebrateMerge();
      } else {
        const errorMsg = result.error || '';
        // i18n-ignore (matching backend error strings)
        const needsRebase = errorMsg.includes('Conflicts detected') || errorMsg.includes('behind') || errorMsg.includes('Please rebase');
        if (needsRebase && !options?.rebaseFirst) {
          toast.error(m.workspace_mergePanel_conflicts_error(), {
            description: m.workspace_mergePanel_conflicts_description(),
            action: {
              label: m.workspace_mergePanel_rebaseInTerminal_label(),
              onClick: () => onOpenRebaseTerminal?.(),
            },
            duration: 10000,
          });
        } else {
          toast.error(result.error || m.workspace_mergePanel_mergeFailed_error());
        }
      }
    } catch {
      toast.error(m.workspace_mergePanel_mergeToTrunkFailed_error());
    } finally {
      isMergingToTrunk = false;
    }
  }

  async function handleMergePROnGitHub(options?: { mergeMethod?: 'merge' | 'squash' | 'rebase' }) {
    if (!workspaceId) return;
    const openPR = pullRequests.find((pr) => pr.status === 'open' || pr.status === 'draft');
    if (!openPR) { toast.error(m.workspace_mergePanel_noOpenPr_error()); return; }

    mergeOptions.mergingPR = true;
    try {
      const result = await AcceptChangesClient.mergePR(workspaceId as WorkspaceId, openPR.number, {
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
            Promise.resolve(appStore.dispatch(loadGitStatus(workspaceId, true))),
            appStore.dispatch(refreshRequested(workspaceId, true)),
            Promise.resolve(appStore.dispatch(refreshPRStatusRequested(workspaceId, true, false))),
          ]);
        } catch { /* Refresh failed but merge succeeded */ }
        toast.success(m.workspace_mergePanel_prMergedOnGithub_label({ number: openPR.number }));
        celebrateMerge();
      } else {
        toast.error(result.error || m.workspace_mergePanel_prMergeFailed_error());
      }
    } catch {
      toast.error(m.workspace_mergePanel_prMergeFailed_error());
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
      {m.workspace_mergePanel_viaPr_label()}
    </button>
    <button
      class="px-2.5 py-1 text-xs font-medium transition-colors border-l border-border {!mergeOptions.viaPR
        ? 'bg-primary text-primary-foreground'
        : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted'}"
      onclick={() => (mergeOptions.viaPR = false)}
    >
      {m.workspace_mergePanel_viaGit_label()}
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
      {m.workspace_mergePanel_prMergedInto_before({ number: openPR.number })}
      <span class="font-medium text-foreground"
        >{targetBranch || trunkBranch || 'main'}</span
      >.
    </p>

    <!-- Squash toggle -->
    {@const totalCommitsGH = allCommits.length + (hasStaged ? 1 : 0)}
    {#if totalCommitsGH > 1}
      <Tooltip
        content={m.workspace_mergePanel_squash_tooltip({
          count: totalCommitsGH,
          branch: $workspace?.branch || 'branch',
        })}
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
            {m.workspace_mergePanel_squashCommits_label()}
          </label>
        </div>
      </Tooltip>
    {/if}

    {#if hasStaged}
      <p class="text-xs text-amber-500">
        {m.workspace_mergePanel_stagedNotIncluded_label()}
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
          <span>{m.workspace_mergePanel_mergingOnGithub_label()}</span>
        {:else}
          <Fa icon={faCodeMerge} size="xs" class="opacity-50" />
          <span
            >{mergeOptions.squash
              ? m.workspace_mergePanel_squashMergePr_label()
              : m.workspace_mergePanel_mergePr_label()}</span
          >
        {/if}
      </Button>
    </div>
  {/if}
{:else}
  <!-- Git merge -->
  {@const mergeStaged = hasStaged
    ? stagedChanges.length === 1
      ? m.workspace_prSection_stagedFiles_one()
      : m.workspace_prSection_stagedFiles_many({ count: stagedChanges.length })
    : ''}
  {@const mergeCommits = hasCommits
    ? allCommits.length === 1
      ? m.workspace_prSection_commits_one()
      : m.workspace_prSection_commits_many({ count: allCommits.length })
    : ''}
  {@const mergeParts = [mergeStaged, mergeCommits].filter(Boolean)}
  {#if mergeParts.length > 0}
    <p class="text-xs text-subtle">
      {m.workspace_mergePanel_willBeMergedInto_before({
        parts: mergeParts.join(m.workspace_prSection_and_separator()),
      })}
      <span class="font-medium text-foreground"
        >{targetBranch || trunkBranch || 'trunk'}</span
      >.
    </p>
  {/if}

  <!-- Commit message for staged changes -->
  {#if hasStaged}
    <div>
      <span class="text-xs text-subtle mb-1 block">{m.workspace_mergePanel_commitMessage_label()}</span>
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
          placeholder={m.workspace_mergePanel_commitMessage_placeholder()}
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
    <span class="text-xs text-subtle mb-1 block">{m.workspace_prSection_targetBranch_label()}</span>
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
        content={m.workspace_mergePanel_squash_tooltip({
          count: totalCommitsToMerge,
          branch: $workspace?.branch || 'branch',
        })}
        side="top"
        align="start"
        contentClass="w-[14rem]"
      >
        <div class="flex items-center gap-1.5">
          <Switch
            id="squash-merge-toggle"
            bind:checked={mergeOptions.squash}
            disabled={isMergingToTrunk || (isGeneratingMerge && $mergeWhenReady$)}
            size="sm"
          />
          <label
            for="squash-merge-toggle"
            class="text-xs text-subtle cursor-pointer select-none"
          >
            {m.workspace_mergePanel_squashCommits_label()}
          </label>
        </div>
      </Tooltip>
    {/if}
    {#if hasRemote}
      <Tooltip
        content={mergeOptions.pushAfter
          ? m.workspace_mergePanel_pushAfter_tooltip()
          : m.workspace_mergePanel_localOnly_tooltip()}
        side="top"
        align="start"
        contentClass="w-[14rem]"
      >
        <div class="flex items-center gap-1.5">
          <Switch
            id="push-after-merge-toggle"
            bind:checked={mergeOptions.pushAfter}
            disabled={isMergingToTrunk || (isGeneratingMerge && $mergeWhenReady$)}
            size="sm"
          />
          <label
            for="push-after-merge-toggle"
            class="text-xs text-subtle cursor-pointer select-none"
          >
            {m.workspace_mergePanel_pushToRemote_label()}
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
        (isGeneratingMerge && $mergeWhenReady$)}
    >
      {#if isMergingToTrunk || (isGeneratingMerge && $mergeWhenReady$)}
        <Fa icon={faSpinner} size="xs" class="animate-spin" />
        <span
          >{isMergingToTrunk
            ? m.workspace_mergePanel_merging_label()
            : m.workspace_mergePanel_willMergeWhenDone_label()}</span
        >
      {:else}
        <Fa icon={faCodeMerge} size="xs" class="opacity-50" />
        <span
          >{mergeOptions.squash
            ? m.workspace_mergePanel_squashMerge_label()
            : m.workspace_prSection_merge_label()}</span
        >
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
            <span class="mr-1">{m.workspace_prCreator_autoFill_label()}</span>
            <Fa icon={faStop} size="xs" />
          </Button>
          {#if mergeAgentId}
            <Button
              variant="outline"
              size="icon-xs"
              class="rounded-none h-7!"
              onclick={viewMergeThoughtProcess}
              tooltip={m.workspace_prSection_viewThoughtProcess_tooltip()}
              tooltipSide="top"
              tooltipDelayDuration={0}
            >
              <Fa icon={faEye} size="xs" />
            </Button>
          {/if}

          <Button
            variant={$mergeWhenReady$ ? 'default' : 'outline'}
            size="xs"
            class="rounded-l-none border-l-0"
            onclick={toggleMergeWhenReady}
          >
            {#if $mergeWhenReady$}
              <Fa icon={faCheck} size="xs" />
            {/if}
            {m.workspace_mergePanel_autoMergeWhenDone_label()}
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
            <span>{m.workspace_prCreator_autoFill_label()}</span>
          </Button>
          {#if mergeAgentId}
            <Button
              variant="outline"
              size="icon-xs"
              class="rounded-l-none border-l-0 h-7!"
              onclick={viewMergeThoughtProcess}
              tooltip={m.workspace_prSection_viewThoughtProcess_tooltip()}
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
