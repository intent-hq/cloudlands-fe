import { Code } from '@tiptap/extension-code';
import { mergeAttributes } from '@tiptap/core';
import {
  Plugin,
  PluginKey,
} from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

const codeMarkBoundaryPluginKey = new PluginKey('codeMarkBoundary');
const codeInputRulePluginKey = new PluginKey('codeInputRule');

/**
 * Check if we're in monospace mode by looking for the CSS class on a parent element.
 * This is more reliable than trying to import the Svelte store in a .ts file.
 */
function isMonospaceMode(view: EditorView | null): boolean {
  if (!view?.dom) return false;
  // Walk up the DOM tree looking for .note-font-monospace
  let el: Element | null = view.dom;
  while (el) {
    if (el.classList?.contains('note-font-monospace')) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * Custom Code extension that adapts behavior based on font mode.
 *
 * ## Normal Mode (Sans)
 * Works like standard TipTap code mark:
 * - Typing `code` converts to a styled code element
 * - Backticks are consumed and replaced with the mark
 *
 * ## Monospace Mode
 * Works like a code editor:
 * - Backticks remain as literal characters in the document
 * - Text between backticks is styled via decorations (purely visual)
 * - Editing feels natural - no special "mode" to be in/out of
 *
 * ## Technical Notes
 * - The mode is checked at runtime via the fontSettings store
 * - In monospace mode, input rules are skipped and decorations are used instead
 * - This allows seamless switching between modes without recreating the editor
 */
export const CustomCode = Code.extend({
  name: 'code',

  inclusive() {
    return false;
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'code',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        spellcheck: 'false',
      }),
      0,
    ];
  },

  // Don't use TipTap's addInputRules - we handle it via a plugin
  // that has proper access to the view for mode detection
  addInputRules() {
    return [];
  },

  addProseMirrorPlugins() {
    const codeMarkType = this.type;

    return [
      // Custom input rule plugin - handles backtick conversion (sans mode only)
      new Plugin({
        key: codeInputRulePluginKey,
        props: {
          handleTextInput(view, from, to, text) {
            // Only check when typing a backtick
            if (text !== '`') return false;

            // In monospace mode, backticks are literal characters - no conversion
            if (isMonospaceMode(view)) return false;

            const { state } = view;
            const $from = state.doc.resolve(from);

            // Get text before cursor in current text block
            const textBefore = $from.parent.textBetween(
              Math.max(0, $from.parentOffset - 100),
              $from.parentOffset,
              null,
              '\ufffc',
            );

            // Check if we have a pattern like `code (opening backtick + content)
            // and the user is typing the closing backtick
            const match = textBefore.match(/`([^`]+)$/);
            if (!match) return false;

            const codeContent = match[1];
            const backtickStart = from - codeContent.length - 1; // -1 for opening backtick

            // Create transaction to replace `code` with code mark
            const tr = state.tr;
            tr.delete(backtickStart, to); // Delete the `code` text including where closing backtick would go
            tr.insert(
              backtickStart,
              state.schema.text(codeContent, [codeMarkType.create()]),
            );
            tr.setStoredMarks([]); // Clear marks so next char isn't code

            view.dispatch(tr);
            return true; // Prevent default handling
          },
        },
      }),

      // Boundary detection plugin
      new Plugin({
        key: codeMarkBoundaryPluginKey,
        appendTransaction: (transactions, _oldState, newState) => {
          const selectionChanged = transactions.some((t) => t.selectionSet);
          if (!selectionChanged) return null;

          const { selection } = newState;
          const { $from, empty } = selection;

          if (!empty) return null;

          const nodeBefore = $from.nodeBefore;
          const nodeAfter = $from.nodeAfter;

          if (!nodeBefore) return null;

          const hasCodeBefore = nodeBefore.marks.some((m) => m.type === codeMarkType);
          const hasCodeAfter = nodeAfter?.marks?.some((m) => m.type === codeMarkType) ?? false;

          if (!hasCodeBefore || hasCodeAfter) return null;

          const currentStoredMarks = newState.storedMarks || $from.marks();
          const hasStoredCodeMark = currentStoredMarks.some((m) => m.type === codeMarkType);

          if (!hasStoredCodeMark) return null;

          const tr = newState.tr;
          const newMarks = currentStoredMarks.filter((m) => m.type !== codeMarkType);
          tr.setStoredMarks(newMarks);
          return tr;
        },
      }),
    ];
  },
});

export default CustomCode;
