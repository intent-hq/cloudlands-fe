<script lang="ts">
  /**
   * CommitDrawer - Commit message drawer
   * Contains the commit form and auto-fill panel.
   */
  import { selectExecutorState } from '$store/renderer/slices/background-agent-executor/background-agent-executor-selectors';
  import {
  executeBackgroundAgent,
  cancelExecution,
} from '$store/renderer/slices/background-agent-executor/background-agent-executor-slice';
  import { setSidebarCommitWhenReady } from '$store/renderer/slices/changes/changes-slice';
  import { selectSidebarCommitWhenReady } from '$store/renderer/slices/changes/changes-selectors';

  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import type { TrackedChange } from '$features/file-tracking/types';
  import {
  faCheck,
  faCodeCommit,
  faEye,
  faRobot,
  faSpinner,
  faStop,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import {
  readable,
  writable,
} from 'svelte/store';
  import DividerButton from './DividerButton.svelte';
  import DividerPanel from './DividerPanel.svelte';
  import TimelineDivider from './TimelineDivider.svelte';

  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    workspaceId: string;
    commitMessage: string;
    isCommitting: boolean;
    commitDrawerOpen: boolean;
    hasStaged: boolean;
    stagedChanges: TrackedChange[];
    onCommit: () => void;
  }

  let {
    workspaceId,
    commitMessage = $bindable(''),
    isCommitting = $bindable(false),
    commitDrawerOpen = $bindable(false),
    hasStaged,
    stagedChanges,
    onCommit,
  }: Props = $props();


  const workspaceIdStore = writable('');
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  const commitWhenReady$ = selectSidebarCommitWhenReady(workspaceIdStore);
  const commitExecState$ = selectExecutorState(workspaceIdStore, readable('commit'));

  const isGenerating = $derived($commitExecState$.status === 'running');
  const commitAgentId = $derived($commitExecState$.agentId);

  async function handleAutoFill() {
    if (isGenerating) {
      appStore.dispatch(cancelExecution(workspaceId, 'commit'));
      return;
    }
    appStore.dispatch(
      executeBackgroundAgent(workspaceId, 'commit', {
        prompt: 'generate a commit message',
      }),
    );
  }

  function handleStopGenerating() {
    appStore.dispatch(cancelExecution(workspaceId, 'commit'));
    appStore.dispatch(setSidebarCommitWhenReady(workspaceId, false));
  }

  function toggleCommitWhenReady() {
    appStore.dispatch(setSidebarCommitWhenReady(workspaceId, !$commitWhenReady$));
  }

  function viewCommitThoughtProcess(e?: MouseEvent) {
    if (commitAgentId) {
      const panelElement = (e?.target as HTMLElement | null)?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
      const openInAdjacentPanel = e?.metaKey || e?.ctrlKey || false;
      appStore.dispatch(
        openAgentTabRequested(workspaceId, {
          agentId: commitAgentId,
          sourcePanelId,
          openInAdjacentPanel,
        }),
      );
    }
  }

</script>

<!-- Divider with Commit button -->
<TimelineDivider>
  <div class="w-full flex gap-1" data-testid="commit-export-divider">
    <DividerButton
      tooltipContents={!hasStaged ? m.workspace_commitDrawer_noStaged_tooltip() : ''}
      onclick={() => {
        commitDrawerOpen = !commitDrawerOpen;
      }}
      expanded={commitDrawerOpen}
      disabled={!hasStaged}
    >
      {m.workspace_commitDrawer_commit_label()}
    </DividerButton>
  </div>
  <DividerPanel open={commitDrawerOpen}>
    {#if hasStaged}
      <p class="text-xs text-subtle">
        {stagedChanges.length === 1
          ? m.workspace_commitDrawer_stagedWillCommit_one()
          : m.workspace_commitDrawer_stagedWillCommit_many({
              count: formatInteger(stagedChanges.length),
            })}
      </p>
    {/if}
    <div class="relative">
      <Textarea
        data-testid="commit-message-input"
        value={commitMessage}
        oninput={(e) => (commitMessage = (e.target as HTMLTextAreaElement).value)}
        onkeydown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onCommit();
          }
        }}
        placeholder={m.workspace_commitDrawer_commitMessage_placeholder()}
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
        data-testid="commit-submit-button"
        onclick={() => onCommit()}
        disabled={!commitMessage.trim() ||
          isCommitting ||
          (isGenerating && $commitWhenReady$)}
      >
        {#if isCommitting || (isGenerating && $commitWhenReady$)}
          <Fa icon={faSpinner} size="xs" class="animate-spin" />
          <span
            >{isCommitting
              ? m.workspace_commitDrawer_committing_label()
              : m.workspace_commitDrawer_willCommitWhenDone_label()}</span
          >
        {:else}
          <Fa icon={faCodeCommit} size="xs" class="opacity-50" />
          <span>{m.workspace_commitDrawer_commit_label()}</span>
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
            <span class="mr-1">{m.workspace_prCreator_autoFill_label()}</span>
            <Fa icon={faStop} size="xs" />
          </Button>
          {#if commitAgentId}
            <Button
              variant="outline"
              size="icon-xs"
              class="rounded-none h-7!"
              onclick={viewCommitThoughtProcess}
              tooltip={m.workspace_prSection_viewThoughtProcess_tooltip()}
              tooltipSide="top"
              tooltipDelayDuration={0}
            >
              <Fa icon={faEye} size="xs" />
            </Button>
          {/if}

          <Button
            variant={$commitWhenReady$ ? 'default' : 'outline'}
            size="xs"
            class="rounded-l-none border-l-0"
            onclick={toggleCommitWhenReady}
          >
            {#if $commitWhenReady$}
              <Fa icon={faCheck} size="xs" />
            {/if}
            {m.workspace_commitDrawer_autoCommitWhenDone_label()}
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
            <span>{m.workspace_prCreator_autoFill_label()}</span>
          </Button>
          {#if commitAgentId}
            <Button
              variant="outline"
              size="icon-xs"
              class="rounded-l-none border-l-0 h-7!"
              onclick={viewCommitThoughtProcess}
              tooltip={m.workspace_prSection_viewThoughtProcess_tooltip()}
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
</TimelineDivider>
