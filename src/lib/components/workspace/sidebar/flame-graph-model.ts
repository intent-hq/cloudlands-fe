import type { Note } from '$shared/types';
import { isSpecNote } from '$shared/constants/notes';
import { extractOrderedSpecTaskIds, extractSpecTaskIds } from '$shared/utils/task-stats';

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
export function buildTaskTree(notesList: Note[]): TaskTreeNode[] {
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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- The preceding guard initializes this key; preserve the source tree algorithm exactly.
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

export function flattenTasks(nodes: TaskTreeNode[]): TaskTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenTasks(node.children)]);
}
