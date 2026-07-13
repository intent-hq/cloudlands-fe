import type { Editor } from '@tiptap/core';
import type { TaskAgentAssociation } from '$store/renderer/slices/task-agent-associations/task-agent-associations-types';

import type { LoggerLike } from './logger.types';

export type { LoggerLike };

const TASK_ASSOCIATION_KEY_SEPARATOR = '\u001f';
const TASK_AGENT_KEY_PREFIX = 'agent:';

export function createTaskAgentAssociationKey(taskText: string, occurrenceIndex: number): string {
  return `${occurrenceIndex}${TASK_ASSOCIATION_KEY_SEPARATOR}${taskText}`;
}

export function createTaskAgentAssociationKeyForAgent(agentId: string): string {
  return `${TASK_AGENT_KEY_PREFIX}${agentId}`;
}

function getTaskTextOccurrenceIndex(occurrencesByText: Map<string, number>, taskText: string): number {
  const occurrenceIndex = occurrencesByText.get(taskText) ?? 0;
  occurrencesByText.set(taskText, occurrenceIndex + 1);
  return occurrenceIndex;
}

export function getTaskTextsInEditor(editor: Editor): string[] {
  const taskTexts: string[] = [];

  editor.state.doc.descendants((node) => {
    if (node.type.name === 'taskItem') {
      const taskText = node.textContent.trim();
      if (taskText) taskTexts.push(taskText);
    }
    return true;
  });

  return taskTexts;
}

export function getTaskAssociationKeysInEditor(editor: Editor): string[] {
  const taskKeys: string[] = [];
  const occurrencesByText = new Map<string, number>();

  editor.state.doc.descendants((node) => {
    if (node.type.name === 'taskItem') {
      const taskText = node.textContent.trim();
      if (taskText) {
        const occurrenceIndex = getTaskTextOccurrenceIndex(occurrencesByText, taskText);
        if (node.attrs.delegatedAgentId) {
          taskKeys.push(createTaskAgentAssociationKeyForAgent(node.attrs.delegatedAgentId));
        } else {
          taskKeys.push(createTaskAgentAssociationKey(taskText, occurrenceIndex));
        }
        taskKeys.push(taskText);
      }
    }
    return true;
  });

  return taskKeys;
}

export function getTaskAssociationKeyAtPosition(
  editor: Editor | null | undefined,
  taskPosition: number,
  taskText: string,
): string {
  if (!editor) return createTaskAgentAssociationKey(taskText, 0);
  const occurrencesByText = new Map<string, number>();
  let taskKey = createTaskAgentAssociationKey(taskText, 0);

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'taskItem') return true;
    const currentTaskText = node.textContent.trim();
    if (!currentTaskText) return true;

    const occurrenceIndex = getTaskTextOccurrenceIndex(occurrencesByText, currentTaskText);
    if (pos === taskPosition) {
      taskKey = createTaskAgentAssociationKey(currentTaskText, occurrenceIndex);
      return false;
    }
    return true;
  });

  return taskKey;
}

function findTaskAgentAssociation(
  associations: TaskAgentAssociation[],
  taskText: string,
  occurrenceTaskKey: string,
  delegatedAgentId: string | null,
  taskTextCounts: Map<string, number>,
  associationTextCounts: Map<string, number>,
  usedAssociationIndexes: Set<number>,
): { association: TaskAgentAssociation; index: number } | null {
  if (delegatedAgentId) {
    const agentKey = createTaskAgentAssociationKeyForAgent(delegatedAgentId);
    const keyedIndex = associations.findIndex(
      (association, index) =>
        !usedAssociationIndexes.has(index) && association.taskKey === agentKey,
    );
    if (keyedIndex >= 0) return { association: associations[keyedIndex], index: keyedIndex };
  }

  if ((associationTextCounts.get(taskText) ?? 0) <= (taskTextCounts.get(taskText) ?? 0)) {
    const occurrenceKeyedIndex = associations.findIndex(
      (association, index) =>
        !usedAssociationIndexes.has(index) && association.taskKey === occurrenceTaskKey,
    );
    if (occurrenceKeyedIndex >= 0) {
      return { association: associations[occurrenceKeyedIndex], index: occurrenceKeyedIndex };
    }
  }

  if ((taskTextCounts.get(taskText) ?? 0) !== 1 || (associationTextCounts.get(taskText) ?? 0) !== 1) {
    return null;
  }

  const uniqueTextIndex = associations.findIndex(
    (association, index) =>
      !usedAssociationIndexes.has(index) &&
      association.taskText === taskText &&
      (!association.taskKey || association.taskKey.startsWith(TASK_AGENT_KEY_PREFIX)),
  );
  return uniqueTextIndex >= 0 ? { association: associations[uniqueTextIndex], index: uniqueTextIndex } : null;
}

function getTaskTextCounts(editor: Editor): Map<string, number> {
  const taskTextCounts = new Map<string, number>();
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'taskItem') {
      const taskText = node.textContent.trim();
      if (taskText) taskTextCounts.set(taskText, (taskTextCounts.get(taskText) ?? 0) + 1);
    }
    return true;
  });
  return taskTextCounts;
}

function getAssociationTextCounts(associations: TaskAgentAssociation[]): Map<string, number> {
  const associationTextCounts = new Map<string, number>();
  associations.forEach((association) => {
    associationTextCounts.set(
      association.taskText,
      (associationTextCounts.get(association.taskText) ?? 0) + 1,
    );
  });
  return associationTextCounts;
}

/**
 * Restore task-agent associations back onto TipTap taskItem nodes.
 *
 * This is used to recover `delegatedAgentId` after external updates, note switches,
 * or editor re-initialization.
 */
export function restoreTaskAgentAssociations(
  editor: Editor,
  associations: TaskAgentAssociation[],
  logger: LoggerLike,
): void {
  logger.debug('[restoreTaskAgentAssociations] Starting', { associationCount: associations.length });
  if (associations.length === 0) return;

  // Find all taskItem nodes and match by stable agent-derived key. Fall back to
  // taskText only when both the current document and association set are unambiguous.
  const doc = editor.state.doc;
  let restoredCount = 0;
  const occurrencesByText = new Map<string, number>();
  const taskTextCounts = getTaskTextCounts(editor);
  const associationTextCounts = getAssociationTextCounts(associations);
  const usedAssociationIndexes = new Set<number>();

  doc.descendants((node, pos) => {
    if (node.type.name !== 'taskItem') return true;

    const taskText = node.textContent.trim();
    if (!taskText) return true;
    const occurrenceIndex = getTaskTextOccurrenceIndex(occurrencesByText, taskText);
    const occurrenceTaskKey = createTaskAgentAssociationKey(taskText, occurrenceIndex);
    const match = findTaskAgentAssociation(
      associations,
      taskText,
      occurrenceTaskKey,
      node.attrs.delegatedAgentId ?? null,
      taskTextCounts,
      associationTextCounts,
      usedAssociationIndexes,
    );
    if (!match) return true;
    usedAssociationIndexes.add(match.index);
    const { association } = match;

    if (!node.attrs.delegatedAgentId) {
      logger.debug('[restoreTaskAgentAssociations] Restoring agent association for task', {
        taskText,
        taskKey: association.taskKey,
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
