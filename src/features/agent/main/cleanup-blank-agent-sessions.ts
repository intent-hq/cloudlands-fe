import { promises as fs } from 'fs';
import * as path from 'path';
import { Logger } from '$shared/logger';
import { WorkspaceConfig } from '$shared/main/config';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { workspaceService } from '../../workspace/main/workspace.service';
import { unifiedPersistence } from './agent-persistence';

export interface CleanupBlankAgentSessionsResult {
  scanned: number;
  removed: number;
  errors: number;
}

const RECENT_AGENT_FILE_GRACE_MS = 60 * 1000;
const logger = new Logger('CleanupBlankAgentSessions');

function emptyResult(): CleanupBlankAgentSessionsResult {
  return { scanned: 0, removed: 0, errors: 0 };
}

function getMessages(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  return (value as { messages?: unknown }).messages;
}

async function cleanupAgentFile(
  workspaceId: string,
  agentId: string,
  now: number,
): Promise<boolean> {
  const agentPath = path.join(WorkspaceConfig.paths.agents(workspaceId), `${agentId}.json`);
  const stats = await fs.stat(agentPath);

  if (now - stats.mtimeMs < RECENT_AGENT_FILE_GRACE_MS) {
    return false;
  }

  const raw = await fs.readFile(agentPath, 'utf-8');
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    logger.debug('Skipping agent session file with invalid JSON', { workspaceId, agentId, error });
    return false;
  }

  const messages = getMessages(parsed);
  if (!Array.isArray(messages)) {
    logger.debug('Skipping agent session file with non-array messages', { workspaceId, agentId });
    return false;
  }

  if (messages.length !== 0) {
    return false;
  }

  const result = await unifiedPersistence.deleteAgent(agentId, workspaceId);
  if (!result.success) {
    throw new Error(result.error || 'Failed to delete blank agent session file');
  }

  return true;
}

export async function cleanupBlankAgentSessions(): Promise<CleanupBlankAgentSessionsResult> {
  const workspacesResult = await workspaceService.listAllWorkspaces({ lite: true });
  if (!workspacesResult.ok) {
    logger.warn('Failed to list workspaces for blank agent session cleanup', {
      error: workspacesResult.error,
    });
    return emptyResult();
  }

  const result = emptyResult();
  const now = Date.now();

  for (const workspace of workspacesResult.data) {
    const workspaceId = workspace.id;
    if (workspaceId === CHIEF_WORKSPACE_ID) {
      logger.debug('Skipping virtual Chief workspace during blank agent session cleanup');
      continue;
    }

    let agentIds: string[];
    try {
      agentIds = await unifiedPersistence.listAgents(workspaceId);
    } catch (error) {
      result.errors++;
      logger.debug('Failed to list agents for blank agent session cleanup', { workspaceId, error });
      continue;
    }

    result.scanned += agentIds.length;
    const settled = await Promise.allSettled(
      agentIds.map((agentId) => cleanupAgentFile(workspaceId, agentId, now)),
    );

    for (let index = 0; index < settled.length; index++) {
      const settledResult = settled[index];
      if (settledResult.status === 'fulfilled') {
        if (settledResult.value) {
          result.removed++;
        }
      } else {
        result.errors++;
        logger.debug('Failed to clean up blank agent session file', {
          workspaceId,
          agentId: agentIds[index],
          error: settledResult.reason,
        });
      }
    }
  }

  if (result.removed > 0) {
    logger.info('Cleaned up blank agent session files on startup', result);
  }

  return result;
}
