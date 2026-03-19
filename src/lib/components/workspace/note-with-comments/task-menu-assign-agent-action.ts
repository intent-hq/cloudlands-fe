import type { Editor } from '@tiptap/core';

import { notesClient } from '$features/notes/notes.client';
import { notesStateManager } from '$features/notes/notes.store.svelte';
import { buildTaskNoteContent } from '$features/notes/utils/task-agent-message-builder';
import { selectWorkspaceDefaultModel } from '$lib/store/slices/model/model-selectors';
import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
import {
  addTaskAgentAssociation,
  removeTaskAgentAssociation,
} from '$lib/utils/task-agent-associations';
import type { Workspace } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
import { unifiedIdService } from '$shared/services/unified-id.service';
import { stripMarkdownFormatting } from '$shared/utils-client';
import { taskNoteUrl } from '$shared/constants/intent-links';

import type { LoggerLike } from './logger.types';
import { getTaskIndexInDocument, restoreTaskAgentAssociations } from './task-item-utils';

export type AssignAgentTaskMenuActionOptions = {
  skipSave?: boolean;
};

export async function runAssignAgentTaskMenuAction({
  editor,
  workspace,
  noteId,
  taskData,
  options,
  debounceUpdate,
  dispatch,
  logger,
}: {
  editor: Editor | null | undefined;
  workspace: Workspace;
  noteId: string | null | undefined;
  taskData: any;
  options?: AssignAgentTaskMenuActionOptions;
  debounceUpdate: () => void;
  dispatch: (type: 'agentLaunched', detail: any) => void;
  logger: LoggerLike;
}): Promise<void> {
  const taskText = taskData.text || 'Unknown task';
  const taskPosition = parseInt(taskData.position) || 0;

  // Graduation flow: Create Task Note + Agent, then convert checklist item to linked task
  //
  // This flow (with optimistic updates):
  // 1. Generate agent ID immediately and set on task item (shows "Spinning up...")
  // 2. Call backend to create Task Note + Agent (non-blocking)
  // 3. When backend completes, convert checklist item to linked task

  if (!noteId) {
    logger.error('Cannot graduate task: no noteId available');
    return;
  }

  // Step 1: Generate IDs immediately for optimistic UI
  const optimisticAgentId = unifiedIdService.generateAgentId();
  const optimisticNoteId = unifiedIdService.generateNoteId();

  // Step 2: Set delegatedAgentId on task item immediately (shows "Spinning up...")
  // Use external-update meta to prevent triggering onUpdate/debounceUpdate for better perf
  if (editor) {
    const setResult = editor
      .chain()
      .command(({ tr }) => {
        tr.setMeta('external-update', true);
        return true;
      })
      .command(({ tr, state }) => {
        const node = state.doc.nodeAt(taskPosition);
        if (node && node.type.name === 'taskItem') {
          tr.setNodeMarkup(taskPosition, undefined, {
            ...node.attrs,
            delegatedAgentId: optimisticAgentId,
          });
          return true;
        }
        return false;
      })
      .run();

    if (setResult) {
      logger.info('Optimistically set agent ID on task item', {
        taskPosition,
        agentId: optimisticAgentId,
      });

      // Step 2b: Persist the task-agent association to localStorage immediately
      // This ensures the association survives external content updates that may
      // replace the editor content before the backend operation completes
      addTaskAgentAssociation(workspace.id, noteId, taskText, optimisticAgentId);
      logger.debug('Persisted task-agent association for optimistic update', {
        taskText,
        agentId: optimisticAgentId,
      });
    }
  }

  // Step 3: Get parent note info and build content
  const parentNote = notesStateManager.findById(NoteId(noteId));
  const parentNoteTitle = parentNote?.title || 'parent note';
  const taskNoteContent = buildTaskNoteContent(taskText, noteId, parentNoteTitle);

  // Step 4: Add optimistic note to store immediately (shows in sidebar)
  const now = new Date().toISOString();
  const sanitizedTitle = stripMarkdownFormatting(taskText);
  const optimisticNote = {
    id: optimisticNoteId,
    workspaceId: workspace.id,
    title: sanitizedTitle,
    content: taskNoteContent,
    tags: [],
    contentType: 'task' as const,
    visibility: 'private' as const,
    taskStatus: 'not_started' as const,
    createdAt: now,
    updatedAt: now,
    created_at: now,
    updated_at: now,
    is_pinned: false,
    is_archived: false,
  };
  notesStateManager.addOptimisticNote(optimisticNote as any);

  logger.info('Added optimistic Task Note', {
    noteId: optimisticNoteId,
    title: taskText,
  });

  // Step 5: Call backend (async - UI already updated)
  try {
    // Calculate peerOrder based on task's position in document (preserves document order)
    const taskIndex = getTaskIndexInDocument(editor, taskPosition);
    const peerOrder = (taskIndex + 1) * 100;

    logger.info('Graduating checklist item to Task Note', {
      taskText,
      taskPosition,
      taskIndex,
      peerOrder,
      parentNoteId: noteId,
      parentNoteTitle,
      optimisticAgentId,
      optimisticNoteId,
    });

    // Create the Task Note with agent via createPrerequisiteNote
    // Pass the pre-generated agent ID so backend uses it
    const result = await notesClient.createPrerequisiteNote(
      WorkspaceId(workspace.id),
      NoteId(noteId),
      {
        title: sanitizedTitle,
        content: taskNoteContent,
        taskStatus: 'not_started',
        peerOrder,
        agentConfig: {
          instruction: taskText,
          model: selectWorkspaceDefaultModel.select(getReduxStore().getState(), workspace.id),
          autoStart: true,
          agentId: optimisticAgentId, // Use pre-generated ID
        },
      },
    );

    if (!result.ok) {
      // Rollback: clear the optimistic agent ID and remove optimistic note
      if (editor) {
        editor.commands.setTaskAgentId(taskPosition, null);
      }
      notesStateManager.removeOptimisticNote(optimisticNoteId);
      throw new Error(result.error || 'Failed to create Task Note');
    }

    const { note: taskNote, agent: agentData } = result.data;

    // Replace optimistic note with real note from server
    notesStateManager.removeOptimisticNote(optimisticNoteId);
    notesStateManager.addOptimisticNote(taskNote); // Add the real note

    logger.info('Task Note created successfully', {
      taskNoteId: taskNote.id,
      agentId: agentData?.id,
    });

    // Convert the checklist item to a linked task
    // First try to find by agentId, but if external update wiped it, try restoring associations
    // As last resort, find by task text
    // Use external-update meta to prevent triggering onUpdate/debounceUpdate for better perf
    if (editor) {
      // Helper to find task by agentId
      const findTaskByAgentId = (): { pos: number; node: any } | null => {
        let foundPos = -1;
        let foundNode: any = null;
        editor.state.doc.descendants((node, pos) => {
          if (foundPos >= 0) return false;
          if (node.type.name === 'taskItem' && node.attrs.delegatedAgentId === optimisticAgentId) {
            foundPos = pos;
            foundNode = node;
            return false;
          }
          return true;
        });
        return foundPos >= 0 ? { pos: foundPos, node: foundNode } : null;
      };

      // Helper to find task by text (fallback)
      const findTaskByText = (): { pos: number; node: any } | null => {
        let foundPos = -1;
        let foundNode: any = null;
        editor.state.doc.descendants((node, pos) => {
          if (foundPos >= 0) return false;
          if (node.type.name === 'taskItem' && node.textContent.trim() === taskText) {
            foundPos = pos;
            foundNode = node;
            return false;
          }
          return true;
        });
        return foundPos >= 0 ? { pos: foundPos, node: foundNode } : null;
      };

      // Step 1: Try to find by agentId
      let taskMatch = findTaskByAgentId();

      // Step 2: If not found, restore associations and try again
      if (!taskMatch && workspace?.id && noteId) {
        logger.debug('[convertToLinkedTask] Task not found by agentId, restoring associations', {
          agentId: optimisticAgentId,
        });
        restoreTaskAgentAssociations(editor, workspace.id, noteId, logger);
        taskMatch = findTaskByAgentId();
      }

      // Step 3: If still not found, try by text as last resort
      if (!taskMatch) {
        logger.debug('[convertToLinkedTask] Task still not found by agentId, trying by text', {
          agentId: optimisticAgentId,
          taskText,
        });
        taskMatch = findTaskByText();
      }

      if (!taskMatch) {
        logger.warn('[convertToLinkedTask] Task item not found by agentId or text', {
          agentId: optimisticAgentId,
          noteId: taskNote.id,
          taskText,
        });
      } else {
        // Found the task - convert it to a linked task
        const convertResult = editor
          .chain()
          .command(({ tr }) => {
            tr.setMeta('external-update', true);
            return true;
          })
          .command(({ tr, state }) => {
            const { pos: foundPos, node: foundNode } = taskMatch!;

            // Create the link URL using shared constants
            const href = taskNoteUrl(taskNote.id);

            // Get the link mark type from the schema
            const linkMarkType = state.schema.marks.link;
            if (!linkMarkType) {
              logger.error('[convertToLinkedTask] Link mark type not found in schema');
              return false;
            }

            // Create a text node with a link mark
            const linkMark = linkMarkType.create({ href });
            const textNode = state.schema.text('delegated', [linkMark]);

            // Create a paragraph containing the linked text
            const paragraphType = state.schema.nodes.paragraph;
            if (!paragraphType) {
              logger.error('[convertToLinkedTask] Paragraph node type not found in schema');
              return false;
            }
            const newParagraph = paragraphType.create(null, textNode);

            // Calculate the content range to replace
            const contentStart = foundPos + 1;
            const contentEnd = foundPos + foundNode.nodeSize - 1;

            // Replace the content inside the taskItem with the new paragraph
            tr.replaceWith(contentStart, contentEnd, newParagraph);

            return true;
          })
          .run();

        if (!convertResult) {
          logger.warn('Failed to convert checklist item to linked task in editor', {
            optimisticAgentId,
            taskNoteId: taskNote.id,
          });
        } else {
          logger.info('Converted checklist item to linked task', {
            optimisticAgentId,
            taskNoteId: taskNote.id,
          });

          // Clean up the task-agent association since the task is now a linked task
          // (no longer a task item that needs the delegatedAgentId attribute)
          removeTaskAgentAssociation(workspace.id, noteId, taskText);

          // Trigger a debounced save since the conversion used external-update meta
          // This ensures the linked task is persisted to disk
          // Note: For bulk delegation, handleStartSectionTasks does an explicit save after all tasks complete
          if (!options?.skipSave) {
            debounceUpdate();
          }
        }
      }
    }

    // Dispatch agent launched event if agent was created
    // Task agents run in the background - don't auto-open the drawer
    if (agentData) {
      dispatch('agentLaunched', { agent: agentData, autoOpenDrawer: false });
    }
  } catch (error) {
    logger.error('Failed to graduate checklist item:', error);
    // Rollback: clear the optimistic agent ID and remove association
    // Use external-update meta to prevent triggering onUpdate/debounceUpdate
    if (editor) {
      editor
        .chain()
        .command(({ tr }) => {
          tr.setMeta('external-update', true);
          return true;
        })
        .command(({ tr, state }) => {
          const node = state.doc.nodeAt(taskPosition);
          if (node && node.type.name === 'taskItem') {
            tr.setNodeMarkup(taskPosition, undefined, {
              ...node.attrs,
              delegatedAgentId: null,
            });
            return true;
          }
          return false;
        })
        .run();
    }
    removeTaskAgentAssociation(workspace.id, noteId, taskText);
  }
}
