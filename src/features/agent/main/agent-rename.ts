/**
 * Lightweight agent-rename helper.
 *
 * Patches only the `name` and `nameExplicitlySet` fields of an agent session
 * through the daemon (`agent.update`, PROTOCOL.md §5.5), then emits
 * `agent:renamed` through Redux workspace events. It is the implementation
 * used by both the MCP `setAgentName` tool and the user-triggered rename IPC
 * handler. The daemon is the single source of session state — there is no
 * main-process session cache to sync.
 */

import { Logger } from '$shared/logger';

import { createWorkspaceEvent, WorkspaceEventType } from '../../events/types';
import { mainDispatch } from '../../../store/main/redux-store-bridge';
import { emitWorkspaceEvent } from '../../../store/main/slices/workspace-events/workspace-events-slice';
import { getBackendClient } from '../../backend/main/backend.ipc';

const logger = new Logger('AgentRename');

export interface RenameAgentOnDiskOptions {
  workspaceId: string;
  agentId: string;
  name: string;
  /**
   * When true (used by the MCP agent-driven rename), the write is skipped if
   * the session already has `nameExplicitlySet: true` on the daemon, so prior
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
 * Patch the `name` and `nameExplicitlySet` fields on an agent session via the
 * daemon. Throws if the name is empty or the daemon write fails.
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

  if (skipIfExplicitlySet) {
    let existingName = trimmedName;
    let existingExplicit = false;
    try {
      const res = (await getBackendClient().request('agent.get', {
        agentId,
        workspaceId,
      })) as { agent?: { name?: string; nameExplicitlySet?: boolean } };
      if (res.agent?.name) existingName = res.agent.name;
      if (res.agent?.nameExplicitlySet === true) existingExplicit = true;
    } catch (err) {
      logger.warn('renameAgentOnDisk: agent.get failed; proceeding as if unset', {
        agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (existingExplicit) {
      logger.info('renameAgentOnDisk: skipping — name already explicitly set', {
        agentId,
        existingName,
        requestedName: trimmedName,
      });
      return { ok: true, name: existingName, skipped: true };
    }
  }

  try {
    await getBackendClient().request('agent.update', {
      agentId,
      workspaceId,
      changes: { name: trimmedName, nameExplicitlySet: true },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('agent.update failed', { agentId, error: msg });
    throw new Error(msg || 'Failed to rename agent session');
  }

  mainDispatch(
    emitWorkspaceEvent(
      createWorkspaceEvent(
        WorkspaceEventType.AgentRenamed,
        workspaceId,
        { type: 'user' as const, id: 'user' },
        { agentId, workspaceId, name: trimmedName },
      ),
    ),
  );

  return { ok: true, name: trimmedName };
}
