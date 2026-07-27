/**
 * Change Converters
 *
 * Utilities to convert different change sources to the standard TrackedChange format
 * Provides robust conversion with validation, error handling, and type safety.
 */

import type { TrackedChange, FileStats, AgentAttribution } from './types';
import { ChangeStage } from './types';
import type { WorkspaceEvent, CodeChange } from '../events/types';
import { Logger } from '$lib/utils/logger';
import { m } from '$shared/paraglide/messages.js';

const logger = new Logger({ category: 'change-converters' });

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Git status file information
 */
export interface GitStatusFile {
  path: string;
  staged?: boolean;
  additions?: number;
  deletions?: number;
  binary?: boolean;
}

/**
 * Extended event data structure for file changes
 */
interface FileChangeData {
  path?: string;
  file?: string;
  filePath?: string;
  relativePath?: string;
  action?: string;
  additions?: number;
  deletions?: number;
  stage?: string;
  diff?: string;
  content?: string;
  oldContent?: string;
  newContent?: string;
  binary?: boolean;
  sessionId?: string;
  turnNumber?: number;
  agentId?: string;
  agentName?: string;
  fileChanges?: FileChangeData[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Safely extract file path from multiple possible locations
 */
function extractFilePath(data: FileChangeData, codeChange?: CodeChange): string | undefined {
  return data.path || data.file || data.filePath || data.relativePath || codeChange?.filePath;
}

/**
 * Safely extract file statistics with proper fallbacks
 */
function extractFileStats(data: FileChangeData, codeChange?: CodeChange): FileStats {
  return {
    additions: data.additions ?? codeChange?.additions ?? 0,
    deletions: data.deletions ?? codeChange?.deletions ?? 0,
    binary: data.binary ?? false,
  };
}

/**
 * Create agent attribution from event data
 * Extracts sessionId and turnNumber from actor (preferred) or eventData (fallback)
 */
function createAgentAttribution(
  eventData: FileChangeData,
  event: WorkspaceEvent,
): AgentAttribution | undefined {
  if (event.actor?.type === 'agent' && event.actor.id) {
    // Actor now includes sessionId and turnNumber from the attribution flow
    const actor = event.actor as {
      type: 'agent';
      id: string;
      name?: string;
      sessionId?: string;
      turnNumber?: number;
      messageId?: string;
    };
    return {
      agentId: actor.id,
      agentName: actor.name || m.fileTracking_changeTimeline_agent_fallback(),
      // Prefer actor fields (from attribution flow), fall back to eventData
      sessionId: actor.sessionId || eventData.sessionId || '',
      turnNumber: actor.turnNumber ?? eventData.turnNumber ?? 0,
      messageId: actor.messageId,
      timestamp: new Date(event.timestamp).getTime(),
    };
  }

  if (eventData.agentId) {
    return {
      agentId: eventData.agentId,
      agentName: eventData.agentName || m.fileTracking_changeTimeline_agent_fallback(),
      sessionId: eventData.sessionId || '',
      turnNumber: eventData.turnNumber || 0,
      timestamp: new Date(event.timestamp).getTime(),
    };
  }

  return undefined;
}

/**
 * Create attribution object
 */
function createAttribution(event: WorkspaceEvent, eventData: FileChangeData) {
  return {
    timestamp: new Date(event.timestamp).getTime(),
    manual: event.actor?.type === 'user',
    agent: createAgentAttribution(eventData, event),
  };
}

/**
 * Extract content information from event data
 */
function extractContent(data: FileChangeData, codeChange?: CodeChange) {
  return {
    oldContent: codeChange?.oldContent ?? data.oldContent,
    newContent: codeChange?.newContent ?? data.newContent,
    diff: data.diff ?? codeChange?.diff,
  };
}

/**
 * Generate a unique change ID
 */
function generateChangeId(prefix: string, eventId: string, index?: number): string {
  return index !== undefined ? `${prefix}-${eventId}-${index}` : `${prefix}-${eventId}`;
}

// ============================================================================
// Main Conversion Functions
// ============================================================================

/**
 * Convert a workspace event to TrackedChange format
 * @param event - The workspace event to convert
 * @returns Array of tracked changes
 */
export function eventToTrackedChange(event: WorkspaceEvent): TrackedChange[] {
  try {
    const eventData = (event as WorkspaceEvent & { data?: FileChangeData }).data || {};
    const codeChange = (event as WorkspaceEvent & { codeChange?: CodeChange }).codeChange;

    logger.debug('Converting event to TrackedChange', {
      eventType: event.type,
      eventId: event.id,
      hasData: !!eventData,
      hasCodeChange: !!codeChange,
    });

    // Extract file path from various locations
    const filePath = extractFilePath(eventData, codeChange);

    // For file events, create a single change entry
    if (event.type.startsWith('file:') && filePath) {
      const stats = extractFileStats(eventData, codeChange);

      logger.debug('Creating TrackedChange for file event', {
        filePath,
        stats,
        hasDiff: !!(eventData.diff || codeChange?.diff),
      });

      return [
        {
          id: generateChangeId('event', event.id),
          file: filePath,
          relativePath: filePath,
          stage: ChangeStage.Unstaged,
          stats,
          attribution: createAttribution(event, eventData),
          content: extractContent(eventData, codeChange),
        },
      ];
    }

    // For agent events with file changes
    if (
      (event.type === 'agent:completed' || event.type.startsWith('agent:')) &&
      eventData.fileChanges &&
      Array.isArray(eventData.fileChanges)
    ) {
      logger.debug('Creating TrackedChanges for agent event', {
        eventType: event.type,
        fileChangesCount: eventData.fileChanges.length,
        agentId: eventData.agentId,
      });

      return eventData.fileChanges
        .filter((change: FileChangeData) => {
          const path = extractFilePath(change);
          if (!path) {
            logger.warn('Skipping file change without path', { change });
            return false;
          }
          return true;
        })
        .map((change: FileChangeData, index: number) => {
          const path = extractFilePath(change);
          if (!path) {
            // Unreachable: entries without a path were removed by the filter above
            throw new Error('file change without path');
          }
          return {
            id: generateChangeId('event', event.id, index),
            file: path,
            relativePath: path,
            stage: ChangeStage.Unstaged,
            stats: extractFileStats(change),
            attribution: createAttribution(event, eventData),
            content: extractContent(change),
          };
        });
    }

    logger.debug('No TrackedChanges created for event', {
      eventType: event.type,
      eventId: event.id,
      hasFilePath: !!filePath,
      hasFileChanges: !!(eventData.fileChanges && Array.isArray(eventData.fileChanges)),
    });

    return [];
  } catch (error) {
    logger.error(
      // i18n-ignore (log message, not user-facing)
      'Error converting event to TrackedChange',
      error instanceof Error ? error : new Error(String(error)),
      {
        eventType: event.type,
        eventId: event.id,
      },
    );
    return [];
  }
}

/**
 * Convert git status files to TrackedChange format
 * @param files - Array of git status files
 * @returns Array of tracked changes
 */
export function gitStatusToTrackedChanges(files: GitStatusFile[]): TrackedChange[] {
  if (!Array.isArray(files)) {
    logger.warn('Invalid input to gitStatusToTrackedChanges', { files });
    return [];
  }

  return files
    .filter((file) => {
      if (!file || !file.path) {
        logger.warn('Skipping invalid git status file', { file });
        return false;
      }
      return true;
    })
    .map((file, index) => ({
      id: `git-${index}-${file.path}`,
      file: file.path,
      relativePath: file.path,
      stage: file.staged ? ChangeStage.Staged : ChangeStage.Unstaged,
      stats: {
        additions: file.additions ?? 0,
        deletions: file.deletions ?? 0,
        binary: file.binary ?? false,
      },
      attribution: {
        timestamp: Date.now(),
        manual: true,
      },
    }));
}

/**
 * Convert staged/unstaged changes to TrackedChange format
 * @param staged - Array of staged file paths
 * @param unstaged - Array of unstaged file paths
 * @param getStats - Optional function to get file statistics
 * @returns Array of tracked changes with deduplication
 */
export function stagedChangesToTrackedChanges(
  staged: string[],
  unstaged: string[],
  getStats?: (path: string) => FileStats | undefined,
): TrackedChange[] {
  const changes: TrackedChange[] = [];
  const processedPaths = new Set<string>();

  /**
   * Helper to create a change entry
   */
  const createChange = (path: string, stage: ChangeStage, index: number): TrackedChange => {
    const stats = getStats?.(path) ?? { additions: 0, deletions: 0, binary: false };
    return {
      id: `${stage === ChangeStage.Staged ? 'staged' : 'unstaged'}-${index}-${path}`,
      file: path,
      relativePath: path,
      stage,
      stats,
      attribution: {
        timestamp: Date.now(),
        manual: true,
      },
    };
  };

  // Add staged files
  if (Array.isArray(staged)) {
    staged.forEach((path, index) => {
      if (path && !processedPaths.has(path)) {
        changes.push(createChange(path, ChangeStage.Staged, index));
        processedPaths.add(path);
      }
    });
  }

  // Add unstaged files (skip if already in staged)
  if (Array.isArray(unstaged)) {
    unstaged.forEach((path, index) => {
      if (path && !processedPaths.has(path)) {
        changes.push(createChange(path, ChangeStage.Unstaged, index));
        processedPaths.add(path);
      }
    });
  }

  return changes;
}
