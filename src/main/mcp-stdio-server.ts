/**
 * MCP STDIO Server
 *
 * Transparent proxy that forwards all MCP requests to the HTTP MCP server
 * running in the Electron main process. This solves the process isolation
 * issue by allowing STDIO MCP to access electron-store data via HTTP.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Note: Logger not used here since stdout is reserved for JSON-RPC
// All logging goes to stderr via custom logToStderr function

// Best-effort persistent log for packaged runs where child stderr may not reach the main log
const BUILD_ID = 'mcp-stdio-server-2025-11-21-bootlog-v1';
const DEFAULT_LOG_DIR = process.env.MCP_STDIO_LOG_PATH
  ? path.dirname(process.env.MCP_STDIO_LOG_PATH)
  : process.env.ELECTRON_STORE_CWD || path.join(os.homedir(), '.augment');
const LOG_FILE = process.env.MCP_STDIO_LOG_PATH || path.join(DEFAULT_LOG_DIR, 'mcp-stdio.log');

const persistLog = (level: string, message: string, context?: any) => {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    fs.appendFileSync(LOG_FILE, `[${timestamp}] [${level}] ${message}${contextStr}\n`);
  } catch {
    // ignore
  }
};

// Handle EPIPE errors on stdout/stderr to prevent uncaught exceptions
// when the parent process closes the pipe before we finish writing.
process.stdout.on('error', (err) => {
  if (err && 'code' in err && (err as NodeJS.ErrnoException).code === 'EPIPE') {
    // Parent closed the pipe — exit gracefully
    process.exit(0);
  }
});
process.stderr.on('error', (err) => {
  if (err && 'code' in err && (err as NodeJS.ErrnoException).code === 'EPIPE') {
    process.exit(0);
  }
});

/**
 * Safe wrapper for process.stdout.write that handles EPIPE gracefully.
 * Returns false if the write could not be performed (e.g. pipe broken).
 */
function safeStdoutWrite(data: string): boolean {
  try {
    if (process.stdout.writable) {
      return process.stdout.write(data);
    }
    return false;
  } catch {
    // Synchronous write error — pipe already broken
    return false;
  }
}

// Override console methods to ensure they go to stderr only
console.log = (...args) => { try { process.stderr.write(`[LOG] ${args.join(' ')}\n`); } catch { /* ignore */ } };
console.error = (...args) => { try { process.stderr.write(`[ERROR] ${args.join(' ')}\n`); } catch { /* ignore */ } };
console.warn = (...args) => { try { process.stderr.write(`[WARN] ${args.join(' ')}\n`); } catch { /* ignore */ } };
console.info = (...args) => { try { process.stderr.write(`[INFO] ${args.join(' ')}\n`); } catch { /* ignore */ } };
console.debug = (...args) => { try { process.stderr.write(`[DEBUG] ${args.join(' ')}\n`); } catch { /* ignore */ } };

// Custom logging functions that write to stderr
const logToStderr = (level: string, message: string, context?: any) => {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` ${JSON.stringify(context)}` : '';
  const line = `[${timestamp}] [${level}] [MCPStdioServer] ${message}${contextStr}\n`;
  try { process.stderr.write(line); } catch { /* ignore EPIPE */ }
  persistLog(level, message, context);
};

// Early boot marker to confirm the runtime file version in packaged runs
logToStderr('INFO', 'MCP stdio server boot', {
  buildId: BUILD_ID,
  argv: process.argv.slice(0, 6),
  node: process.version,
  cwd: process.cwd(),
  logFile: LOG_FILE,
  logDir: DEFAULT_LOG_DIR,
  electronStoreCwd: process.env.ELECTRON_STORE_CWD,
});

// HTTP MCP server configuration
// Use 127.0.0.1 by default to ensure IPv4 connection (avoids IPv6/IPv4 port conflicts with Vite on macOS)
const HTTP_MCP_HOST = process.env.HTTP_MCP_HOST || '127.0.0.1';
const ELECTRON_STORE_CWD = process.env.ELECTRON_STORE_CWD;

// Port must be an integer in the valid TCP range (1–65535) to be usable for connecting.
// Port 0 is only valid for bind() (OS-assigned), not for connect().
function isValidPort(v: number | undefined): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535;
}

// Prefer explicit CLI arg for port to avoid env/store mismatches. Args: <workspaceId> <workspacePath> [port]
const cliPort = isValidPort(Number(process.argv[4])) ? Number(process.argv[4]) : undefined;
const envPort = isValidPort(Number(process.env.HTTP_MCP_PORT))
  ? Number(process.env.HTTP_MCP_PORT)
  : undefined;

function readPortFromStore(): number | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ElectronStore = require('electron-store') as typeof import('electron-store').default;
    const storeOpts = ELECTRON_STORE_CWD
      ? { name: 'settings', cwd: ELECTRON_STORE_CWD }
      : { name: 'settings' };
    const settings: any = new ElectronStore(storeOpts);
    const persisted = settings.get('http-bridge-port');
    const asNumber = Number(persisted);
    if (isValidPort(asNumber)) {
      return asNumber;
    }
  } catch (_err) {
    // ignore, will fall back
  }
  return undefined;
}

function getCandidatePorts(): number[] {
  // Re-read the store each time — the bridge may have restarted on a new
  // OS-assigned port and persisted it since we last checked.
  const storePort = readPortFromStore();
  const candidates = [cliPort, envPort, storePort].filter(isValidPort);
  return Array.from(new Set(candidates));
}

// The bridge binds to port 0 (OS-assigned) by default. The actual port is
// communicated via CLI arg, env var, or settings store — there is no hardcoded default.
// A value of 0 means "port not yet known" — the reconnect loop will discover it.
let HTTP_MCP_PORT: number = cliPort ?? envPort ?? readPortFromStore() ?? 0;

const HTTP_MCP_ENDPOINT = () => `http://${HTTP_MCP_HOST}:${HTTP_MCP_PORT}/mcp`;

logToStderr('INFO', 'MCP stdio server configuration', {
  HTTP_MCP_HOST,
  HTTP_MCP_PORT,
  hasEnvPort: !!process.env.HTTP_MCP_PORT,
  ELECTRON_STORE_CWD,
  cwd: process.cwd(),
  execPath: process.execPath,
  cliPort,
  envPort,
  candidatePorts: getCandidatePorts(),
  logFile: LOG_FILE,
  logDir: DEFAULT_LOG_DIR,
  mcpStdioLogPathEnv: process.env.MCP_STDIO_LOG_PATH,
});

// Add error handlers
process.on('uncaughtException', (error) => {
  logToStderr('ERROR', 'Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logToStderr('ERROR', 'Unhandled Rejection', { reason });
  process.exit(1);
});

/**
 * Make HTTP request to the MCP server
 */
async function makeHttpRequest(
  jsonRpcRequest: any,
  workspaceId: string,
  workspacePath: string,
  agentId: string = 'agent',
  agentName: string = 'Agent',
  sessionId: string = '',
  isRetry: boolean = false,
): Promise<any> {
  const startTime = Date.now();
  try {
    const turnNumber = process.env.AGENT_TURN_NUMBER;

    logToStderr('info', 'MCP stdio server using agent info', {
      agentId,
      agentName,
      sessionId,
      hasTurnNumber: !!turnNumber,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'X-Workspace-Id': workspaceId,
      'X-Workspace-Path': workspacePath,
      'X-Agent-Id': agentId,
      'X-Agent-Name': agentName,
    };

    // Add optional headers if available
    if (sessionId) {
      headers['X-Session-Id'] = sessionId;
    }
    if (turnNumber) {
      headers['X-Turn-Number'] = turnNumber;
    }

    logToStderr('DEBUG', 'Sending MCP request to HTTP bridge', {
      endpoint: HTTP_MCP_ENDPOINT(),
      method: jsonRpcRequest.method,
      id: jsonRpcRequest.id,
      headers,
    });

    // Add timeout to fetch request
    // For tools/call requests, use a dynamic timeout based on the tool's timeout_seconds argument.
    // Some tools like wait_for_pr_changes can run for 10+ minutes, so we add 30s padding to
    // the tool's expected runtime. If no timeout_seconds is specified, default to 15 minutes
    // for tool calls to handle long-running operations.
    // For all other MCP requests (initialize, tools/list, etc.), use a 60-second timeout.
    let fetchTimeoutMs = 60000; // Default 60 seconds for non-tool-call requests
    if (jsonRpcRequest.method === 'tools/call') {
      const toolTimeoutSeconds = jsonRpcRequest.params?.arguments?.timeout_seconds;
      if (typeof toolTimeoutSeconds === 'number' && toolTimeoutSeconds > 0) {
        // Add 30 seconds padding to the tool's expected runtime
        fetchTimeoutMs = toolTimeoutSeconds * 1000 + 30000;
      } else {
        // Default to 15 minutes for tool calls without explicit timeout
        fetchTimeoutMs = 900000;
      }
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), fetchTimeoutMs);

    try {
      const response = await fetch(HTTP_MCP_ENDPOINT(), {
        method: 'POST',
        headers,
        body: JSON.stringify(jsonRpcRequest),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      logToStderr('DEBUG', 'HTTP response received', {
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
        contentLength: response.headers.get('content-length'),
      });

      if (!response.ok) {
        logToStderr('ERROR', 'HTTP MCP request failed', {
          status: response.status,
          statusText: response.statusText,
          endpoint: HTTP_MCP_ENDPOINT(),
        });
        // Treat 404/502/503 as potential "bridge unavailable" — the port may now
        // be occupied by a different server (e.g. Vite dev server) or the bridge
        // may have crashed. Tag the error so the catch block triggers reconnection.
        const isBridgeGone =
          response.status === 404 || response.status === 502 || response.status === 503;
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        if (isBridgeGone) {
          (error as Error & { isBridgeGone: boolean }).isBridgeGone = true;
        }
        throw error;
      }

      // Handle empty responses (e.g., for notifications)
      const text = await response.text();
      logToStderr('DEBUG', 'HTTP response body', {
        bodyLength: text.length,
        isEmpty: !text.trim(),
        first100Chars: text.substring(0, 100),
      });

      if (!text.trim()) {
        return null; // No response for notifications
      }

      const jsonResponse = JSON.parse(text);
      logToStderr('DEBUG', 'Parsed JSON response', {
        id: jsonResponse?.id,
        hasResult: !!jsonResponse?.result,
        hasError: !!jsonResponse?.error,
        error: jsonResponse?.error,
      });

      // Log tools/list responses to help debug tool availability issues
      if (jsonRpcRequest.method === 'tools/list' && jsonResponse?.result?.tools) {
        const tools = jsonResponse.result.tools as Array<{ name: string }>;
        const toolNames = tools.map((t) => t.name);
        const hasCreateAgent = toolNames.includes('create_agent');
        const hasDelegateTask = toolNames.includes('delegate_task');
        logToStderr('INFO', 'Tools available to agent', {
          totalTools: tools.length,
          hasCreateAgent,
          hasDelegateTask,
          agentInteractionTools: toolNames.filter((n) =>
            [
              'create_agent',
              'delegate_task',
              'send_message_to_agent',
              'list_agents',
              'get_agent_status',
              'subscribe_to_events',
              'wake_or_create_task_agent',
            ].includes(n),
          ),
          allToolNames: toolNames,
        });
      }

      const elapsed = Date.now() - startTime;
      logToStderr('DEBUG', 'HTTP request completed', {
        elapsed,
        method: jsonRpcRequest.method,
        id: jsonRpcRequest.id,
      });

      return jsonResponse;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      const fetchErr = fetchError as Error & { name?: string };
      if (fetchErr.name === 'AbortError') {
        // Include tool name and actual timeout for better debugging
        const toolName = jsonRpcRequest.params?.name || 'unknown';
        const timeoutSeconds = Math.round(fetchTimeoutMs / 1000);
        throw new Error(`Request timeout after ${timeoutSeconds} seconds (tool: ${toolName})`);
      }
      throw fetchError;
    }
  } catch (error) {
    const err = error as Error;
    const elapsed = Date.now() - startTime;
    const toolName = jsonRpcRequest.params?.name || 'unknown';
    logToStderr('ERROR', 'HTTP request failed', {
      elapsed,
      error: err.message,
      stack: err.stack,
      method: jsonRpcRequest.method,
      id: jsonRpcRequest.id,
      toolName,
    });

    // Check if this is a connection error (app likely closed or bridge crashed)
    // Also treat HTTP 404/502/503 as connection errors — the port may now be
    // occupied by a different server (e.g. Vite dev server returning 404).
    const isConnectionError =
      (err as Error & { isBridgeGone?: boolean }).isBridgeGone ||
      err.message.includes('ECONNREFUSED') ||
      err.message.includes('ECONNRESET') ||
      err.message.includes('fetch failed') ||
      err.message.includes('network') ||
      err.message.includes('socket');

    if (isConnectionError) {
      logToStderr('WARN', 'Connection error detected - attempting reconnect', {
        error: err.message,
        isRetry,
      });

      // Only attempt reconnect + retry once to prevent infinite recursion
      if (!isRetry) {
        const reconnectedPort = await tryReconnect();
        if (reconnectedPort) {
          HTTP_MCP_PORT = reconnectedPort;
          httpBridgeUnavailable = false;
          logToStderr('INFO', 'Reconnected after connection error, retrying request', {
            port: reconnectedPort,
            method: jsonRpcRequest.method,
          });
          // Retry the request once on the new port (isRetry=true prevents further recursion)
          try {
            return await makeHttpRequest(
              jsonRpcRequest,
              workspaceId,
              workspacePath,
              agentId,
              agentName,
              sessionId,
              true,
            );
          } catch (retryError) {
            logToStderr('ERROR', 'Retry after reconnect also failed', {
              error: (retryError as Error).message,
            });
            // Fall through to mark unavailable
          }
        }
      }

      // Reconnect failed — mark as unavailable (will be retried on next request
      // and by the background reconnection loop)
      httpBridgeUnavailable = true;
      startReconnectLoop();

      // Return clear error message about app connection lost
      return {
        jsonrpc: '2.0',
        id: jsonRpcRequest.id || null,
        error: {
          code: -32603,
          message: HTTP_BRIDGE_UNAVAILABLE_ERROR,
          data: {
            method: jsonRpcRequest.method,
            tool: toolName,
            hint: 'Please restart the Intent by Augment app',
          },
        },
      };
    }

    // Return JSON-RPC error response with detailed context for debugging
    return {
      jsonrpc: '2.0',
      id: jsonRpcRequest.id || null,
      error: {
        code: -32603,
        message: `Tool error (${toolName}): ${err.message}`,
        data: {
          tool: toolName,
          method: jsonRpcRequest.method,
          elapsed,
          originalError: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }
}

/**
 * Wait for HTTP MCP server to be available.
 * Uses exponential backoff (1s, 2s, 4s, 4s, 4s) for ~15s total wait.
 * This is long enough to survive GC pauses on large heaps (which can block
 * the main process event loop for several seconds) while still failing
 * reasonably fast if the app is truly down.
 */
async function waitForHttpServer(
  ports: number[],
  maxRetries: number = 5,
  initialDelay: number = 1000,
): Promise<number | null> {
  if (ports.length === 0) {
    logToStderr('WARN', 'No candidate ports to check — bridge port not yet known');
    return null;
  }

  const MAX_DELAY = 4000; // Cap backoff at 4 seconds

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    for (const port of ports) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        try {
          const response = await fetch(`http://${HTTP_MCP_HOST}:${port}/health`, {
            signal: controller.signal,
          });
          if (await isValidBridgeHealthResponse(response)) {
            logToStderr('INFO', 'HTTP MCP server is available', { port, attempt });
            return port;
          }
        } finally {
          clearTimeout(timeoutId);
        }
      } catch {
        // Server not ready yet, continue waiting
      }
    }

    if (attempt < maxRetries) {
      const delay = Math.min(initialDelay * Math.pow(2, attempt), MAX_DELAY);
      logToStderr('DEBUG', 'Waiting for HTTP MCP server...', {
        attempt: attempt + 1,
        maxRetries,
        delay,
        ports,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  logToStderr('ERROR', 'HTTP MCP server is not available after maximum retries', { ports });
  return null;
}

/**
 * Validate that a health response is actually from the MCP bridge,
 * not from another server (e.g. Vite dev server) that happens to be on the same port.
 */
async function isValidBridgeHealthResponse(response: Response): Promise<boolean> {
  if (!response.ok) return false;
  try {
    const data = await response.json();
    return data.service === 'http-mcp-bridge' && data.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Build the list of candidate ports to try when reconnecting.
 * Since the bridge uses port 0 (OS-assigned), the only way to discover
 * the port is via the settings store (which the bridge updates after binding).
 * Re-reads the store each time to pick up port changes from bridge restarts.
 */
function getReconnectCandidatePorts(): number[] {
  return getCandidatePorts();
}

/**
 * Quick health check — try to reach the HTTP MCP server on the current port
 * or any candidate port. Returns the working port or null.
 * Uses a short timeout (2s) since this is called per-request when the bridge is down.
 *
 * Validates that the response is actually from the MCP bridge (checks the
 * `service` field) to avoid connecting to a different server on the same port.
 */
async function tryReconnect(): Promise<number | null> {
  const ports = getReconnectCandidatePorts();
  // Ensure the currently configured port is tried first (if it's a real port)
  if (isValidPort(HTTP_MCP_PORT) && !ports.includes(HTTP_MCP_PORT)) {
    ports.unshift(HTTP_MCP_PORT);
  } else if (isValidPort(HTTP_MCP_PORT)) {
    // Move current port to front so we try it first
    const idx = ports.indexOf(HTTP_MCP_PORT);
    if (idx > 0) {
      ports.splice(idx, 1);
      ports.unshift(HTTP_MCP_PORT);
    }
  }

  if (ports.length === 0) {
    logToStderr('WARN', 'No candidate ports available for reconnect — waiting for bridge to persist its port');
    return null;
  }

  logToStderr('DEBUG', 'Attempting reconnect', { ports });

  for (const port of ports) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch(`http://${HTTP_MCP_HOST}:${port}/health`, {
        signal: controller.signal,
      });
      if (await isValidBridgeHealthResponse(response)) {
        logToStderr('INFO', 'HTTP MCP server reconnected', { port });
        return port;
      }
      // Got a response but it's not from our bridge (e.g. Vite dev server)
      logToStderr('DEBUG', 'Port responded but is not MCP bridge', {
        port,
        status: response.status,
      });
    } catch {
      // Not available on this port
    } finally {
      clearTimeout(timeoutId);
    }
  }
  return null;
}

// Flag to track if HTTP bridge is unavailable (set during startup or if connection is lost)
// This flag is now recoverable — when set, each incoming request will attempt a quick
// reconnect before giving up. A background reconnection loop also runs periodically.
let httpBridgeUnavailable = false;
let reconnectIntervalId: ReturnType<typeof setTimeout> | null = null;
const HTTP_BRIDGE_UNAVAILABLE_ERROR =
  'Intent by Augment app connection lost. The app may have been closed or the MCP bridge crashed. Please restart the Intent by Augment app and try again.';

/**
 * Start a background reconnection loop that periodically tries to find the
 * bridge when it's marked unavailable. This ensures recovery even when no
 * new MCP requests are arriving (e.g. the LLM client gave up after errors).
 *
 * The loop runs every 5 seconds while the bridge is unavailable and stops
 * automatically once reconnection succeeds.
 */
function startReconnectLoop(): void {
  if (reconnectIntervalId) return; // Already running

  const RECONNECT_INTERVAL_MS = 5000;
  logToStderr('INFO', 'Starting background reconnection loop', {
    intervalMs: RECONNECT_INTERVAL_MS,
  });

  // Use self-scheduling setTimeout instead of setInterval to prevent
  // overlapping reconnect attempts when tryReconnect() takes longer
  // than the interval.
  async function scheduleNext(): Promise<void> {
    reconnectIntervalId = setTimeout(async () => {
      if (!httpBridgeUnavailable) {
        stopReconnectLoop();
        return;
      }

      logToStderr('DEBUG', 'Background reconnect attempt');
      try {
        const reconnectedPort = await tryReconnect();
        if (reconnectedPort) {
          HTTP_MCP_PORT = reconnectedPort;
          httpBridgeUnavailable = false;
          logToStderr('INFO', 'Background reconnect succeeded', { port: reconnectedPort });
          stopReconnectLoop();
          return;
        }
      } catch (err) {
        logToStderr('WARN', 'Background reconnect error', {
          error: (err as Error).message,
        });
      }

      // Schedule next attempt only after current one completes
      scheduleNext();
    }, RECONNECT_INTERVAL_MS);
  }

  scheduleNext();
}

function stopReconnectLoop(): void {
  if (reconnectIntervalId) {
    clearTimeout(reconnectIntervalId);
    reconnectIntervalId = null;
    logToStderr('DEBUG', 'Stopped background reconnection loop');
  }
}

async function main() {
  try {
    // Parse command line arguments (for compatibility)
    const args = process.argv.slice(2);
    const workspaceId = args[0];
    const workspacePath = args[1];

    if (!workspaceId || !workspacePath) {
      logToStderr(
        'ERROR',
        'Missing required arguments: Usage: node mcp-stdio-server.js <workspaceId> <workspacePath>',
      );
      process.exit(1);
    }

    // Extract agent information from environment or use defaults
    // These would be set by the ACP provider when launching the stdio server
    const agentId = process.env.AGENT_ID || 'agent';
    const agentName = process.env.AGENT_NAME || 'Agent';
    const sessionId = process.env.AGENT_SESSION_ID || '';

    // Log startup information
    logToStderr('INFO', 'MCP STDIO Server starting', {
      workspaceId,
      workspacePath,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      argv: process.argv,
    });

    // Wait for HTTP MCP server to be available (try all candidates)
    const candidatePorts = getCandidatePorts();
    logToStderr('DEBUG', 'Checking candidate ports', { candidatePorts });

    const resolvedPort = await waitForHttpServer(candidatePorts);
    if (!resolvedPort) {
      logToStderr(
        'ERROR',
        'Cannot connect to HTTP MCP server - will return error responses for all requests',
      );
      httpBridgeUnavailable = true;
      startReconnectLoop();
      // Don't exit - keep process running to return proper MCP error responses
    } else {
      HTTP_MCP_PORT = resolvedPort;
      logToStderr('INFO', 'Connected to HTTP MCP server', {
        port: resolvedPort,
        endpoint: HTTP_MCP_ENDPOINT(),
      });
    }

    // Handle stdin/stdout communication - proxy to HTTP MCP server
    process.stdin.setEncoding('utf8');
    let buffer = '';
    let lastProcessedBuffer = ''; // Track what we've already processed

    process.stdin.on('data', async (chunk: string) => {
      try {
        buffer += chunk;
        logToStderr('DEBUG', 'Received stdin data', {
          chunkLength: chunk.length,
          bufferLength: buffer.length,
          firstChars: chunk.substring(0, 100),
        });

        // Try to process complete JSON objects even without newlines
        // This is a workaround for auggie not sending newlines
        let processedMessages = false;

        // First, try the standard newline-delimited approach
        if (buffer.includes('\n')) {
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.trim()) continue;
            await processJsonRpcMessage(line);
            processedMessages = true;
          }
        }
        // If no newlines, try to detect complete JSON objects
        else if (buffer.trim().startsWith('{')) {
          // Try to parse as complete JSON
          try {
            const request = JSON.parse(buffer);
            // If parsing succeeds, we have a complete JSON object
            logToStderr('DEBUG', 'Detected complete JSON without newline', {
              method: request.method,
              id: request.id,
            });
            lastProcessedBuffer = buffer; // Remember what we processed BEFORE clearing
            await processJsonRpcMessage(buffer);
            buffer = ''; // Clear buffer after processing
            processedMessages = true;
          } catch (e) {
            // Not a complete JSON object yet, keep buffering
            // Check if we might have multiple JSON objects concatenated
            const matches = buffer.match(/\{[^{}]*\}/g);
            if (matches && matches.length > 0) {
              for (const match of matches) {
                try {
                  JSON.parse(match);
                  await processJsonRpcMessage(match);
                  buffer = buffer.replace(match, '');
                  processedMessages = true;
                } catch {
                  // Not a valid JSON object, keep it in buffer
                }
              }
            }
          }
        }

        // Helper function to process a single JSON-RPC message
        async function processJsonRpcMessage(jsonStr: string) {
          if (!jsonStr.trim()) return;

          try {
            const request = JSON.parse(jsonStr);
            logToStderr('DEBUG', 'Parsed JSON-RPC request from stdin', {
              method: request.method,
              id: request.id,
              hasParams: !!request.params,
            });

            // Validate basic JSON-RPC structure
            if (!request.jsonrpc) {
              const errorResponse = {
                jsonrpc: '2.0',
                id: request.id || null,
                error: {
                  code: -32600,
                  message: 'Invalid Request',
                  data: 'Missing jsonrpc field',
                },
              };
              safeStdoutWrite(`${JSON.stringify(errorResponse)}\n`);
              return;
            }

            // If this is a response (not a request), just ignore it
            if (request.result !== undefined || request.error !== undefined) {
              return;
            }

            // Must have a method for requests
            if (!request.method) {
              // Only send error response if this is a request (has id), not a notification
              if (request.id !== undefined) {
                const errorResponse = {
                  jsonrpc: '2.0',
                  id: request.id,
                  error: {
                    code: -32600,
                    message: 'Invalid Request',
                    data: 'Missing method field',
                  },
                };
                safeStdoutWrite(`${JSON.stringify(errorResponse)}\n`);
              }
              return;
            }

            // Check if this is a notification (no id field)
            const isNotification = request.id === undefined;

            // If HTTP bridge was previously unavailable, try to reconnect before giving up
            if (httpBridgeUnavailable) {
              logToStderr('INFO', 'HTTP bridge was unavailable, attempting reconnect before request', {
                method: request.method,
              });
              const reconnectedPort = await tryReconnect();
              if (reconnectedPort) {
                HTTP_MCP_PORT = reconnectedPort;
                httpBridgeUnavailable = false;
                logToStderr('INFO', 'HTTP bridge reconnected successfully', {
                  port: reconnectedPort,
                  method: request.method,
                });
              } else {
                if (!isNotification) {
                  const errorResponse = {
                    jsonrpc: '2.0',
                    id: request.id,
                    error: {
                      code: -32603,
                      message: HTTP_BRIDGE_UNAVAILABLE_ERROR,
                      data: {
                        method: request.method,
                        hint: 'Please restart the Intent by Augment app',
                      },
                    },
                  };
                  safeStdoutWrite(`${JSON.stringify(errorResponse)}\n`);
                }
                return;
              }
            }

            // Forward request to HTTP MCP server
            const response = await makeHttpRequest(
              request,
              workspaceId,
              workspacePath,
              agentId,
              agentName,
              sessionId,
            );

            // Send response to stdout only for requests (not notifications)
            if (response && !isNotification) {
              const responseStr = JSON.stringify(response);
              logToStderr('DEBUG', 'Writing response to stdout', {
                responseLength: responseStr.length,
                responseId: response?.id,
                hasResult: !!response?.result,
                hasError: !!response?.error,
              });
              safeStdoutWrite(`${responseStr}\n`);
              logToStderr('DEBUG', 'Response written to stdout successfully');
            } else if (isNotification) {
              logToStderr('DEBUG', 'Skipping stdout write for notification');
            } else {
              logToStderr('DEBUG', 'No response to write to stdout');
            }
          } catch (error) {
            // Try to extract ID from the line for better error reporting
            let requestId = null;
            let isNotification = false;
            try {
              const partialRequest = JSON.parse(jsonStr);
              requestId = partialRequest.id;
              isNotification = requestId === undefined;
            } catch {
              // Ignore parse errors when trying to extract ID
            }

            // Only send error response for requests (not notifications)
            if (!isNotification) {
              const errorResponse = {
                jsonrpc: '2.0',
                id: requestId || null,
                error: {
                  code: -32700,
                  message: 'Parse error',
                  data: (error as Error).message,
                },
              };
              safeStdoutWrite(`${JSON.stringify(errorResponse)}\n`);
            }
          }
        }
      } catch (error) {
        logToStderr('ERROR', 'Unexpected error in data handler', {
          error: (error as Error).message,
        });
      }
    });

    process.stdin.on('end', async () => {
      // Process any remaining buffer content when stdin closes
      // This handles the case where auggie sends JSON without a trailing newline
      // But skip if we already processed this exact buffer content
      if (buffer.trim() && buffer !== lastProcessedBuffer) {
        logToStderr('DEBUG', 'Processing remaining buffer on stdin close', {
          bufferLength: buffer.length,
          content: buffer.substring(0, 200),
        });

        try {
          const request = JSON.parse(buffer);
          logToStderr('DEBUG', 'Parsed final JSON-RPC request from buffer', {
            method: request.method,
            id: request.id,
            hasParams: !!request.params,
          });

          // Send to HTTP MCP server using makeHttpRequest
          const response = await makeHttpRequest(request, workspaceId, workspacePath);

          // Send response to stdout if we got one
          if (response) {
            safeStdoutWrite(`${JSON.stringify(response)}\n`);
          }

          // Give a moment for the response to be sent
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          logToStderr('ERROR', 'Failed to process final buffer', {
            error: (error as Error).message,
            buffer: buffer.substring(0, 200),
          });
        }
      }

      logToStderr('INFO', 'Stdin closed, exiting');
      process.exit(0);
    });

    process.on('SIGINT', () => {
      logToStderr('INFO', 'Received SIGINT, exiting');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      logToStderr('INFO', 'Received SIGTERM, exiting');
      process.exit(0);
    });

    // Don't log immediately after setup - auggie might close stderr early
    // Instead, delay the ready message slightly
    setTimeout(() => {
      try {
        logToStderr('INFO', 'MCP STDIO proxy ready', {
          httpEndpoint: HTTP_MCP_ENDPOINT(),
          workspaceId,
          workspacePath,
          HTTP_MCP_PORT,
          candidatePorts: getCandidatePorts(),
          logFile: LOG_FILE,
        });
      } catch {
        // Ignore errors if stderr is already closed
      }
    }, 100);
  } catch (error) {
    logToStderr('ERROR', 'Fatal error during initialization', { error: (error as Error).message });
    process.exit(1);
  }
}

// Start the proxy
main().catch((error) => {
  logToStderr('ERROR', 'Fatal error in main', { error: error.message });
  process.exit(1);
});
