import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('SmoothScroll');

interface SmoothScrollOptions {
  behavior?: ScrollBehavior;
  block?: ScrollLogicalPosition;
  inline?: ScrollLogicalPosition;
  offset?: number;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    smoothScroll: {
      /**
       * Smoothly scroll to a position in the editor
       */
      smoothScrollToPos: (position: number, options?: SmoothScrollOptions) => ReturnType;
      /**
       * Smoothly scroll to a heading by text
       */
      smoothScrollToHeading: (headingText: string, options?: SmoothScrollOptions) => ReturnType;
      /**
       * Smoothly scroll the current selection into view
       */
      smoothScrollIntoView: (options?: SmoothScrollOptions) => ReturnType;
    };
  }
}

const SmoothScroll = Extension.create({
  name: 'smoothScroll',

  addCommands() {
    return {
      // Smooth scroll to a specific position
      smoothScrollToPos:
        (position: number, options: SmoothScrollOptions = {}) =>
          ({ editor, view, state }: { editor: Editor; view: EditorView; state: EditorState }) => {
            const { behavior = 'smooth', offset = 100, block = 'start' } = options;

            try {
            // Get the resolved position
              const $pos = state.doc.resolve(position);

              // Check if this position points to a block node (like a heading)
              const node = $pos.nodeAfter;

              if (node && node.isBlock && node.isTextblock) {
              // For text block nodes (like headings), set cursor at the start of the text content
              // The position + 1 moves us from the node position to inside the node
                const textStartPos = position + 1;

                // Use TipTap's built-in setTextSelection which handles edge cases better
                editor.commands.setTextSelection(textStartPos);
              } else if (node && node.isBlock) {
              // For non-textblock nodes, just focus without setting selection
                editor.commands.focus();
              } else {
              // For inline positions, set selection normally
                editor.commands.setTextSelection(position);
              }
            } catch (e) {
            // If any selection operation fails, just focus the editor
              logger.debug('Could not set selection, focusing editor instead', { error: e });
              editor.commands.focus();
            }

            // Defer scrolling to next tick to ensure DOM is updated
            setTimeout(() => {
              try {
              // Get the DOM node for the position
                const domNode = view.nodeDOM(position);

                if (domNode instanceof HTMLElement) {
                // Find the scrollable parent container
                  const findScrollableParent = (element: HTMLElement): HTMLElement | null => {
                    let parent = element.parentElement;
                    while (parent) {
                      const style = window.getComputedStyle(parent);
                      const overflow = style.overflow + style.overflowY;
                      if (overflow.includes('auto') || overflow.includes('scroll')) {
                        return parent;
                      }
                      parent = parent.parentElement;
                    }
                    return null;
                  };

                  const scrollableContainer = findScrollableParent(domNode);

                  if (scrollableContainer) {
                  // Scroll within the container
                    const containerRect = scrollableContainer.getBoundingClientRect();
                    const nodeRect = domNode.getBoundingClientRect();

                    // Calculate the position relative to the container
                    const relativeTop =
                    nodeRect.top - containerRect.top + scrollableContainer.scrollTop;

                    // Calculate scroll position based on block alignment
                    let scrollTop = relativeTop - offset;

                    if (block === 'center') {
                      const containerHeight = scrollableContainer.clientHeight;
                      scrollTop = relativeTop - containerHeight / 2 + nodeRect.height / 2;
                    } else if (block === 'end') {
                      const containerHeight = scrollableContainer.clientHeight;
                      scrollTop = relativeTop - containerHeight + nodeRect.height + offset;
                    }

                    // Smooth scroll the container
                    scrollableContainer.scrollTo({
                      top: Math.max(0, scrollTop),
                      behavior,
                    });
                  } else {
                  // No scrollable container found, try window scroll as fallback
                    const rect = domNode.getBoundingClientRect();
                    const absoluteTop = rect.top + window.scrollY;

                    // Calculate scroll position based on block alignment
                    let scrollTop = absoluteTop - offset;

                    if (block === 'center') {
                      const viewportHeight = window.innerHeight;
                      scrollTop = absoluteTop - viewportHeight / 2 + rect.height / 2;
                    } else if (block === 'end') {
                      const viewportHeight = window.innerHeight;
                      scrollTop = absoluteTop - viewportHeight + rect.height + offset;
                    }

                    window.scrollTo({
                      top: Math.max(0, scrollTop),
                      behavior,
                    });
                  }
                } else {
                // Fallback: use TipTap's built-in scrollIntoView
                  const { from } = editor.state.selection;
                  const domAtCursor = view.domAtPos(from);
                  if (domAtCursor.node instanceof HTMLElement) {
                    domAtCursor.node.scrollIntoView({
                      behavior: behavior as ScrollBehavior,
                      block: block as ScrollLogicalPosition,
                      inline: 'nearest',
                    });
                  }
                }
              } catch (e) {
                logger.debug('Could not scroll to position', { error: e });
              }
            }, 0);

            return true;
          },

      // Smooth scroll to a heading by text
      smoothScrollToHeading:
        (headingText: string, options: SmoothScrollOptions = {}) =>
          ({ editor, state }: { editor: Editor; state: EditorState }) => {
            let targetPos: number | null = null;

            state.doc.descendants((node, pos) => {
              if (node.type.name === 'heading' && node.textContent === headingText) {
                targetPos = pos;
                return false; // Stop searching
              }
            });

            if (targetPos !== null) {
              return editor.commands.smoothScrollToPos(targetPos, options);
            }

            return false;
          },

      // Smooth scroll to selection with custom behavior
      smoothScrollIntoView:
        (options: SmoothScrollOptions = {}) =>
          ({ state, view }: { state: EditorState; view: EditorView }) => {
            const { from } = state.selection;

            setTimeout(() => {
              const domNode = view.nodeDOM(from);
              if (domNode instanceof HTMLElement) {
                domNode.scrollIntoView({
                  behavior: 'smooth',
                  block: options.block || 'center',
                  inline: options.inline || 'nearest',
                });
              }
            }, 0);

            return true;
          },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Optional: Add keyboard shortcuts for smooth scrolling
      'Mod-g': () => {
        // Example: Smooth scroll to top
        this.editor.commands.smoothScrollToPos(0);
        return true;
      },
    };
  },
});

export default SmoothScroll;
