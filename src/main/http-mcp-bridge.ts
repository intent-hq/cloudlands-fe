/**
 * HTTP MCP Bridge
 *
 * Exposes the existing MCP server (same one used by STDIO MCP) via HTTP.
 * This creates a transparent bridge so STDIO MCP can access all tools
 * without duplicating tool definitions.
 *
 * ---------------------------------------------------------------------------
 * Integration hook: `httpBridgeUnrecoverable`
 * ---------------------------------------------------------------------------
 * When `ensureHealthy()` fails to make the bridge healthy after a full
 * restart attempt, it emits a structured event via the exported
 * `onHttpBridgeUnrecoverable(handler)` registration API. The sibling
 * "Recover stuck agents" task consumes this hook to mark streaming agents
 * as interrupted.
 *
 * Handler signature:
 *   type HttpBridgeUnrecoverableHandler = (info: {
 *     reason: 'restart-failed' | 'still-unhealthy-after-restart';
 *     error?: Error;
 *     port: number;
 *     timestamp: number;
 *   }) => void;
 *
 * Usage from the sibling task:
 *   import { onHttpBridgeUnrecoverable } from '../main/http-mcp-bridge';
 *   onHttpBridgeUnrecoverable((info) => {
 *     // repair persisted agents, notify renderer, …
 *   });
 *
 * The event is best-effort and should never throw — handlers are called
 * synchronously and any thrown error is caught and logged.
 * ---------------------------------------------------------------------------
 */

import { createRequire } from 'module';
import * as os from 'os';
import * as path from 'path';
import express, { Request, Response } from 'express';
import {
  app,
  BrowserWindow,
} from 'electron';
import {
  createServer,
  type IncomingMessage,
} from 'http';

import { Logger } from '../shared/logger';
import type { EnvironmentConfig } from '$shared/types';
import { createWorkspaceMCPServer } from '../features/mcp/main/mcp/index';
import { protocolAdapter } from '../features/protocol/main/protocol-adapter';
import { getAgentContextRegistry } from '$features/agent/agent-context-registry';
import { getProvenanceContextManager } from '$features/workspace/main/provenance/provenance-context-manager';
import { findAvailablePort } from '../utils/port-utils';
import ElectronStore from 'electron-store';
import { storeMcpToolParams } from '../shared/services/mcp-tool-params-cache';

const require = createRequire(import.meta.url);

// Import types for ws (ESM named import fails inside Electron's asar archive at runtime)
import type { WebSocket as WebSocketType, WebSocketServer as WebSocketServerType } from 'ws';
// Use require() for the runtime value to avoid ESM/CJS resolution issues inside asar
const { WebSocketServer, WebSocket } = require('ws') as {
  WebSocketServer: typeof WebSocketServerType;
  WebSocket: typeof WebSocketType;
};

// Cross-platform dummy workspace path (Windows doesn't have /tmp/)
const DUMMY_WORKSPACE_PATH = process.platform === 'win32'
  ? path.join(os.tmpdir(), 'dummy-workspace')
  : '/tmp/dummy-workspace';

const CONTENT_BEARING_BROWSER_CHANNELS = new Set([
  'file:content-changed',
  'note:created',
  'note:updated',
  'note:content-changed',
  'spec:updated',
  'goal:updated',
  'task:status-changed',
  'task:ready-tasks-changed',
  'comment:added',
  'comment:updated',
  'comment:updated-batch',
]);
const CONTENT_BEARING_BROWSER_CHANNEL_PREFIXES = ['note:content-changed:'];

function isContentBearingBrowserChannel(channel: string, data?: unknown): boolean {
  if (
    CONTENT_BEARING_BROWSER_CHANNELS.has(channel) ||
    CONTENT_BEARING_BROWSER_CHANNEL_PREFIXES.some((prefix) => channel.startsWith(prefix))
  ) {
    return true;
  }

  if (channel === 'events:new' && data && typeof data === 'object') {
    const event = (data as { event?: unknown }).event;
    if (event && typeof event === 'object') {
      const eventType = (event as { type?: unknown }).type;
      return typeof eventType === 'string' && isContentBearingBrowserChannel(eventType);
    }
  }

  return false;
}

function getWorkspaceIdFromPayload(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const workspaceId = (data as { workspaceId?: unknown }).workspaceId;
  if (typeof workspaceId === 'string' && workspaceId.length > 0) return workspaceId;

  const event = (data as { event?: unknown }).event;
  if (event && typeof event === 'object') {
    const eventWorkspaceId = (event as { workspaceId?: unknown }).workspaceId;
    if (typeof eventWorkspaceId === 'string' && eventWorkspaceId.length > 0) {
      return eventWorkspaceId;
    }
  }

  return undefined;
}

function getWorkspaceIdFromWsRequest(request?: IncomingMessage): string | undefined {
  const headerWorkspaceId = request?.headers?.['x-workspace-id'];
  if (typeof headerWorkspaceId === 'string' && headerWorkspaceId.length > 0) {
    return headerWorkspaceId;
  }
  if (Array.isArray(headerWorkspaceId)) {
    return headerWorkspaceId.find((value) => value.length > 0);
  }

  if (!request?.url) return undefined;
  try {
    const url = new URL(request.url, 'http://localhost');
    return url.searchParams.get('workspaceId') || undefined;
  } catch {
    return undefined;
  }
}

// WeakSet to track synthetic senders created by the /ipc bridge.
// Used by the one-time BrowserWindow.fromWebContents patch so concurrent
// requests don't stomp each other's monkey-patches.
const syntheticSenders = new WeakSet<object>();

// Whether BrowserWindow.fromWebContents has already been patched (once).
let fromWebContentsPatched = false;

// Default TTL for cached MCP servers (30 minutes)
const DEFAULT_MCP_SERVER_TTL_MS = 30 * 60 * 1000;

// Health probe configuration (exported so tests can import).
// Raised from 2s → 5s per spec: the health endpoint is merely slow under
// memory pressure; aborting at 2s synthesises a failure that then races
// restart() against itself.
export const HTTP_MCP_HEALTH_CHECK_TIMEOUT_MS = 5000;
// Backoff before a single retry of the health probe.
export const HTTP_MCP_HEALTH_CHECK_RETRY_BACKOFF_MS = 250;
// Window during which a recent memory-critical signal suppresses the
// health probe's restart decision.
export const HTTP_MCP_MEMORY_CRITICAL_WINDOW_MS = 30_000;
// Backoff schedule when a chosen port is still held by a concurrent listener
// (e.g. our own previous server still releasing). After the schedule is
// exhausted we fall through to the next port.
export const HTTP_MCP_LISTEN_BACKOFF_MS: number[] = [100, 200, 400];
// Maximum number of distinct ports to try before giving up.
export const HTTP_MCP_MAX_PORT_ATTEMPTS = 10;

// Explicit renderer origins allowed to make browser CORS requests to the local
// HTTP MCP bridge. Non-browser bridge clients usually omit Origin and continue
// through the middleware without CORS headers. Do not trust literal "null" or
// file:// origins: hostile sandboxed/data/srcdoc browser contexts can send them.
const TRUSTED_RENDERER_ORIGINS = new Set(['app://workspaces']);

function getTrustedRendererOrigins(): Set<string> {
  const origins = new Set(TRUSTED_RENDERER_ORIGINS);
  const devPort = process.env.DEV_PORT || '5177';
  origins.add(`http://127.0.0.1:${devPort}`);
  origins.add(`http://localhost:${devPort}`);
  return origins;
}

function isTrustedRendererOrigin(origin: string | undefined): origin is string {
  return typeof origin === 'string' && getTrustedRendererOrigins().has(origin);
}

function getOriginHeader(headers: { origin?: string | string[] }): string | undefined {
  const origin = headers.origin;
  if (Array.isArray(origin)) return origin[0];
  return typeof origin === 'string' ? origin : undefined;
}

function getRequestOrigin(req: Request): string | undefined {
  return getOriginHeader(req.headers);
}

function isAllowedWebSocketOrigin(origin: string | undefined): boolean {
  return origin === undefined || isTrustedRendererOrigin(origin);
}

// ---------------------------------------------------------------------------
// Memory-critical signal (shared via module scope).
// Set by the memory-pressure handler in src/main/index.ts via
// `notifyCriticalMemoryPressure()`. Read by isHealthy() to avoid tearing
// down a slow-but-working bridge during heap stress.
// Using module scope (not `global`) keeps the signal scoped to this bundle
// and easy to reset from tests.
// ---------------------------------------------------------------------------
let lastCriticalMemoryAt = 0;
export function notifyCriticalMemoryPressure(): void {
  lastCriticalMemoryAt = Date.now();
}
export function isCriticalMemoryPressureActive(
  windowMs: number = HTTP_MCP_MEMORY_CRITICAL_WINDOW_MS,
): boolean {
  return lastCriticalMemoryAt > 0 && Date.now() - lastCriticalMemoryAt < windowMs;
}
/** Test-only helper: reset the memory-critical signal. */
export function __resetCriticalMemoryPressureForTests(): void {
  lastCriticalMemoryAt = 0;
}

// ---------------------------------------------------------------------------
// httpBridgeUnrecoverable hook
// See file-header for the handler signature and consumer contract.
// ---------------------------------------------------------------------------
export interface HttpBridgeUnrecoverableInfo {
  reason: 'restart-failed' | 'still-unhealthy-after-restart';
  error?: Error;
  port: number;
  timestamp: number;
}
export type HttpBridgeUnrecoverableHandler = (info: HttpBridgeUnrecoverableInfo) => void | Promise<void>;

const unrecoverableHandlers = new Set<HttpBridgeUnrecoverableHandler>();
export function onHttpBridgeUnrecoverable(handler: HttpBridgeUnrecoverableHandler): () => void {
  unrecoverableHandlers.add(handler);
  return () => unrecoverableHandlers.delete(handler);
}
function emitHttpBridgeUnrecoverable(info: HttpBridgeUnrecoverableInfo, logger: Logger): void {
  // Snapshot the subscriber Set before iterating so handlers that subscribe /
  // unsubscribe during emission do not mutate the iteration we are currently
  // in. Each emission sees a stable view of the subscribers.
  const snapshot = Array.from(unrecoverableHandlers);
  for (const handler of snapshot) {
    try {
      const result = handler(info);
      // Assimilate any thenable (not just real Promises) via Promise.resolve.
      // This prevents a non-Promise thenable with `then` but no `catch` from
      // throwing TypeError on the direct `.catch` call below.
      if (result && typeof (result as PromiseLike<void>).then === 'function') {
        Promise.resolve(result as PromiseLike<void>).catch((err) => {
          logger.error('httpBridgeUnrecoverable async handler rejected', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    } catch (err) {
      logger.error('httpBridgeUnrecoverable handler threw', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

interface CachedMcpServer {
  server: any;
  createdAt: number;
  lastUsedAt: number;
  errorCount: number;
}

export class HttpMcpBridge {
  private app: express.Application;
  private server: any;
  private wss: InstanceType<typeof WebSocketServer> | null = null;
  private mcpServers: Map<string, CachedMcpServer> = new Map(); // Workspace-specific MCP servers with metadata
  private logger: Logger;
  private settingsStore: any;
  private port: number;
  private cleanupIntervalId: NodeJS.Timeout | null = null;
  private readonly mcpServerTtlMs: number = DEFAULT_MCP_SERVER_TTL_MS;
  private readonly browserClientWorkspaceIds = new WeakMap<object, string>();
  // In-flight restart promise — concurrent callers share it (DoD #2).
  private restartPromise: Promise<void> | null = null;
  // In-flight health probe promise — concurrent callers share it so a burst
  // of messages does not spam the health endpoint.
  private healthCheckPromise: Promise<boolean> | null = null;
  // Set true by stop() so an in-flight start() retry loop aborts cleanly
  // instead of binding a new listener after the server has been torn down.
  // Cleared at the top of the next start() call.
  private shuttingDown = false;
  // Monotonic counter incremented by every external stop() call (i.e. stops
  // that did not come from restart()'s internal cycle). start() and restart()
  // capture this at entry and abort if it changes, so an external stop() that
  // races with an in-flight restart cannot be "undone" by restart()'s own
  // later call to start() clearing `shuttingDown`.
  private externalStopGeneration = 0;
  // Exposed as a hook for tests that need shorter backoff than production.
  protected listenBackoffMs: number[] = HTTP_MCP_LISTEN_BACKOFF_MS;
  protected healthRetryBackoffMs: number = HTTP_MCP_HEALTH_CHECK_RETRY_BACKOFF_MS;

  constructor(port: number = parseInt(process.env.HTTP_MCP_PORT || '5179', 10)) {
    this.port = port;
    this.logger = new Logger('HttpMcpBridge');

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

      // CORS middleware. Echo only known renderer origins; never use '*'.
      this.app.use((req, res, next) => {
        const origin = getRequestOrigin(req);
        const isTrustedOrigin = isTrustedRendererOrigin(origin);

        if (isTrustedOrigin) {
          res.header('Access-Control-Allow-Origin', origin);
          res.header('Vary', 'Origin');
          res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.header('Access-Control-Allow-Headers', 'Content-Type, x-workspace-id');
        }

        if (req.method === 'OPTIONS') {
          if (origin && !isTrustedOrigin) {
            return res.sendStatus(403);
          }
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
    environmentConfig?: EnvironmentConfig,
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
        undefined, // Event bus no longer needed (Redux handles events)
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
    environmentConfig: EnvironmentConfig | undefined,
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

    // ---------------------------------------------------------------
    // IPC-over-HTTP bridge for browser-mode rendering
    // Allows the browser (non-Electron) renderer to call real IPC handlers
    // ---------------------------------------------------------------
    this.app.post('/ipc', async (req: Request, res: Response) => {
      const { channel, data } = req.body || {};
      if (!channel || typeof channel !== 'string') {
        return res.status(400).json({ success: false, error: 'Missing or invalid "channel"' });
      }

      const handlers: Map<string, (...args: any[]) => any> | undefined =
        (global as any).__ipcHandlerFunctions;

      if (!handlers || !handlers.has(channel)) {
        return res.status(404).json({
          success: false,
          error: `No handler registered for channel "${channel}"`,
        });
      }

      try {
        const requestWorkspaceId =
          getWorkspaceIdFromWsRequest(req) ??
          getWorkspaceIdFromPayload(data) ??
          getWorkspaceIdFromPayload(req.body);
        // Create a synthetic IpcMainInvokeEvent-like object.
        // Handlers that call event.sender.send() (for streaming) will have
        // those messages routed through the WebSocket to browser clients.
        //
        // IMPORTANT: Many handlers call BrowserWindow.fromWebContents(event.sender)
        // which throws if sender is not a real WebContents. We mark the event with
        // __isBrowserBridge so handlers can detect this and skip native Electron calls.
        const broadcast = (global as any).__browserIpcBroadcast;
        const syntheticSender = {
          id: -1,
          __isBrowserBridge: true,
          // Route streaming sends through WebSocket
          send: (ch: string, ...args: any[]) => {
            if (typeof broadcast === 'function' && requestWorkspaceId) {
              broadcast(ch, args.length === 1 ? args[0] : args, requestWorkspaceId);
            }
          },
          // Stubs for properties that some handlers may access
          isDestroyed: () => false,
          getZoomFactor: () => 1.0,
        };
        const syntheticEvent = {
          sender: syntheticSender,
          senderFrame: null,
          processId: process.pid,
          frameId: -1,
          __isBrowserBridge: true,
        };

        // Track this synthetic sender so the one-time BrowserWindow.fromWebContents
        // patch can recognise it and return null instead of throwing a TypeError.
        syntheticSenders.add(syntheticSender);

        // Patch BrowserWindow.fromWebContents exactly once (idempotent).
        // This avoids the concurrency bug where per-request patching/unpatching
        // causes concurrent requests to stomp each other's patches.
        if (!fromWebContentsPatched) {
          const orig = BrowserWindow.fromWebContents;
          BrowserWindow.fromWebContents = (wc: any) => {
            if (syntheticSenders.has(wc)) return null as any;
            return orig.call(BrowserWindow, wc);
          };
          fromWebContentsPatched = true;
        }

        const handler = handlers.get(channel)!;
        const result = await handler(syntheticEvent, data);
        res.json(result);
      } catch (error) {
        this.logger.error(`IPC bridge error on channel "${channel}"`, error as Error);
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'IPC handler error',
        });
      }
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
        let environmentConfig: EnvironmentConfig | undefined;
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
          agentContextRegistry = getAgentContextRegistry();

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
            const provenanceManager = getProvenanceContextManager();

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
    // workspace:deleting and workspace:deleted listeners are now handled by sagas
    // (domain-event-listener-sagas.ts) which call clearMcpServersForWorkspace directly.


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

  /**
   * Attempt a single listen() on (port, host). Resolves with the bound
   * server+wss on success, or with { error } on failure. Never throws.
   * Attaches `on('error')` BEFORE calling listen so EADDRINUSE can never
   * escape to `uncaughtException`.
   */
  private listenOnce(
    port: number,
    host: string,
  ): Promise<
    | { server: any; wss: InstanceType<typeof WebSocketServer> }
    | { error: NodeJS.ErrnoException }
  > {
    return new Promise((resolve) => {
      const server = createServer(this.app);
      const wss = new WebSocketServer({
        server,
        path: '/ipc-events',
        verifyClient: ({ req }, done) => {
          const origin = getOriginHeader(req.headers);
          if (isAllowedWebSocketOrigin(origin)) {
            done(true);
            return;
          }

          this.logger.warn('Rejected Browser IPC WebSocket connection from untrusted origin', {
            origin,
          });
          done(false, 403, 'Forbidden');
        },
      });
      wss.on('connection', (ws: InstanceType<typeof WebSocket>, request?: IncomingMessage) => {
        const workspaceId = getWorkspaceIdFromWsRequest(request);
        if (workspaceId) {
          this.browserClientWorkspaceIds.set(ws, workspaceId);
        }
        this.logger.info('Browser IPC WebSocket client connected');
        ws.on('close', () => {
          this.browserClientWorkspaceIds.delete(ws);
          this.logger.debug('Browser IPC WebSocket client disconnected');
        });
        // Per-client error listener: in Node's EventEmitter semantics, an
        // 'error' emitted by a WebSocket with no listener throws as an
        // uncaught 'error' event. The WSS-level error listener does not
        // cover per-client errors. Log and terminate the client.
        ws.on('error', (err: Error) => {
          this.logger.warn('Browser IPC WebSocket client error', {
            message: err.message,
          });
          try {
            ws.terminate();
          } catch {
            /* ignore */
          }
        });
      });

      let settled = false;
      const onError = (error: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        try {
          server.removeListener('error', onError);
        } catch {
          /* ignore */
        }
        // Release any partially-acquired resources from this attempt.
        try {
          wss.close();
        } catch {
          /* ignore */
        }
        try {
          server.close(() => {});
        } catch {
          /* ignore */
        }
        resolve({ error });
      };
      // Attach error handler BEFORE listen — this is the invariant that
      // prevents EADDRINUSE from reaching process.on('uncaughtException').
      // `once` auto-removes after firing; retries recreate the server and
      // re-register `once` on that fresh instance.
      server.once('error', onError);

      server.listen(port, host, () => {
        if (settled) return;
        settled = true;
        try {
          server.removeListener('error', onError);
        } catch {
          /* ignore */
        }
        // Attach a durable error listener so post-listen errors from the HTTP
        // server are not treated as unhandled 'error' events by Node (which
        // would otherwise crash the main process). Log and swallow — the
        // restart path is driven by the health check, not by ad-hoc server
        // errors.
        server.on('error', (err: NodeJS.ErrnoException) => {
          this.logger.warn('HTTP MCP Bridge server error after listening', {
            code: err.code,
            message: err.message,
          });
        });
        // Same for the WebSocket server for symmetry.
        wss.on('error', (err: Error) => {
          this.logger.warn('HTTP MCP Bridge WSS error after listening', {
            message: err.message,
          });
        });
        resolve({ server, wss });
      });
    });
  }

  async start(): Promise<void | 'aborted'> {
    // DoD #3: start() refuses to proceed if a server is still running.
    // Restart must go through stop() first.
    if (this.server) {
      throw new Error(
        'HttpMcpBridge.start(): server is still running; call stop() first',
      );
    }
    // Capture the external-stop generation at entry. If an external stop()
    // increments it while we are running, we abort instead of binding — even
    // if our own code has since cleared `shuttingDown`. This closes the
    // R1 race where external stop() returned while this call was mid-retry
    // and a later listen() could still bind after stop() completed.
    const genAtEntry = this.externalStopGeneration;
    // Fresh start clears any prior stop() shutdown marker. The flag remains
    // true after an external stop() so an in-flight start() can detect the
    // race, but a deliberate new start() call wants to run normally.
    this.shuttingDown = false;

    // Best-effort advisory pre-check: ask for an available port. We used to
    // assign the returned port back to `this.port`, but that bypassed the
    // same-port EADDRINUSE backoff below — if findAvailablePort drifted to
    // 5180 while 5179 was transiently held (e.g. during restart), the real
    // retry loop would never wait for 5179 to release. Keep the call for
    // its validation side-effects only; let the retry loop own port choice.
    try {
      await findAvailablePort(this.port, 10);
    } catch (error) {
      this.logger.warn(`Could not find available port, trying default ${this.port}:`, error);
    }

    // Always bind to IPv4 loopback so the bridge is only reachable locally.
    const host = '127.0.0.1';

    const startPort = this.port;
    let boundServer: any = null;
    let boundWss: InstanceType<typeof WebSocketServer> | null = null;
    let boundPort: number = -1;
    let lastError: NodeJS.ErrnoException | null = null;

    // True iff this start() run has been cancelled by either the local
    // `shuttingDown` flag or by an external stop() bumping the generation.
    const isAborted = (): boolean =>
      this.shuttingDown || this.externalStopGeneration !== genAtEntry;

    for (let portOffset = 0; portOffset < HTTP_MCP_MAX_PORT_ATTEMPTS; portOffset++) {
      // Abort cleanly if stop() fired while we were between attempts, so a
      // delayed listen() can't bind after the bridge has already been stopped.
      if (isAborted()) {
        this.logger.info('HttpMcpBridge.start(): aborting port retry, stop() in progress');
        return 'aborted';
      }
      const tryPort = startPort + portOffset;

      // Same-port backoff schedule: retry a held port a few times before
      // falling through to the next port (DoD #1).
      const backoff = this.listenBackoffMs;
      const maxSamePortAttempts = backoff.length + 1; // initial + len(backoff) waits
      for (let attempt = 0; attempt < maxSamePortAttempts; attempt++) {
        if (isAborted()) {
          this.logger.info('HttpMcpBridge.start(): aborting port retry, stop() in progress');
          return 'aborted';
        }
        const result = await this.listenOnce(tryPort, host);
        if ('server' in result) {
          boundServer = result.server;
          boundWss = result.wss;
          // Capture the bound port locally; publish to `this.port` only after
          // the post-loop abort check passes so an abort-after-bind path that
          // discards the server doesn't leave `this.port` pointing at a port
          // that was never actually published (subsequent restarts/health
          // checks would otherwise probe a never-bound port).
          boundPort = tryPort;
          break;
        }
        lastError = result.error;
        if (result.error.code !== 'EADDRINUSE') {
          // Non-retryable error — surface it immediately.
          this.logger.error('Server listen error (not retrying):', result.error);
          throw result.error;
        }
        // Wait before retrying the same port, except after the last attempt.
        if (attempt < backoff.length) {
          this.logger.warn(
            `Port ${tryPort} in use, waiting ${backoff[attempt]}ms before retry...`,
          );
          await new Promise((r) => setTimeout(r, backoff[attempt]));
          if (isAborted()) {
            this.logger.info(
              'HttpMcpBridge.start(): aborting after backoff sleep, stop() in progress',
            );
            return 'aborted';
          }
        }
      }

      if (boundServer) break;
      this.logger.warn(
        `Port ${tryPort} still in use after ${maxSamePortAttempts} attempts, trying next port`,
      );
    }

    // After the loop: if we were asked to shut down and somehow bound a server,
    // close it immediately and return — don't publish it.
    if (isAborted() && boundServer) {
      try {
        boundServer.close?.();
      } catch {
        /* ignore */
      }
      try {
        boundWss?.close?.();
      } catch {
        /* ignore */
      }
      this.logger.info('HttpMcpBridge.start(): discarded newly-bound server, stop() in progress');
      return 'aborted';
    }

    if (!boundServer || !boundWss) {
      const err =
        lastError ??
        Object.assign(new Error('HttpMcpBridge: no ports available'), {
          code: 'EADDRINUSE',
        });
      this.logger.error(
        `HttpMcpBridge: could not bind to any port in range ${startPort}-${startPort + HTTP_MCP_MAX_PORT_ATTEMPTS - 1}`,
        err,
      );
      throw err;
    }

    // Publish the bound server/wss references and the port they're bound to.
    // Deferring the `this.port` assignment until here (instead of inside the
    // listen loop) ensures an abort-after-bind path that discards the server
    // also leaves `this.port` unchanged — so the instance never retains a
    // port value for a server that was never actually published.
    this.server = boundServer;
    this.wss = boundWss;
    this.port = boundPort;

    // Expose a global broadcast function so any code that does webContents.send
    // can also push events to browser-mode clients.
    (global as any).__browserIpcBroadcast = (
      channel: string,
      data: any,
      workspaceId?: string,
    ) => {
      if (!this.wss) return;
      const isContentBearing = isContentBearingBrowserChannel(channel, data);
      const effectiveWorkspaceId =
        workspaceId ?? (isContentBearing ? getWorkspaceIdFromPayload(data) : undefined);
      if (isContentBearing && !effectiveWorkspaceId) return;

      const message = JSON.stringify({ channel, data });
      for (const client of this.wss.clients) {
        if (
          effectiveWorkspaceId &&
          this.browserClientWorkspaceIds.get(client) !== effectiveWorkspaceId
        ) {
          continue;
        }
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }
    };

    // Keep references to prevent garbage collection and for sibling modules.
    (global as any).__httpMcpBridgeServer = this.server;
    (global as any).__httpMcpBridgeInstance = this;

    // CRITICAL: Only set the port env var and persist AFTER successfully binding
    process.env.HTTP_MCP_PORT = this.port.toString();

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
        console.log(`\n🔌 HTTP MCP Bridge: http://${host}:${this.port} (${toolCount} tools)\n`);
      })
      .catch(() => {
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
  }

  /**
   * Stop the bridge cleanly.
   * Terminates all WSS clients, closes the WSS, awaits server.close(),
   * and nulls `this.server` / `this.wss` before resolving (DoD #3).
   */
  async stop(opts: { _fromRestart?: boolean } = {}): Promise<void> {
    // External stops bump the generation counter so an in-flight restart()
    // can observe "external stop fired while I was running" and abort before
    // its start() re-binds a listener (R1).
    if (!opts._fromRestart) {
      this.externalStopGeneration++;
    }
    // Signal any in-flight start() retry loop to abort cleanly so a delayed
    // listen() cannot bind a new listener after we tear down the server.
    this.shuttingDown = true;

    // External callers racing with an in-flight restart() should wait briefly
    // for that restart to settle (its own stop() + start() cycle) so we tear
    // down the server restart just produced — otherwise stop() returns while
    // restart's start() is still pending and a listener binds after us.
    // When restart() itself calls us via { _fromRestart: true }, skip the
    // await or we would deadlock on our own promise.
    // The 1s timeout bounds the wait; the externalStopGeneration bump above
    // is what guarantees correctness if the inflight restart outlives it.
    const inflight = this.restartPromise;
    if (inflight && !opts._fromRestart) {
      try {
        await Promise.race([
          inflight.catch(() => {
            /* ignore — restart errors are handled by its own caller */
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 1000)),
        ]);
      } catch {
        /* ignore */
      }
      // Re-assert the shutdown flag: restart's internal start() reset it
      // when entering, and we need it set so any late retry aborts.
      this.shuttingDown = true;
    }

    // Stop the cache cleanup interval
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
      this.logger.debug('Stopped MCP server cache cleanup interval');
    }

    // Clear all cached MCP servers
    this.clearAllMcpServers();

    // Close WSS first: terminate all connected clients, then close the WSS.
    // If we close the HTTP server first, the WSS can linger holding refs.
    const wss = this.wss;
    this.wss = null;
    if (wss) {
      try {
        for (const client of wss.clients) {
          try {
            client.terminate();
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
      await new Promise<void>((resolve) => {
        try {
          wss.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }

    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => {
        try {
          server.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }

    // NOTE: `shuttingDown` intentionally stays true here so any start() still
    // in its retry backoff aborts instead of binding a listener after stop()
    // has returned. The flag is cleared at the top of the next start() call.

    this.logger.info('HTTP MCP Bridge stopped');
  }

  /**
   * Perform a single fetch of /health with an AbortController timeout.
   */
  private async probeHealthOnce(timeoutMs: number): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}/health`, {
        signal: controller.signal,
      });
      if (!response.ok) {
        this.logger.warn('Health check returned non-OK status', { status: response.status });
        return false;
      }
      const data = await response.json();
      return data?.status === 'ok';
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check if the HTTP bridge is healthy and responding.
   * Tolerates main-process load (DoD #4):
   *   - 5s configurable timeout (HTTP_MCP_HEALTH_CHECK_TIMEOUT_MS)
   *   - one retry with short backoff
   *   - returns true when a recent memory-critical signal is active
   */
  async isHealthy(
    timeoutMs: number = HTTP_MCP_HEALTH_CHECK_TIMEOUT_MS,
  ): Promise<boolean> {
    if (!this.server) {
      return false;
    }

    // Memory-critical override: under sustained pressure the health endpoint
    // is merely slow. Reporting unhealthy here would trip restart() against
    // its own running listener (the original EADDRINUSE bug).
    if (isCriticalMemoryPressureActive()) {
      this.logger.info(
        'Skipping HTTP MCP Bridge health probe — recent critical memory pressure',
      );
      return true;
    }

    try {
      const healthy = await this.probeHealthOnce(timeoutMs);
      if (healthy) return true;
    } catch (error) {
      this.logger.warn('Health check failed (first attempt)', {
        error: (error as Error).message,
      });
    }

    // One retry with short backoff before declaring unhealthy.
    await new Promise((r) => setTimeout(r, this.healthRetryBackoffMs));

    try {
      return await this.probeHealthOnce(timeoutMs);
    } catch (error) {
      this.logger.warn('Health check failed', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Restart the HTTP bridge.
   * Serialised: concurrent callers share a single in-flight Promise (DoD #2).
   * Any failure from either stop() or start() is logged once and rethrown
   * as a single Error with the original error preserved on `.cause`.
   */
  async restart(): Promise<void> {
    if (this.restartPromise) {
      this.logger.debug('Restart already in-flight; awaiting shared promise');
      return this.restartPromise;
    }

    this.restartPromise = (async () => {
      this.logger.info('Restarting HTTP MCP Bridge...');
      // Capture the external-stop generation at entry (R1). If an external
      // stop() fires during our internal stop() or start(), we abort without
      // re-binding.
      const genAtEntry = this.externalStopGeneration;
      try {
        // Internal stop: skip the "await in-flight restart" branch (that
        // would be this very promise → self-await deadlock).
        await this.stop({ _fromRestart: true });
        // If an external stop() fired during our internal stop, abort before
        // calling start() so we never re-bind after external stop returned.
        if (this.externalStopGeneration !== genAtEntry) {
          this.logger.info(
            'HTTP MCP Bridge restart() aborting after internal stop: external stop() fired',
          );
          return;
        }
        // Re-initialize the cleanup interval that stop() cleared.
        this.startCacheCleanupInterval();
        const started = await this.start();
        // R2: start() returns 'aborted' when it short-circuited due to
        // shuttingDown / a racing external stop. Don't report success in
        // that case — no server was actually published.
        if (started === 'aborted') {
          this.logger.info(
            'HTTP MCP Bridge restart() aborting: start() did not publish a server',
          );
          return;
        }
        this.logger.info('HTTP MCP Bridge restarted successfully', { port: this.port });
      } catch (error) {
        this.logger.error('HTTP MCP Bridge restart failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error(
          `HttpMcpBridge.restart() failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    })();

    try {
      await this.restartPromise;
    } finally {
      this.restartPromise = null;
    }
  }

  /**
   * Ensure the bridge is healthy, restarting if necessary.
   * Idempotent under concurrent callers (shares `restartPromise` and the
   * in-flight probe). Returns false and emits `httpBridgeUnrecoverable`
   * on permanent failure — never throws, never leaks an uncaught exception.
   */
  async ensureHealthy(): Promise<boolean> {
    // Coalesce concurrent probes so a burst of messages doesn't spam /health.
    if (!this.healthCheckPromise) {
      this.healthCheckPromise = this.isHealthy().finally(() => {
        this.healthCheckPromise = null;
      });
    }
    const healthy = await this.healthCheckPromise;
    if (healthy) return true;

    this.logger.warn('HTTP MCP Bridge unhealthy, attempting restart...');

    try {
      await this.restart();
    } catch (error) {
      this.logger.error('Failed to restart HTTP MCP Bridge', {
        error: (error as Error).message,
      });
      emitHttpBridgeUnrecoverable(
        {
          reason: 'restart-failed',
          error: error as Error,
          port: this.port,
          timestamp: Date.now(),
        },
        this.logger,
      );
      return false;
    }

    // Verify it's healthy after restart (fresh probe, not the coalesced one).
    const healthyAfterRestart = await this.isHealthy();
    if (!healthyAfterRestart) {
      this.logger.error('HTTP MCP Bridge still unhealthy after restart');
      emitHttpBridgeUnrecoverable(
        {
          reason: 'still-unhealthy-after-restart',
          port: this.port,
          timestamp: Date.now(),
        },
        this.logger,
      );
      return false;
    }
    return true;
  }

  /**
   * Get the current port the bridge is running on.
   */
  getPort(): number {
    return this.port;
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor for saga use
// ---------------------------------------------------------------------------

let bridgeInstance: HttpMcpBridge | null = null;

/**
 * Set the singleton HttpMcpBridge instance (called from main/index.ts after construction).
 */
export function setHttpMcpBridge(bridge: HttpMcpBridge): void {
  bridgeInstance = bridge;
}

/**
 * Get the singleton HttpMcpBridge instance, or null if not yet created.
 */
export function getHttpMcpBridge(): HttpMcpBridge | null {
  return bridgeInstance;
}
