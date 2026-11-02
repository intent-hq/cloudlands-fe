import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorScreenReference } from '$shared/dock-evidence';
import { m } from '$shared/paraglide/messages.js';
import { formatInteger } from '$lib/i18n/format';

export interface ScreenReferenceOptions {
  references: () => readonly EditorScreenReference[];
}

/**
 * The range to delete for a chip at [from, to): also one neighbouring space,
 * so "a [chip] b" becomes "a b" and no space is left at a line start or end.
 */
export function chipDeletionRange(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): [from: number, to: number] {
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  const leaf = (node: ProseMirrorNode) => (node.type.name === 'hardBreak' ? '\n' : '\ufffc');
  const before = from > $from.start() ? doc.textBetween(from - 1, from, '\n', leaf) : '\n';
  const after = to < $to.end() ? doc.textBetween(to, to + 1, '\n', leaf) : '\n';
  if (after === ' ' && (before === ' ' || before === '\n')) return [from, to + 1];
  if (before === ' ' && after === '\n') return [from - 1, to];
  return [from, to];
}

/** An evidence reference occupies one editor position, independently of its label. */
export const ScreenReference = Node.create<ScreenReferenceOptions>({
  name: 'screenReference',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { references: () => [] };
  },

  addAttributes() {
    return {
      id: { default: '', renderHTML: () => ({}) },
      number: { default: 0, renderHTML: () => ({}) },
      label: { default: '', renderHTML: () => ({}) },
      kind: { default: null, renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-screen-reference]',
        getAttrs: (element) => {
          const id = element.getAttribute('data-screen-reference');
          const reference = this.options.references().find((value) => value.id === id);
          return reference ? { ...reference } : false;
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { id, number, label, kind } = node.attrs as EditorScreenReference;
    const displayNumber = formatInteger(number);
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-screen-reference': id,
        'data-reference-number': number,
        ...(kind ? { 'data-reference-kind': kind } : {}),
        class: 'screen-reference-chip',
        contenteditable: 'false',
        role: 'img',
        // A recording chip shows its own label ("Recording 2"); a mark shows its number.
        'aria-label': kind
          ? label
          : m.chat_screenReference_ariaLabel({ number: displayNumber, label }),
      }),
      kind ? label : displayNumber,
    ];
  },

  renderText({ node }) {
    const { number, kind } = node.attrs as EditorScreenReference;
    if (kind === 'clip-start') return `[[clip:${number}]]`;
    if (kind === 'clip-end') return `[[clip:${number}:end]]`;
    return `[[mark:${number}]]`;
  },

  addKeyboardShortcuts() {
    const removeAdjacent = (direction: 'before' | 'after') => {
      const { state, view } = this.editor;
      if (view.composing || !state.selection.empty) return false;
      const { $from, from } = state.selection;
      const adjacent = direction === 'before' ? $from.nodeBefore : $from.nodeAfter;
      if (adjacent?.type !== this.type) return false;
      const start = direction === 'before' ? from - adjacent.nodeSize : from;
      view.dispatch(
        state.tr.delete(...chipDeletionRange(state.doc, start, start + adjacent.nodeSize)),
      );
      return true;
    };
    return {
      Backspace: () => removeAdjacent('before'),
      Delete: () => removeAdjacent('after'),
    };
  },
});
