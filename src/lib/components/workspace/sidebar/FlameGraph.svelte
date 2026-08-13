<script lang="ts">
  import type { Note, TaskStatus } from '$shared/types';
  import { isSpecNote } from '$shared/constants/notes';
  import { extractOrderedSpecTaskIds, extractSpecTaskIds } from '$shared/utils/task-stats';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import {
    TASK_STATUS_BAR_CLASSES,
    TASK_STATUS_INDICATOR_CLASSES,
    TASK_STATUS_LABELS,
    TASK_STATUS_ORDER,
  } from '../utils/task-status-display';
  interface Props {
    notes: Note[];
    onTaskClick?: (noteId: string) => void;
    /** Canonical BE-owned completion ratio, from 0 to 1. Undefined while loading. */
    progress?: number;
    loading?: boolean;
    /** Remounts the visual bar so workspace switches replay the entrance animation. */
    animationKey?: string;
  }

  let {
    notes = [],
    onTaskClick,
    progress,
    loading = progress === undefined,
    animationKey,
  }: Props = $props();

  // Tree node with computed weight (leaf count)
  interface TaskTreeNode {
    note: Note;
    children: TaskTreeNode[];
    weight: number;
    isLeaf: boolean;
  }

  // Sort notes by their order in the parent's content, falling back to peerOrder/createdAt
  function sortByContentOrder(notesToSort: Note[], parentContent: string | undefined): Note[] {
    const orderFromContent = extractOrderedSpecTaskIds(parentContent);
    const orderMap = new Map(orderFromContent.map((id, index) => [id, index]));

    return [...notesToSort].sort((a, b) => {
      const aId = a.id as string;
      const bId = b.id as string;
      const aOrder = orderMap.get(aId);
      const bOrder = orderMap.get(bId);

      // If both are in the content, sort by content order
      if (aOrder !== undefined && bOrder !== undefined) {
        return aOrder - bOrder;
      }
      // If only one is in the content, prioritize the one in content
      if (aOrder !== undefined) return -1;
      if (bOrder !== undefined) return 1;

      // Neither in content - fall back to peerOrder then createdAt
      const aPeerOrder = a.metadata?.task?.peerOrder ?? 0;
      const bPeerOrder = b.metadata?.task?.peerOrder ?? 0;
      if (aPeerOrder !== bPeerOrder) {
        return aPeerOrder - bPeerOrder;
      }
      const aCreated = (a.createdAt || a.created_at || '') as string;
      const bCreated = (b.createdAt || b.created_at || '') as string;
      return aCreated.localeCompare(bCreated);
    });
  }

  // Build task tree from notes
  // Orders tasks by their appearance in the spec note content
  function buildTaskTree(notesList: Note[]): TaskTreeNode[] {
    // Get spec note for ordering
    const specNote = notesList.find((n) => isSpecNote(n.id as string));

    const seenIds = new Set<string>();
    const allTaskNotes = notesList.filter((n) => {
      if (!n.metadata?.task || isSpecNote(n.id as string) || n.metadata.task.status === 'cancelled')
        return false;
      const noteId = n.id as string;
      if (seenIds.has(noteId)) return false;
      seenIds.add(noteId);
      return true;
    });

    const specDescendantIds = new Set<string>();
    for (const note of allTaskNotes) {
      if (isSpecNote(note.parentId as string)) specDescendantIds.add(note.id as string);
    }

    let foundNew = true;
    while (foundNew) {
      foundNew = false;
      for (const note of allTaskNotes) {
        const noteId = note.id as string;
        const parentId = note.parentId as string | undefined;
        if (!specDescendantIds.has(noteId) && parentId && specDescendantIds.has(parentId)) {
          specDescendantIds.add(noteId);
          foundNew = true;
        }
      }
    }

    const taskNotes = allTaskNotes.filter((n) => specDescendantIds.has(n.id as string));
    const childrenMap = new Map<string | undefined, Note[]>();
    for (const note of taskNotes) {
      const rawParentId = note.parentId as string | undefined;
      const parentId = rawParentId && !isSpecNote(rawParentId) ? rawParentId : undefined;
      if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
      childrenMap.get(parentId)!.push(note);
    }

    // Recursively build tree nodes with weights
    // Sort children by their order in the parent note's content
    function buildNode(note: Note): TaskTreeNode {
      const childNotes = childrenMap.get(note.id as string) || [];
      // Sort children by their order in this note's content
      const sortedChildren = sortByContentOrder(childNotes, note.content);
      const children = sortedChildren.map(buildNode);
      const isLeaf = children.length === 0;
      const weight = isLeaf ? 1 : children.reduce((sum, c) => sum + c.weight, 0);
      return { note, children, weight, isLeaf };
    }

    // Get root tasks (direct children of spec - their parentId is 'spec')
    // Only include tasks that are actually referenced in the spec note content
    // If spec has no task links, fall back to all direct children of spec
    const specTaskIds = extractSpecTaskIds(specNote?.content);
    const hasSpecLinks = specTaskIds.size > 0;
    const roots = taskNotes.filter(
      (n) => isSpecNote(n.parentId as string) && (!hasSpecLinks || specTaskIds.has(n.id as string)),
    );

    // Sort roots by their order in the spec note content
    const sortedRoots = sortByContentOrder(roots, specNote?.content);

    return sortedRoots.map(buildNode);
  }

  function flattenTasks(nodes: TaskTreeNode[]): TaskTreeNode[] {
    return nodes.flatMap((node) => [node, ...flattenTasks(node.children)]);
  }

  const taskTree = $derived(buildTaskTree(notes));
  const taskList = $derived(flattenTasks(taskTree));
  const specNoteId = $derived(
    notes.find((note) => isSpecNote(note.id as string))?.id as string | undefined,
  );
  const taskCount = $derived(taskList.length);
  const completedCount = $derived(
    taskList.filter((task) => task.note.metadata?.task?.status === 'complete').length,
  );
  const progressPercent = $derived(Math.min(100, Math.max(0, (progress ?? 0) * 100)));

  interface StatusBar {
    status: TaskStatus;
    count: number;
  }

  const statusBars = $derived.by(() => {
    const counts = new Map<TaskStatus, number>();
    for (const task of taskList) {
      const status = task.note.metadata?.task?.status ?? 'not_started';
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return TASK_STATUS_ORDER.flatMap<StatusBar>((status) => {
      const count = counts.get(status) ?? 0;
      return count > 0 ? [{ status, count }] : [];
    });
  });

  const progressValueText = $derived(
    statusBars
      .map((bar) => `${formatInteger(bar.count)} ${TASK_STATUS_LABELS[bar.status].toLowerCase()}`)
      .join(', '),
  );

  function statusBarLabel(status: TaskStatus, count: number): string {
    return count === 1
      ? m.workspace_flameGraph_statusTasks_one({ status: TASK_STATUS_LABELS[status] })
      : m.workspace_flameGraph_statusTasks_many({
          status: TASK_STATUS_LABELS[status],
          count: formatInteger(count),
        });
  }
</script>

{#snippet taskListTooltip()}
  <div
    class="flex h-auto min-h-0 max-h-72 w-72 flex-col overflow-x-hidden overflow-y-auto px-2 pt-2"
  >
    <button
      type="button"
      class="type-caption mb-1 w-full cursor-pointer text-left font-normal text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40 disabled:cursor-default"
      onclick={() => specNoteId && onTaskClick?.(specNoteId)}
      disabled={!specNoteId || !onTaskClick}
      aria-label={m.workspace_flameGraph_openSpecProgress_ariaLabel({
        completed: formatInteger(completedCount),
        total: formatInteger(taskCount),
      })}
    >
      {m.workspace_flameGraph_tasksComplete_label({
        completed: formatInteger(completedCount),
        total: formatInteger(taskCount),
      })}
    </button>
    {#each taskList as task (task.note.id)}
      {@const status = task.note.metadata?.task?.status ?? 'not_started'}
      <button
        type="button"
        class="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
        onclick={() => onTaskClick?.(task.note.id as string)}
        aria-label={m.workspace_flameGraph_openTask_ariaLabel({
          title: task.note.title,
          status: TASK_STATUS_LABELS[status],
        })}
      >
        <span
          class="size-2 shrink-0 rounded-full {TASK_STATUS_INDICATOR_CLASSES[status]}"
          aria-hidden="true"
        ></span>
        <span class="type-caption min-w-0 flex-1 truncate text-foreground">{task.note.title}</span>
        <span class="type-caption shrink-0 font-normal! text-subtle"
          >{TASK_STATUS_LABELS[status]}</span
        >
      </button>
    {/each}
  </div>
{/snippet}

{#snippet progressBar()}
  <div
    class="flame-progress-enter flex h-5 w-full overflow-hidden rounded-xs bg-background"
    role="progressbar"
    aria-label={m.workspace_flameGraph_taskProgress_ariaLabel()}
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={Math.round(progressPercent)}
    aria-valuetext={progressValueText}
    data-flame-animation-key={animationKey}
  >
    {#each statusBars as bar (bar.status)}
      <div
        class="flame-status-segment h-full min-w-0 {TASK_STATUS_BAR_CLASSES[bar.status]}"
        data-flame-status-bar={bar.status}
        aria-label={statusBarLabel(bar.status, bar.count)}
        style:flex-basis="0%"
        style:flex-grow={bar.count}
        style:mask-image={bar.status === 'in_progress'
          ? 'var(--status-in-progress-hatch-mask)'
          : undefined}
      ></div>
    {/each}
  </div>
{/snippet}

{#key animationKey}
  {#if loading}
    <div class="h-5 w-full" data-flame-progress-placeholder aria-hidden="true"></div>
  {:else}
    <Tooltip
      content={taskListTooltip}
      side="bottom"
      align="start"
      sideOffset={6}
      delayDuration={300}
      disableHoverableContent={false}
      contentClass="h-auto! min-h-0! max-w-80 whitespace-normal p-0!"
      class="w-full {specNoteId && onTaskClick ? 'cursor-pointer' : ''}"
      onclick={() => specNoteId && onTaskClick?.(specNoteId)}
      showArrow
    >
      {@render progressBar()}
    </Tooltip>
  {/if}
{/key}

<style>
  .flame-progress-enter {
    animation: flame-progress-enter var(--motion-slow) var(--ease-emphasized-out) both;
  }

  .flame-status-segment {
    transition: flex-grow var(--motion-slow) var(--ease-emphasized-out);
    animation: flame-status-enter var(--motion-standard) var(--ease-standard) both;
  }

  @keyframes flame-progress-enter {
    from {
      clip-path: inset(0 100% 0 0 round var(--radius-small));
    }
    to {
      clip-path: inset(0 0 0 0 round var(--radius-small));
    }
  }

  @keyframes flame-status-enter {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .flame-progress-enter,
    .flame-status-segment {
      animation: none;
      transition: none;
    }
  }
</style>
