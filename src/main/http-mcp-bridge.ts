/**
 * HTTP MCP Bridge
 *
 * Exposes the existing MCP server (same one used by STDIO MCP) via HTTP.
 * This creates a transparent bridge so STDIO MCP can access all tools
 * without duplicating tool definitions.
 */

import { createRequire } from 'module';
import * as os from 'os';
import * as path from 'path';
import express, { Request, Response } from 'express';
import { app } from 'electron';
import { createServer } from 'http';
import { Logger } from '../shared/logger';
import {
  createWorkspaceMCPServer,
  registerPRTools,
  unregisterPRTools,
} from '../features/mcp/main/mcp/index';
import { type PRContext } from '../features/mcp/main/mcp/pr-comment-tools';
import { protocolAdapter } from '../features/protocol/main/protocol-adapter';
import { unifiedEventBus, type UnifiedEventBus } from '../features/events/main/unified-event-bus';
import { findAvailablePort } from '../utils/port-utils';
import ElectronStore from 'electron-store';
import { storeMcpToolParams } from '../shared/services/mcp-tool-params-cache';

const require = createRequire(import.meta.url);

// Cross-platform dummy workspace path (Windows doesn't have /tmp/)
const DUMMY_WORKSPACE_PATH = process.platform === 'win32'
  ? path.join(os.tmpdir(), 'dummy-workspace')
  : '/tmp/dummy-workspace';

// Default TTL for cached MCP servers (30 minutes)
const DEFAULT_MCP_SERVER_TTL_MS = 30 * 60 * 1000;

interface CachedMcpServer {
  server: any;
  createdAt: number;
  lastUsedAt: number;
  errorCount: number;
}

export class HttpMcpBridge {
  private app: express.Application;
  private server: any;
  private mcpServers: Map<string, CachedMcpServer> = new Map(); // Workspace-specific MCP servers with metadata
  private logger: Logger;
  private settingsStore: any;
  private port: number;
  private eventBus: UnifiedEventBus;
  private cleanupIntervalId: NodeJS.Timeout | null = null;
  private readonly mcpServerTtlMs: number = DEFAULT_MCP_SERVER_TTL_MS;

  constructor(port: number = parseInt(process.env.HTTP_MCP_PORT || '5179', 10)) {
    this.port = port;
    this.logger = new Logger('HttpMcpBridge');
    this.eventBus = unifiedEventBus;

    try {
      this.settingsStore = new ElectronStore({ name: 'settings' });
      this.settingsStore.set('http-bridge-start-time', new Date().toISOString());
    } catch (error) {
      this.logger.error('Failed to initialize ElectronStore:', error);
    }

    this.setupWorkspaceCleanupListeners();
    this.startCacheCleanupInterval();

    try {
      this.app = express();

      // CORS middleware
      this.app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') {
          return res.sendStatus(200);
        }
        next();
      });

      this.app.use(express.json());
      this.setupRoutes();
    } catch (error) {
      this.logger.error('Failed to create Express app:', error);
      throw error;
    }
  }

  /**
   * Get or create MCP server for a specific workspace.
   * Supports both local and remote workspaces via the environmentConfig parameter.
   * Includes TTL-based expiration check.
   */
  private async getMcpServer(
    workspaceId: string,
    workspacePath: string,
    environmentConfig?: import('../shared/types').EnvironmentConfig,
  ): Promise<any> {
    // Include environment type in key to ensure separate servers for local vs remote
    const envType = environmentConfig?.type || 'local';
    const key = `${workspaceId}:${workspacePath}:${envType}`;
    const now = Date.now();

    const cached = this.mcpServers.get(key);

    // Check if cached server exists and is not expired
    if (cached) {
      // Check TTL expiration
      const age = now - cached.createdAt;
      if (age > this.mcpServerTtlMs) {
        this.logger.info('Cached MCP server expired, recreating', {
          workspaceId,
          key,
          ageMs: age,
          ttlMs: this.mcpServerTtlMs,
        });
        this.mcpServers.delete(key);
      } else {
        // Update last used time and return
        cached.lastUsedAt = now;
        return cached.server;
      }
    }

    this.logger.debug('Creating MCP server for workspace', {
      workspaceId,
      workspacePath,
      isRemote: envType === 'remote',
    });

    try {
      const mcpServer = await createWorkspaceMCPServer(
        workspacePath, // Use real workspace path
        workspaceId, // Use real workspace ID
        protocolAdapter, // Use protocol adapter for workspace operations
        protocolAdapter, // Use protocol adapter for timeline operations
        undefined, // No workspace metadata path needed
        this.eventBus, // Use event bus for events
      );

      this.mcpServers.set(key, {
        server: mcpServer,
        createdAt: now,
        lastUsedAt: now,
        errorCount: 0,
      });

      return mcpServer;
    } catch (error) {
      this.logger.error('Error creating MCP server:', error);
      // Return a mock server to prevent crashes
      return {
        getTools: () => [],
        handleRequest: async () => ({ error: 'MCP server not available' }),
      };
    }
  }

  /**
   * Check if an error indicates a stale or broken MCP server that should be recreated.
   * These are errors that suggest the cached server instance is no longer valid.
   */
  private isStaleServerError(error: any): boolean {
    if (!error) return false;

    const errorMessage = error.message || error.toString();
    const staleErrorPatterns = [
      // Server state issues
      /server.*closed/i,
      /server.*disconnected/i,
      /connection.*refused/i,
      /connection.*reset/i,
      /socket.*closed/i,
      /socket.*hang.*up/i,
      // Internal state corruption
      /cannot read propert/i,
      /undefined is not a function/i,
      /null is not an object/i,
      // Tool availability issues
      /tool.*not.*found/i,
      /no.*tools.*available/i,
      // MCP-specific errors
      /mcp.*server.*not.*available/i,
      /handleMessage.*is not a function/i,
    ];

    return staleErrorPatterns.some((pattern) => pattern.test(errorMessage));
  }

  /**
   * Execute an MCP request with automatic retry on stale server errors.
   * If the first attempt fails with a stale server error, invalidates the cache
   * and retries with a fresh MCP server.
   */
  private async executeWithRetry(
    workspaceId: string,
    workspacePath: string,
    environmentConfig: import('../shared/types').EnvironmentConfig | undefined,
    jsonRpcRequest: any,
    context: {
      workspaceId: string;
      agentId: string;
      agentName: string;
      sessionId?: string;
      agentModel?: string;
      agentProvider?: string;
    },
  ): Promise<any> {
    const maxRetries = 1; // Only retry once with fresh server
    let lastError: any = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const isRetry = attempt > 0;

      if (isRetry) {
        this.logger.info('Retrying MCP request with fresh server', {
          workspaceId,
          method: jsonRpcRequest?.method,
          previousError: lastError?.message,
        });
      }

      try {
        const mcpServer = await this.getMcpServer(workspaceId, workspacePath, environmentConfig);

        // Log tool name for tools/call requests for better observability
        const isToolCall = jsonRpcRequest?.method === 'tools/call';
        const toolName = isToolCall ? jsonRpcRequest?.params?.name : undefined;
        if (isToolCall) {
          this.logger.info('MCP tool call', {
            toolName: toolName || 'unknown',
            workspaceId,
            agentId: context.agentId,
            agentName: context.agentName,
            isRetry,
          });

          // Cache tool params so the streaming handler can enrich skeleton tool_use blocks
          // for providers like OpenCode that don't include params in streaming events.
          if (context.agentId && toolName) {
            const toolArgs = jsonRpcRequest?.params?.arguments || {};
            storeMcpToolParams(context.agentId, toolName, toolArgs);
          }
        } else {
          this.logger.debug('Calling handleMessage', {
            method: jsonRpcRequest?.method,
            id: jsonRpcRequest?.id,
            isRetry,
          });
        }

        // Set tool call context before handling the message
        (mcpServer as any).setToolCallContext({
          workspaceId: context.workspaceId,
          agentId: context.agentId,
          agentName: context.agentName,
          sessionId: context.sessionId,
          metadata: {
            model: context.agentModel,
            provider: context.agentProvider,
          },
        });

        let response: any;
        try {
          response = await (mcpServer as any).handleMessage(jsonRpcRequest);
        } finally {
          (mcpServer as any).clearToolCallContext();
        }

        // Log tool call result for better debugging
        if (isToolCall) {
          const hasError = !!response?.error || response?.result?.isError;
          const resultText =
            typeof response?.result?.content?.[0]?.text === 'string'
              ? response.result.content[0].text
              : undefined;
          this.logger.info('MCP tool call result', {
            toolName: toolName || 'unknown',
            workspaceId,
            agentId: context.agentId,
            hasError,
            resultPreview: resultText ? resultText.substring(0, 200) : undefined,
          });
        }

        // Check if the response itself indicates an error that warrants retry
        if (response?.error && this.isStaleServerError(response.error)) {
          throw new Error(response.error.message || 'MCP server error');
        }

        return response;
      } catch (error) {
        lastError = error;

        // Track error count for this server
        this.incrementErrorCount(workspaceId);

        // Only retry if this looks like a stale server error
        if (attempt < maxRetries && this.isStaleServerError(error)) {
          this.logger.warn('Detected stale MCP server, invalidating cache and retrying', {
            workspaceId,
            method: jsonRpcRequest?.method,
            error: (error as Error).message,
          });

          // Invalidate the cached server
          this.clearMcpServersForWorkspace(workspaceId);
          continue;
        }

        // Non-retryable error or max retries exceeded
        throw error;
      }
    }

    // Should never reach here, but throw last error just in case
    throw lastError;
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', async (req: Request, res: Response) => {
      try {
        const mcpServer = await this.getMcpServer('http-bridge-workspace', DUMMY_WORKSPACE_PATH);
        res.json({
          status: 'ok',
          service: 'http-mcp-bridge',
          timestamp: new Date().toISOString(),
          tools: mcpServer.getTools().map((t: any) => t.name),
        });
      } catch (error) {
        this.logger.error('Health check failed', error as Error);
        res.status(500).json({ status: 'error', message: (error as Error).message });
      }
    });

    // Legacy settings endpoints (for backward compatibility with POC)
    this.app.get('/settings', (req: Request, res: Response) => {
      const settings = this.settingsStore.store;
      res.json({ success: true, data: settings });
    });

    this.app.get('/settings/:key', (req: Request, res: Response) => {
      const key = req.params.key;
      const value = this.settingsStore.get(key);
      res.json({ success: true, key, data: value });
    });

    // MCP endpoint - transparent proxy to the existing MCP server
    this.app.post('/mcp', async (req: Request, res: Response) => {
      this.logger.debug('MCP request received', {
        method: req.body?.method,
        id: req.body?.id,
      });

      try {
        const jsonRpcRequest = req.body;

        this.logger.debug('Received MCP request', {
          method: jsonRpcRequest.method,
          id: jsonRpcRequest.id,
        });

        // Extract workspace context from request headers or use defaults
        const workspaceId = (req.headers['x-workspace-id'] as string) || 'http-bridge-workspace';
        const workspacePath = (req.headers['x-workspace-path'] as string) || DUMMY_WORKSPACE_PATH;

        // Look up workspace to get environment config for remote workspace support
        let environmentConfig: import('../shared/types').EnvironmentConfig | undefined;
        try {
          const workspace = await protocolAdapter.getWorkspace(workspaceId);
          if (workspace?.environmentConfig) {
            environmentConfig = workspace.environmentConfig;
            this.logger.debug('Found environment config for workspace', {
              workspaceId,
              isRemote: environmentConfig?.type === 'remote',
            });
          }
        } catch (error) {
          // Workspace lookup failed, continue with local file system
          this.logger.debug('Could not look up workspace for environment config', {
            workspaceId,
            error: (error as Error).message,
          });
        }

        // Try to get agent context from registry first
        let registeredContext: any = undefined;
        let agentContextRegistry: any = null;

        try {
          const module = await import('../features/agent/agent-context-registry');
          agentContextRegistry = module.getAgentContextRegistry();

          // Get session ID from headers (passed by MCP stdio server)
          const sessionIdFromHeader = req.headers['x-session-id'] as string;

          // Try to get agent context - prefer session ID lookup as it's more reliable
          registeredContext = sessionIdFromHeader
            ? agentContextRegistry.getBySessionId(sessionIdFromHeader)
            : undefined;

          // Fall back to workspace ID lookup if session lookup fails
          if (!registeredContext) {
            registeredContext = agentContextRegistry.getByWorkspaceId(workspaceId);
          }
        } catch (error) {
          // Module not available (e.g., in test environment)
          this.logger.debug('Agent context registry not available', {
            error: (error as Error).message,
          });
        }

        // Get agent info from headers (passed by MCP stdio server)
        // IMPORTANT: Always prefer header values over registry lookup!
        // The headers are set by the MCP stdio server which is spawned with the correct
        // agent's environment variables (AGENT_ID, AGENT_NAME, AGENT_SESSION_ID).
        // The registry lookup can return the wrong agent if:
        // - The calling agent wasn't registered
        // - getByWorkspaceId() returns a different agent for the same workspace
        const agentIdFromHeader = req.headers['x-agent-id'] as string;
        const agentNameFromHeader = req.headers['x-agent-name'] as string;
        const sessionIdFromHeader = req.headers['x-session-id'] as string;
        const turnNumberFromHeader = req.headers['x-turn-number']
          ? parseInt(req.headers['x-turn-number'] as string)
          : undefined;

        // Use header values as the primary source of truth
        const agentId = agentIdFromHeader || registeredContext?.agentId || 'agent';
        const agentName = agentNameFromHeader || registeredContext?.agentName || 'Agent';
        const sessionId = sessionIdFromHeader || registeredContext?.sessionId;
        const turnNumber = turnNumberFromHeader ?? registeredContext?.turnNumber;

        // Get model and provider from registered context
        const agentModel = registeredContext?.model;
        const agentProvider = registeredContext?.provider;

        // Log agent context resolution for debugging
        if (jsonRpcRequest.method === 'tools/call') {
          this.logger.debug('Resolved agent context for tool call', {
            toolName: jsonRpcRequest.params?.name,
            agentIdFromHeader,
            agentIdFromRegistry: registeredContext?.agentId,
            resolvedAgentId: agentId,
            sessionIdFromHeader,
            sessionIdFromRegistry: registeredContext?.sessionId,
            usedHeaderValues: !!agentIdFromHeader,
          });
        }

        // Set provenance context for tool calls from agents
        let contextId: string | undefined;
        if (jsonRpcRequest.method === 'tools/call') {
          try {
            const module = await import(
              '../features/workspace/main/provenance/provenance-context-manager'
            );
            const provenanceManager = module.getProvenanceContextManager();

            // Create agent context for this tool execution
            contextId = provenanceManager.createAgentContext({
              agentId,
              agentName,
              messageId: `msg-${Date.now()}`,
              sessionId,
              turnNumber,
            });

            // Note: recordAgentActivity is deprecated. Agent file writes are now tracked
            // via content-based attribution in acp-provider-streaming.ts when tool_use blocks
            // are received for file-editing tools (save-file, str_replace_editor, etc.)

            this.logger.debug('Created provenance context for MCP tool call', {
              contextId,
              agentId,
              toolName: jsonRpcRequest.params?.name,
            });
          } catch (error) {
            // Module not available (e.g., in test environment)
            this.logger.debug('Provenance context manager not available', {
              error: (error as Error).message,
            });
          }
        }

        try {
          // Execute MCP request with automatic retry on stale server errors
          const response = await this.executeWithRetry(
            workspaceId,
            workspacePath,
            environmentConfig,
            jsonRpcRequest,
            { workspaceId, agentId, agentName, sessionId, agentModel, agentProvider },
          );

          // Send response back
          if (response) {
            res.json(response);
            this.logger.debug('Sent MCP response', {
              id: response.id,
              hasError: !!response.error,
            });
          } else {
            // Notification (no response expected)
            res.status(204).send();
          }
        } finally {
          // Pop provenance context if we created one
          if (contextId) {
            try {
              const { getProvenanceContextManager } = await import(
                '../features/workspace/main/provenance/provenance-context-manager'
              );
              const provenanceManager = getProvenanceContextManager();
              provenanceManager.popContext();
              this.logger.debug('Popped provenance context', { contextId });
            } catch (error) {
              this.logger.debug('Failed to pop provenance context', { error });
            }
          }
        }
      } catch (error) {
        this.logger.error('Error handling MCP request:', error as Error);

        const errorResponse = {
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
            data: (error as Error).message,
          },
          id: req.body?.id || null,
        };

        res.status(500).json(errorResponse);
      }
    });

    // List available tools endpoint (for debugging)
    this.app.get('/tools', async (req: Request, res: Response) => {
      try {
        // Get tools from a default MCP server (for debugging purposes)
        const defaultServer = await this.getMcpServer('http-bridge-workspace', DUMMY_WORKSPACE_PATH);
        const tools = defaultServer.getTools().map((tool: any) => ({
          name: tool.name,
          description: tool.description,
          // Don't expose the full tool implementation, just metadata
        }));

        res.json({ tools });
      } catch (error) {
        this.logger.error('Failed to list tools', error as Error);
        res.status(500).json({ error: 'Failed to list tools', message: (error as Error).message });
      }
    });
  }

  /**
   * Setup listeners for workspace lifecycle events to clean up cached MCP servers.
   * This prevents stale MCP server state from causing tool disconnection issues.
   */
  private setupWorkspaceCleanupListeners(): void {
    // Listen for workspace close/delete events to clean up cached MCP servers
    this.eventBus.onDomainEvent('workspace:deleting', (data: { workspaceId: string }) => {
      this.logger.info('Workspace deleting, clearing MCP server cache', {
        workspaceId: data.workspaceId,
      });
      this.clearMcpServersForWorkspace(data.workspaceId);
    });

    this.eventBus.onDomainEvent('workspace:deleted', (data: { workspaceId: string }) => {
      this.logger.info('Workspace deleted, ensuring MCP server cache is cleared', {
        workspaceId: data.workspaceId,
      });
      this.clearMcpServersForWorkspace(data.workspaceId);
    });

    // Listen for workspace updates to dynamically register/unregister PR tools
    this.eventBus.on(
      'workspace:updated',
      async (data: { workspaceId: string; changes?: { activePullRequest?: any } }) => {
        if (!data.changes || !('activePullRequest' in data.changes)) return; // No PR change in this event

        const workspaceId = data.workspaceId;
        const pr = data.changes.activePullRequest;
        const isOpenPR = pr && (pr.status === 'Open' || pr.status === 'Draft');

        // Find all cached servers for this workspace
        for (const [key, cached] of this.mcpServers.entries()) {
          if (!key.startsWith(`${workspaceId}:`)) continue;
          const server = cached.server;

          try {
            if (isOpenPR) {
              // Get owner/repo from workspace
              const workspace = await protocolAdapter.getWorkspace(workspaceId);
              if (workspace?.repositoryOwner && workspace?.repositoryName) {
                const prContext: PRContext = {
                  owner: workspace.repositoryOwner,
                  repo: workspace.repositoryName,
                  prNumber: pr.number,
                };
                // Unregister first (idempotent) then register with fresh context
                unregisterPRTools(server);
                registerPRTools(server, prContext);
                server.notifyToolsListChanged();
                this.logger.info('Registered PR comment tools for workspace', {
                  workspaceId,
                  prNumber: pr.number,
                });
              }
            } else {
              // PR closed/merged or cleared — remove tools
              unregisterPRTools(server);
              server.notifyToolsListChanged();
              this.logger.info('Unregistered PR comment tools for workspace', {
                workspaceId,
                prStatus: pr?.status ?? 'cleared',
              });
            }
          } catch (error) {
            this.logger.warn(`Failed to update PR tools for workspace ${workspaceId}`, error as Error);
          }
        }
      },
    );

    this.logger.info('Workspace cleanup listeners set up');
  }

  /**
   * Clear all cached MCP servers for a specific workspace.
   * This should be called when:
   * - A workspace is closed
   * - A workspace is deleted
   * - Repeated tool errors are detected
   * - An agent is stopped/deleted
   *
   * @param workspaceId The workspace ID to clear servers for
   * @returns The number of servers cleared
   */
  public clearMcpServersForWorkspace(workspaceId: string): number {
    let clearedCount = 0;

    for (const key of this.mcpServers.keys()) {
      if (key.startsWith(`${workspaceId}:`)) {
        this.mcpServers.delete(key);
        clearedCount++;
        this.logger.debug('Cleared MCP server from cache', { workspaceId, key });
      }
    }

    if (clearedCount > 0) {
      this.logger.info('Cleared MCP server cache for workspace', {
        workspaceId,
        clearedCount,
        remainingServers: this.mcpServers.size,
      });
    }

    return clearedCount;
  }

  /**
   * Clear all cached MCP servers.
   * This is useful for debugging or when the entire cache needs to be reset.
   *
   * @returns The number of servers cleared
   */
  public clearAllMcpServers(): number {
    const count = this.mcpServers.size;
    this.mcpServers.clear();
    this.logger.info('Cleared all MCP servers from cache', { clearedCount: count });
    return count;
  }

  /**
   * Get diagnostic information about cached MCP servers.
   * Useful for debugging MCP connection issues.
   */
  public getMcpServerCacheStats(): {
    total: number;
    servers: Array<{
      key: string;
      ageMs: number;
      lastUsedMs: number;
      errorCount: number;
    }>;
  } {
    const now = Date.now();
    const servers = Array.from(this.mcpServers.entries()).map(([key, cached]) => ({
      key,
      ageMs: now - cached.createdAt,
      lastUsedMs: now - cached.lastUsedAt,
      errorCount: cached.errorCount,
    }));

    return {
      total: this.mcpServers.size,
      servers,
    };
  }

  /**
   * Perform a health check on cached MCP servers for a workspace.
   * Tests each server by calling getTools() and removes any that fail.
   * This can be called on-demand when MCP issues are suspected.
   *
   * @param workspaceId Optional workspace ID to check. If not provided, checks all servers.
   * @returns Object with healthy and unhealthy server counts
   */
  public async healthCheckMcpServers(workspaceId?: string): Promise<{
    checked: number;
    healthy: number;
    unhealthy: number;
    removed: string[];
  }> {
    const removed: string[] = [];
    let checked = 0;
    let healthy = 0;

    for (const [key, cached] of this.mcpServers.entries()) {
      // Filter by workspace if specified
      if (workspaceId && !key.startsWith(`${workspaceId}:`)) {
        continue;
      }

      checked++;

      try {
        // Test the server by calling getTools - this should always work on a healthy server
        const tools = cached.server.getTools();
        if (Array.isArray(tools)) {
          healthy++;
        } else {
          throw new Error('getTools did not return an array');
        }
      } catch (error) {
        this.logger.warn('Health check failed for MCP server, removing from cache', {
          key,
          error: (error as Error).message,
        });
        this.mcpServers.delete(key);
        removed.push(key);
      }
    }

    const result = {
      checked,
      healthy,
      unhealthy: removed.length,
      removed,
    };

    this.logger.info('MCP server health check complete', result);
    return result;
  }

  /**
   * Start the periodic cache cleanup interval.
   * Removes expired MCP servers based on TTL.
   */
  private startCacheCleanupInterval(): void {
    // Run cleanup every 5 minutes
    const cleanupIntervalMs = 5 * 60 * 1000;

    this.cleanupIntervalId = setInterval(() => {
      this.cleanupExpiredServers();
    }, cleanupIntervalMs);

    this.logger.debug('Started MCP server cache cleanup interval', {
      intervalMs: cleanupIntervalMs,
      ttlMs: this.mcpServerTtlMs,
    });
  }

  /**
   * Clean up expired MCP servers based on TTL.
   * Called periodically by the cleanup interval.
   */
  private cleanupExpiredServers(): void {
    const now = Date.now();
    let expiredCount = 0;

    for (const [key, cached] of this.mcpServers.entries()) {
      const age = now - cached.createdAt;
      if (age > this.mcpServerTtlMs) {
        this.mcpServers.delete(key);
        expiredCount++;
        this.logger.debug('Cleaned up expired MCP server', { key, ageMs: age });
      }
    }

    if (expiredCount > 0) {
      this.logger.info('Cleaned up expired MCP servers', {
        expiredCount,
        remainingCount: this.mcpServers.size,
      });
    }
  }

  /**
   * Increment error count for a cached server.
   * High error counts can be used to identify problematic servers.
   */
  private incrementErrorCount(workspaceId: string): void {
    for (const [key, cached] of this.mcpServers.entries()) {
      if (key.startsWith(`${workspaceId}:`)) {
        cached.errorCount++;
      }
    }
  }

  async start(): Promise<void> {
    // Try to find an available port if the default is in use
    let actualPort = this.port;

    try {
      actualPort = await findAvailablePort(this.port, 10);
      this.port = actualPort;
    } catch (error) {
      this.logger.warn(`Could not find available port, trying default ${this.port}:`, error);
    }

    return new Promise((resolve, reject) => {
      // Always use 127.0.0.1 to ensure IPv4 binding (avoids IPv6/IPv4 port conflicts with Vite)
      // In production builds, use 0.0.0.0 to ensure binding works in ASAR
      const host =
        process.env.NODE_ENV === 'production' || app?.isPackaged ? '0.0.0.0' : '127.0.0.1';

      // Create HTTP server explicitly for better ASAR compatibility
      this.server = createServer(this.app);

      // Add error handler before listening - this is the ONLY error handler
      // to avoid duplicate handlers causing race conditions
      this.server.on('error', (error: any) => {
        this.logger.error('HTTP MCP Bridge server error', {
          error: error.message,
          code: error.code,
        });

        // If address in use, try next port (up to a reasonable limit)
        if (error.code === 'EADDRINUSE' && this.port < this.port + 10) {
          this.logger.warn(`Port ${this.port} in use, trying next port...`);
          this.port++;
          setTimeout(() => {
            this.server.close();
            this.start().then(resolve).catch(reject);
          }, 100);
        } else {
          // For non-retryable errors, reject the promise
          this.logger.error('Server listen error (not retrying):', error);
          reject(error);
        }
      });

      // Keep reference to prevent garbage collection
      (global as any).__httpMcpBridgeServer = this.server;
      (global as any).__httpMcpBridgeInstance = this;

      this.server.listen(this.port, host, () => {
        // CRITICAL: Only set the port env var and persist AFTER successfully binding
        // This ensures agents get the correct port even after fallback retries
        process.env.HTTP_MCP_PORT = this.port.toString();

        // Persist the resolved port so child processes that miss the env can still read it
        try {
          const userDataDir = app.getPath('userData');
          process.env.ELECTRON_STORE_CWD =
            this.settingsStore.path?.replace(/settings\.json$/, '') || userDataDir;
          this.settingsStore.set('http-bridge-port', this.port);
        } catch (error) {
          this.logger.warn('Failed to persist HTTP MCP port to settings store', { error });
        }

        // Get tool count for the startup message (async, don't block startup)
        this.getMcpServer('http-bridge-workspace', DUMMY_WORKSPACE_PATH)
          .then((defaultServer) => {
            const toolCount = defaultServer.getTools().length;
            // Single clean startup message
            console.log(`\n🔌 HTTP MCP Bridge: http://${host}:${this.port} (${toolCount} tools)\n`);
          })
          .catch(() => {
            // Fallback message if we can't get tool count
            console.log(`\n🔌 HTTP MCP Bridge: http://${host}:${this.port}\n`);
          });

        // Silent self-test - only log on failure
        setTimeout(() => {
          fetch(`http://127.0.0.1:${this.port}/health`)
            .then((res) => {
              if (!res.ok) {
                this.logger.error(`Health check failed with status ${res.status}`);
              }
            })
            .catch((err) => {
              this.logger.error(`Self-test failed: ${err.message}`);
            });
        }, 100);

        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    // Stop the cache cleanup interval
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
      this.logger.debug('Stopped MCP server cache cleanup interval');
    }

    // Clear all cached MCP servers
    this.clearAllMcpServers();

    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this.logger.info('HTTP MCP Bridge stopped');
          resolve();
        });
      });
    }
  }

  /**
   * Check if the HTTP bridge is healthy and responding.
   * Returns true if the health endpoint responds correctly.
   */
  async isHealthy(): Promise<boolean> {
    if (!this.server) {
      return false;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`http://127.0.0.1:${this.port}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        this.logger.warn('Health check returned non-OK status', { status: response.status });
        return false;
      }

      const data = await response.json();
      return data.status === 'ok';
    } catch (error) {
      this.logger.warn('Health check failed', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Restart the HTTP bridge.
   * Stops the current server and starts a new one.
   */
  async restart(): Promise<void> {
    this.logger.info('Restarting HTTP MCP Bridge...');

    try {
      await this.stop();
    } catch (error) {
      this.logger.warn('Error stopping bridge during restart', { error: (error as Error).message });
    }

    // Re-initialize the cleanup interval and listeners that were stopped
    this.startCacheCleanupInterval();

    await this.start();
    this.logger.info('HTTP MCP Bridge restarted successfully', { port: this.port });
  }

  /**
   * Ensure the bridge is healthy, restarting if necessary.
   * Returns true if the bridge is healthy after the check (possibly after restart).
   */
  async ensureHealthy(): Promise<boolean> {
    const healthy = await this.isHealthy();

    if (healthy) {
      return true;
    }

    this.logger.warn('HTTP MCP Bridge unhealthy, attempting restart...');

    try {
      await this.restart();
      // Verify it's healthy after restart
      const healthyAfterRestart = await this.isHealthy();
      if (!healthyAfterRestart) {
        this.logger.error('HTTP MCP Bridge still unhealthy after restart');
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error('Failed to restart HTTP MCP Bridge', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Get the current port the bridge is running on.
   */
  getPort(): number {
    return this.port;
  }
}
