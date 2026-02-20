import type { Editor } from '@tiptap/core';
import { loadAssociationsForNote } from '$lib/utils/task-agent-associations';

import type { LoggerLike } from './logger.types';

export type { LoggerLike };

/**
 * Restore task-agent associations from localStorage back onto TipTap taskItem nodes.
 *
 * This is used to recover `delegatedAgentId` after external updates, note switches,
 * or editor re-initialization.
 */
export function restoreTaskAgentAssociations(
  editor: Editor,
  workspaceId: string,
  noteId: string,
  logger: LoggerLike,
): void {
  logger.debug('[restoreTaskAgentAssociations] Starting', { workspaceId, noteId });

  const associations = loadAssociationsForNote(workspaceId, noteId);
  if (associations.length === 0) return;

  // Find all taskItem nodes and match by text
  const doc = editor.state.doc;
  let restoredCount = 0;

  doc.descendants((node, pos) => {
    if (node.type.name !== 'taskItem') return true;

    const taskText = node.textContent.trim();
    const association = associations.find((a) => a.taskText === taskText);
    if (!association) return true;

    if (!node.attrs.delegatedAgentId) {
      logger.debug('[restoreTaskAgentAssociations] Restoring agent association for task', {
        taskText,
        agentId: association.agentId,
      });

      // Use command chain with external-update meta to prevent triggering onUpdate
      editor
        .chain()
        .command(({ tr }) => {
          tr.setMeta('external-update', true);
          return true;
        })
        .command(({ tr, state }) => {
          const currentNode = state.doc.nodeAt(pos);
          if (currentNode && currentNode.type.name === 'taskItem') {
            tr.setNodeMarkup(pos, undefined, {
              ...currentNode.attrs,
              delegatedAgentId: association.agentId,
            });
          }
          return true;
        })
        .run();

      restoredCount++;
    }

    return true; // Continue traversing
  });

  if (restoredCount > 0) {
    logger.debug('[restoreTaskAgentAssociations] Restored associations', { restoredCount });
  }
}

/**
 * Remove `delegatedAgentId` from all task items for a deleted agent.
 */
export function removeAgentFromTasks(editor: Editor, agentId: string, logger?: LoggerLike): void {
  const doc = editor.state.doc;
  let removedCount = 0;

  doc.descendants((node, pos) => {
    if (node.type.name === 'taskItem' && node.attrs.delegatedAgentId === agentId) {
      editor
        .chain()
        .command(({ tr }) => {
          tr.setMeta('external-update', true);
          return true;
        })
        .command(({ tr, state }) => {
          const currentNode = state.doc.nodeAt(pos);
          if (currentNode && currentNode.type.name === 'taskItem') {
            tr.setNodeMarkup(pos, undefined, {
              ...currentNode.attrs,
              delegatedAgentId: null,
            });
          }
          return true;
        })
        .run();

      removedCount++;
    }
    return true;
  });

  if (removedCount > 0) {
    logger?.info?.('[removeAgentFromTasks] Removed agent from tasks', { agentId, removedCount });
  }
}

/**
 * Calculate the index of a task item among all task items in the document.
 * Used to determine peerOrder when manually converting checklist items to Task Notes.
 */
export function getTaskIndexInDocument(
  editor: Editor | null | undefined,
  taskPosition: number,
): number {
  if (!editor) return 0;

  let taskIndex = 0;
  let foundIndex = 0;

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'taskItem') {
      if (pos === taskPosition) {
        foundIndex = taskIndex;
        return false; // Stop traversal
      }
      taskIndex++;
    }
    return true; // Continue traversal
  });

  return foundIndex;
}
