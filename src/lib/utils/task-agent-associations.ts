/**
 * Task-Agent Associations Utility
 *
 * Manages the persistence of task-to-agent assignments using localStorage.
 * Tasks are matched by their text content since positions can change as the document is edited.
 */

import { browser } from '$app/environment';
import { createLogger } from './client-logger';
import { dispatchWindowEvent } from './window-events';

const logger = createLogger('TaskAgentAssociations');

/**
 * Task-agent association stored in localStorage
 */
export interface TaskAgentAssociation {
  taskText: string; // Used to match tasks (since positions change)
  agentId: string;
  noteId: string;
  createdAt: number;
}

/**
 * Custom event name dispatched when task associations change
 */
export const TASK_ASSOCIATION_CHANGED_EVENT = 'task-association-changed';

/**
 * Custom event dispatched when an agent's associations are removed (agent deleted)
 */
export const AGENT_ASSOCIATIONS_REMOVED_EVENT = 'agent-associations-removed';

/**
 * Get the localStorage key for task associations in a specific note
 */
function getStorageKey(workspaceId: string, noteId: string): string {
  return `task-agent-associations:${workspaceId}:${noteId}`;
}

/**
 * Load task-agent associations for a specific note
 */
export function loadAssociationsForNote(
  workspaceId: string,
  noteId: string,
): TaskAgentAssociation[] {
  if (!browser) return [];

  try {
    const key = getStorageKey(workspaceId, noteId);
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    logger.warn('Failed to load task-agent associations', { workspaceId, noteId, error: e });
  }
  return [];
}

/**
 * Save task-agent associations for a specific note
 */
function saveAssociationsForNote(
  workspaceId: string,
  noteId: string,
  associations: TaskAgentAssociation[],
): void {
  if (!browser) return;

  try {
    const key = getStorageKey(workspaceId, noteId);
    localStorage.setItem(key, JSON.stringify(associations));
    // Dispatch event to notify other components (like ChatPanel) of the change
    dispatchWindowEvent(TASK_ASSOCIATION_CHANGED_EVENT);
  } catch (e) {
    logger.warn('Failed to save task-agent associations', { workspaceId, noteId, error: e });
  }
}

/**
 * Add or update a task-agent association
 */
export function addTaskAgentAssociation(
  workspaceId: string,
  noteId: string,
  taskText: string,
  agentId: string,
): void {
  const associations = loadAssociationsForNote(workspaceId, noteId);
  // Remove existing association for this task text if present
  const filtered = associations.filter((a) => a.taskText !== taskText);
  filtered.push({
    taskText,
    agentId,
    noteId,
    createdAt: Date.now(),
  });
  saveAssociationsForNote(workspaceId, noteId, filtered);
  logger.debug('Added task-agent association', { workspaceId, noteId, taskText, agentId });
}

/**
 * Remove a task-agent association by task text
 */
export function removeTaskAgentAssociation(
  workspaceId: string,
  noteId: string,
  taskText: string,
): void {
  const associations = loadAssociationsForNote(workspaceId, noteId);
  const filtered = associations.filter((a) => a.taskText !== taskText);
  saveAssociationsForNote(workspaceId, noteId, filtered);
  logger.debug('Removed task-agent association', { workspaceId, noteId, taskText });
}

/**
 * Get all tasks assigned to a specific agent across all notes in a workspace
 */
export function getTasksForAgent(workspaceId: string, agentId: string): TaskAgentAssociation[] {
  if (!browser) return [];

  const tasks: TaskAgentAssociation[] = [];
  const prefix = `task-agent-associations:${workspaceId}:`;

  // Scan all localStorage keys for task associations in this workspace
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) {
      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          const associations: TaskAgentAssociation[] = JSON.parse(stored);
          for (const assoc of associations) {
            if (assoc.agentId === agentId) {
              tasks.push(assoc);
            }
          }
        }
      } catch (e) {
        logger.warn('Failed to parse task associations', { key, error: e });
      }
    }
  }

  return tasks;
}

/**
 * Get the agent assigned to a specific task (by task text)
 */
export function getAgentForTask(
  workspaceId: string,
  noteId: string,
  taskText: string,
): TaskAgentAssociation | undefined {
  const associations = loadAssociationsForNote(workspaceId, noteId);
  return associations.find((a) => a.taskText === taskText);
}

/**
 * Remove all associations for a specific agent (used when agent is deleted/not found)
 */
export function removeAssociationsForAgent(workspaceId: string, agentId: string): void {
  if (!browser) return;

  const prefix = `task-agent-associations:${workspaceId}:`;

  // Scan all localStorage keys for task associations in this workspace
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) {
      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          const associations: TaskAgentAssociation[] = JSON.parse(stored);
          const filtered = associations.filter((a) => a.agentId !== agentId);
          if (filtered.length !== associations.length) {
            const noteId = key.replace(prefix, '');
            logger.info('Removing stale associations for deleted agent', {
              workspaceId,
              noteId,
              agentId,
              removedCount: associations.length - filtered.length,
            });
            if (filtered.length === 0) {
              localStorage.removeItem(key);
            } else {
              localStorage.setItem(key, JSON.stringify(filtered));
            }
            // Dispatch event to notify other components
            dispatchWindowEvent(TASK_ASSOCIATION_CHANGED_EVENT);
            // Dispatch specific event for agent removal so editor can clean up delegatedAgentId
            dispatchWindowEvent(AGENT_ASSOCIATIONS_REMOVED_EVENT, { agentId, noteId, workspaceId });
          }
        }
      } catch (e) {
        logger.warn('Failed to clean up task associations', { key, error: e });
      }
    }
  }
}
