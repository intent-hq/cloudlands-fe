<script lang="ts">
  import { logger } from '$lib/utils/client-logger';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { fileTrackingStore } from '$features/file-tracking/file-tracking.store.svelte';
  import { gitStore } from '$features/git/git.store.svelte';
  import type { TrackedChange } from '$features/file-tracking/types';
  import type { ChatFileChange } from '$lib/utils/get-file-changes-from-messages';
  import FileChangesList from './FileChangesList.svelte';
  import { ChangeSetVisualization } from './change-set-visualization';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import PanelWrapper from '$lib/components/ui/PanelWrapper.svelte';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import Fa from 'svelte-fa';
  import { faCodeCommit, faCircleCheck, faCircleDot } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    workspaceId: string;
    canGoBack?: boolean;
    canGoForward?: boolean;
    onNavigateBack?: () => void;
    onNavigateForward?: () => void;
    onClose?: () => void;
    /** Whether clicking visualization scrolls to file (default: true) */
    enableScrollToFile?: boolean;
  }

  let {
    workspaceId,
    canGoBack = false,
    canGoForward = false,
    onNavigateBack = () => {},
    onNavigateForward = () => {},
    onClose,
    enableScrollToFile = true,
  }: Props = $props();

  // Reference to the scrollable container
  let scrollContainer: HTMLDivElement | null = null;
  // Map of file IDs to their DOM elements
  let fileElementRefs = $state<Map<string, HTMLElement>>(new Map());

  // Get working changes from store
  const workingChanges = $derived(fileTrackingStore.workingChanges);

  // Combine all changes for display
  const allChanges = $derived([...workingChanges.staged, ...workingChanges.unstaged]);

  // Calculate statistics
  const totalAdditions = $derived(
    allChanges.reduce((sum, c) => sum + (c.stats?.additions || 0), 0),
  );
  const totalDeletions = $derived(
    allChanges.reduce((sum, c) => sum + (c.stats?.deletions || 0), 0),
  );

  // Form state
  let commitMessage = $state('');
  let isCommitting = $state(false);

  // Handle staging/unstaging
  async function handleStageChange(change: TrackedChange) {
    await fileTrackingStore.stageChanges([change.id]);
  }

  async function handleUnstageChange(change: TrackedChange) {
    await fileTrackingStore.unstageChanges([change.id]);
  }

  // Handle file click to show diff
  function handleFileClick(change: TrackedChange) {
    fileTrackingStore.setMainPanelView({
      type: 'diff',
      change,
    });
  }

  // Handle commit
  async function handleCommit() {
    if (!commitMessage.trim()) {
      alert('Please enter a commit message');
      return;
    }

    if (workingChanges.staged.length === 0) {
      alert('No staged changes to commit');
      return;
    }

    isCommitting = true;
    try {
      await gitStore.commit(WorkspaceId(workspaceId), commitMessage);

      // Clear the form and refresh
      commitMessage = '';
      await fileTrackingStore.refresh();

      // Close the view after successful commit
      if (onClose) {
        onClose();
      } else {
        fileTrackingStore.clearMainPanelView();
      }
    } catch (error) {
      logger.error('Failed to commit:', error);
      alert(`Failed to commit: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      isCommitting = false;
    }
  }

  // Stage all unstaged changes
  async function handleStageAll() {
    const unstagedIds = workingChanges.unstaged.map((c) => c.id);
    if (unstagedIds.length > 0) {
      await fileTrackingStore.stageChanges(unstagedIds);
    }
  }

  // Unstage all staged changes
  async function handleUnstageAll() {
    const stagedIds = workingChanges.staged.map((c) => c.id);
    if (stagedIds.length > 0) {
      await fileTrackingStore.unstageChanges(stagedIds);
    }
  }

  // Handle visualization file click - scrolls to file in list
  // Accepts AnyChange (TrackedChange | ChatFileChange) to match ChangeSetVisualization's onFileClick prop
  function handleVisualizationFileClick(change: TrackedChange | ChatFileChange) {
    // Only TrackedChange has the 'id' property we need for scrolling
    const isTrackedChange = 'id' in change && 'stage' in change;

    if (!enableScrollToFile || !isTrackedChange) {
      if (isTrackedChange) {
        handleFileClick(change as TrackedChange);
      }
      return;
    }

    const trackedChange = change as TrackedChange;

    // Try to find and scroll to the file element
    const fileElement = fileElementRefs.get(trackedChange.id);
    if (fileElement) {
      fileElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Brief highlight effect using background color instead of ring
      fileElement.classList.add('bg-accent/20');
      setTimeout(() => {
        fileElement.classList.remove('bg-accent/20');
      }, 1500);
    }

    // Also open the diff view
    handleFileClick(trackedChange);
  }

  // Register a file element ref
  function registerFileRef(id: string, element: HTMLElement | null) {
    if (element) {
      fileElementRefs.set(id, element);
    } else {
      fileElementRefs.delete(id);
    }
    // Trigger reactivity
    fileElementRefs = new Map(fileElementRefs);
  }

  // Svelte action to register element refs
  function registerRef(node: HTMLElement, id: string) {
    registerFileRef(id, node);
    return {
      destroy() {
        registerFileRef(id, null);
      },
    };
  }
</script>

<PanelWrapper
  title="Commit Changes"
  faIcon={faCodeCommit}
  {onClose}
  showClose={true}
  {canGoBack}
  {canGoForward}
  {onNavigateBack}
  {onNavigateForward}
>
  {#snippet actions()}
    <LineChangesBadge additions={totalAdditions} deletions={totalDeletions} size="sm" />
  {/snippet}

  <div class="flex flex-col h-full">
    <!-- Commit Form -->
    <div class="p-4 border-b border-border bg-muted/30">
      <div class="space-y-3">
        <div class="space-y-2">
          <label for="commit-message" class="block text-sm font-medium">Commit Message</label>
          <Textarea
            id="commit-message"
            bind:value={commitMessage}
            placeholder="Enter your commit message..."
            rows={3}
            class="resize-none"
          />
        </div>

        <div class="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onclick={handleCommit}
            disabled={isCommitting || !commitMessage.trim() || workingChanges.staged.length === 0}
            class="gap-2"
          >
            {#if isCommitting}
              <Fa icon={faCodeCommit} size="sm" class="animate-pulse" />
              <span>Committing...</span>
            {:else}
              <Fa icon={faCodeCommit} size="sm" />
              <span
                >Commit {workingChanges.staged.length} file{workingChanges.staged.length === 1
                  ? ''
                  : 's'}</span
              >
            {/if}
          </Button>

          {#if workingChanges.unstaged.length > 0}
            <Button variant="outline" size="sm" onclick={handleStageAll} class="gap-2">
              <Fa icon={faCircleCheck} size="sm" />
              <span>Stage All</span>
            </Button>
          {/if}

          {#if workingChanges.staged.length > 0}
            <Button variant="outline" size="sm" onclick={handleUnstageAll} class="gap-2">
              <Fa icon={faCircleDot} size="sm" />
              <span>Unstage All</span>
            </Button>
          {/if}
        </div>
      </div>
    </div>

    <!-- Sticky Visualization -->
    {#if allChanges.length > 0}
      <div class="sticky top-0 -mt-8 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
        <ChangeSetVisualization
          groups={[
            { label: 'Staged', changes: workingChanges.staged },
            { label: 'Unstaged', changes: workingChanges.unstaged },
          ]}
          onFileClick={handleVisualizationFileClick}
        />
      </div>
    {/if}

    <!-- Changes List -->
    <div class="flex-1 overflow-y-auto" bind:this={scrollContainer}>
      {#if workingChanges.staged.length > 0}
        <div class="p-4 border-b border-border">
          <div class="flex items-center gap-2 mb-3">
            <Fa icon={faCircleCheck} size="sm" class="text-green-600" />
            <h3 class="text-sm font-medium">Staged Changes ({workingChanges.staged.length})</h3>
          </div>
          {#each workingChanges.staged as change (change.id)}
            <div class="transition-all duration-300 rounded" use:registerRef={change.id}>
              <FileChangesList
                changes={[change]}
                viewMode="list"
                showStats={true}
                showActions={true}
                onFileClick={handleFileClick}
                onUnstageClick={handleUnstageChange}
              />
            </div>
          {/each}
        </div>
      {/if}

      {#if workingChanges.unstaged.length > 0}
        <div class="p-4">
          <div class="flex items-center gap-2 mb-3">
            <Fa icon={faCircleDot} size="sm" class="text-yellow-600" />
            <h3 class="text-sm font-medium">Unstaged Changes ({workingChanges.unstaged.length})</h3>
          </div>
          {#each workingChanges.unstaged as change (change.id)}
            <div class="transition-all duration-300 rounded" use:registerRef={change.id}>
              <FileChangesList
                changes={[change]}
                viewMode="list"
                showStats={true}
                showActions={true}
                onFileClick={handleFileClick}
                onStageClick={handleStageChange}
              />
            </div>
          {/each}
        </div>
      {/if}

      {#if allChanges.length === 0}
        <div class="flex items-center justify-center h-full text-subtle">
          <p>No changes to commit</p>
        </div>
      {/if}
    </div>
  </div>
</PanelWrapper>
