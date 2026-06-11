/**
 * Browser Mock for window.electronAPI
 *
 * When the app runs in a regular browser (not Electron), IPC is unavailable.
 * This module provides a mock electronAPI that returns sensible defaults so
 * the renderer can boot and render the full UI for development/preview purposes.
 *
 * Install by importing this module early (e.g., in hooks.client.ts).
 */

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const NOW = new Date().toISOString();

const MOCK_WORKSPACES = [
  {
    id: 'mock-ws-1',
    title: 'Example Project',
    branch: 'feature/demo',
    baseRef: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: 'Active',
    createdAt: NOW,
    updatedAt: NOW,
    lastActivity: NOW,
    repositoryPath: '/Users/demo/projects/example',
    repositoryOwner: 'demo',
    repositoryName: 'example-project',
    tags: [],
    agentSummary: { agentIds: ['agent-1'] },
  },
  {
    id: 'mock-ws-2',
    title: 'Design System',
    branch: 'feature/tokens',
    baseRef: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: 'Active',
    createdAt: NOW,
    updatedAt: NOW,
    lastActivity: NOW,
    repositoryPath: '/Users/demo/projects/design-system',
    repositoryOwner: 'demo',
    repositoryName: 'design-system',
    tags: [],
  },
];

// ---------------------------------------------------------------------------
// Channel → response mapping
// ---------------------------------------------------------------------------

/** Return a mock response for a given IPC channel + data. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function mockInvoke(channel: string, data?: any): any {
  // Workspace channels
  if (channel === 'workspace:list') {
    return { success: true, data: MOCK_WORKSPACES };
  }
  if (channel === 'workspace:get-recent-repositories') {
    return { success: true, data: [] };
  }
  if (channel === 'workspace:get-settings' || channel === 'workspace:getSettings') {
    return { success: true, data: {} };
  }

  // App / system
  if (channel === 'app:version' || channel === 'app:get-version') {
    return { success: true, data: '0.0.0-browser' };
  }
  if (channel === 'system:get-info') {
    return { success: true, data: { platform: 'browser', arch: 'wasm', hostname: 'localhost' } };
  }
  if (channel === 'app:get-memory-usage') {
    return { success: true, data: { heapUsed: 0, heapTotal: 0 } };
  }

  // Provider / model channels
  if (channel === 'auggie:check-availability') {
    return { success: true, data: { available: false } };
  }
  if (channel === 'auggie:status') {
    return { success: true, data: { nodeVersionOk: true, nodeVersion: '20.0.0' } };
  }
  if (channel.endsWith(':get-models') || channel.endsWith(':check-availability')) {
    return { success: true, data: [] };
  }
  if (channel === 'providers:get-availability') {
    return { success: true, data: {} };
  }
  if (channel === 'providers:get-paths') {
    return { success: true, data: {} };
  }

  // Feature codes
  if (channel === 'feature-codes:get-active') {
    return { features: [] };
  }

  // Config / settings
  if (channel === 'config:get' || channel === 'config:get-all' || channel === 'config:getAll') {
    return { success: true, data: {} };
  }
  if (channel === 'settings:get' || channel === 'settings:getAll') {
    return { success: true, data: {} };
  }
  if (channel === 'config:get-model' || channel === 'config:get-all-models') {
    return { success: true, data: null };
  }

  // Sentry
  if (channel === 'sentry:get-config') {
    return null;
  }
  if (channel === 'analytics:get-config') {
    return { success: true, data: {} };
  }

  // Auto-update
  if (channel === 'auto-update:get-state') {
    return { success: true, data: { channel: 'stable', status: 'idle' } };
  }

  // Window channels
  if (channel.startsWith('window:')) {
    return { success: true };
  }

  // Panel layout
  if (channel === 'panel-layout:load') {
    return { success: true, data: null };
  }
  if (channel === 'first-visit-state:load') {
    return { success: true, data: null };
  }

  // Rules / specialists
  if (channel === 'rules:list' || channel === 'rules:load-workspace') {
    return { success: true, data: [] };
  }
  if (channel.startsWith('specialists:')) {
    return { success: true, data: [] };
  }
  if (channel.startsWith('user-rules:')) {
    return { success: true, data: channel.includes('get-all') ? [] : '' };
  }

  // Git channels
  if (channel.startsWith('git:')) {
    return { success: true, data: null };
  }

  // Persistence / storage
  if (channel.startsWith('persistence:') || channel.startsWith('storage:')) {
    return { success: true, data: null };
  }

  // Notes
  if (channel.startsWith('notes:')) {
    return { success: true, data: channel.includes('list') ? [] : null };
  }

  // Agent channels
  if (channel.startsWith('agent:')) {
    return { success: true, data: null };
  }

  // Log channels
  if (channel.startsWith('log:')) {
    return { success: true, data: null };
  }

  // Banner
  if (channel === 'banner:fetch') {
    return { success: true, data: null };
  }

  // MCP
  if (channel.startsWith('user-mcp:') || channel.startsWith('mcp:')) {
    return { success: true, data: channel.includes('list') ? [] : null };
  }

  // Skills
  if (channel === 'skills:list') {
    return { success: true, data: [] };
  }

  // Auth channels
  if (channel.includes('-auth:') || channel.includes('auth:')) {
    return { success: true, data: { authenticated: false } };
  }

  // Dialog
  if (channel.startsWith('dialog:')) {
    return { success: true, data: { canceled: true, filePaths: [] } };
  }

  // Default fallback — return a non-throwing "not available" response
  console.debug(`[BrowserMock] Unhandled IPC channel: ${channel}`);
  return { success: false, error: `Browser mock: channel "${channel}" not implemented` };
}

// ---------------------------------------------------------------------------
// HTTP IPC Bridge — try to reach the running Electron main process
// ---------------------------------------------------------------------------

/**
 * Candidate ports for the HTTP MCP Bridge (which hosts our /ipc endpoint).
 * The Electron app typically starts on 5179 but may use a nearby port.
 */
const BRIDGE_CANDIDATE_PORTS = [5179, 5180, 5181, 5182, 5183];
let resolvedBridgeUrl: string | null = null;
let bridgeProbePromise: Promise<string | null> | null = null;

/** Probe candidate ports once and cache the result. */
function probeBridgeUrl(): Promise<string | null> {
  if (bridgeProbePromise) return bridgeProbePromise;
  bridgeProbePromise = (async () => {
    // Use localhost (not 127.0.0.1) because the CSP allows http://localhost:*
    for (const port of BRIDGE_CANDIDATE_PORTS) {
      const baseUrl = `http://localhost:${port}`;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 800);
        const res = await fetch(`${baseUrl}/health`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          // Verify this is actually the HTTP MCP bridge (not Vite or another server)
          try {
            const health = await res.json();
            if (health?.service !== 'http-mcp-bridge') continue;
          } catch {
            continue;
          }

          // Verify /ipc endpoint exists by sending a test request
          try {
            const ipcTest = await fetch(`${baseUrl}/ipc`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ channel: 'app:get-version' }),
            });
            if (!ipcTest.ok && ipcTest.status === 404) {
              console.info(
                `[BrowserMock] Bridge on port ${port} does not support /ipc — needs rebuild`,
              );
              continue;
            }
          } catch {
            continue;
          }

          console.info(`[BrowserMock] Found Electron HTTP bridge with /ipc at ${baseUrl}`);
          resolvedBridgeUrl = baseUrl;
          return baseUrl;
        }
      } catch {
        // not available on this port
      }
    }
    console.info('[BrowserMock] No Electron HTTP bridge found — using mock data');
    return null;
  })();
  return bridgeProbePromise;
}

/** Invoke an IPC handler via the HTTP bridge. Returns undefined if bridge is unavailable. */
async function bridgeInvoke(channel: string, data?: any): Promise<any> {
  const url = resolvedBridgeUrl ?? (await probeBridgeUrl());
  if (!url) return undefined;
  const workspaceId = getCurrentWorkspaceId();

  try {
    const res = await fetch(`${url}/ipc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
      },
      body: JSON.stringify({ channel, data }),
    });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

function getCurrentWorkspaceId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const match = window.location.pathname.match(/^\/workspace\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

// ---------------------------------------------------------------------------
// WebSocket event connection
// ---------------------------------------------------------------------------

type EventListener = { id: string; channel: string; callback: (...args: any[]) => void };
const eventListeners: EventListener[] = [];
let ws: WebSocket | null = null;
let wsConnectAttempted = false;

function connectEventWebSocket(): void {
  if (wsConnectAttempted || typeof WebSocket === 'undefined') return;
  wsConnectAttempted = true;

  // Wait for bridge URL to be resolved
  probeBridgeUrl().then((bridgeUrl) => {
    if (!bridgeUrl) return;

    const workspaceId = getCurrentWorkspaceId();
    const eventPath = workspaceId
      ? `/ipc-events?workspaceId=${encodeURIComponent(workspaceId)}`
      : '/ipc-events';
    const url = bridgeUrl.replace(/^http/, 'ws') + eventPath;
    try {
      ws = new WebSocket(url);
      ws.onmessage = (event) => {
        try {
          const { channel, data } = JSON.parse(event.data as string);
          for (const listener of eventListeners) {
            if (listener.channel === channel) {
              listener.callback(data);
            }
          }
        } catch {
          // ignore malformed messages
        }
      };
      ws.onopen = () => console.info('[BrowserMock] WebSocket connected for live events');
      ws.onclose = () => {
        console.debug('[BrowserMock] WebSocket disconnected');
        ws = null;
        // Retry after a delay
        setTimeout(() => {
          wsConnectAttempted = false;
          connectEventWebSocket();
        }, 5000);
      };
      ws.onerror = () => {
        // onclose will fire after this
      };
    } catch {
      // WebSocket not available
    }
  });
}

// ---------------------------------------------------------------------------
// Mock electronAPI object
// ---------------------------------------------------------------------------

let listenerIdCounter = 0;

const browserElectronAPI = {
  invoke: async (channel: string, data?: any): Promise<any> => {
    // Try the real Electron backend first
    const bridgeResult = await bridgeInvoke(channel, data);
    if (bridgeResult !== undefined) return bridgeResult;

    // Fall back to mock data
    return mockInvoke(channel, data);
  },

   
  send: (_channel: string, ..._args: any[]) => {
    // No-op in browser
  },

  on: (channel: string, callback: (...args: any[]) => void): string => {
    const id = `browser-mock-${++listenerIdCounter}`;
    eventListeners.push({ id, channel, callback });
    // Ensure WebSocket is connected for live events
    connectEventWebSocket();
    return id;
  },

   
  off: (_channel: string, _callback: (...args: any[]) => void) => {
    // No-op (use offById for reliable removal)
  },

  offById: (_channel: string, listenerId: string) => {
    const idx = eventListeners.findIndex((l) => l.id === listenerId);
    if (idx !== -1) eventListeners.splice(idx, 1);
  },

  removeAllListeners: (channel: string) => {
    for (let i = eventListeners.length - 1; i >= 0; i--) {
      if (eventListeners[i].channel === channel) {
        eventListeners.splice(i, 1);
      }
    }
  },

  once: (channel: string, callback: (...args: any[]) => void) => {
    const id = `browser-mock-${++listenerIdCounter}`;
    const wrappedCallback = (...args: any[]) => {
      callback(...args);
      const idx = eventListeners.findIndex((l) => l.id === id);
      if (idx !== -1) eventListeners.splice(idx, 1);
    };
    eventListeners.push({ id, channel, callback: wrappedCallback });
    connectEventWebSocket();
  },

   
  getPathForFile: (_file: File): string => '',

  getSentryConfig: () => null,

  fetchSentryConfig: async () => null,

  platform: 'darwin' as string,
  arch: 'arm64' as string,
  versions: {
    node: '20.0.0',
    chrome: '120.0.0',
    electron: '0.0.0-browser',
  },
};

// ---------------------------------------------------------------------------
// Auto-install
// ---------------------------------------------------------------------------

/**
 * Install the browser mock if we're not in Electron.
 * Call this as early as possible (e.g., in hooks.client.ts).
 */
export function installBrowserMock(): boolean {
  if (typeof window === 'undefined') return false;

  // Already have a real electronAPI — don't overwrite
  if ((window as any).electronAPI) return false;

  console.info('[BrowserMock] Installing mock electronAPI for browser-mode rendering');
  (window as any).electronAPI = browserElectronAPI;

  // Start probing for the Electron HTTP bridge in the background
  probeBridgeUrl();

  return true;
}

// Auto-install on import
installBrowserMock();

