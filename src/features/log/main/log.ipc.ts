/**
 * Log IPC
 *
 * IPC layer for log operations and event tracking.
 * All channels follow the feature:action naming convention.
 *
 * Handles:
 * - Event tracking from main process
 * - Log file operations
 * - Event persistence
 */

import { ipcMain, app } from 'electron';
import path from 'path';
import { z } from 'zod';
import { mainLogger } from './main-logger';
import { sendToWorkspaceWindows } from '../../system/main/system.ipc';
import type { CommandResponse } from '../../../shared/types';
import { WorkspaceEvent, WorkspaceEventType } from '../../events/types';
import { FileSystemLogRepository } from './log.repository';
import type { LogRepository } from './log.repository';
import { createWorkspaceEvent } from '../../events/types';
import { EventStore } from '../../events/main/event-store';
import { LOG_CHANNELS } from '../../../shared/ipc/channels';
import { mainDispatch } from '../../../store/main/redux-store-bridge';
import { emitWorkspaceEvent as reduxEmitWorkspaceEvent } from '../../../store/main/slices/workspace-events/workspace-events-slice';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { EmptySchema } from '../../../main/ipc-schemas';

// ============================================================================
// Types
// ============================================================================

interface LogPaths {
  mainLog: string;
  rendererLog: string;
  logDirectory: string;
}

// ============================================================================
// Validation Schemas
// ============================================================================

const TrackFileChangeSchema = z.object({
  workspaceId: z.string(),
  action: z.enum(['create', 'modify', 'delete']),
  filePath: z.string(),
  additions: z.number().optional(),
  deletions: z.number().optional(),
  diff: z.string().optional(),
  actor: z.any(),
  agentId: z.string().optional(),
  exchangeId: z.string().optional(),
});

const TrackAgentEventSchema = z.object({
  workspaceId: z.string(),
  eventType: z.string(),
  title: z.string(),
  actor: z.any(),
  description: z.string().optional(),
  metadata: z.any().optional(),
  agentId: z.string().optional(),
  exchangeId: z.string().optional(),
});

const TrackMcpCallSchema = z.object({
  workspaceId: z.string(),
  toolName: z.string(),
  actor: z.any(),
  success: z.boolean(),
  duration: z.number().optional(),
  error: z.string().optional(),
  metadata: z.any().optional(),
  agentId: z.string().optional(),
  exchangeId: z.string().optional(),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const GetEventsSchema = z.string(); // workspaceId
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ClearEventsSchema = z.string(); // workspaceId
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ReadLogSchema = z.object({
  type: z.enum(['main', 'renderer']),
  lines: z.number().optional(),
  filter: z.string().optional(),
});
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ClearLogSchema = z.enum(['main', 'renderer', 'all']).optional();
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const LogSummarySchema = z
  .object({
    hours: z.number().optional(),
    type: z.enum(['main', 'renderer']).optional(),
  })
  .optional();

const PersistRendererLogsSchema = z.array(
  z.object({
    timestamp: z.string(),
    level: z.string(),
    category: z.string(),
    message: z.string(),
    context: z.any().optional(),
    error: z
      .object({
        name: z.string(),
        message: z.string(),
        stack: z.string().optional(),
      })
      .optional(),
  }),
);

interface LogContent {
  content: string;
  path: string;
  exists: boolean;
  size?: number;
}

interface LogSummary {
  errors: number;
  warnings: number;
  info: number;
  debug: number;
  recent: string[];
  errorMessages: string[];
  warningMessages: string[];
}

// ============================================================================
// State
// ============================================================================

// Log repository instance (for application logs)
const logRepository: LogRepository = new FileSystemLogRepository();

/**
 * Convert Result type to CommandResponse type for IPC
 */
// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Determine tool kind from tool name for categorization
 */
function getToolKindFromName(
  toolName: string,
): 'file' | 'terminal' | 'search' | 'note' | 'git' | 'other' {
  const lowerName = toolName.toLowerCase();

  if (
    lowerName.includes('file') ||
    lowerName.includes('read') ||
    lowerName.includes('write') ||
    lowerName.includes('edit')
  ) {
    return 'file';
  }
  if (lowerName.includes('terminal') || lowerName.includes('exec') || lowerName.includes('shell')) {
    return 'terminal';
  }
  if (lowerName.includes('search') || lowerName.includes('find') || lowerName.includes('grep')) {
    return 'search';
  }
  if (lowerName.includes('note') || lowerName.includes('document')) {
    return 'note';
  }
  if (lowerName.includes('git') || lowerName.includes('commit') || lowerName.includes('branch')) {
    return 'git';
  }
  return 'other';
}

// ============================================================================
// IPC Handlers
// ============================================================================

export function setupLogIPC() {
  // ========================================================================
  // Event Tracking Handlers
  // ========================================================================

  // Track a file change event - delegate to activity log
  ipcMain.handle(
    LOG_CHANNELS.TRACK_FILE_CHANGE,
    createSafeValidatedHandler(
      TrackFileChangeSchema,
      async (_, validated): Promise<CommandResponse<any>> => {
        try {
          // Emit file change event via Redux
          const actor = validated.actor || { type: 'user' as const, name: 'User' };
          const fileEvent = createWorkspaceEvent(
            'file:changed',
            validated.workspaceId,
            actor as any,
            {
              path: validated.filePath,
              relativePath: validated.filePath,
              action: validated.action,
              additions: validated.additions,
              deletions: validated.deletions,
              diff: validated.diff,
            },
          );
          mainDispatch(reduxEmitWorkspaceEvent(fileEvent));

          // Return success
          return {
            success: true,
            data: {
              workspaceId: validated.workspaceId,
              filePath: validated.filePath,
              action: validated.action,
            },
          };
        } catch (error) {
          mainLogger.error('[LOG] Failed to track file change', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      LOG_CHANNELS.TRACK_FILE_CHANGE,
    ),
  );

  // Track an agent event - emit to the event system
  ipcMain.handle(
    LOG_CHANNELS.TRACK_AGENT_EVENT,
    createSafeValidatedHandler(
      TrackAgentEventSchema,
      async (_, validated): Promise<CommandResponse<WorkspaceEvent>> => {
        try {
          // Create and emit the agent event via Redux
          const event: WorkspaceEvent = {
            id: crypto.randomUUID(),
            type: (validated.eventType as WorkspaceEventType) || 'agent:message',
            timestamp: new Date().toISOString(),
            workspaceId: validated.workspaceId,
            actor: validated.actor || { type: 'agent', name: 'Agent' },
            title: validated.title,
            description: validated.description,
            agentId: validated.agentId,
            exchangeId: validated.exchangeId,
            metadata: validated.metadata,
          };

          // Emit through Redux (which handles persistence and broadcast via sagas)
          mainDispatch(reduxEmitWorkspaceEvent(event));

          mainLogger.debug('[LOG] Agent event tracked', {
            eventType: validated.eventType,
            title: validated.title,
          });

          return { success: true, data: event };
        } catch (error) {
          mainLogger.error('[LOG] Failed to track agent event', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      LOG_CHANNELS.TRACK_AGENT_EVENT,
    ),
  );

  // Track an MCP tool call - emit to the event system
  ipcMain.handle(
    LOG_CHANNELS.TRACK_MCP_CALL,
    createSafeValidatedHandler(
      TrackMcpCallSchema,
      async (_, validated): Promise<CommandResponse<WorkspaceEvent>> => {
        try {
          // Determine tool kind from tool name
          const toolKind = getToolKindFromName(validated.toolName);

          // Emit agent tool call event via Redux
          const toolEvent = createWorkspaceEvent(
            'agent:tool:call',
            validated.workspaceId,
            validated.actor || { type: 'agent' as const, name: 'Agent', id: '' },
            {
              toolName: validated.toolName,
              toolKind,
              metadata: validated.metadata || {},
              status: validated.success ? 'completed' : 'error',
              error: validated.error,
              duration: validated.duration,
            },
          );
          mainDispatch(reduxEmitWorkspaceEvent(toolEvent));

          mainLogger.debug('[LOG] MCP tool call tracked', {
            toolName: validated.toolName,
            success: validated.success,
          });

          return { success: true };
        } catch (error) {
          mainLogger.error('[LOG] Failed to track MCP call', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      LOG_CHANNELS.TRACK_MCP_CALL,
    ),
  );

  // Get all events for a workspace - delegate to activity log
  ipcMain.handle(
    LOG_CHANNELS.GET_EVENTS,
    async (_, workspaceId: string): Promise<CommandResponse<WorkspaceEvent[]>> => {
      try {
        // Query events from the EventStore
        const eventStore = new EventStore(workspaceId);
        const events = eventStore.getAll();

        // Return the events directly - they're already in WorkspaceEvent format
        return { success: true, data: events };
      } catch (error) {
        mainLogger.error('[LOG] Failed to get events', error as Error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  // Clear events for a workspace
  ipcMain.handle(
    LOG_CHANNELS.CLEAR_EVENTS,
    async (_, workspaceId: string): Promise<CommandResponse<void>> => {
      try {
        // Clear events from the EventStore
        const clearEventStore = new EventStore(workspaceId);
        await clearEventStore.clear();

        // Broadcast the clear event to workspace windows
        sendToWorkspaceWindows(workspaceId, 'events:cleared', workspaceId);
        return { success: true, data: undefined };
      } catch (error) {
        mainLogger.error('[LOG] Failed to clear events', error as Error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  // ========================================================================
  // Log File Handlers
  // ========================================================================

  // Get log file paths
  ipcMain.handle(
    LOG_CHANNELS.PATHS,
    createSafeValidatedHandler(
      EmptySchema,
      async (): Promise<CommandResponse<LogPaths>> => {
        try {
          const userDataPath = app.getPath('userData');
          const logPath = path.join(userDataPath, 'logs');

          return {
            success: true,
            data: {
              mainLog: path.join(logPath, 'main.log'),
              rendererLog: path.join(logPath, 'renderer.log'),
              logDirectory: logPath,
            },
          };
        } catch (error) {
          mainLogger.error('[LOG] Failed to get log paths', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      LOG_CHANNELS.PATHS,
    ),
  );

  // Read log file content
  ipcMain.handle(
    LOG_CHANNELS.READ,
    async (
      _,
      options: {
        type: 'main' | 'renderer';
        lines?: number;
        since?: string; // ISO date string
      },
    ): Promise<CommandResponse<LogContent>> => {
      try {
        const userDataPath = app.getPath('userData');
        const logPath = path.join(userDataPath, 'logs');
        const fileName = options.type === 'main' ? 'main.log' : 'renderer.log';
        const filePath = path.join(logPath, fileName);

        // Read file content using repository
        let content = await logRepository.readLogFile(options.type);

        // If content is empty, file doesn't exist
        if (!content) {
          return {
            success: true,
            data: {
              content: '',
              path: filePath,
              exists: false,
            },
          };
        }

        // Filter by date if specified
        if (options.since) {
          const sinceDate = new Date(options.since);
          const lines = content.split('\n');
          const filtered: string[] = [];

          for (const line of lines) {
            // Extract date from log line format: [YYYY-MM-DD HH:mm:ss.ms]
            const dateMatch = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\]/);
            if (dateMatch) {
              const lineDate = new Date(dateMatch[1].replace(' ', 'T'));
              if (lineDate >= sinceDate) {
                filtered.push(line);
              }
            } else if (filtered.length > 0) {
              // Include continuation lines
              filtered.push(line);
            }
          }

          content = filtered.join('\n');
        }

        // Limit lines if specified
        if (options.lines && options.lines > 0) {
          const lines = content.split('\n');
          content = lines.slice(-options.lines).join('\n');
        }

        return {
          success: true,
          data: {
            content,
            path: filePath,
            exists: true,
            size: content.length,
          },
        };
      } catch (error) {
        mainLogger.error('[LOG] Failed to read log file', error as Error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  // Clear log files
  ipcMain.handle(
    LOG_CHANNELS.CLEAR,
    async (_, type?: 'main' | 'renderer' | 'all'): Promise<CommandResponse<void>> => {
      try {
        // Clear logs using repository
        await logRepository.clearLogFile(type || 'all');
        mainLogger.info(`[LOG] Cleared log files: ${type || 'all'}`);

        return { success: true, data: undefined };
      } catch (error) {
        mainLogger.error('[LOG] Failed to clear logs', error as Error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  // Get log summary
  ipcMain.handle(
    LOG_CHANNELS.SUMMARY,
    async (
      _,
      options?: {
        hours?: number;
        includeErrors?: boolean;
        includeWarnings?: boolean;
        includeInfo?: boolean;
      },
    ): Promise<CommandResponse<LogSummary>> => {
      try {
        const hours = options?.hours || 1;
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);

        const userDataPath = app.getPath('userData');
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const logPath = path.join(userDataPath, 'logs');

        const summary: LogSummary = {
          errors: 0,
          warnings: 0,
          info: 0,
          debug: 0,
          recent: [],
          errorMessages: [],
          warningMessages: [],
        };

        // Read both log files using repository
        for (const type of ['main', 'renderer'] as const) {
          try {
            const content = await logRepository.readLogFile(type);
            const lines = content.split('\n');

            for (const line of lines) {
              // Extract date and level
              const match = line.match(
                /\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\]\s+\[(\w+)\]/,
              );
              if (match) {
                const lineDate = new Date(match[1].replace(' ', 'T'));
                const level = match[2].toUpperCase();

                if (lineDate >= since) {
                  // Count by level
                  switch (level) {
                    case 'ERROR':
                      summary.errors++;
                      if (options?.includeErrors !== false) {
                        summary.errorMessages.push(line);
                      }
                      break;
                    case 'WARN':
                    case 'WARNING':
                      summary.warnings++;
                      if (options?.includeWarnings !== false) {
                        summary.warningMessages.push(line);
                      }
                      break;
                    case 'INFO':
                      summary.info++;
                      break;
                    case 'DEBUG':
                      summary.debug++;
                      break;
                  }

                  // Add to recent if within time range
                  if (summary.recent.length < 100) {
                    summary.recent.push(line);
                  }
                }
              }
            }
          } catch {
            // File might not exist, continue
          }
        }

        return { success: true, data: summary };
      } catch (error) {
        mainLogger.error('[LOG] Failed to get log summary', error as Error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  // Persist renderer logs to disk
  ipcMain.handle(
    LOG_CHANNELS.PERSIST_RENDERER_LOGS,
    createSafeValidatedHandler(
      PersistRendererLogsSchema,
      async (_, validated): Promise<CommandResponse<void>> => {
        try {
          if (validated.length === 0) {
            return { success: true, data: undefined };
          }

          // Append logs to renderer.log file
          await logRepository.appendRendererLogs(validated);

          mainLogger.debug('[LOG] Persisted renderer logs', {
            count: validated.length,
          });

          return { success: true, data: undefined };
        } catch (error) {
          mainLogger.error('[LOG] Failed to persist renderer logs', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      LOG_CHANNELS.PERSIST_RENDERER_LOGS,
    ),
  );
}
