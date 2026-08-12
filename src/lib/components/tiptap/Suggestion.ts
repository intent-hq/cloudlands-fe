import { Mark, mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface SuggestionOptions {
  HTMLAttributes: Record<string, any>;
}

type SuggestionRange = {
  from: number;
  to: number;
  type: 'addition' | 'deletion' | 'modification';
  originalText?: string;
};

function findSuggestionRanges(
  doc: ProseMirrorNode,
  markName: string,
  id: string,
): SuggestionRange[] {
  const ranges: SuggestionRange[] = [];
  doc.descendants((node, pos) => {
    const mark = node.marks.find(
      (candidate) => candidate.type.name === markName && candidate.attrs.id === id,
    );
    if (!mark) return;
    const previous = ranges.at(-1);
    const type = mark.attrs.type as SuggestionRange['type'];
    const originalText = mark.attrs.originalText as string | undefined;
    if (
      previous &&
      previous.to === pos &&
      previous.type === type &&
      previous.originalText === originalText
    ) {
      previous.to = pos + node.nodeSize;
      return;
    }
    ranges.push({ from: pos, to: pos + node.nodeSize, type, originalText });
  });
  return ranges;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    suggestion: {
      /**
       * Set a suggestion mark
       */
      setSuggestion: (attributes?: {
        id: string;
        type: 'addition' | 'deletion' | 'modification';
        author?: string;
        reason?: string;
        originalText?: string;
      }) => ReturnType;
      /**
       * Toggle a suggestion mark
       */
      toggleSuggestion: (attributes?: {
        id: string;
        type: 'addition' | 'deletion' | 'modification';
        author?: string;
        reason?: string;
        originalText?: string;
      }) => ReturnType;
      /**
       * Unset a suggestion mark
       */
      unsetSuggestion: () => ReturnType;
      /**
       * Accept a suggestion
       */
      acceptSuggestion: (id: string) => ReturnType;
      /**
       * Reject a suggestion
       */
      rejectSuggestion: (id: string) => ReturnType;
    };
  }
}

export const Suggestion = Mark.create<SuggestionOptions>({
  name: 'suggestion',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-suggestion-id'),
        renderHTML: (attributes) => {
          if (!attributes.id) {
            return {};
          }
          return {
            'data-suggestion-id': attributes.id,
          };
        },
      },
      type: {
        default: 'addition',
        parseHTML: (element) => element.getAttribute('data-suggestion-type'),
        renderHTML: (attributes) => ({
          'data-suggestion-type': attributes.type,
        }),
      },
      author: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-suggestion-author'),
        renderHTML: (attributes) => {
          if (!attributes.author) {
            return {};
          }
          return {
            'data-suggestion-author': attributes.author,
          };
        },
      },
      reason: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-suggestion-reason'),
        renderHTML: (attributes) => {
          if (!attributes.reason) {
            return {};
          }
          return {
            'data-suggestion-reason': attributes.reason,
          };
        },
      },
      originalText: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-suggestion-original'),
        renderHTML: (attributes) => {
          if (!attributes.originalText) {
            return {};
          }
          return {
            'data-suggestion-original': attributes.originalText,
          };
        },
      },
      status: {
        default: 'pending',
        parseHTML: (element) => element.getAttribute('data-suggestion-status') || 'pending',
        renderHTML: (attributes) => ({
          'data-suggestion-status': attributes.status || 'pending',
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-suggestion-id]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes);

    // Add CSS classes based on suggestion type and status
    const type = attrs['data-suggestion-type'] || 'addition';
    const status = attrs['data-suggestion-status'] || 'pending';

    let className = 'suggestion';

    // Type-based classes
    if (type === 'addition') {
      className += ' suggestion-addition';
    } else if (type === 'deletion') {
      className += ' suggestion-deletion';
    } else if (type === 'modification') {
      className += ' suggestion-modification';
    }

    // Status-based classes
    if (status === 'accepted') {
      className += ' suggestion-accepted';
    } else if (status === 'rejected') {
      className += ' suggestion-rejected';
    } else {
      className += ' suggestion-pending';
    }

    attrs.class = className;

    return ['span', attrs, 0];
  },

  addCommands() {
    return {
      setSuggestion:
        (attributes) =>
        ({ commands }) =>
          commands.setMark(this.name, attributes),
      toggleSuggestion:
        (attributes) =>
        ({ commands }) =>
          commands.toggleMark(this.name, attributes),
      unsetSuggestion:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
      acceptSuggestion:
        (id: string) =>
        ({ state, dispatch, tr }) => {
          const ranges = findSuggestionRanges(state.doc, this.name, id);
          if (dispatch && ranges.length > 0) {
            for (const range of [...ranges].reverse()) {
              if (range.type === 'deletion') tr.delete(range.from, range.to);
              else tr.removeMark(range.from, range.to, this.type);
            }
            dispatch(tr);
          }
          return ranges.length > 0;
        },
      rejectSuggestion:
        (id: string) =>
        ({ state, dispatch, tr }) => {
          const ranges = findSuggestionRanges(state.doc, this.name, id);
          if (dispatch && ranges.length > 0) {
            for (const range of [...ranges].reverse()) {
              if (range.type === 'addition') tr.delete(range.from, range.to);
              else if (range.type === 'modification' && range.originalText) {
                tr.replaceWith(range.from, range.to, state.schema.text(range.originalText));
              } else {
                tr.removeMark(range.from, range.to, this.type);
              }
            }
            dispatch(tr);
          }
          return ranges.length > 0;
        },
    };
  },
});
