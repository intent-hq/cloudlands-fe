/**
 * MCP Module Entry Point
 *
 * Exports the MCP hub and related functionality.
 */

import { McpHub } from './hub/mcp-hub';
import type { BrowserWindow } from 'electron';
import { Logger } from '../../../shared/logger';
import { WorkspaceConfig } from '../../../shared/main/config.js';
import { initGlobalDisabledMcpServers } from './user-mcp-settings';
const logger = new Logger('MCP');

// Singleton instance
let mcpHub: McpHub | null = null;

/**
 * Setup and start the Model Context Protocol (MCP) hub.
 * Initializes the hub with default configuration and event listeners.
 *
 * @param mainWindow - Optional Electron browser window for IPC communication
 * @returns The initialized MCP hub instance
 * @throws Error if hub is already initialized
 * @example
 * ```typescript
 * const hub = await setupMcpHub(mainWindow);
 * // Hub is now ready to manage MCP servers
 * ```
 */
export async function setupMcpHub(mainWindow?: BrowserWindow): Promise<McpHub> {
  if (mcpHub) {
    logger.warn('MCP Hub already initialized');
    return mcpHub;
  }

  logger.info('Setting up MCP Hub');

  mcpHub = new McpHub({
    maxRetries: 3,
    retryDelay: 1000,
    healthCheckInterval: 30000,
    requestTimeout: 30000,
  });

  if (mainWindow) {
    mcpHub.setMainWindow(mainWindow);
  }

  // Listen for hub events
  mcpHub.on('event', (event: any) => {
    logger.debug('MCP Hub event:', event);
  });

  logger.info('MCP Hub setup complete');

  // Hydrate daemon-owned MCP settings so sync consumers (per-workspace
  // disabled-list merge) see the correct global default.
  initGlobalDisabledMcpServers().catch((err) =>
    logger.warn('Failed to init mcp.disabledServers hydration', {
      error: err instanceof Error ? err.message : String(err),
    }),
  );

  return mcpHub;
}

/**
 * Start MCP servers for a workspace.
 * Initializes workspace, notes, and git servers in parallel for better performance.
 *
 * @param workspaceId - Unique identifier of the workspace
 * @param workspacePath - Optional path to the workspace directory
 * @param onProgress - Optional callback for progress updates
 * @throws Error if MCP hub is not initialized or server startup fails
 * @example
 * ```typescript
 * await startWorkspaceServers(
 *   'workspace-123',
 *   '/path/to/workspace',
 *   (status) => console.log(`${status.step}: ${status.message}`)
 * );
 * ```
 */
export async function startWorkspaceServers(
  workspaceId: string,
  workspacePath?: string,
  onProgress?: (status: { step: string; message: string }) => void,
): Promise<void> {
  if (!mcpHub) {
    throw new Error('MCP Hub not initialized');
  }
  const hub = mcpHub;

  const metadataPath = WorkspaceConfig.paths.workspace(workspaceId);

  logger.info(`Starting MCP servers for workspace ${workspaceId}`);
  onProgress?.({ step: 'initializing', message: 'Initializing MCP servers...' });

  // Start all servers in parallel for better performance
  const serverConfigs = [
    {
      id: `workspace-${workspaceId}`,
      name: 'Workspace Server',
      type: 'workspace' as const,
      workspaceId,
      workspacePath,
      metadataPath,
    },
    {
      id: `notes-${workspaceId}`,
      name: 'Notes Server',
      type: 'notes' as const,
      workspaceId,
      workspacePath,
      metadataPath,
    },
    {
      id: `git-${workspaceId}`,
      name: 'Git Server',
      type: 'git' as const,
      workspaceId,
      workspacePath,
      metadataPath,
    },
  ];

  try {
    // Start all servers in parallel
    await Promise.all(
      serverConfigs.map(async (config) => {
        onProgress?.({
          step: 'starting',
          message: `Starting ${config.name}...`,
        });
        await hub.startServer(config);
        onProgress?.({
          step: 'started',
          message: `${config.name} ready`,
        });
      }),
    );

    logger.info(`MCP servers started for workspace ${workspaceId}`);
    onProgress?.({ step: 'complete', message: 'All servers ready' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      `Failed to start MCP servers for workspace ${workspaceId}:`,
      error instanceof Error ? error : new Error(errorMessage),
    );
    onProgress?.({
      step: 'error',
      message: `Failed to start servers: ${errorMessage}`,
    });
    throw error;
  }
}

/**
 * Stop all MCP servers associated with a workspace.
 * Gracefully shuts down workspace, notes, and git servers.
 *
 * @param workspaceId - Unique identifier of the workspace
 * @example
 * ```typescript
 * await stopWorkspaceServers('workspace-123');
 * // All servers for workspace-123 are now stopped
 * ```
 */
export async function stopWorkspaceServers(workspaceId: string): Promise<void> {
  if (!mcpHub) {
    return;
  }

  logger.info(`Stopping MCP servers for workspace ${workspaceId}`);

  await Promise.all([
    mcpHub.stopServer(`workspace-${workspaceId}`),
    mcpHub.stopServer(`notes-${workspaceId}`),
    mcpHub.stopServer(`git-${workspaceId}`),
  ]);

  logger.info(`MCP servers stopped for workspace ${workspaceId}`);
}

/**
 * Execute an MCP tool with the specified parameters.
 * Routes the tool call through the MCP hub to the appropriate server.
 *
 * @param toolName - Name of the tool to execute
 * @param params - Parameters to pass to the tool
 * @param actor - Optional actor information for attribution
 * @returns Tool execution result
 * @throws Error if MCP hub is not initialized
 * @example
 * ```typescript
 * const result = await callMcpTool(
 *   'workspace_read_file',
 *   { path: 'src/app.ts' },
 *   { type: 'agent', id: 'agent-123', name: 'Code Assistant' }
 * );
 * ```
 */
export async function callMcpTool(toolName: string, params: any, actor?: any): Promise<any> {
  if (!mcpHub) {
    throw new Error('MCP Hub not initialized');
  }

  return mcpHub.callTool(
    toolName as any,
    params,
    actor || {
      type: 'agent',
      id: 'system',
      name: 'System',
    },
  );
}

/**
 * Get the current status of the MCP hub and its servers.
 *
 * @returns Status object with initialization state and server information
 * @example
 * ```typescript
 * const status = getMcpStatus();
 * if (status.initialized) {
 *   console.log('Servers:', status.servers);
 * }
 * ```
 */
export function getMcpStatus(): any {
  if (!mcpHub) {
    return { initialized: false };
  }

  return {
    initialized: true,
    servers: mcpHub.getServerStatus(),
  };
}

/**
 * Gracefully shutdown the MCP hub and all running servers.
 * Should be called during application shutdown.
 *
 * @example
 * ```typescript
 * // During app shutdown
 * await shutdownMcpHub();
 * ```
 */
export async function shutdownMcpHub(): Promise<void> {
  if (!mcpHub) {
    return;
  }

  logger.info('Shutting down MCP Hub');

  await mcpHub.shutdown();
  mcpHub = null;

  logger.info('MCP Hub shutdown complete');
}

// Export types
export * from '../types/schemas';
export * from '../types/events';
export type { McpHub } from './hub/mcp-hub';
export type { McpServerConfig } from './hub/mcp-hub';
