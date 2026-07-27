import type { Editor } from '@tiptap/core';

import { buildTaskNoteContent } from '$features/notes/utils/task-agent-message-builder';
import {
  addOptimisticNote,
  removeOptimisticNote,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import {
  addTaskAgentAssociation,
  removeTaskAgentAssociation,
} from '$store/renderer/slices/task-agent-associations/task-agent-associations-slice';
import { appClient } from '$lib/client';
import type { Workspace } from '$shared/types';
import { unifiedIdService } from '$shared/services/unified-id.service';
import { stripMarkdownFormatting } from '$shared/utils-client';
import { taskNoteUrl } from '$shared/constants/intent-links';
import { m } from '$shared/paraglide/messages.js';

import type { LoggerLike } from './logger.types';
import {
  createTaskAgentAssociationKey,
  createTaskAgentAssociationKeyForAgent,
  getTaskAssociationKeyAtPosition,
  getTaskIndexInDocument,
  restoreTaskAgentAssociations,
} from './task-item-utils';

export type AssignAgentTaskMenuActionOptions = {
  skipSave?: boolean;
};

type AssignAgentStoreAction =
  | ReturnType<typeof addOptimisticNote>
  | ReturnType<typeof removeOptimisticNote>
  | ReturnType<typeof addTaskAgentAssociation>
  | ReturnType<typeof removeTaskAgentAssociation>;

export async function runAssignAgentTaskMenuAction({
  editor,
  workspace,
  noteId,
  taskData,
  options,
  parentNoteTitle,
  model,
  debounceUpdate,
  storeDispatch,
  logger,
}: {
  editor: Editor | null | undefined;
  workspace: Workspace;
  noteId: string | null | undefined;
  taskData: any;
  options?: AssignAgentTaskMenuActionOptions;
  parentNoteTitle: string;
  model: string;
  debounceUpdate: () => void;
  storeDispatch: (action: AssignAgentStoreAction) => void;
  logger: LoggerLike;
}): Promise<void> {
  const taskText = taskData.text || m.workspace_taskMenu_unknownTask_label();
  const taskPosition = parseInt(taskData.position) || 0;
  const occurrenceTaskKey = getTaskAssociationKeyAtPosition(editor, taskPosition, taskText);

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

  // Step 1: Generate IDs immediately for optimistic UI. The agent id here is
  // a LOCAL placeholder only (task-item marker); it is never sent to the
  // daemon — the daemon assigns the real agent id on create, and the marker
  // is re-keyed to that id once known. Until then, NO daemon-synced store
  // action is dispatched with the placeholder (addTaskAgentAssociation
  // triggers `task.linkAgent` on the wire via the associations middleware).
  const optimisticAgentId = unifiedIdService.generateAgentId();
  const optimisticNoteId = unifiedIdService.generateNoteId();
  let agentId: string = optimisticAgentId;
  let taskKey = createTaskAgentAssociationKeyForAgent(optimisticAgentId);

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
      // NOTE: the task-agent association is NOT dispatched here — the
      // placeholder id must not reach the daemon via `task.linkAgent`. The
      // association is dispatched after `agents.create` returns the
      // daemon-assigned id (Step 5b below).
    }
  }

  // Step 3: Get parent note info and build content
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
  storeDispatch(addOptimisticNote(workspace.id, optimisticNote as any));

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

    // Create the Task Note via the live tasks client (daemon `task.createPrerequisite`).
    // `peerOrder` is not part of the §7.9 arm and is dropped; the daemon assigns
    // ordering. The auto-agent behavior (initialMessage + `task.assignAgent`) is
    // preserved via a follow-up `agents.create`; the initial-message send and
    // explicit assignment are NOT re-issued here (known gap versus the retired
    // main-process handler).
    const createResult = await appClient.tasks.createPrerequisite(
      noteId,
      sanitizedTitle,
      {
        content: taskNoteContent,
        status: 'not_started',
      },
    );

    if (!createResult.success || !createResult.id) {
      // Rollback: clear the optimistic agent ID and remove optimistic note
      if (editor) {
        editor.commands.setTaskAgentId(taskPosition, null);
      }
      storeDispatch(removeOptimisticNote(workspace.id, optimisticNoteId));
      throw new Error(createResult.error || 'Failed to create Task Note');
    }

    const newTaskNoteId = createResult.id;

    try {
      const createdAgent = await appClient.agents.create({
        workspaceId: workspace.id,
        name: sanitizedTitle,
        agentType: 'task-loop',
        model,
        metadata: {
          source: 'task-creation',
          agentType: 'task-loop',
          taskNoteId: newTaskNoteId,
          isBackground: true,
        },
      });

      // Step 5b: adopt the daemon-assigned agent id. Re-key the task-item
      // marker and only NOW dispatch the association (which syncs to the
      // daemon via `task.linkAgent`) — never with the local placeholder.
      agentId = String(createdAgent.id);
      taskKey = createTaskAgentAssociationKeyForAgent(agentId);

      if (editor) {
        editor
          .chain()
          .command(({ tr }) => {
            tr.setMeta('external-update', true);
            return true;
          })
          .command(({ tr, state }) => {
            let rekeyed = false;
            state.doc.descendants((node, pos) => {
              if (rekeyed) return false;
              if (node.type.name === 'taskItem' && node.attrs.delegatedAgentId === optimisticAgentId) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  delegatedAgentId: agentId,
                });
                rekeyed = true;
                return false;
              }
              return true;
            });
            return rekeyed;
          })
          .run();
      }

      storeDispatch(addTaskAgentAssociation(workspace.id, noteId, {
        taskText,
        taskKey,
        agentId,
        noteId,
        createdAt: Date.now(),
      }));
      logger.debug('Persisted task-agent association with daemon-assigned id', {
        taskText,
        taskKey,
        agentId,
      });
    } catch (agentError) {
      logger.warn('Failed to create agent for new Task Note', {
        taskNoteId: newTaskNoteId,
        error: agentError instanceof Error ? agentError.message : String(agentError),
      });
    }

    // Replace optimistic note with a real-id-bearing copy so the sidebar stays
    // populated until the notes `subscribe` refetch delivers the authoritative
    // BE payload (which upserts by id).
    const taskNote = { ...optimisticNote, id: newTaskNoteId };
    storeDispatch(removeOptimisticNote(workspace.id, optimisticNoteId));
    storeDispatch(addOptimisticNote(workspace.id, taskNote as any));

    logger.info('Task Note created successfully', {
      taskNoteId: taskNote.id,
    });

    // Convert the checklist item to a linked task
    // First try to find by agentId, but if external update wiped it, try restoring associations
    // As last resort, find by task text
    // Use external-update meta to prevent triggering onUpdate/debounceUpdate for better perf
    if (editor) {
      // Helper to find task by agentId (adopted daemon id, with the local
      // placeholder as fallback in case the re-key markup did not land)
      const findTaskByAgentId = (): { pos: number; node: any } | null => {
        let foundPos = -1;
        let foundNode: any = null;
        editor.state.doc.descendants((node, pos) => {
          if (foundPos >= 0) return false;
          if (
            node.type.name === 'taskItem' &&
            (node.attrs.delegatedAgentId === agentId ||
              node.attrs.delegatedAgentId === optimisticAgentId)
          ) {
            foundPos = pos;
            foundNode = node;
            return false;
          }
          return true;
        });
        return foundPos >= 0 ? { pos: foundPos, node: foundNode } : null;
      };

      // Helper to find task by occurrence key, with legacy text fallback
      const findTaskByKeyOrText = (): { pos: number; node: any } | null => {
        let foundPos = -1;
        let foundNode: any = null;
        let textMatchCount = 0;
        let textMatch: { pos: number; node: any } | null = null;
        const occurrencesByText = new Map<string, number>();
        editor.state.doc.descendants((node, pos) => {
          if (foundPos >= 0) return false;
          if (node.type.name !== 'taskItem') return true;
          const currentTaskText = node.textContent.trim();
          if (!currentTaskText) return true;

          const occurrenceIndex = occurrencesByText.get(currentTaskText) ?? 0;
          occurrencesByText.set(currentTaskText, occurrenceIndex + 1);
          const currentTaskKey = createTaskAgentAssociationKey(currentTaskText, occurrenceIndex);
          if (currentTaskKey === occurrenceTaskKey) {
            foundPos = pos;
            foundNode = node;
            return false;
          }
          if (currentTaskText === taskText) {
            textMatchCount++;
            textMatch = { pos, node };
          }
          return true;
        });
        if (foundPos >= 0) return { pos: foundPos, node: foundNode };
        return textMatchCount === 1 ? textMatch : null;
      };

      // Step 1: Try to find by agentId
      let taskMatch = findTaskByAgentId();

      // Step 2: If not found, restore associations and try again
      if (!taskMatch && workspace?.id && noteId) {
        logger.debug('[convertToLinkedTask] Task not found by agentId, restoring associations', {
          agentId,
        });
        restoreTaskAgentAssociations(editor, [{
          taskText,
          taskKey,
          agentId,
          noteId,
          createdAt: Date.now(),
        }], logger);
        taskMatch = findTaskByAgentId();
      }

      // Step 3: If still not found, try by occurrence key/text as last resort
      if (!taskMatch) {
        logger.debug('[convertToLinkedTask] Task still not found by agentId, trying by task key/text', {
          agentId,
          taskKey,
          occurrenceTaskKey,
          taskText,
        });
        taskMatch = findTaskByKeyOrText();
      }

      if (!taskMatch) {
        logger.warn('[convertToLinkedTask] Task item not found by agentId or text', {
          agentId,
          noteId: taskNote.id,
            taskKey,
          taskText,
        });
      } else {
        // Found the task - convert it to a linked task
        const matchedTask = taskMatch;
        const convertResult = editor
          .chain()
          .command(({ tr }) => {
            tr.setMeta('external-update', true);
            return true;
          })
          .command(({ tr, state }) => {
            const { pos: foundPos, node: foundNode } = matchedTask;

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
            agentId,
            taskNoteId: taskNote.id,
          });
        } else {
          logger.info('Converted checklist item to linked task', {
            agentId,
            taskNoteId: taskNote.id,
          });

          // Clean up the task-agent association since the task is now a linked task
          // (no longer a task item that needs the delegatedAgentId attribute)
          storeDispatch(removeTaskAgentAssociation(workspace.id, noteId, taskKey));

          // Trigger a debounced save since the conversion used external-update meta
          // This ensures the linked task is persisted to disk
          // Note: For bulk delegation, handleStartSectionTasks does an explicit save after all tasks complete
          if (!options?.skipSave) {
            debounceUpdate();
          }
        }
      }
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
    storeDispatch(removeTaskAgentAssociation(workspace.id, noteId, taskKey));
  }
}
