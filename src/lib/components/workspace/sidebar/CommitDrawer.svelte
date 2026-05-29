<script lang="ts">
  /**
   * CommitDrawer - Commit message and Export file drawer
   * Contains the commit form, auto-fill, and file export panels.
   */
  import { AcceptChangesClient } from '$features/accept-changes/accept-changes.client';
  import { selectExecutorState } from '$lib/store/slices/background-agent-executor/background-agent-executor-selectors';
  import {
  executeBackgroundAgent,
  cancelExecution,
} from '$lib/store/slices/background-agent-executor/background-agent-executor-slice';
  import { setSidebarCommitWhenReady } from '$lib/store/slices/changes/changes-slice';
  import { selectSidebarCommitWhenReady } from '$lib/store/slices/changes/changes-selectors';

  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import { toast } from '$lib/components/ui/toast';
  import ExportErrorToast from '$lib/components/ui/toast/ExportErrorToast.svelte';
  import ExportSuccessToast from '$lib/components/ui/toast/ExportSuccessToast.svelte';
  import { dialog } from '$lib/electron-bridge';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import type { TrackedChange } from '$features/file-tracking/types';
  import {
  faCheck,
  faCodeCommit,
  faEye,
  faFolderOpen,
  faRobot,
  faSpinner,
  faStop,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import {
  readable,
  writable,
} from 'svelte/store';
  import DividerButton from './DividerButton.svelte';
  import DividerPanel from './DividerPanel.svelte';
  import TimelineDivider from './TimelineDivider.svelte';

  import { openAgentTabRequested } from '$lib/store/slices/app-layout/app-layout-slice';
  import { store as appStore } from '$lib/store/store';

  interface Props {
    workspaceId: string;
    commitMessage: string;
    isCommitting: boolean;
    commitDrawerOpen: boolean;
    exportDrawerOpen: boolean;
    hasStaged: boolean;
    hasUnstaged: boolean;
    stagedChanges: TrackedChange[];
    unstagedChanges: TrackedChange[];
    allCommitsCount: number;
    repoPath: string;
    onCommit: () => void;
  }

  let {
    workspaceId,
    commitMessage = $bindable(''),
    isCommitting = $bindable(false),
    commitDrawerOpen = $bindable(false),
    exportDrawerOpen = $bindable(false),
    hasStaged,
    hasUnstaged,
    stagedChanges,
    unstagedChanges,
    allCommitsCount,
    repoPath,
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

  // Export state
  let exportPath = $state('');
  let isExporting = $state(false);

  // Initialize export path from repo path
  $effect(() => {
    const shouldInit = !exportPath && repoPath;
    if (shouldInit) exportPath = repoPath;
  });

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

  async function handlePickExportFolder(): Promise<string | undefined> {
    try {
      const result = await dialog.open({
        directory: true,
        title: 'Select export destination folder',
      });
      if (typeof result === 'string' && result.length > 0) {
        return result;
      }
    } catch (error) {
      console.error('Failed to open folder dialog:', error);
    }
    return undefined;
  }

  async function handleExport() {
    if (!exportPath.trim()) {
      const selectedPath = await handlePickExportFolder();
      if (selectedPath) {
        exportPath = selectedPath;
      } else {
        return;
      }
    }

    const exportedToPath = exportPath;

    // Check for uncommitted changes in the destination
    try {
      const { hasChanges, isGitRepo } = await AcceptChangesClient.checkPathHasChanges(exportPath);
      if (isGitRepo && hasChanges) {
        const confirmed = await dialog.message(
          `The destination folder has uncommitted git changes. Exporting will overwrite files in this directory.\n\nPath: ${exportPath}\n\nDo you want to continue?`,
          {
            title: 'Uncommitted changes detected',
            type: 'warning',
            buttons: ['Cancel', 'Continue'],
          },
        );
        if (confirmed === 0) return;
      }
    } catch {
      // If check fails, continue with export
    }

    isExporting = true;
    try {
      const result = await AcceptChangesClient.exportFiles(workspaceId as WorkspaceId, exportPath, {
        preserveStructure: true,
      });
      if (!result.success) {
        toast.custom(ExportErrorToast, {
          componentProps: {
            message: result.error || 'Failed to export files',
            exportPath: exportedToPath,
          },
          duration: 10000,
        });
        return;
      }

      toast.custom(ExportSuccessToast, {
        componentProps: { exportPath: exportedToPath },
        duration: 10000,
      });
      exportDrawerOpen = false;
      exportPath = '';
    } catch {
      toast.error('Failed to export files');
    } finally {
      isExporting = false;
    }
  }
</script>

<!-- Divider with Commit and Export buttons -->
<TimelineDivider>
  <div class="w-full flex gap-1" data-testid="commit-export-divider">
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
      <p class="text-xs text-subtle">
        {stagedChanges.length} staged file{stagedChanges.length === 1 ? '' : 's'} will be committed.
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
        data-testid="commit-submit-button"
        onclick={() => onCommit()}
        disabled={!commitMessage.trim() ||
          isCommitting ||
          (isGenerating && $commitWhenReady$)}
      >
        {#if isCommitting || (isGenerating && $commitWhenReady$)}
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
            variant={$commitWhenReady$ ? 'default' : 'outline'}
            size="xs"
            class="rounded-l-none border-l-0"
            onclick={toggleCommitWhenReady}
          >
            {#if $commitWhenReady$}
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
    {@const commitCount = allCommitsCount}
    {@const unstagedText =
      unstagedCount > 0
        ? `${unstagedCount} unstaged file${unstagedCount === 1 ? '' : 's'}`
        : ''}
    {@const stagedText =
      stagedCount > 0 ? `${stagedCount} staged file${stagedCount === 1 ? '' : 's'}` : ''}
    {@const commitText =
      commitCount > 0 ? `${commitCount} commit${commitCount === 1 ? '' : 's'}` : ''}
    {@const parts = [unstagedText, stagedText, commitText].filter(Boolean)}
    <p class="text-xs text-subtle">
      Export files to a folder outside this workspace. This copies files while preserving
      directory structure, allowing you to use them in another project or share
      externally.
    </p>
    {#if parts.length > 0}
      <p class="text-xs text-subtle mt-1">
        {parts.join(' and ')} will be exported.
      </p>
    {/if}
    <div class="mt-2">
      <span class="text-xs text-subtle mb-1 block">Destination Folder</span>
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
