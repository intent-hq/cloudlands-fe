/**
 * Lightweight agent-rename helper.
 *
 * Patches only the `name` and `nameExplicitlySet` fields of an agent session
 * through the daemon (`agent.update`, PROTOCOL.md §5.5) via
 * `daemonAgentBridge.saveAgent`, then syncs the in-memory backend session and
 * emits `agent:renamed` through Redux workspace events. It is the
 * implementation used by both the MCP `setAgentName` tool and the
 * user-triggered rename IPC handler.
 */

import { Logger } from '$shared/logger';
import type { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import type { AgentSession } from '$shared/types';

import { createWorkspaceEvent, WorkspaceEventType } from '../../events/types';
import { mainDispatch } from '../../../store/main/redux-store-bridge';
import { emitWorkspaceEvent } from '../../../store/main/slices/workspace-events/workspace-events-slice';
import { daemonAgentBridge } from './daemon-agent-bridge';

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
    const existing = await daemonAgentBridge.loadAgentSummary(
      agentId as unknown as AgentId,
      workspaceId as unknown as WorkspaceId,
    );
    const existingName =
      existing.success && existing.data?.name ? existing.data.name : trimmedName;
    const existingExplicit =
      existing.success &&
      (existing.data as unknown as { nameExplicitlySet?: boolean } | undefined)
        ?.nameExplicitlySet === true;
    if (existingExplicit) {
      logger.info('renameAgentOnDisk: skipping — name already explicitly set', {
        agentId,
        existingName,
        requestedName: trimmedName,
      });
      await syncInMemorySession(agentId, existingName, true);
      return { ok: true, name: existingName, skipped: true };
    }
  }

  const patch = {
    id: agentId,
    workspaceId,
    name: trimmedName,
    nameExplicitlySet: true,
  } as unknown as AgentSession;
  const saveResult = await daemonAgentBridge.saveAgent(patch);
  if (!saveResult.success) {
    throw new Error(saveResult.error || 'Failed to rename agent session');
  }

  await syncInMemorySession(agentId, trimmedName, true);

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
