import type { Editor } from '@tiptap/core';
import { listenSync } from '$lib/electron-bridge';
import { Logger } from '$shared/logger';

const logger = new Logger('EditorListeners');

interface SetupListenersOptions {
  editor: Editor;
  showSuggestions: boolean;
  workspaceId?: string;
}

/**
 * Sets up event listeners for spec suggestions and updates from agents
 * Returns a cleanup function to remove all listeners
 */
export function setupEditorListeners(options: SetupListenersOptions): () => void {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { editor, showSuggestions, workspaceId } = options;
  const unlisteners: Array<() => void> = [];

  // Listen for note suggestions from agents
  if (showSuggestions) {
    try {
      const unlistenSuggestion = listenSync('note-suggestion', (event: any) => {
        const suggestion = event.payload;
        logger.debug('Received note suggestion:', suggestion);

        if (editor && suggestion?.type === 'addition') {
          editor
            .chain()
            .focus()
            .insertContent({
              type: 'text',
              text: suggestion.content,
              marks: [
                {
                  type: 'suggestion',
                  attrs: {
                    id: suggestion.id,
                    type: 'addition',
                    author: suggestion.author,
                    reason: suggestion.reason,
                  },
                },
              ],
            })
            .run();
        }
      });
      unlisteners.push(unlistenSuggestion);
    } catch (error) {
      logger.error('Failed to setup note-suggestion listener:', error);
    }
  }

  // Removed direct spec content updates on "note:updated".
  // NotesStore already listens for note:updated and updates the store.
  // The editor components (e.g., NoteWithComments) react to store changes and
  // handle selection/cursor preservation on content updates.
  // Keeping updates centralized prevents cursor jumps and double-applies.

  // Return cleanup function
  return () => {
    unlisteners.forEach((unlisten) => unlisten());
  };
}
