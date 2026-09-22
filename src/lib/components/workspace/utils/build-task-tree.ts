import { isSpecNote } from '$shared/constants/notes';
import type { Note } from '$shared/types';
import { extractSpecTaskIds } from '$shared/utils/task-stats';
import { sortByContentOrder } from './sort-by-content-order';

export interface TaskTreeNode {
  note: Note;
  children: TaskTreeNode[];
  weight: number;
  isLeaf: boolean;
}

export function buildTaskTree(notes: Note[]): TaskTreeNode[] {
  const specNote = notes.find((note) => isSpecNote(note.id as string));
  const seenIds = new Set<string>();
  const allTaskNotes = notes.filter((note) => {
    if (
      !note.metadata?.task ||
      isSpecNote(note.id as string) ||
      note.metadata.task.status === 'cancelled'
    ) {
      return false;
    }
    const noteId = note.id as string;
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

  const taskNotes = allTaskNotes.filter((note) => specDescendantIds.has(note.id as string));
  const childrenMap = new Map<string | undefined, Note[]>();
  for (const note of taskNotes) {
    const rawParentId = note.parentId as string | undefined;
    const parentId = rawParentId && !isSpecNote(rawParentId) ? rawParentId : undefined;
    const siblings = childrenMap.get(parentId) ?? [];
    siblings.push(note);
    childrenMap.set(parentId, siblings);
  }

  function buildNode(note: Note): TaskTreeNode {
    const childNotes = childrenMap.get(note.id as string) ?? [];
    const children = sortByContentOrder(childNotes, note.content).map(buildNode);
    const isLeaf = children.length === 0;
    const weight = isLeaf ? 1 : children.reduce((sum, child) => sum + child.weight, 0);
    return { note, children, weight, isLeaf };
  }

  const specTaskIds = extractSpecTaskIds(specNote?.content);
  const hasSpecLinks = specTaskIds.size > 0;
  const roots = taskNotes.filter(
    (note) =>
      isSpecNote(note.parentId as string) && (!hasSpecLinks || specTaskIds.has(note.id as string)),
  );

  return sortByContentOrder(roots, specNote?.content).map(buildNode);
}
