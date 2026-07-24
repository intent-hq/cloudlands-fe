/**
 * Lightweight agent-rename helper.
 *
 * Renames an agent session through the daemon (`agent.rename`,
 * PROTOCOL.md §5.5) in a single call — the daemon enforces the
 * `skipIfExplicitlySet` guard natively and returns
 * `{ success: true, name, skipped? }`. On applied renames the helper also
 * emits `agent:renamed` through Redux workspace events. It is the
 * implementation used by both the MCP `setAgentName` tool and the
 * user-triggered rename IPC handler. The daemon is the single source of
 * session state — there is no main-process session cache to sync.
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
   * When true (used by the MCP agent-driven rename), the daemon skips the
   * write if the session already has `nameExplicitlySet: true`, so prior
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
 * Rename an agent session via the daemon (`agent.rename`, PROTOCOL.md §5.5).
 * Throws if the name is empty or the daemon write fails.
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

  let res: { success: boolean; name: string; skipped?: boolean };
  try {
    res = (await getBackendClient().request('agent.rename', {
      agentId,
      name: trimmedName,
      skipIfExplicitlySet,
    })) as { success: boolean; name: string; skipped?: boolean };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('agent.rename failed', { agentId, error: msg });
    throw new Error(msg || 'Failed to rename agent session');
  }

  if (res.skipped === true) {
    logger.info('renameAgentOnDisk: skipped — name already explicitly set', {
      agentId,
      existingName: res.name,
      requestedName: trimmedName,
    });
    return { ok: true, name: res.name, skipped: true };
  }

  mainDispatch(
    emitWorkspaceEvent(
      createWorkspaceEvent(
        WorkspaceEventType.AgentRenamed,
        workspaceId,
        { type: 'user' as const, id: 'user' },
        { agentId, workspaceId, name: res.name },
      ),
    ),
  );

  return { ok: true, name: res.name };
}
