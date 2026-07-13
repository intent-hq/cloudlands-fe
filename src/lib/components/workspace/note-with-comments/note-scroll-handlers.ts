import type { Editor } from '@tiptap/core';

import type { LoggerLike } from './logger.types';

export function createScrollToHeadingHandler({
  getEditor,
  getElement,
}: {
  getEditor: () => Editor | null | undefined;
  getElement: () => HTMLElement | null | undefined;
}): (e: any) => void {
  return (e: any) => {
    try {
      const text = e?.detail?.text as string | undefined;
      if (!text) return;

      const container = getElement();
      if (!container) return;

      const headings = container.querySelectorAll('h1,h2,h3,h4,h5,h6');
      for (const h of Array.from(headings)) {
        if (h.textContent?.trim() === text.trim()) {
          (h as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' });

          try {
            const editor = getEditor();
            const pos = (editor as any)?.view?.posAtDOM?.(h, 0);
            if (typeof pos === 'number' && pos >= 0) {
              editor?.commands?.focus?.();
              editor?.commands?.setTextSelection?.({ from: pos, to: pos });
            }
          } catch {
            // Best-effort: selection sync should never break navigation.
          }

          break;
        }
      }
    } catch {
      // Best-effort: navigation should not crash the editor.
    }
  };
}

export function createScrollToTaskHandler({
  getEditor,
  getElement,
  getNoteId,
  highlightTaskAtPosition,
  logger,
}: {
  getEditor: () => Editor | null | undefined;
  getElement: () => HTMLElement | null | undefined;
  getNoteId: () => string | null | undefined;
  highlightTaskAtPosition: (position: number) => void;
  logger: LoggerLike;
}): (e: any) => void {
  return (e: any) => {
    try {
      const { noteId: targetNoteId, taskPosition, taskText } = e?.detail || {};

      // Only handle if this is the correct note
      const currentNoteId = getNoteId();
      if (targetNoteId && currentNoteId !== targetNoteId) return;

      const editor = getEditor();
      if (!editor?.view) {
        logger.warn('[NoteWithComments] Cannot scroll to task - editor not ready');
        return;
      }

      // Try to scroll to the task by position first
      if (typeof taskPosition === 'number' && taskPosition >= 0) {
        const doc = editor.state.doc;
        // Ensure position is within document bounds
        if (taskPosition <= doc.content.size) {
          logger.info('[NoteWithComments] Scrolling to task by position', { taskPosition });
          editor.commands.smoothScrollToPos(taskPosition, {
            offset: 80,
            block: 'center',
          });
          // Briefly highlight the task
          highlightTaskAtPosition(taskPosition);
          return;
        }
      }

      // Fallback: search for the task by text content
      if (taskText) {
        logger.info('[NoteWithComments] Searching for task by text', { taskText });
        const container = getElement();
        if (!container) return;

        // Find task items in the editor
        const taskItems = container.querySelectorAll('[data-type="taskItem"]');
        for (const taskItem of Array.from(taskItems)) {
          const itemText = taskItem.textContent?.trim();
          if (itemText && itemText.includes(taskText.trim().substring(0, 50))) {
            (taskItem as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' });
            // Add flash effect
            taskItem.classList.add('task-highlight-flash');
            setTimeout(() => taskItem.classList.remove('task-highlight-flash'), 2000);
            return;
          }
        }
      }

      logger.warn('[NoteWithComments] Could not find task to scroll to', {
        taskPosition,
        taskText,
      });
    } catch (err) {
      logger.error('[NoteWithComments] Error scrolling to task', err);
    }
  };
}
