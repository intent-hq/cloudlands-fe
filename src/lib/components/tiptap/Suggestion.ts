import { Mark, mergeAttributes } from '@tiptap/core';

export interface SuggestionOptions {
  HTMLAttributes: Record<string, any>;
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
            const { doc } = state;
            let found = false;

            doc.descendants((node, pos) => {
              node.marks.forEach((mark) => {
                if (mark.type.name === this.name && mark.attrs.id === id) {
                  found = true;
                  const from = pos;
                  const to = pos + node.nodeSize;

                  if (mark.attrs.type === 'deletion') {
                  // Remove the content for deletions
                    if (dispatch) {
                      tr.delete(from, to);
                    }
                  } else {
                  // Remove the suggestion mark for additions/modifications
                    if (dispatch) {
                      tr.removeMark(from, to, mark.type);
                    }
                  }
                }
              });
            });

            if (dispatch && found) {
              dispatch(tr);
            }

            return found;
          },
      rejectSuggestion:
        (id: string) =>
          ({ state, dispatch, tr }) => {
            const { doc } = state;
            let found = false;

            doc.descendants((node, pos) => {
              node.marks.forEach((mark) => {
                if (mark.type.name === this.name && mark.attrs.id === id) {
                  found = true;
                  const from = pos;
                  const to = pos + node.nodeSize;

                  if (mark.attrs.type === 'addition') {
                  // Remove the content for additions
                    if (dispatch) {
                      tr.delete(from, to);
                    }
                  } else {
                  // Remove the suggestion mark for deletions/modifications
                    if (dispatch) {
                      tr.removeMark(from, to, mark.type);
                    }
                  }
                }
              });
            });

            if (dispatch && found) {
              dispatch(tr);
            }

            return found;
          },
    };
  },
});
