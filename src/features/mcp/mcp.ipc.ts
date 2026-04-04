/**
 * MCP IPC
 *
 * IPC layer for Model Context Protocol operations.
 * Uses the new hub-based architecture.
 */

import { ipcMain, BrowserWindow } from 'electron';
import {
  setupMcpHub,
  startWorkspaceServers,
  stopWorkspaceServers,
  callMcpTool,
  getMcpStatus,
  type McpHub,
} from './main/index';
// getWorkspaceEventService removed — Redux handles events now
import { Logger } from '$shared/logger';
import { MCP_CHANNELS } from '$shared/ipc/channels';
import { createWorkspaceId, isValidWorkspaceId } from '$shared/types/branded-ids';
import { workspaceService } from '../workspace/main/workspace.service';
import { IPCRateLimiter } from '../ipc/ipc-validation';
import { createSafeValidatedHandler } from '../../main/ipc-validation-middleware';
import {
  McpTransitionWorkspaceSchema,
  McpCallToolSchema,
  McpListToolsSchema,
  McpCreateServerSchema,
  McpGetStatusSchema,
} from '../../main/ipc-schemas';

// Logger instance
const logger = new Logger('MCP-IPC');

// Track active workspaces
const activeWorkspaces = new Set<string>();

// Map optimistic workspace IDs to real workspace IDs
const workspaceIdMap = new Map<string, string>();

// MCP Hub instance
let mcpHub: McpHub | null = null;

// Rate limiter for MCP calls
const rateLimiter = new IPCRateLimiter(60); // 60 calls per minute

async function resolveWorkspacePathForMcp(workspaceId: string): Promise<string> {
  if (!isValidWorkspaceId(workspaceId)) {
    throw new Error(`Expected real workspace UUID, got: ${workspaceId}`);
  }

  const result = await workspaceService.getWorkspace(createWorkspaceId(workspaceId));
  if (!result.ok) {
    throw new Error(result.error);
  }

  const workspacePath = workspaceService.getEffectiveWorkspacePath(result.data);
  if (!workspacePath) {
    throw new Error('Workspace has no repository/worktree path');
  }

  return workspacePath;
}

/**
 * Setup MCP IPC handlers
 */
export async function setupMCPIPC(mainWindow?: BrowserWindow) {
  logger.debug('Setting up MCP IPC handlers');

  // Initialize the MCP hub
  mcpHub = await setupMcpHub(mainWindow);

  // Forward MCP events to renderer
  mcpHub.on('event', (event: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(MCP_CHANNELS.EVENT, event);
    }
  });

  // Handle workspace ID transitions (optimistic -> real)
  ipcMain.handle(
    MCP_CHANNELS.TRANSITION_WORKSPACE,
    createSafeValidatedHandler(
      McpTransitionWorkspaceSchema,
      async (_, validated) => {
        try {
          logger.info(
            `Transitioning MCP workspace from ${validated.optimisticId} to ${validated.realId}`,
          );

          // Store the mapping
          workspaceIdMap.set(validated.optimisticId, validated.realId);

          // If servers were started for the optimistic ID, stop them
          if (activeWorkspaces.has(validated.optimisticId)) {
            await stopWorkspaceServers(validated.optimisticId);
            activeWorkspaces.delete(validated.optimisticId);
          }

          // Start servers for the real ID if not already started
          if (!activeWorkspaces.has(validated.realId)) {
            const workspacePath = await resolveWorkspacePathForMcp(validated.realId);
            await startWorkspaceServers(validated.realId, workspacePath);
            activeWorkspaces.add(validated.realId);
          }

          return { success: true };
        } catch (error) {
          logger.error('Failed to transition workspace:', error as Error);
          return {
            success: false,
            error: (error as Error).message,
          };
        }
      },
      MCP_CHANNELS.TRANSITION_WORKSPACE,
    ),
  );

  // Call an MCP tool
  ipcMain.handle(
    MCP_CHANNELS.CALL_TOOL,
    createSafeValidatedHandler(
      McpCallToolSchema,
      async (event, validated) => {
        // Rate limiting
        const senderId = event.sender.id.toString();
        if (!rateLimiter.canCall(MCP_CHANNELS.CALL_TOOL, senderId)) {
          return {
            success: false,
            error: 'Rate limit exceeded. Please wait before making more requests.',
          };
        }

        // Get actor information from the event
        const actor = {
          type: 'agent' as const,
          id: senderId,
          name: 'Agent',
        };

        const effectiveWorkspaceId =
          workspaceIdMap.get(validated.workspaceId) || validated.workspaceId;

        // Don't attempt MCP operations against an unresolved optimistic workspace.
        if (
          validated.workspaceId.startsWith('optimistic-') &&
          effectiveWorkspaceId === validated.workspaceId
        ) {
          return {
            success: false,
            error: 'Workspace is still being created. Please retry shortly.',
          };
        }

        if (effectiveWorkspaceId !== validated.workspaceId) {
          logger.debug(
            `Mapping optimistic workspace ${validated.workspaceId} to real workspace ${effectiveWorkspaceId}`,
          );
        }

        try {
          logger.debug(`Calling tool ${validated.toolName} for workspace ${effectiveWorkspaceId}`);

          const workspacePath = await resolveWorkspacePathForMcp(effectiveWorkspaceId);

          // Ensure servers are started for this workspace
          if (!activeWorkspaces.has(effectiveWorkspaceId)) {
            await startWorkspaceServers(effectiveWorkspaceId, workspacePath);
            activeWorkspaces.add(effectiveWorkspaceId);
          }

          // Map old tool names to new ones for backward compatibility
          let mappedToolName = validated.toolName;
          if (validated.toolName === 'add_spec_comment') {
            mappedToolName = 'spec.addComment';
          } else if (validated.toolName === 'list_spec_comments') {
            mappedToolName = 'spec.listComments';
          } else if (validated.toolName === 'suggest_spec_change') {
            mappedToolName = 'spec.suggestChange';
          } else if (validated.toolName === 'update_comment_status') {
            mappedToolName = 'spec.updateCommentStatus';
          }

          // Call the tool through the hub
          const result = await callMcpTool(
            mappedToolName,
            {
              workspaceId: effectiveWorkspaceId,
              ...(validated.arguments || {}),
            },
            actor,
          );

          return {
            success: true,
            result,
          };
        } catch (error) {
          logger.error(
            'Tool call failed:',
            error instanceof Error ? error : new Error(String(error)),
          );

          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      MCP_CHANNELS.CALL_TOOL,
    ),
  );

  // List available tools
  ipcMain.handle(
    MCP_CHANNELS.LIST_TOOLS,
    createSafeValidatedHandler(
      McpListToolsSchema,
      async (_, validated) => {
        try {
          const effectiveWorkspaceId =
            workspaceIdMap.get(validated.workspaceId) || validated.workspaceId;

          if (
            validated.workspaceId.startsWith('optimistic-') &&
            effectiveWorkspaceId === validated.workspaceId
          ) {
            return {
              success: false,
              error: 'Workspace is still being created. Please retry shortly.',
            };
          }

          // Ensure servers are started for this workspace
          if (!activeWorkspaces.has(effectiveWorkspaceId)) {
            const workspacePath = await resolveWorkspacePathForMcp(effectiveWorkspaceId);

            await startWorkspaceServers(effectiveWorkspaceId, workspacePath);
            activeWorkspaces.add(effectiveWorkspaceId);
          }

          // Get available tools from the hub
          const tools = [];

          // Extract tools from server status
          // This is a simplified version - in production, servers would report their tools
          tools.push(
            // Workspace tools
            { name: 'workspace.get', description: 'Get workspace information' },
            { name: 'workspace.update', description: 'Update workspace metadata' },
            { name: 'workspace.listSessions', description: 'List agent sessions' },
            {
              name: 'workspace.createSession',
              description: 'Create agent session',
            },

            // Notes tools
            { name: 'notes.list', description: 'List all notes' },
            { name: 'notes.create', description: 'Create a new note' },
            { name: 'notes.update', description: 'Update a note' },
            { name: 'notes.addComment', description: 'Add comment to note' },
            { name: 'notes.listComments', description: 'List comments for a note' },
            { name: 'notes.delete', description: 'Delete a note' },
            { name: 'notes.suggestChange', description: 'Suggest a change to a note' },
            { name: 'notes.updateCommentStatus', description: 'Update comment status' },

            // Git tools
            { name: 'git.status', description: 'Get git status' },
            { name: 'git.diff', description: 'Get git diff' },
            { name: 'git.commit', description: 'Create git commit' },
            { name: 'git.branch', description: 'Manage branches' },

            // File system tools
            { name: 'fs.read', description: 'Read a file' },
            { name: 'fs.write', description: 'Write a file' },
            { name: 'fs.applyPatch', description: 'Apply a patch' },
            { name: 'fs.delete', description: 'Delete a file' },
            { name: 'fs.rename', description: 'Rename or move a file' },
            { name: 'fs.mkdir', description: 'Create a directory' },
          );

          return {
            success: true,
            tools,
          };
        } catch (error) {
          logger.error(
            'Failed to list tools:',
            error instanceof Error ? error : new Error(String(error)),
          );
          return {
            success: false,
            error: (error as Error).message,
          };
        }
      },
      MCP_CHANNELS.LIST_TOOLS,
    ),
  );

  // Create MCP server for a workspace
  ipcMain.handle(
    MCP_CHANNELS.CREATE_SERVER,
    createSafeValidatedHandler(
      McpCreateServerSchema,
      async (_, validated) => {
        try {
          logger.debug(`Creating servers for workspace ${validated.workspaceId}`);

          await startWorkspaceServers(validated.workspaceId, validated.workspacePath);
          activeWorkspaces.add(validated.workspaceId);

          return {
            success: true,
          };
        } catch (error) {
          logger.error(
            'Failed to create servers:',
            error instanceof Error ? error : new Error(String(error)),
          );
          return {
            success: false,
            error: (error as Error).message,
          };
        }
      },
      MCP_CHANNELS.CREATE_SERVER,
    ),
  );

  // Get MCP server status
  ipcMain.handle(
    MCP_CHANNELS.GET_STATUS,
    createSafeValidatedHandler(
      McpGetStatusSchema,
      async () => {
        try {
          const status = getMcpStatus();
          return {
            success: true,
            status,
          };
        } catch (error) {
          logger.error(
            'Failed to get status:',
            error instanceof Error ? error : new Error(String(error)),
          );
          return {
            success: false,
            error: (error as Error).message,
          };
        }
      },
      MCP_CHANNELS.GET_STATUS,
    ),
  );

  logger.debug('MCP IPC handlers setup complete');
}

/**
 * Cleanup all MCP servers on app shutdown.
 * Stops all active workspace servers and the MCP Hub.
 */
export async function cleanupMCP(): Promise<void> {
  logger.info('Cleaning up MCP servers', { activeWorkspaces: activeWorkspaces.size });

  try {
    // Stop all active workspace servers
    const stopPromises = Array.from(activeWorkspaces).map(async (workspaceId) => {
      try {
        await stopWorkspaceServers(workspaceId);
      } catch (error) {
        logger.warn(`Failed to stop workspace servers for ${workspaceId}`, {
          error: (error as Error).message,
        });
      }
    });
    await Promise.all(stopPromises);
    activeWorkspaces.clear();

    // Stop all remaining servers through the hub (catches any not tracked in activeWorkspaces)
    if (mcpHub) {
      await mcpHub.stopAllServers();
      mcpHub = null;
    }

    logger.info('MCP cleanup complete');
  } catch (error) {
    logger.error('Error during MCP cleanup:', error instanceof Error ? error : new Error(String(error)));
  }
}
