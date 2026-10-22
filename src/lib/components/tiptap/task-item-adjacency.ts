import type { Node } from '@tiptap/pm/model';
import type { NoteId } from '$shared/types';

const TASK_LINK_REGEX = /^intent:\/\/local\/task\/(.+)$/;

/** Read this row's link, without descending into nested task lists. */
export function linkedTaskNoteId(node: Node): NoteId | null {
  let noteId: NoteId | null = null;
  node.content.forEach((child) => {
    child.content?.forEach((inline) => {
      if (!inline.isText) return;
      for (const mark of inline.marks) {
        const match = mark.type.name === 'link' && mark.attrs.href?.match(TASK_LINK_REGEX);
        if (match) {
          noteId = match[1] as NoteId;
          return;
        }
      }
    });
  });
  return noteId;
}

/** Adjacency is local to the containing task list; a plain row breaks the chain. */
export function previousTaskNoteId(
  doc: Node,
  pos: number | undefined,
  listType = 'taskList',
): NoteId | null {
  if (pos === undefined || pos < 0 || pos > doc.content.size) return null;
  const resolved = doc.resolve(pos);
  if (resolved.parent.type.name !== listType || resolved.index() === 0) return null;
  const previous = resolved.parent.child(resolved.index() - 1);
  return previous.type.name === 'taskItem' ? linkedTaskNoteId(previous) : null;
}
