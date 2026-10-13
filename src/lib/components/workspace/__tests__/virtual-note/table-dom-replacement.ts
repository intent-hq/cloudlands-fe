import type { JSONContent } from '@tiptap/core';
import type { Transaction, Selection } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import type { TableCommandSlice } from './table-native-command';

export type TableDOMReplacement = { path: number[]; anchor: number; head: number };
/** Remove only a proven unchanged mounted suffix. Backing resolves the rest of
 * that same revisioned paragraph; this request carries no full paragraph. */
export function captureTableDOMReplacement(tr: Transaction, selection: Selection) {
  const step = tr.steps.length === 1 ? tr.steps[0] : undefined;
  if (
    !(step instanceof ReplaceStep) ||
    !step.slice.openStart ||
    step.slice.openEnd ||
    selection.$to.parent.type.name !== 'paragraph' ||
    step.from !== selection.from ||
    step.to !== selection.$to.after()
  )
    return undefined;
  const suffix = selection.$to.parent.content.cut(selection.$to.parentOffset);
  let node = step.slice.content.lastChild;
  const path = [step.slice.content.childCount - 1];
  while (node && !node.isTextblock) {
    path.push(node.childCount - 1);
    node = node.lastChild;
  }
  if (
    !node ||
    node.type.name !== 'paragraph' ||
    suffix.size > node.content.size ||
    !node.content.cut(node.content.size - suffix.size).eq(suffix)
  )
    return undefined;
  const slice: TableCommandSlice = step.slice.toJSON() ?? {};
  let leaf: JSONContent = slice.content![path[0]];
  for (const index of path.slice(1)) leaf = leaf.content![index];
  leaf.content = node.content.cut(0, node.content.size - suffix.size).toJSON() ?? [];
  return {
    slice,
    dom: { path, anchor: tr.selection.anchor - step.from, head: tr.selection.head - step.from },
  };
}
