<script lang="ts">
  import {
  faPlus,
} from '@fortawesome/free-solid-svg-icons';

  import { Skeleton } from '../ui/skeleton';
  import VSCodeScrollablePanel from '../ui/VSCodeScrollablePanel.svelte';
  import {
  ListContainer,
  ListItem,
} from '../ui/list';

  import {
  initializeNotes,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
  import { createNote as createNoteWrite } from '$features/notes/notes-write-service';
  import {
  selectNotesLoading,
  selectNotesError,
  selectAllNotes,
} from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import {
  sortNotes,
  getNoteIcon,
  getNoteTitle,
  getNoteDepth,
  parseTaskStats,
} from '../workspace/sidebar/utils';
  import { store as appStore } from '$store/renderer/store';

  // Props
  let {
    workspaceId,
    selectedNoteId = 'workspace-spec',
    onOpenNote = () => {},
    collapsed = undefined,
    onCollapse = undefined,
  }: {
    workspaceId: string;
    selectedNoteId?: string;
    onOpenNote?: (noteId: string) => void | Promise<void>;
    collapsed?: boolean;
    onCollapse?: () => void;
  } = $props();

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

  // Get notes from Redux store
  const loading$ = selectNotesLoading(workspaceId);
  const error$ = selectNotesError(workspaceId);

  // Get all notes as array for parent/child detection
  const allNotes$ = selectAllNotes(workspaceId);

  // Filtered and sorted notes (with parent/child grouping)
  let filteredNotes = $derived(sortNotes($allNotes$, []));

  function createNote() {
    if (!workspaceId) return;

    void createNoteWrite(workspaceId, {
      title: 'New Note',
      content: '',
      tags: [],
    });
  }
</script>

<div class="h-full">
  <VSCodeScrollablePanel
    title="Notes"
    class="h-full"
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
    {#if $loading$}
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
    {:else if filteredNotes.length === 0}
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
      </ListContainer>
    {/if}
  </VSCodeScrollablePanel>
</div>
