<script lang="ts">
  import { WorkspaceId } from '$shared/types/branded-ids';
  import {
  faPlus,
  faLink,
  faGlobe,
} from '@fortawesome/free-solid-svg-icons';
  import {
  faGithub,
  faGoogle,
  faSlack,
  faFigma,
} from '@fortawesome/free-brands-svg-icons';

  import { Skeleton } from '../ui/skeleton';
  import VSCodeScrollablePanel from '../ui/VSCodeScrollablePanel.svelte';
  import {
  ListContainer,
  ListItem,
} from '../ui/list';

  import {
  createNote as createNoteAction,
  initializeNotes,
} from '$lib/store/slices/workspace-notes/workspace-notes-slice';
  import {
  selectNotesLoading,
  selectNotesError,
  selectAllNotes,
} from '$lib/store/slices/workspace-notes/workspace-notes-selectors';
  import { thirdPartySourcesClient } from '$features/third-party-sources/third-party-sources.client';
  import type { ThirdPartySource } from '$shared/types';
  import {
  hasUrls,
  handleThirdPartyDrop,
} from '$lib/utils/third-party-drag-drop';
  import { onMount } from 'svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import {
  sortNotes,
  getNoteIcon,
  getNoteTitle,
  getNoteDepth,
  parseTaskStats,
} from '../workspace/sidebar/utils';
  import { store as appStore } from '$lib/store/store';


  const logger = createLogger('NotesPanel');

  // Props
  let {
    workspaceId,
    selectedNoteId = 'workspace-spec',
    selectedSourceId = undefined,
    onOpenNote = () => {},
    onOpenSource = () => {},
    collapsed = undefined,
    onCollapse = undefined,
  }: {
    workspaceId: string;
    selectedNoteId?: string;
    selectedSourceId?: string;
    onOpenNote?: (noteId: string) => void | Promise<void>;
    onOpenSource?: (sourceId: string) => void | Promise<void>;
    collapsed?: boolean;
    onCollapse?: () => void;
  } = $props();


  // Local UI state
  let thirdPartySources: ThirdPartySource[] = $state([]);
  let sourcesLoading = $state(false);
  let _sourcesError = $state<string | null>(null);
  let isDraggingOver = $state(false);

  // Initialize notes state when workspace changes
  let lastInitializedWorkspaceId: string | null = null;
  $effect(() => {
    if (workspaceId && lastInitializedWorkspaceId !== workspaceId) {
      lastInitializedWorkspaceId = workspaceId;
      // Initialize with the current selected note to preserve selection
      appStore.dispatch(initializeNotes(
        workspaceId,
        selectedNoteId ? selectedNoteId : undefined,
      ));
    }
  });

  // Load third-party sources
  onMount(() => {
    if (workspaceId) {
      loadThirdPartySources();
    }

    // Return cleanup function
    return () => {
      // Cleanup if needed
    };
  });

  async function loadThirdPartySources() {
    sourcesLoading = true;
    _sourcesError = null;

    try {
      const response = await thirdPartySourcesClient.list(WorkspaceId(workspaceId));
      if (response.success && response.data) {
        thirdPartySources = response.data;
      } else {
        _sourcesError = response.error || 'Failed to load external sources';
      }
    } catch (err) {
      logger.error('Failed to load third-party sources', err);
      _sourcesError = 'Failed to load external sources';
    } finally {
      sourcesLoading = false;
    }
  }

  // Get notes from Redux store
  const loading$ = selectNotesLoading(workspaceId);
  const error$ = selectNotesError(workspaceId);

  // Get all notes as array for parent/child detection
  const allNotes$ = selectAllNotes(workspaceId);

  // Filtered and sorted notes (with parent/child grouping)
  let filteredNotes = $derived(sortNotes($allNotes$, []));

  // Helper functions
  function getSourceIcon(type: string) {
    switch (type) {
      case 'linear_issue':
        return faLink;
      case 'github_issue':
      case 'github_pr':
        return faGithub;
      case 'google_doc':
        return faGoogle;
      case 'slack_thread':
        return faSlack;
      case 'figma_design':
        return faFigma;
      default:
        return faGlobe;
    }
  }

  function createNote() {
    if (!workspaceId) return;

    appStore.dispatch(createNoteAction(workspaceId, {
      title: 'New Note',
      content: '',
      tags: [],
    }));
  }

  // Drag and drop handlers for third-party sources
  function handleDragOver(event: DragEvent) {
    if (hasUrls(event)) {
      event.preventDefault();
      event.dataTransfer!.dropEffect = 'copy';
      isDraggingOver = true;
    }
  }

  function handleDragLeave(event: DragEvent) {
    // Only set to false if we're leaving the component entirely
    const relatedTarget = event.relatedTarget as HTMLElement;
    const currentTarget = event.currentTarget as HTMLElement;
    if (!relatedTarget || !currentTarget?.contains(relatedTarget)) {
      isDraggingOver = false;
    }
  }

  async function handleDrop(event: DragEvent) {
    isDraggingOver = false;

    if (!workspaceId) {
      logger.error('No workspace ID available for drop');
      return;
    }

    await handleThirdPartyDrop(
      event,
      workspaceId,
      async (sourceId) => {
        // Reload third-party sources to include the new one
        await loadThirdPartySources();
        // Open the newly created source
        onOpenSource(sourceId);
      },
      (error) => {
        _sourcesError = error;
        // Clear error after a few seconds
        setTimeout(() => {
          _sourcesError = null;
        }, 5000);
      },
    );
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="h-full" ondragover={handleDragOver} ondragleave={handleDragLeave} ondrop={handleDrop}>
  <VSCodeScrollablePanel
    title="Notes"
    class="h-full {isDraggingOver ? 'ring-2 ring-primary' : ''}"
    collapsible={true}
    {collapsed}
    {onCollapse}
    storageKey={collapsed === undefined ? 'workspace-notes-collapsed' : undefined}
    showAction={true}
    actionIcon={faPlus}
    actionLabel="Create Note"
    onAction={createNote}
    contentClass="py-0.5 px-0"
  >
    {#if isDraggingOver}
      <div class="p-4 m-2 border-2 border-dashed border-primary rounded-lg bg-primary/5">
        <div class="text-center text-sm text-primary">Drop third-party reference here</div>
      </div>
    {:else if $loading$}
      <div class="pt-1.5 px-2">
        {#each Array(5) as _}
          <div class="flex items-center gap-2 py-1">
            <Skeleton class="h-3 w-3 rounded flex-shrink-0" />
            <Skeleton class="h-3 w-24 flex-1" />
          </div>
        {/each}
      </div>
    {:else if $error$}
      <div class="text-xs text-destructive-foreground px-1">
        {$error$}
      </div>
    {:else if filteredNotes.length === 0 && thirdPartySources.length === 0}
      <!-- <ListEmpty message="No notes yet" icon={faStickyNote} /> -->
    {:else}
      <ListContainer spacing="compact">
        <!-- Show all notes (including spec note with fixed ID "spec") -->
        {#each filteredNotes as note (note.id)}
          {@const depth = getNoteDepth(note, $allNotes$)}
          {@const taskStats = parseTaskStats(note.content, $allNotes$)}
          {@const hasTasks = taskStats.total > 0}
          {#if hasTasks}
            {@const isAllComplete = taskStats.completed === taskStats.total}
            {@const size = 14}
            {@const strokeWidth = 2.5}
            {@const radius = (size - strokeWidth) / 2}
            {@const circumference = 2 * Math.PI * radius}
            {@const completedPctNorm = taskStats.completed / taskStats.total}
            {@const inProgressPctNorm = taskStats.inProgress / taskStats.total}
            {@const completedOffset = circumference * (1 - completedPctNorm)}
            {@const inProgressOffset = circumference * (1 - inProgressPctNorm)}
            <ListItem
              active={selectedNoteId === note.id}
              iconClass="text-ghost"
              title={getNoteTitle(note)}
              onclick={() => onOpenNote(note.id)}
              size="sm"
              indent={depth}
            >
              {#snippet iconSnippet()}
                {#if isAllComplete}
                  <!-- All tasks complete - show checked checkbox -->
                  <div title="{taskStats.completed}/{taskStats.total} complete">
                    <input
                      type="checkbox"
                      checked
                      disabled
                      class="w-3.5 h-3.5 rounded border border-muted-foreground/40 accent-emerald-500 pointer-events-none"
                    />
                  </div>
                {:else}
                  <!-- Show progress ring -->
                  <div
                    title="{taskStats.completed}/{taskStats.total} complete{taskStats.inProgress > 0
                      ? `, ${taskStats.inProgress} in progress`
                      : ''}"
                  >
                    <svg width={size} height={size} class="transform -rotate-90">
                      <!-- Background ring -->
                      <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        fill="none"
                        stroke="currentColor"
                        stroke-width={strokeWidth}
                        class="text-ghost"
                      />
                      <!-- In progress arc -->
                      {#if taskStats.inProgress > 0}
                        <circle
                          cx={size / 2}
                          cy={size / 2}
                          r={radius}
                          fill="none"
                          stroke="currentColor"
                          stroke-width={strokeWidth}
                          stroke-dasharray={circumference}
                          stroke-dashoffset={inProgressOffset}
                          stroke-linecap="round"
                          class="text-primary"
                          style="transform-origin: center; transform: rotate({completedPctNorm *
                            360}deg);"
                        />
                      {/if}
                      <!-- Completed arc -->
                      {#if taskStats.completed > 0}
                        <circle
                          cx={size / 2}
                          cy={size / 2}
                          r={radius}
                          fill="none"
                          stroke="currentColor"
                          stroke-width={strokeWidth}
                          stroke-dasharray={circumference}
                          stroke-dashoffset={completedOffset}
                          stroke-linecap="round"
                          class="text-emerald-500"
                        />
                      {/if}
                    </svg>
                  </div>
                {/if}
              {/snippet}
            </ListItem>
          {:else}
            <ListItem
              active={selectedNoteId === note.id}
              icon={getNoteIcon(note)}
              iconClass="text-ghost"
              title={getNoteTitle(note)}
              onclick={() => onOpenNote(note.id)}
              size="sm"
              indent={depth}
            />
          {/if}
        {/each}

        <!-- Show third-party sources -->
        {#if sourcesLoading}
          <div class="mt-2 pt-2 border-t border-border/50">
            <!-- <div class="px-2 pb-1">
            <span class="text-xs text-subtle font-medium">External Sources</span>
          </div> -->
            <div class="px-2 py-2">
              <Skeleton class="h-3 w-full mb-1" />
              <Skeleton class="h-3 w-3/4" />
            </div>
          </div>
        {:else if thirdPartySources.length > 0}
          <div class="mt-2 pt-2 border-t border-border/50">
            <!-- <div class="px-2 pb-1 flex items-center justify-between">
            <span class="text-xs text-subtle font-medium">External Sources</span>
            <span class="text-xs text-subtle">({thirdPartySources.length})</span>
          </div> -->
            {#each thirdPartySources as source (source.id)}
              <ListItem
                active={selectedSourceId === source.id}
                icon={getSourceIcon(source.type)}
                iconClass="text-ghost"
                title={source.title || 'External Source'}
                onclick={() => onOpenSource(source.id)}
                size="sm"
                class="text-muted-foreground hover:text-foreground"
              />
            {/each}
          </div>
        {/if}
      </ListContainer>
    {/if}
  </VSCodeScrollablePanel>
</div>
