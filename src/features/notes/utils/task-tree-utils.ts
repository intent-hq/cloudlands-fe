/**
 * Task Tree Utilities
 *
 * Utilities for traversing and analyzing task hierarchies.
 */

import type { Note, TaskStatus } from '$shared/types';

const TERMINAL_STATUSES: TaskStatus[] = ['complete', 'cancelled'];

/**
 * Check if a task status is terminal (complete or cancelled)
 */
function isTerminalStatus(status: TaskStatus | undefined): boolean {
  return status !== undefined && TERMINAL_STATUSES.includes(status);
}

/**
 * Sort notes by peerOrder, then by createdAt as fallback
 */
function sortByPeerOrderThenCreated(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    const aPeerOrder = a.metadata?.task?.peerOrder ?? 0;
    const bPeerOrder = b.metadata?.task?.peerOrder ?? 0;
    if (aPeerOrder !== bPeerOrder) {
      return aPeerOrder - bPeerOrder;
    }
    // Fallback: older tasks first (by createdAt)
    const aCreated = (a.createdAt || a.created_at || '') as string;
    const bCreated = (b.createdAt || b.created_at || '') as string;
    return aCreated.localeCompare(bCreated);
  });
}

/**
 * Flatten the task tree into an ordered list.
 *
 * Uses post-order traversal (children before parents):
 * 1. Process all children first (recursively)
 * 2. Then add the parent
 * 3. Siblings are ordered by peerOrder (ascending), then createdAt (older first)
 *
 * This gives us deepest leaf tasks first, working up to root tasks.
 * Terminal tasks (complete, cancelled) are excluded.
 *
 * @param notes - All task notes to consider
 * @returns Ordered flat list of non-terminal tasks (leaves first)
 */
export function flattenTaskTree(notes: Note[]): Note[] {
  // Filter to only task notes that are not terminal
  const taskNotes = notes.filter(
    (n) => n.metadata?.task && !isTerminalStatus(n.metadata.task.status),
  );

  if (taskNotes.length === 0) {
    return [];
  }

  // Build a map of parentId -> children
  const childrenMap = new Map<string | undefined, Note[]>();
  for (const note of taskNotes) {
    const parentId = note.parentId as string | undefined;
    let children = childrenMap.get(parentId);
    if (!children) {
      children = [];
      childrenMap.set(parentId, children);
    }
    children.push(note);
  }

  // Sort children at each level
  for (const [parentId, children] of childrenMap) {
    childrenMap.set(parentId, sortByPeerOrderThenCreated(children));
  }

  // Post-order DFS traversal (children first, then parent)
  // This gives us: deepest children first, then their parents, then root-level tasks
  const result: Note[] = [];

  function traverse(parentId: string | undefined) {
    const children = childrenMap.get(parentId) || [];
    for (const child of children) {
      // First recurse into children
      traverse(child.id as string);
      // Then add this node
      result.push(child);
    }
  }

  traverse(undefined);

  return result;
}

/**
 * Find all tasks that are ready to be worked on.
 *
 * A task is "ready" if:
 * 1. It is not in a terminal status (complete, cancelled)
 * 2. All its explicit dependencies are complete
 * 3. All its children are complete (parent blocked by children)
 *
 * Note: Siblings do NOT block each other unless explicitly flagged as sequential
 * (a feature we don't have yet).
 *
 * Takes the flattened task list as input to preserve its ordering.
 *
 * @param flattenedTasks - The ordered flat list from flattenTaskTree()
 * @param allNotes - All notes for dependency lookups (includes complete tasks)
 * @returns List of ready tasks, preserving the flattened order
 */
export function findReadyTasks(flattenedTasks: Note[], allNotes: Note[]): Note[] {
  if (flattenedTasks.length === 0) {
    return [];
  }

  // Build a map of noteId -> note for quick lookup (include all notes for dependency checks)
  const noteMap = new Map<string, Note>();
  for (const note of allNotes) {
    noteMap.set(note.id as string, note);
  }

  // Build a map of parentId -> children (for checking if parent is blocked by children)
  const childrenMap = new Map<string, Note[]>();
  for (const note of allNotes) {
    if (note.metadata?.task && note.parentId) {
      const parentId = note.parentId as string;
      let children = childrenMap.get(parentId);
      if (!children) {
        children = [];
        childrenMap.set(parentId, children);
      }
      children.push(note);
    }
  }

  // Check if all children (subtasks) of a task are complete
  // Note: Task orchestration now uses parentId hierarchy - children ARE the dependencies
  function areChildrenComplete(note: Note): boolean {
    const children = childrenMap.get(note.id as string) || [];
    for (const child of children) {
      if (child.metadata?.task && child.metadata.task.status !== 'complete') {
        return false;
      }
    }
    return true;
  }

  // A task is ready if all its children (subtasks) are complete
  function isReady(note: Note): boolean {
    return areChildrenComplete(note);
  }

  // Filter the flattened list to only ready tasks, preserving order
  return flattenedTasks.filter(isReady);
}
