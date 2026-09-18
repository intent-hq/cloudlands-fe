<script lang="ts">
  /**
   * MergePanel - Merge drawer content for sidebar changes panel.
   * Shows merge options (via PR or git), squash/push toggles, and merge/auto-fill buttons.
   */
  import type { AcceptChangesResult } from '$features/accept-changes/types';
  import type { CommitInfo, TrackedChange } from '$features/file-tracking/types';
  import type { PRInfo } from '$lib/components/file-tracking/accept-changes/types';
  import {
    clearOlderCommits as ftClearOlderCommits,
    setSidebarMergeWhenReady,
  } from '$store/renderer/slices/changes/changes-slice';
  import {
    executeAcceptChangesRequested,
    mergePullRequestRequested,
  } from '$store/renderer/slices/git/git-slice';
  import { selectGitMutationRequest } from '$store/renderer/slices/git/git-selectors';
  import { selectExecutorState } from '$store/renderer/slices/background-agent-executor/background-agent-executor-selectors';
  import {
    cancelExecution,
    executeBackgroundAgent,
  } from '$store/renderer/slices/background-agent-executor/background-agent-executor-slice';

  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { updateWorkspaceRequested } from '$store/renderer/slices/workspace/workspace-slice';

  import { selectSidebarMergeWhenReady } from '$store/renderer/slices/changes/changes-selectors';
  import BranchSelector from '$lib/components/workspace/initializer/BranchSelector.svelte';
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import Switch from '$lib/components/ui/switch/switch.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import Tooltip from '$lib/components/ui/tooltip/Tooltip.svelte';
  import { toast } from '$lib/components/ui/toast';
  import { m } from '$shared/paraglide/messages.js';
  import { faCheck, faCodeMerge, faEye, faRobot, faStop } from '@fortawesome/free-solid-svg-icons';
  import { readable, writable } from 'svelte/store';
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

  type MergeToTrunkOptions = {
    squash?: boolean;
    rebaseFirst?: boolean;
    localOnly?: boolean;
  };

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
  const prScopeStore = writable('');
  const commitRequest$ = selectGitMutationRequest(
    workspaceIdStore,
    readable('accept-changes'),
    readable('commit'),
  );
  const mergeRequest$ = selectGitMutationRequest(
    workspaceIdStore,
    readable('accept-changes'),
    readable('merge'),
  );
  const mergePrRequest$ = selectGitMutationRequest(
    workspaceIdStore,
    readable('merge-pr'),
    prScopeStore,
  );
  const mergeExecState$ = selectExecutorState(workspaceIdStore, readable('commit-merge'));
  const mergeWhenReady$ = selectSidebarMergeWhenReady(workspaceIdStore);

  // Derived from Redux
  const isGeneratingMerge = $derived($mergeExecState$.status === 'running');
  const mergeAgentId = $derived($mergeExecState$.agentId);

  // Local state
  let mergeOptions = $state({ squash: false, viaPR: false, mergingPR: false, pushAfter: true });
  let pendingCommitMerge: {
    options: MergeToTrunkOptions;
    commitVersion: number;
  } | null = null;
  let handledMergeVersion = 0;
  let handledMergePrVersion = 0;
  let mergingPrNumber = 0;
  const isMergingToTrunk = $derived(
    ($commitRequest$?.loading ?? false) || ($mergeRequest$?.loading ?? false),
  );

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

  function dispatchMergeToTrunk(options?: MergeToTrunkOptions) {
    appStore.dispatch(
      executeAcceptChangesRequested(workspaceId, 'merge', {
        targetBranch,
        mergeStrategy: options?.squash ? 'squash' : 'merge',
        rebaseFirst: options?.rebaseFirst,
        localOnly: options?.localOnly,
      }),
    );
  }

  function handleMergeToTrunk(options?: MergeToTrunkOptions) {
    if (!workspaceId) return;
    if (hasStaged && !commitMessage.trim()) {
      toast.error(m.workspace_mergePanel_commitMessageRequired_error());
      return;
    }
    if (hasStaged) {
      const commitRequest = selectGitMutationRequest.select(
        appStore.state,
        workspaceId,
        'accept-changes',
        'commit',
      );
      pendingCommitMerge = {
        options: options ?? {},
        commitVersion: (commitRequest?.version ?? 0) + 1,
      };
      appStore.dispatch(
        executeAcceptChangesRequested(workspaceId, 'commit', {
          commitMessage: commitMessage.trim(),
        }),
      );
    } else {
      dispatchMergeToTrunk(options);
    }
  }

  function handleMergePROnGitHub(options?: { mergeMethod?: 'merge' | 'squash' | 'rebase' }) {
    if (!workspaceId) return;
    const openPR = pullRequests.find((pr) => pr.status === 'open' || pr.status === 'draft');
    if (!openPR) {
      toast.error(m.workspace_mergePanel_noOpenPr_error());
      return;
    }

    prScopeStore.set(String(openPR.number));
    mergingPrNumber = openPR.number;
    appStore.dispatch(
      mergePullRequestRequested(
        workspaceId,
        openPR.number,
        options?.mergeMethod || (mergeOptions.squash ? 'squash' : 'merge'),
      ),
    );
  }

  $effect(() => {
    const request = $commitRequest$;
    const pending = pendingCommitMerge;
    if (!pending || !request || request.loading || request.version < pending.commitVersion) return;
    pendingCommitMerge = null;
    if (request.version !== pending.commitVersion) return;
    const result = request.data as AcceptChangesResult | null;
    if (request.error || !result?.success) {
      toast.error(request.error || result?.error || m.workspace_mergePanel_commitFailed_error());
      return;
    }
    dispatchMergeToTrunk(pending.options);
  });

  $effect(() => {
    const request = $mergeRequest$;
    if (!request || request.loading || request.version <= handledMergeVersion) return;
    handledMergeVersion = request.version;
    const result = request.data as AcceptChangesResult | null;
    if (request.error || !result?.success) {
      const errorMsg = request.error || result?.error || '';
      const needsRebase =
        // i18n-ignore (matching backend error strings)
        errorMsg.includes('Conflicts detected') ||
        // i18n-ignore (matching backend error strings)
        errorMsg.includes('behind') ||
        // i18n-ignore (matching backend error strings)
        errorMsg.includes('Please rebase');
      if (needsRebase) {
        toast.error(m.workspace_mergePanel_conflicts_error(), {
          description: m.workspace_mergePanel_conflicts_description(),
          action: {
            label: m.workspace_mergePanel_rebaseInTerminal_label(),
            onClick: () => onOpenRebaseTerminal?.(),
          },
          duration: 10000,
        });
      } else toast.error(errorMsg || m.workspace_mergePanel_mergeFailed_error());
      return;
    }
    dispatchPostMergeUpdate({ isMergedToTrunk: true, mergeHeadSha: allCommits[0]?.hash ?? null });
    onMergeComplete?.();
    onCommitMessageChange?.('');
    if (result.result?.autoRebased && result.result.newBaseSha) {
      appStore.dispatch(
        updateWorkspaceRequested(
          workspaceId,
          { baseCommitSha: result.result.newBaseSha },
          'base-commit',
        ),
      );
      appStore.dispatch(ftClearOlderCommits(workspaceId));
    }
    toast.success(
      result.result?.autoRebased
        ? m.workspace_mergePanel_rebasedAndMerged_label({ branch: targetBranch })
        : m.workspace_mergePanel_merged_label({ branch: targetBranch }),
    );
    celebrateMerge();
  });

  $effect(() => {
    const request = $mergePrRequest$;
    mergeOptions.mergingPR = request?.loading ?? false;
    if (!request || request.loading || request.version <= handledMergePrVersion) return;
    handledMergePrVersion = request.version;
    const result = request.data as AcceptChangesResult | null;
    if (request.error || !result?.success) {
      toast.error(request.error || result?.error || m.workspace_mergePanel_prMergeFailed_error());
      return;
    }
    dispatchPostMergeUpdate({ isMergedToTrunk: true, mergeHeadSha: allCommits[0]?.hash ?? null });
    onMergeComplete?.();
    toast.success(m.workspace_mergePanel_prMergedOnGithub_label({ number: mergingPrNumber }));
    celebrateMerge();
  });

  function celebrateMerge() {
    // Dynamic import to avoid loading confetti until needed
    import('canvas-confetti')
      .then(({ default: confetti }) => {
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
          if (Date.now() < end) requestAnimationFrame(frame);
        };
        frame();
      })
      .catch(() => {
        /* confetti not available */
      });
  }
</script>

<!-- Via PR / Via git toggle - only show when there's an open PR -->
{#if hasOpenPR && hasRemote}
  <div class="flex items-center rounded-md border border-border overflow-hidden w-fit">
    <Button
      variant="plain"
      class="px-2.5 py-1 text-xs font-medium transition-colors {mergeOptions.viaPR
        ? 'bg-primary text-primary-foreground'
        : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted'}"
      onclick={() => (mergeOptions.viaPR = true)}
    >
      {m.workspace_mergePanel_viaPr_label()}
    </Button>
    <Button
      variant="plain"
      class="px-2.5 py-1 text-xs font-medium transition-colors border-l border-border {!mergeOptions.viaPR
        ? 'bg-primary text-primary-foreground'
        : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted'}"
      onclick={() => (mergeOptions.viaPR = false)}
    >
      {m.workspace_mergePanel_viaGit_label()}
    </Button>
  </div>
{/if}

{#if mergeOptions.viaPR && hasOpenPR && hasRemote}
  <!-- GitHub merge: merge the PR via the GitHub API -->
  {@const openPR = pullRequests.find((pr) => pr.status === 'open' || pr.status === 'draft')}
  {#if openPR}
    <p class="text-xs text-subtle">
      {m.workspace_mergePanel_prMergedInto_before({ number: openPR.number })}
      <!-- i18n-ignore (intentional default branch fallback) -->
      <span class="font-medium text-foreground">{targetBranch || trunkBranch || 'main'}</span>.
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
          <IntentMarkLoader size={12} />
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
        >{targetBranch || trunkBranch || m.workspace_mergePanel_trunkFallback_label()}</span
      >.
    </p>
  {/if}

  <!-- Commit message for staged changes -->
  {#if hasStaged}
    <div>
      <span class="text-xs text-subtle mb-1 block"
        >{m.workspace_mergePanel_commitMessage_label()}</span
      >
      <div class="relative">
        <Textarea
          value={commitMessage}
          oninput={(e) => onCommitMessageChange?.((e.target as HTMLTextAreaElement).value)}
          onkeydown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleMergeToTrunk({
                squash: mergeOptions.squash,
                localOnly: !mergeOptions.pushAfter,
              });
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
          <label for="squash-merge-toggle" class="text-xs text-subtle cursor-pointer select-none">
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
        <IntentMarkLoader size={12} />
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
            <IntentMarkLoader size={12} />
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
