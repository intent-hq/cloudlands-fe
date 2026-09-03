/**
 * Browser Mock for window.electronAPI
 *
 * When the app runs in a regular browser (not Electron), IPC is unavailable.
 * This module provides a mock electronAPI that returns sensible defaults so
 * the renderer can boot and render the full UI for development/preview purposes.
 *
 * DEV-ONLY: the mock masks missing daemon wiring, so it must never activate in
 * packaged/daemon-bridged runs. `installBrowserMock()` refuses to install
 * unless the build is a dev build (`import.meta.env.DEV`) or the mock is
 * explicitly opted into via `VITE_ENABLE_BROWSER_MOCK=true`. Every served mock
 * response also logs a loud `[BrowserMock]` console warning naming the channel
 * so mock data can never silently pass for real data.
 *
 * Install by importing this module early (e.g., in hooks.client.ts).
 */

import {
  resolveBrowserWsUrl,
  sanitizeWsUrlForDisplay,
} from './client/live/browser-websocket-transport';
import {
  getWebDaemonStatusSource,
  onWebDaemonStatusSourceRegistered,
} from './client/live/web-daemon-status';
import { expectsElectronPreloadBridge } from './utils/platform-capabilities';

/**
 * Whether the browser mock is allowed to activate: dev builds or explicit
 * opt-in only — never packaged/daemon-bridged runs.
 */
export function isBrowserMockEnabled(): boolean {
  return !!import.meta.env.DEV || import.meta.env.VITE_ENABLE_BROWSER_MOCK === 'true';
}

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
// Backend transport channels (`backend:*`)
// ---------------------------------------------------------------------------
//
// `electron-ipc-transport.ts` unwraps `backend:request` / `backend:subscribe`
// responses as the `BackendResult` envelope `{ ok: true, result }` /
// `{ ok: false, error: { code, message } }` produced by the main-process
// bridge (`backend.ipc.ts`). These handlers mirror that envelope; the legacy
// `{ success, data }` shape below is only for the non-backend IPC channels.

let subscriptionIdCounter = 0;

/** §5.13 `daemonBootId` is a per-boot UUID; a page load is the mock's boot. */
const MOCK_DAEMON_BOOT_ID = crypto.randomUUID();

/**
 * Module-private sentinel marking a structured wire error from
 * `mockBackendMethodResult`. A symbol key cannot collide with a legitimate
 * mocked result shape (unlike an `'error' in result` check).
 */
const MOCK_ERROR = Symbol('browser-mock-error');

interface MockErrorEnvelope {
  [MOCK_ERROR]: { code: string; message: string; data: { code: string }; rpcCode: number };
}

/** Structured wire error mirroring `JsonRpcError.toErrorPayload()`: the real
 * bridge always carries `data.code` and the numeric `rpcCode` alongside
 * `code`/`message` (`isDaemonErrorResponse` duck-types on `rpcCode`). */
function mockError(code: string, rpcCode: number, message: string): MockErrorEnvelope {
  return { [MOCK_ERROR]: { code, message, data: { code }, rpcCode } };
}

function isMockError(value: unknown): value is MockErrorEnvelope {
  return typeof value === 'object' && value !== null && MOCK_ERROR in value;
}

/**
 * Mock results for the daemon JSON-RPC methods hit at boot and during the
 * workspace-open lifecycle reads. Returns a `MOCK_ERROR`-keyed envelope for
 * structured wire errors (mirroring the daemon's -32602 responses) and
 * `undefined` for methods the mock does not implement.
 */
function mockBackendMethodResult(method: string, params?: Record<string, unknown>): unknown {
  if (method === 'workspace.list') return { workspaces: MOCK_WORKSPACES };
  // Workspace open (monorepo#2605): resolve by id per PROTOCOL §5.1
  // ({ workspace } envelope; -32602 when not found).
  if (method === 'workspace.get') {
    const workspace = MOCK_WORKSPACES.find((ws) => ws.id === params?.workspaceId);
    if (!workspace) {
      return mockError(
        'INVALID_PARAMS',
        -32602,
        `Browser mock: workspace "${String(params?.workspaceId)}" not found`,
      );
    }
    return { workspace };
  }
  // Tab registration (monorepo#2605): PROTOCOL §5.4 — flat list plus the
  // byNoteId → byTaskKey map; empty is a valid daemon response.
  if (method === 'task.listAgentLinks') return { links: [], linksByNoteId: {} };
  // Remaining workspace-open lifecycle reads (lifecycle-read-saga):
  // PROTOCOL §5.23 TokenUsage rollup — lastScanAt null before the first scan.
  if (method === 'workspace.getTokenUsage') {
    const totals = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
    return { tokenUsage: { byAgentId: {}, totals, byModel: {}, lastScanAt: null } };
  }
  if (method === 'workspace.getContext') return { items: [] };
  if (method === 'script.list') return { scripts: [] };
  // §5.13 v4.0 envelope: { terminals, daemonBootId } — never the bare array.
  if (method === 'terminal.list') {
    return { terminals: [], daemonBootId: MOCK_DAEMON_BOOT_ID };
  }
  // Other empty-safe reads hit during workspace open (audit, monorepo#2605).
  if (method === 'agent.listActive') return { streams: [] };
  if (method === 'prMonitor.list') return { monitors: [] };
  if (method === 'gitRoot.list') return { gitRoots: [] };
  // §5.9 file.tree returns a bare array.
  if (method === 'file.tree') return [];
  // §5.19 file-tracking reads (refreshChanges in the lifecycle saga).
  if (method === 'file-tracking.getChanges') {
    return { changes: [], truncated: false, totalCount: 0 };
  }
  if (method === 'file-tracking.loadCommits') {
    return { commits: [], boundarySha: null, nextToken: null };
  }
  if (method === 'repo.list') return { repos: [] };
  if (method === 'settings.list') return { settings: [] };
  if (method === 'agent.list') return { agents: [], retiredCount: 0 };
  if (method === 'agent.listInterrupted') return { agents: [] };
  if (method === 'models.list') return { models: [] };
  if (method === 'skill.list') return { skills: [] };
  if (method === 'search.fileNames') return { files: [] };
  if (method === 'comment.list') return { threads: [] };
  if (method === 'task.list') {
    return { tasks: [], stats: { total: 0, completed: 0, inProgress: 0 } };
  }
  if (method === 'note.list') return { notes: [] };
  if (method === 'git.status') {
    return {
      branch: '',
      ahead: 0,
      behind: 0,
      diverged: false,
      files: [],
      hasUncommittedChanges: false,
      hasUntrackedFiles: false,
    };
  }
  // `event.query` (§5.10) returns a bare newest→oldest array.
  if (method === 'event.query') return [];
  // The daemon-events-bridge firehose issues `events.subscribe` over
  // `backend:request` (not the `backend:subscribe` channel).
  if (method === 'events.subscribe') {
    return { subscriptionId: `browser-mock-sub-${++subscriptionIdCounter}` };
  }
  if (method === 'events.unsubscribe') return {};
  return undefined;
}

/** Handle the `backend:*` transport channels; `undefined` when not one of them. */
function mockBackendInvoke(channel: string, data?: any): any {
  if (channel === 'backend:request') {
    const method = data?.method;
    if (typeof method !== 'string' || method.length === 0) {
      return { ok: false, error: { code: 'INVALID_PARAMS', message: 'method is required' } };
    }
    const result = mockBackendMethodResult(method, data?.params);
    if (isMockError(result)) {
      return { ok: false, error: result[MOCK_ERROR] };
    }
    if (result !== undefined) {
      return { ok: true, result };
    }
    return {
      ok: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: `Browser mock: backend method "${method}" not implemented`,
      },
    };
  }
  if (channel === 'backend:subscribe') {
    return { ok: true, result: { subscriptionId: `browser-mock-sub-${++subscriptionIdCounter}` } };
  }
  if (channel === 'backend:unsubscribe') {
    return { ok: true, result: {} };
  }
  if (channel === 'backend:get-status') {
    // dev:web — reflect the live BrowserWebSocketTransport state so the
    // daemon-health slice doesn't show a false "intentd is stopped" overlay
    // while the WS connection to the daemon is healthy.
    const source = getWebDaemonStatusSource();
    if (source) {
      return {
        status: source.getStatus(),
        transport: { mode: 'external-ws', target: source.getTarget() },
      };
    }
    const wsUrl = resolveBrowserWsUrl();
    if (wsUrl) {
      // The WS transport singleton is created lazily on first request and is
      // not up yet — report external-ws immediately so the daemon-loss UI
      // hides the spawn-sidecar button and locality treats the daemon as
      // remote from the very first status read.
      return {
        status: 'connecting',
        transport: { mode: 'external-ws', target: sanitizeWsUrlForDisplay(wsUrl) },
      };
    }
    // Bare status shape (no envelope), mirroring backend.ipc.ts. `disconnected`
    // keeps connection-gated boot flows (e.g. interrupted-agents) inert.
    return { status: 'disconnected', transport: 'browser-mock' };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Channel → response mapping
// ---------------------------------------------------------------------------

/** Return a mock response for a given IPC channel + data. */
function mockInvoke(channel: string, data?: any): any {
  // Backend transport channels use the BackendResult envelope, not the
  // legacy { success, data } shape.
  const backendResponse = mockBackendInvoke(channel, data);
  if (backendResponse !== undefined) {
    return backendResponse;
  }

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

  // Provider / model channels
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
// Event listeners (only backend:status is live — forwarded from the WS
// transport in dev:web; every other channel is a stub for browser preview)
// ---------------------------------------------------------------------------

type EventListener = { id: string; channel: string; callback: (...args: any[]) => void };
const eventListeners: EventListener[] = [];

/** Deliver a payload to every mock listener registered on a channel. */
function emitBrowserMockEvent(channel: string, payload: unknown): void {
  for (const listener of [...eventListeners]) {
    if (listener.channel === channel) listener.callback(payload);
  }
}

// ---------------------------------------------------------------------------
// Mock electronAPI object
// ---------------------------------------------------------------------------

let listenerIdCounter = 0;

const browserElectronAPI = {
  invoke: async (channel: string, data?: any): Promise<any> => {
    console.warn(
      `[BrowserMock] Serving MOCK response for IPC channel '${channel}' — this is dev-only mock data, not a real bridge`,
    );
    return mockInvoke(channel, data);
  },

  send: (_channel: string, ..._args: any[]) => {
    // No-op in browser
  },

  on: (channel: string, callback: (...args: any[]) => void): string => {
    const id = `browser-mock-${++listenerIdCounter}`;
    eventListeners.push({ id, channel, callback });
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
  },

  getPathForFile: (_file: File): string => '',

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
 *
 * Refuses to install outside dev builds / explicit opt-in (see
 * `isBrowserMockEnabled`), so a packaged run without a bridge fails loudly via
 * `UnbridgedMockIpcChannelError` instead of silently serving mock data.
 *
 * Also refuses inside an Electron renderer even when `window.electronAPI` is
 * not present yet: the preload bridge can be exposed after early renderer
 * modules evaluate, so bridge presence at import time is not a safe signal.
 * The Electron check reads the user agent, which is available synchronously.
 */
export function installBrowserMock(): boolean {
  if (typeof window === 'undefined') return false;

  // Dev-only affordance — never activate in packaged/daemon-bridged runs
  if (!isBrowserMockEnabled()) return false;

  // Electron-built renderer in Electron — the preload bridge owns
  // window.electronAPI; its absence here means the preload has not landed,
  // not that this is a browser (see intent-hq/monorepo#3606). The web build
  // inside the app's <webview> is not affected (never has a preload).
  if (expectsElectronPreloadBridge()) {
    console.warn(
      '[BrowserMock] Electron renderer detected — refusing to install the mock over the preload bridge',
    );
    return false;
  }

  // Already have a real electronAPI — don't overwrite
  if ((window as any).electronAPI) return false;

  console.warn(
    '[BrowserMock] Installing mock electronAPI for browser-mode rendering — all IPC responses are DEV MOCKS',
  );
  (window as any).electronAPI = browserElectronAPI;

  installWebDaemonStatusBridge();

  return true;
}

let webDaemonStatusBridgeInstalled = false;

/**
 * dev:web daemon health: once the BrowserWebSocketTransport registers as the
 * status source (lazily, on first backend request), forward its
 * connection-status transitions as backend:status push events — the
 * daemon-health service subscribes via electronAPI.on, not the mock router.
 * Idempotent (guarded for repeat installBrowserMock calls, e.g. HMR), and a
 * re-registered source replaces the previous onStatusChange subscription so
 * events are never emitted in duplicate.
 */
function installWebDaemonStatusBridge(): void {
  if (webDaemonStatusBridgeInstalled) return;
  webDaemonStatusBridgeInstalled = true;
  let unsubscribeStatus: (() => void) | null = null;
  let unsubscribeReconnected: (() => void) | null = null;
  onWebDaemonStatusSourceRegistered((source) => {
    unsubscribeStatus?.();
    unsubscribeReconnected?.();
    unsubscribeStatus = source.onStatusChange((status) => {
      emitBrowserMockEvent('backend:status', {
        status,
        transport: { mode: 'external-ws', target: source.getTarget() },
      });
    });
    // Mirror backend.ipc.ts: on the 2nd+ successful connect, emit a
    // `reconnected: true` marker AFTER the plain 'connected' status event so
    // consumers (interrupted-agents, provider-availability) distinguish
    // reconnects from the initial connect.
    unsubscribeReconnected = source.onReconnected(() => {
      emitBrowserMockEvent('backend:status', {
        status: 'connected',
        reconnected: true,
        transport: { mode: 'external-ws', target: source.getTarget() },
      });
    });
  });
}

// Auto-install on import
installBrowserMock();
