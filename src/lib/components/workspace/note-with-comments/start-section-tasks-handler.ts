import type { Editor } from '@tiptap/core';
import type { Store } from '@augmentcode/ag-redux-toolkit/svelte-store';

import { updateNoteContent } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';

import type { LoggerLike } from './logger.types';

export async function runStartSectionTasks({
  noteId,
  workspaceId,
  editor,
  headingText,
  tasks,
  assignAgent,
  processHTMLToMarkdown,
  dispatch,
  setLastKnownContent,
  logger,
}: {
  noteId: string | null | undefined;
  workspaceId: string | null | undefined;
  editor: Editor | null | undefined;
  headingText: string;
  tasks: Array<{ pos: number; text: string }>;
  assignAgent: (taskData: any, options?: { skipSave?: boolean }) => Promise<unknown>;
  processHTMLToMarkdown: (
    html: string,
    options?: { preserveAnchors?: boolean },
  ) => string | Promise<string>;
  dispatch: Store<any, any>['dispatch'];
  setLastKnownContent: (value: string) => void;
  logger: LoggerLike;
}): Promise<void> {
  if (!noteId || !workspaceId) {
    logger.error('Cannot start section tasks: no noteId or workspace');
    return;
  }

  logger.info('Starting all tasks in section', {
    sectionHeading: headingText,
    taskCount: tasks.length,
  });

  // Process tasks in parallel for better performance
  // Each task is independent - they don't depend on each other
  // Task-agent associations are persisted to localStorage immediately when the
  // optimistic agent ID is set, so external content updates won't lose the association
  // Pass skipSave: true to avoid multiple debounced saves - we do an explicit save at the end
  const taskPromises = tasks.map((task) => {
    const taskData = {
      text: task.text,
      position: task.pos,
      checked: false,
    };
    return assignAgent(taskData, { skipSave: true });
  });

  // Wait for all tasks to complete (or fail independently)
  const results = await Promise.allSettled(taskPromises);

  // Log any failures
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failures.length > 0) {
    logger.warn('Some tasks failed to start', {
      failedCount: failures.length,
      totalCount: tasks.length,
      errors: failures.map((f) => (f.reason as any)?.message || String(f.reason)),
    });
  }

  // Trigger a save after all conversions complete
  // The convertToLinkedTask operations use external-update meta to avoid triggering
  // debounced saves during the bulk operation, so we need to explicitly save here
  const successCount = results.filter((r) => r.status === 'fulfilled').length;
  if (successCount > 0 && editor) {
    logger.info('Saving note after bulk task delegation', {
      successCount,
      totalCount: tasks.length,
    });

    try {
      const htmlContent = editor.getHTML();
      const markdownContent = await processHTMLToMarkdown(htmlContent, {
        preserveAnchors: true,
      });

      // Update last known content
      setLastKnownContent(markdownContent);

      // Update Redux store to persist
      dispatch(updateNoteContent(workspaceId, noteId, markdownContent));
      logger.info('Note saved after bulk task delegation');
    } catch (error) {
      logger.error('Failed to save note after bulk task delegation', error);
    }
  }
}
