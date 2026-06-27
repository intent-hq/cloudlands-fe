/**
 * Utility for tracking and displaying agent file edits in the file tree
 */

import { invoke } from '$lib/electron-bridge';
import type { WorkspaceEvent } from '$features/events/types';
import { Logger } from '$shared/logger';

const logger = new Logger('AgentFileEdits');

export interface AgentFileEdit {
  agentId: string;
  filePath: string;
  timestamp: string;
}

/**
 * Get recent file edits for all agents in a workspace
 * Returns a map of file paths (relative) to arrays of agent IDs who edited them
 */
export async function getAgentFileEdits(
  workspaceId: string,
  filesPerAgent: number = 3,
): Promise<Map<string, string[]>> {
  try {
    // Query for file change events by agents via IPC
    logger.info('[AgentEdits] Querying events', { workspaceId });
    const result = await invoke<WorkspaceEvent[] | { data: WorkspaceEvent[] }>(
      'events:query',
      {
        workspaceId,
        filters: [
          { field: 'actor.type', operator: 'equals', value: 'agent' },
          { field: 'type', operator: 'in', value: ['file:changed', 'file:created'] },
        ],
        limit: 100,
      },
    );
    const events = Array.isArray(result) ? result : result?.data || [];

    logger.info('[AgentEdits] Query result', {
      eventCount: events?.length ?? 0,
      sampleEvents: events?.slice(0, 3).map((e) => ({
        type: e.type,
        actorType: e.actor?.type,
        actorId: e.actor?.id,
        path: e.data?.path,
        relativePath: e.data?.relativePath,
      })),
    });

    if (!events || events.length === 0) {
      logger.info('[AgentEdits] No events found');
      return new Map();
    }

    // Group events by agent, keeping only the most recent N files per agent
    const agentFiles = new Map<string, string[]>(); // agentId -> file paths (most recent first)

    for (const event of events) {
      const agentId = event.actor?.id;
      // Prefer relativePath, fall back to path
      const filePath = event.data?.relativePath || event.data?.path || event.data?.filePath;

      if (!agentId || !filePath) continue;

      let files = agentFiles.get(agentId);
      if (!files) {
        files = [];
        agentFiles.set(agentId, files);
      }
      // Only add if not already in the list and we haven't reached the limit
      if (!files.includes(filePath) && files.length < filesPerAgent) {
        files.push(filePath);
      }
    }

    // Now invert the map: file path -> agent IDs
    const fileToAgents = new Map<string, string[]>();

    for (const [agentId, files] of agentFiles.entries()) {
      for (const filePath of files) {
        let agents = fileToAgents.get(filePath);
        if (!agents) {
          agents = [];
          fileToAgents.set(filePath, agents);
        }
        if (!agents.includes(agentId)) {
          agents.push(agentId);
        }
      }
    }

    logger.debug('Loaded agent file edits', {
      workspaceId,
      filesWithEdits: fileToAgents.size,
      totalAgents: agentFiles.size,
      paths: Array.from(fileToAgents.keys()).slice(0, 5),
    });

    return fileToAgents;
  } catch (error) {
    logger.error('Failed to get agent file edits', error as Error, { workspaceId });
    return new Map();
  }
}

/**
 * Propagate agent edits from files to their parent directories
 * If a file has agent edits but isn't visible, show them on the nearest visible parent
 *
 * @param fileToAgents - Map of file paths (relative to project) to agent IDs
 * @param fileTreeRoot - Root path of the file tree display
 * @param projectPath - Actual project path (worktreePath) where events occurred
 */
export function propagateAgentEditsToParents(
  fileToAgents: Map<string, string[]>,
  fileTreeRoot: string,
  projectPath: string = '',
): Map<string, string[]> {
  const result = new Map<string, string[]>();

  // Calculate the relative path from file tree root to project
  // e.g., if fileTreeRoot=/Users/x/augment and projectPath=/Users/x/augment/experimental/amelia/workspaces
  // then projectRelative="experimental/amelia/workspaces"
  let projectRelative = '';
  if (projectPath && fileTreeRoot && projectPath.startsWith(fileTreeRoot)) {
    projectRelative = projectPath.slice(fileTreeRoot.length).replace(/^\//, '');
  }

  logger.debug('Propagating agent edits', {
    fileTreeRoot,
    projectPath,
    projectRelative,
    eventCount: fileToAgents.size,
  });

  for (const [eventPath, agentIds] of fileToAgents.entries()) {
    // Build the full path relative to file tree root
    // e.g., "src/lib/file.ts" becomes "experimental/amelia/workspaces/src/lib/file.ts"
    const fullRelativePath = projectRelative
      ? `${projectRelative}/${eventPath}`
      : eventPath;

    // Add the file itself
    let fileAgents = result.get(fullRelativePath);
    if (!fileAgents) {
      fileAgents = [];
      result.set(fullRelativePath, fileAgents);
    }
    for (const agentId of agentIds) {
      if (!fileAgents.includes(agentId)) {
        fileAgents.push(agentId);
      }
    }

    // Split path into parts and create all parent paths
    const parts = fullRelativePath.split('/').filter(Boolean);

    // Walk up the directory tree, creating parent paths
    for (let i = parts.length - 2; i >= 0; i--) {
      const parentPath = parts.slice(0, i + 1).join('/');

      let parentAgents = result.get(parentPath);
      if (!parentAgents) {
        parentAgents = [];
        result.set(parentPath, parentAgents);
      }

      // Add agent IDs to parent (avoiding duplicates)
      for (const agentId of agentIds) {
        if (!parentAgents.includes(agentId)) {
          parentAgents.push(agentId);
        }
      }
    }
  }

  logger.debug('Propagated agent edits to parents', {
    originalCount: fileToAgents.size,
    withParentsCount: result.size,
    samplePaths: Array.from(result.keys()).slice(0, 10),
  });

  return result;
}
