<script lang="ts">
  import type { Note, TaskStatus } from '$shared/types';
  import { isSpecNote } from '$shared/constants/notes';
  import { TASK_LINK_REGEX_FLEXIBLE } from '$shared/constants/intent-links';
  import Fa from 'svelte-fa';
  import { faFileAlt } from '@fortawesome/free-solid-svg-icons';
  import { Tooltip } from '$lib/components/ui/tooltip';

  interface Props {
    notes: Note[];
    onCellClick?: (noteId: string) => void;
    onCellHover?: (noteId: string | null) => void;
    onSpecClick?: () => void;
    hoveredNoteId?: string | null;
    hasUnreadChanges?: (noteId: string) => boolean;
  }

  let {
    notes = [],
    onCellClick,
    onCellHover,
    onSpecClick,
    hoveredNoteId = null,
    hasUnreadChanges = () => false,
  }: Props = $props();

  // Tree node with computed weight (leaf count)
  interface TaskTreeNode {
    note: Note;
    children: TaskTreeNode[];
    weight: number;
    isLeaf: boolean;
  }

  interface RowCell {
    node: TaskTreeNode | null;
    colspan: number;
  }

  // Extract ordered task IDs from note content (order they appear in the markdown)
  function extractTaskOrderFromContent(content: string | undefined): string[] {
    if (!content) return [];
    const taskIds: string[] = [];
    // Use fresh regex instance to avoid lastIndex issues
    const taskLinkRegex = new RegExp(TASK_LINK_REGEX_FLEXIBLE.source, 'g');
    const matches = content.matchAll(taskLinkRegex);
    for (const match of matches) {
      const noteId = match[2];
      if (noteId && !taskIds.includes(noteId)) {
        taskIds.push(noteId);
      }
    }
    return taskIds;
  }

  // Sort notes by their order in the parent's content, falling back to peerOrder/createdAt
  function sortByContentOrder(notesToSort: Note[], parentContent: string | undefined): Note[] {
    const orderFromContent = extractTaskOrderFromContent(parentContent);
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
    const roots = taskNotes.filter((n) => isSpecNote(n.parentId as string));

    // Sort roots by their order in the spec note content
    const sortedRoots = sortByContentOrder(roots, specNote?.content);

    return sortedRoots.map(buildNode);
  }

  function treeToRows(roots: TaskTreeNode[]): RowCell[][] {
    if (roots.length === 0) return [];
    // Only return the first depth (root level)
    const firstRow: RowCell[] = roots.map((node) => ({ node, colspan: 1 }));
    return [firstRow];
  }

  function getStatusColor(status: TaskStatus): string {
    switch (status) {
      case 'complete':
        return 'bg-emerald-500';
      case 'in_progress':
        return 'bg-sky-400';
      case 'review_required':
        return 'bg-blue-500';
      case 'waiting':
        return 'bg-muted';
      default:
        return 'bg-muted/60';
    }
  }

  const taskTree = $derived(buildTaskTree(notes));
  const flameRows = $derived(treeToRows(taskTree));
  const hasFocus = $derived(hoveredNoteId !== null);
  const taskCount = $derived(taskTree.length);
  const tooltipContent = $derived(() => {
    const items = flameRows[0]?.filter((c) => c.node?.note.title) || [];
    const maxItems = 5;
    const visibleItems = items.slice(0, maxItems);
    const remaining = items.length - maxItems;
    const maxTitleLength = 50;
    const truncateTitle = (title: string) =>
      title.length > maxTitleLength ? title.slice(0, maxTitleLength) + '…' : title;
    const itemsList = visibleItems
      .map((c) => `\n •  ${truncateTitle(c.node?.note.title || '')}`)
      .join('');
    const moreText = remaining > 0 ? `\n + ${remaining} more` : '';
    return `${taskCount} task${taskCount === 1 ? '' : 's'} in the Spec note${itemsList}${moreText}`;
  });
</script>

{#if flameRows.length > 0}
  <div class="w-full flex items-center gap-1.5">
    <!-- Doc icon to open spec -->
    <Tooltip content={tooltipContent()} side="bottom" align="start" sideOffset={4} showArrow>
      <button
        type="button"
        class="shrink-0 p-0.5 text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer"
        onclick={() => onSpecClick?.()}
        aria-label="Open spec"
      >
        <Fa icon={faFileAlt} size="xs" />
      </button>
    </Tooltip>

    <table class="flex-1 flex">
      <tbody class="flex-1 flex">
        {#each flameRows as row, rowIndex (`row-${rowIndex}`)}
          <tr class="h-3 flex flex-1 justify-end">
            {#each row as cell, cellIndex (`cell-${rowIndex}-${cellIndex}`)}
              {#if cell.node}
                {@const noteId = cell.node.note.id as string}
                {@const isUnread = hasUnreadChanges(noteId)}
                {@const isFocused = noteId === hoveredNoteId}
                {@const status = cell.node.note.metadata?.task?.status ?? 'not_started'}
                <td
                  colspan={cell.colspan}
                  class="flex-1 p-[0.5px] min-w-0.75 relative transition-all duration-150 {cellIndex ===
                  0
                    ? 'rounded-l-xs'
                    : cellIndex === row.length - 1
                      ? 'rounded-r-xs'
                      : ''}"
                  class:opacity-40={hasFocus && !isFocused}
                  class:scale-y-120={isFocused}
                  onmouseenter={() => onCellHover?.(noteId)}
                  onmouseleave={() => onCellHover?.(null)}
                >
                  <button
                    type="button"
                    class="block w-full h-full min-h-2.5 border-none cursor-pointer px-[0.5px] relative transition-all hover:brightness-110 {cellIndex ===
                    0
                      ? 'rounded-l-xs'
                      : cellIndex === row.length - 1
                        ? 'rounded-r-xs'
                        : ''} {getStatusColor(status)}"
                    style="anchor-name: --task-{noteId}"
                    onclick={() => onCellClick?.(noteId)}
                    aria-label={cell.node.note.title}
                  >
                    {#if isUnread}
                      <span
                        class="absolute top-1/2 -translate-y-1/2 left-1 size-0.75 bg-background rounded-full"
                      ></span>
                    {/if}
                  </button>
                </td>
              {:else}
                <td colspan={cell.colspan} class="bg-transparent"></td>
              {/if}
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
