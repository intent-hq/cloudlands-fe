/**
 * Agent Lock Store
 *
 * Provides reactive state for determining which agents and files are locked
 * due to auto-commit being enabled and agents actively working.
 *
 * A file is locked when:
 * 1. Auto-commit is enabled AND
 * 2. The file belongs to an agent that is actively working
 *    (streaming or task not in terminal status)
 */

import { unifiedStateStore } from '$features/agent/browser';
import { agentService } from '$features/agent/agent.service';
import { notesStateManager } from '$features/notes/notes.store.svelte';
import { fileTrackingStore } from './file-tracking.store.svelte';
import { syncWorkspaceSettings, emptyWorkspaceSettings } from '$lib/store/slices/workspace-settings/workspace-settings-slice';
import { dispatch as reduxDispatch, getReduxStore } from '$lib/store/redux-dispatch-bridge';
import type { WorkspaceId } from '$shared/types/branded-ids';

// Module-level reactive state mirroring Redux autoCommitEnabled for the current workspace.
// This keeps $derived blocks reactive (just like the old module-level $state).
let _autoCommitEnabled = $state(true);
let _subscribedWorkspaceId: string | undefined;
let _unsubscribe: (() => void) | undefined;

function ensureStoreSubscription(workspaceId: string | undefined): void {
  if (_subscribedWorkspaceId === workspaceId) return;
  _subscribedWorkspaceId = workspaceId;
  _unsubscribe?.();
  _unsubscribe = undefined;
  if (!workspaceId) return;
  try {
    const store = getReduxStore();
    const getAutoCommit = () => {
      const wsState = store.getState().workspaceSettings.byWorkspaceId[workspaceId];
      return wsState?.autoCommitEnabled ?? emptyWorkspaceSettings.autoCommitEnabled;
    };
    _autoCommitEnabled = getAutoCommit();
    _unsubscribe = store.subscribe(() => {
      const next = getAutoCommit();
      if (next !== _autoCommitEnabled) {
        _autoCommitEnabled = next;
      }
    });
  } catch {
    // Store not initialized yet — will use default
  }
}

/**
 * Check if an agent is actively working (streaming or task not complete).
 */
function isAgentActivelyWorking(agentId: string): boolean {
  // Check if agent is currently streaming via unified state store
  const currentWorkspace = unifiedStateStore.currentWorkspace;
  if (currentWorkspace) {
    const agentState = currentWorkspace.agents.get(agentId as any);
    if (agentState?.streaming?.active) {
      return true;
    }
  }

  // Check if agent session exists and has a linked task
  const session = agentService.getSession(agentId);
  if (!session) return false;

  // Check if session is streaming (fallback check)
  if (session.isStreaming) {
    return true;
  }

  // Check linked task status
  const taskNoteId = session.metadata?.taskNoteId as string | undefined;
  if (taskNoteId) {
    const taskNote = notesStateManager.findById(taskNoteId as any);
    const taskStatus = taskNote?.metadata?.task?.status;
    // Active unless in terminal status (complete or cancelled)
    if (taskStatus && taskStatus !== 'complete' && taskStatus !== 'cancelled') {
      return true;
    }
  }

  return false;
}

/**
 * Create a reactive agent lock store for a specific workspace.
 */
export function createAgentLockStore(workspaceId: WorkspaceId | string | undefined) {
  // Ensure we're subscribed to Redux store for autoCommit changes
  ensureStoreSubscription(workspaceId as string | undefined);

  // Sync workspace settings on first access per workspace
  if (workspaceId) {
    try {
      reduxDispatch(syncWorkspaceSettings(workspaceId as string));
    } catch {
      // Redux dispatch bridge not initialized yet — skip sync for now
    }
  }

  const autoCommitEnabled = $derived(_autoCommitEnabled);

  // Get working changes
  const unstagedChanges = $derived(fileTrackingStore.workingChanges.unstaged);
  const stagedChanges = $derived(fileTrackingStore.workingChanges.staged);

  /**
   * Compute the set of locked agent IDs.
   */
  const lockedAgentIds = $derived.by(() => {
    const locked = new Set<string>();

    // If auto-commit is disabled, no agents are locked
    if (!autoCommitEnabled) return locked;

    // Collect all unique agent IDs from both unstaged and staged changes
    const agentIds = new Set<string>();
    for (const change of unstagedChanges) {
      const agentId = change.attribution?.agent?.agentId;
      if (agentId) agentIds.add(agentId);
    }
    for (const change of stagedChanges) {
      const agentId = change.attribution?.agent?.agentId;
      if (agentId) agentIds.add(agentId);
    }

    // Check each agent
    for (const agentId of agentIds) {
      if (isAgentActivelyWorking(agentId)) {
        locked.add(agentId);
      }
    }

    return locked;
  });

  /**
   * Compute the set of locked file paths.
   */
  const lockedFilePaths = $derived.by(() => {
    const locked = new Set<string>();

    // Add paths from unstaged changes belonging to locked agents
    for (const change of unstagedChanges) {
      const agentId = change.attribution?.agent?.agentId;
      if (agentId && lockedAgentIds.has(agentId)) {
        locked.add(change.relativePath);
        if (change.file && change.file !== change.relativePath) {
          locked.add(change.file);
        }
      }
    }

    // Add paths from staged changes belonging to locked agents
    for (const change of stagedChanges) {
      const agentId = change.attribution?.agent?.agentId;
      if (agentId && lockedAgentIds.has(agentId)) {
        locked.add(change.relativePath);
        if (change.file && change.file !== change.relativePath) {
          locked.add(change.file);
        }
      }
    }

    return locked;
  });

  return {
    get lockedAgentIds() {
      return lockedAgentIds;
    },
    get lockedFilePaths() {
      return lockedFilePaths;
    },
    get autoCommitEnabled() {
      return autoCommitEnabled;
    },
    isAgentLocked(agentId: string | null | undefined): boolean {
      if (!agentId) return false;
      return lockedAgentIds.has(agentId);
    },
    isFileLocked(filePath: string | null | undefined): boolean {
      if (!filePath) return false;
      return lockedFilePaths.has(filePath);
    },
  };
}
