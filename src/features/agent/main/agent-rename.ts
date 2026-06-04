/**
 * Lightweight agent-rename helper.
 *
 * Patches only the `name` and `nameExplicitlySet` fields of an agent session
 * through `UnifiedPersistence.renameAgent`, which acquires the same per-agent
 * write lock that `saveAgent` uses and writes atomically with the `.checksum`
 * sidecar updated. Also invalidates the persistence load cache, syncs the
 * in-memory backend session, and emits `agent:renamed` through Redux workspace
 * events. It is the implementation used by both the MCP
 * `setAgentName` tool and the user-triggered rename IPC handler.
 */

import { Logger } from '$shared/logger';
import type { AgentId, WorkspaceId } from '$shared/types/branded-ids';

import { createWorkspaceEvent, WorkspaceEventType } from '../../events/types';
import { mainDispatch } from '../../../store/main/redux-store-bridge';
import { emitWorkspaceEvent } from '../../../store/main/slices/workspace-events/workspace-events-slice';

const logger = new Logger('AgentRename');

export interface RenameAgentOnDiskOptions {
  workspaceId: string;
  agentId: string;
  name: string;
  /**
   * When true (used by the MCP agent-driven rename), the write is skipped if
   * the session already has `nameExplicitlySet: true` on disk, so prior
   * user/tool renames are not overwritten.
   * When false (used by user-driven rename), the write always proceeds.
   */
  skipIfExplicitlySet?: boolean;
}

export interface RenameAgentOnDiskResult {
  ok: true;
  name: string;
  skipped?: boolean;
}

/**
 * Patch the `name` and `nameExplicitlySet` fields on an agent session file.
 * Throws if the name is empty or the session file cannot be read.
 */
export async function renameAgentOnDisk(
  options: RenameAgentOnDiskOptions,
): Promise<RenameAgentOnDiskResult> {
  const { workspaceId, agentId, skipIfExplicitlySet = false } = options;

  if (!options.name || typeof options.name !== 'string') {
    throw new Error('name is required');
  }
  const trimmedName = options.name.trim();
  if (!trimmedName) {
    throw new Error('name must not be empty or whitespace-only');
  }

  const { UnifiedPersistence } = await import('./agent-persistence');
  const result = await UnifiedPersistence.getInstance().renameAgent(
    agentId,
    workspaceId,
    trimmedName,
    { skipIfExplicitlySet },
  );

  if (!result.ok) {
    throw new Error(result.error || 'Failed to rename agent session');
  }

  if (result.skipped) {
    logger.info('renameAgentOnDisk: skipping — name already explicitly set', {
      agentId,
      existingName: result.name,
      requestedName: trimmedName,
    });

    // Sync in-memory backend session with the disk name so subsequent
    // getSession() calls don't return a stale pre-rename value.
    await syncInMemorySession(agentId, result.name, true);
    return { ok: true, name: result.name, skipped: true };
  }

  await invalidatePersistenceCache(agentId, workspaceId);
  await syncInMemorySession(agentId, result.name, true);

  mainDispatch(
    emitWorkspaceEvent(
      createWorkspaceEvent(
        WorkspaceEventType.AgentRenamed,
        workspaceId,
        { type: 'user' as const, id: 'user' },
        { agentId, workspaceId, name: result.name },
      ),
    ),
  );

  return { ok: true, name: result.name };
}

async function invalidatePersistenceCache(agentId: string, workspaceId: string): Promise<void> {
  try {
    const { UnifiedPersistence } = await import('./agent-persistence');
    UnifiedPersistence.getInstance().invalidateLoadCache(
      agentId as unknown as AgentId,
      workspaceId as unknown as WorkspaceId,
    );
  } catch (err) {
    logger.warn('Failed to invalidate persistence load cache after rename', {
      agentId,
      error: err,
    });
  }
}

async function syncInMemorySession(
  agentId: string,
  name: string,
  nameExplicitlySet: boolean,
): Promise<void> {
  try {
    const { ConsolidatedBackendService } = await import('./consolidated-backend.service');
    const backend = ConsolidatedBackendService.getInstance();
    const session = backend.getSession(agentId);
    if (session) {
      session.name = name;
      (session as unknown as { nameExplicitlySet?: boolean }).nameExplicitlySet = nameExplicitlySet;
    }
  } catch (err) {
    logger.warn('Failed to update in-memory session for agent name', {
      agentId,
      error: err,
    });
  }
}
