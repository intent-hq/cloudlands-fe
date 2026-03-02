<script lang="ts">
  import type { Note, TaskStatus, Workspace } from '$shared/types';
  import { isSpecNote } from '$shared/constants/notes';
  import { extractSpecTaskIds, EXCLUDED_STATUSES } from '$shared/utils/task-stats';
  import { noteReadTrackingStore } from '$lib/stores/note-read-tracking.store.svelte';
  import HoverCard from '$lib/components/ui/HoverCard.svelte';
  import TaskStatusIndicator from '$lib/components/workspace/TaskStatusIndicator.svelte';
  import TaskAgentStatus from '$lib/components/tiptap/TaskAgentStatus.svelte';
  import { notesClient } from '$features/notes/notes.client';
  import { createWorkspaceId } from '$shared/types/branded-ids';
  import { createLogger } from '$lib/utils/client-logger';
  import { listenSync } from '$lib/electron-bridge';
  import Fa from 'svelte-fa';
  import {
    faSpinner,
    faArrowRight,
    faChevronLeft,
    faChevronRight,
  } from '@fortawesome/free-solid-svg-icons';
  import { getNoteIcon } from '$features/notes/utils/note-icon-utils';

  const logger = createLogger('TasksOverview');

  interface Props {
    notes: Note[];
    workspaceId?: string;
    workspace?: Workspace;
    onOpenNote?: (noteId: string) => void;
  }

  let { notes, workspaceId, workspace, onOpenNote }: Props = $props();

  // Ready tasks state
  let readyTasks: Note[] = $state([]);
  let currentReadyIndex = $state(0);
  let isLoadingReadyTasks = $state(false);
  let readyTasksError: string | null = $state(null);
  let hasSearchedForReadyTasks = $state(false);

  // Hover state - set by flame graph cells, triggers hover card
  let hoveredNoteId: string | null = $state(null);

  // Highlight state - set by next task button, triggers cell dimming only (no hover card)
  let highlightedNoteId: string | null = $state(null);

  // Derived: which note is currently focused (for dimming effect)
  const focusedNoteId = $derived(hoveredNoteId ?? highlightedNoteId);

  // Tree node with computed weight (leaf count)
  interface TaskTreeNode {
    note: Note;
    children: TaskTreeNode[];
    weight: number; // Number of leaf descendants (or 1 if leaf)
    isLeaf: boolean;
  }

  // Build task tree from notes using parentId
  // Excludes spec note and cancelled tasks; treats tasks with no parent or spec as parent as roots
  // Only includes tasks that are referenced in the spec content
  function buildTaskTree(notes: Note[]): TaskTreeNode[] {
    // Get spec note to determine which tasks are referenced
    // If spec has no task links, fall back to showing all tasks
    const specNote = notes.find((n) => isSpecNote(n.id as string));
    const specTaskIds = extractSpecTaskIds(specNote?.content);
    const hasSpecLinks = specTaskIds.size > 0;

    // Filter to only task notes, excluding the spec note and cancelled tasks
    const taskNotes = notes.filter(
      (n) =>
        n.metadata?.task &&
        !isSpecNote(n.id as string) &&
        !EXCLUDED_STATUSES.has(n.metadata.task.status),
    );

    // Build parent -> children map
    // Treat spec as parent === no parent (root level)
    const childrenMap = new Map<string | undefined, Note[]>();
    for (const note of taskNotes) {
      const rawParentId = note.parentId as string | undefined;
      // Normalize: spec parent or no parent → undefined (root)
      const parentId = rawParentId && !isSpecNote(rawParentId) ? rawParentId : undefined;
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      childrenMap.get(parentId)!.push(note);
    }

    // Sort by creation time (oldest first)
    function sortByCreatedAt(a: TaskTreeNode, b: TaskTreeNode): number {
      const timeA = new Date(a.note.createdAt || a.note.created_at || 0).getTime();
      const timeB = new Date(b.note.createdAt || b.note.created_at || 0).getTime();
      return timeA - timeB;
    }

    // Recursively build tree nodes with weights
    function buildNode(note: Note): TaskTreeNode {
      const children = (childrenMap.get(note.id as string) || [])
        .map(buildNode)
        .sort(sortByCreatedAt); // Sort by creation time

      const isLeaf = children.length === 0;
      const weight = isLeaf ? 1 : children.reduce((sum, c) => sum + c.weight, 0);

      return { note, children, weight, isLeaf };
    }

    // Get root tasks (no parent, or parent is spec, or parent is not a task)
    // Only include roots that are referenced in the spec content (if spec has links)
    const taskIds = new Set(taskNotes.map((n) => n.id as string));
    const roots = taskNotes.filter((n) => {
      const parentId = n.parentId as string | undefined;
      const isRoot = !parentId || isSpecNote(parentId) || !taskIds.has(parentId);
      return isRoot && (!hasSpecLinks || specTaskIds.has(n.id as string));
    });

    return roots.map(buildNode).sort(sortByCreatedAt);
  }

  // Convert tree to rows for table rendering
  interface RowCell {
    node: TaskTreeNode | null; // null for empty filler cells
    colspan: number;
  }

  function treeToRows(roots: TaskTreeNode[]): RowCell[][] {
    if (roots.length === 0) return [];

    const rows: RowCell[][] = [];

    // First row is the roots
    let currentRow: RowCell[] = roots.map((node) => ({ node, colspan: node.weight }));

    // Keep building rows until all cells are leaves or fillers
    while (currentRow.some((cell) => cell.node && !cell.node.isLeaf)) {
      rows.push(currentRow);

      const nextRow: RowCell[] = [];
      for (const cell of currentRow) {
        if (cell.node === null || cell.node.isLeaf) {
          // Filler or leaf becomes filler in next row (preserves position)
          nextRow.push({ node: null, colspan: cell.colspan });
        } else {
          // Expand children into this position
          for (const child of cell.node.children) {
            nextRow.push({ node: child, colspan: child.weight });
          }
        }
      }
      currentRow = nextRow;
    }

    // Add final row (all leaves or fillers)
    rows.push(currentRow);

    return rows;
  }

  // Get status class for a task
  function getStatusClass(status: TaskStatus | undefined): string {
    switch (status) {
      case 'complete':
        return 'status-complete';
      case 'in_progress':
        return 'status-in-progress';
      case 'review_required':
        return 'status-review-required';
      case 'waiting':
        return 'status-waiting';
      case 'discussion_needed':
        return 'status-discussion-needed';
      case 'cancelled':
        return 'status-cancelled';
      case 'not_started':
      default:
        return 'status-not-started';
    }
  }

  // Reactive computations
  const taskTree = $derived(buildTaskTree(notes));
  const rows = $derived(treeToRows(taskTree));
  const totalWeight = $derived(taskTree.reduce((sum, r) => sum + r.weight, 0));

  // Check if a note has unread changes
  // NOTE: The refresh is triggered by the parent component (WorkspaceDetailSidebar)
  // to avoid duplicate IPC calls from multiple components.
  // We use the store's hasUnreadChanges method directly for consistency.
  const hasUnreadChanges = noteReadTrackingStore.hasUnreadChanges;

  // Load all ready tasks using the backend service
  async function loadReadyTasks() {
    if (!workspaceId) return;

    isLoadingReadyTasks = true;
    readyTasksError = null;

    try {
      const wsId = createWorkspaceId(workspaceId);
      const result = await notesClient.findReadyTasks(wsId);

      if (result.ok) {
        readyTasks = result.data.ready;
        currentReadyIndex = 0;
        logger.info('Loaded ready tasks', { count: readyTasks.length });
      } else {
        logger.info('No ready tasks found');
        readyTasks = [];
      }
    } catch (error) {
      readyTasksError = error instanceof Error ? error.message : String(error);
      logger.error('Error loading ready tasks', error);
      readyTasks = [];
    } finally {
      isLoadingReadyTasks = false;
      hasSearchedForReadyTasks = true;
    }
  }

  // Navigation helpers
  function navigatePrev() {
    if (readyTasks.length > 0) {
      currentReadyIndex = (currentReadyIndex - 1 + readyTasks.length) % readyTasks.length;
    }
  }

  function navigateNext() {
    if (readyTasks.length > 0) {
      currentReadyIndex = (currentReadyIndex + 1) % readyTasks.length;
    }
  }

  // Current ready task (derived)
  const currentReadyTask = $derived(readyTasks[currentReadyIndex] ?? null);

  // Auto-load ready tasks on initial load (only once)
  $effect(() => {
    if (workspaceId && notes.length > 0 && !isLoadingReadyTasks && !hasSearchedForReadyTasks) {
      loadReadyTasks();
    }
  });

  // Listen for ready tasks changes from backend
  $effect(() => {
    if (!workspaceId) return;

    const unsubscribe = listenSync<{
      workspaceId: string;
      data: {
        readyTaskIds: string[];
        triggeredBy?: {
          noteId: string;
          previousStatus: string;
          newStatus: string;
        };
        computedAt: string;
      };
    }>('task:ready-tasks-changed', (event) => {
      const payload = event.payload;
      const eventWorkspaceId = payload?.workspaceId;
      const readyTaskIds = payload?.data?.readyTaskIds;

      // Only update if it's for this workspace
      if (eventWorkspaceId !== workspaceId) return;

      logger.debug('Received ready tasks changed event', {
        workspaceId: eventWorkspaceId,
        readyTaskIds,
        triggeredBy: payload?.data?.triggeredBy,
      });

      // Update ready tasks from the notes we already have
      if (readyTaskIds) {
        const newReadyTasks = notes.filter((n) => readyTaskIds.includes(n.id as string));
        readyTasks = newReadyTasks;
        currentReadyIndex = 0; // Reset pagination when ready tasks change
      }
    });

    // Cleanup
    return () => {
      unsubscribe();
    };
  });
</script>

<!-- Ready Tasks Navigation -->
{#if workspace}
  <div class="ready-tasks-nav">
    {#if isLoadingReadyTasks}
      <div class="ready-tasks-loading">
        <Fa icon={faSpinner} spin />
        <span>Finding ready tasks...</span>
      </div>
    {:else if readyTasks.length > 0 && currentReadyTask}
      <div class="ready-tasks-header text-subtle">
        <span class="ready-tasks-label"> Ready Task{readyTasks.length > 1 ? 's:' : ''}</span>
        {#if readyTasks.length > 1}
          <span class="ready-tasks-pagination">
            <span class="ready-tasks-count">{currentReadyIndex + 1} of {readyTasks.length}</span>
            <button
              class="nav-button"
              onclick={navigatePrev}
              disabled={readyTasks.length <= 1}
              title="Previous ready task"
            >
              <Fa icon={faChevronLeft} />
            </button>
            <button
              class="nav-button"
              onclick={navigateNext}
              disabled={readyTasks.length <= 1}
              title="Next ready task"
            >
              <Fa icon={faChevronRight} />
            </button>
          </span>
        {/if}
      </div>
      <button
        class="ready-task-link"
        onclick={() => onOpenNote?.(currentReadyTask.id as string)}
        onmouseenter={() => (highlightedNoteId = currentReadyTask.id as string)}
        onmouseleave={() => (highlightedNoteId = null)}
      >
        <Fa icon={getNoteIcon(currentReadyTask)} class="ready-task-icon" />
        <span class="ready-task-title">{currentReadyTask.title}</span>
        <Fa icon={faArrowRight} />
      </button>
    {:else if readyTasksError}
      <div class="ready-tasks-error">Error: {readyTasksError}</div>
    {:else}
      <div class="ready-tasks-empty">No ready tasks</div>
    {/if}
  </div>
{/if}

{#if rows.length > 0}
  <div class="task-overview-container">
    <table
      class="task-overview"
      class:has-focus={focusedNoteId}
      style="--total-cols: {totalWeight}"
    >
      <tbody>
        {#each rows as row, rowIndex (`row-${rowIndex}`)}
          <tr>
            {#each row as cell, cellIndex (`cell-${rowIndex}-${cellIndex}`)}
              {#if cell.node}
                {@const noteId = cell.node.note.id as string}
                {@const isUnread = hasUnreadChanges(noteId)}
                {@const isFocused = noteId === focusedNoteId}
                <td
                  colspan={cell.colspan}
                  class="{getStatusClass(cell.node.note.metadata?.task?.status)} {cell.node.isLeaf
                    ? 'leaf'
                    : ''} {isUnread ? 'has-unread' : ''}"
                  class:is-focused={isFocused}
                >
                  <button
                    class="task-cell-button"
                    style:anchor-name="--task-{noteId}"
                    onclick={() => onOpenNote?.(noteId)}
                    onmouseenter={() => (hoveredNoteId = noteId)}
                    onmouseleave={() => (hoveredNoteId = null)}
                  >
                    <span class="cell-label">{cell.node.note.title}</span>
                    {#if isUnread}
                      <span class="unread-indicator" title="Has unread changes"></span>
                    {/if}
                  </button>
                </td>
              {:else}
                <td colspan={cell.colspan} class="filler"></td>
              {/if}
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{:else}
  <!-- <div class="empty-state">No tasks found</div> -->
{/if}

<!-- Hover Card - Uses CSS Anchor Positioning (only on flame graph hover) -->
{#if hoveredNoteId}
  {@const hoveredNote = notes.find((n) => n.id === hoveredNoteId)}
  {#if hoveredNote}
    {@const taskStatus = hoveredNote.metadata?.task?.status ?? 'not_started'}
    {@const assignedAgentIds = hoveredNote.metadata?.task?.assignedAgentIds}
    {@const latestAgentId = assignedAgentIds?.length
      ? assignedAgentIds[assignedAgentIds.length - 1]
      : null}
    <HoverCard anchor="--task-{hoveredNoteId}" position="bottom-right">
      <div class="task-hover-content">
        <!-- Task title -->
        <div class="task-hover-title">{hoveredNote.title}</div>

        <!-- Status badge -->
        <div class="task-hover-status">
          <TaskStatusIndicator status={taskStatus} readonly compact />
        </div>

        <!-- Agent row (if assigned) -->
        {#if latestAgentId}
          <div class="task-hover-agent">
            <TaskAgentStatus agentId={latestAgentId} compact />
          </div>
        {/if}
      </div>
    </HoverCard>
  {/if}
{/if}

<style>
  .task-overview-container {
    width: 100%;
    overflow-x: auto;
  }

  .task-overview-container::-webkit-scrollbar {
    display: none;
  }

  .task-overview {
    border-collapse: separate;
    border-spacing: 2px;
    table-layout: fixed;
    width: 100%;
  }

  .task-overview td {
    height: 8px;
    padding: 0;
    border-radius: 3px;
    transition: opacity 0.15s ease;
  }

  /* Focus state: dim non-focused cells when something is focused */
  .task-overview.has-focus td:not(.is-focused):not(.filler) {
    opacity: 0.35;
  }

  .task-overview.has-focus td.is-focused {
    opacity: 1;
  }

  /* Button fills the cell */
  .task-cell-button {
    display: block;
    width: 100%;
    height: 8px;
    padding: 2px 6px;
    border: none;
    border-radius: 3px;
    background: inherit;
    color: transparent;
    font-size: 12px;
    text-align: left;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.3);
    cursor: pointer;
    transition: filter 0.15s ease;
  }

  .task-cell-button:hover {
    filter: brightness(1.15);
  }

  .task-cell-button:active {
    filter: brightness(0.95);
  }

  /* Leaf cells: constrain to square (width = height) */
  .task-overview td.leaf {
    max-width: 28px;
  }

  .task-overview td.leaf .task-cell-button {
    padding: 2px;
    text-align: center;
  }

  .task-overview td.leaf .cell-label {
    display: none; /* Hide text in leaf cells - too narrow */
  }

  .cell-label {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Status colors */
  .status-complete {
    background-color: #00bc7d; /* emerald-500 */
  }

  .status-in-progress {
    background-color: #38bdf8; /* sky-400 - lighter blue for active work */
  }

  .status-review-required {
    background-color: #3b82f6; /* blue-500 - darker blue for review */
  }

  .status-waiting {
    background-color: #d1d5db; /* gray-300 - light grey for waiting */
  }

  .status-discussion-needed {
    background-color: #f59e0b; /* amber-500 */
  }

  .status-not-started {
    background-color: var(--color-muted); /* gray-700 */
  }

  .status-cancelled {
    background-color: var(--color-border); /* gray-600 */
    text-decoration: line-through;
  }

  .filler {
    background: transparent;
  }

  .empty-state {
    color: var(--muted-foreground);
    font-size: 14px;
    padding: 16px;
    text-align: center;
  }

  /* Unread indicator */
  .has-unread {
    position: relative;
  }

  .unread-indicator {
    position: absolute;
    top: -2px;
    right: -2px;
    width: 6px;
    height: 6px;
    background-color: #ef4444; /* red-500 */
    border-radius: 50%;
    border: 1px solid rgba(0, 0, 0, 0.2);
    box-shadow: 0 0 4px rgba(239, 68, 68, 0.5);
  }

  .task-cell-button {
    position: relative;
  }

  /* Hover card styles */
  .task-hover-content {
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .task-hover-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--foreground);
    line-height: 1.3;
  }

  .task-hover-status {
    display: flex;
    align-items: center;
  }

  .task-hover-agent {
    border-top: 1px solid var(--border);
    padding-top: 0.5rem;
    margin-top: 0.25rem;
  }

  /* Ready Tasks Navigation */
  .ready-tasks-nav {
    display: flex;
    flex-direction: column;
    margin-bottom: 0.25rem;
  }

  .ready-tasks-header {
    display: flex;
    gap: 0.25rem;
    align-items: center;
  }

  .ready-tasks-loading {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted-foreground);
    font-size: 11px;
  }

  .ready-tasks-label {
    font-size: 11px;
    color: var(--muted-foreground);
  }

  .ready-task-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    border: none;
    background: transparent;
    color: var(--foreground);
    font-size: 13px;
    cursor: pointer;
    text-align: left;
  }

  .ready-task-link:hover {
    text-decoration: underline;
  }

  .ready-task-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ready-tasks-pagination {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .ready-tasks-count {
    font-size: 11px;
    color: var(--muted-foreground);
    margin-right: 4px;
    font-feature-settings: 'tnum';
    font-variant-numeric: tabular-nums;
  }

  .nav-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 0.5rem;
    height: 0.5rem;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--background);
    color: var(--muted-foreground);
    font-size: 11px;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .nav-button:hover:not(:disabled) {
    background: var(--accent);
    color: #fff;
  }

  .nav-button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .ready-tasks-error {
    color: #ef4444;
    font-size: 11px;
  }

  .ready-tasks-empty {
    font-size: 11px;
    color: var(--muted-foreground);
  }
</style>
