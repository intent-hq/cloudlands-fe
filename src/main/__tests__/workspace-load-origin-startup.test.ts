// @verify-changed-triggers: src/main/index.ts, src/shared/ipc-registry.ts, scripts/inline-ipc-channels.ts, src/preload/index.template.ts
/** Actual main startup + pool + route registration over declared desktop edges.
 * Controlled boundaries: Electron frame/preload delivery, storage/identity and Duplex.
 * No native IPC, real daemon, socket-peer or service-readiness claim.
 */
import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';
import { app, BrowserWindow, ipcMain, webContents } from 'electron';
import {
  mockInvoke,
  registerMockIpcHandler,
  unregisterMockIpcHandler,
  resetMockIpcRouter,
} from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import vm from 'node:vm';
import ts from 'typescript';
import type { BrowserWindow as ElectronWindow, IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Frame {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}
const edge = vi.hoisted(() => ({
  sockets: [] as ControlledSocket[],
  beforeSocketReturn: undefined as undefined | ((socket: ControlledSocket) => void),
  respond: undefined as undefined | ((socket: ControlledSocket, frame: Frame) => unknown),
  list: undefined as undefined | (() => Promise<unknown[]>),
  findGuest: undefined as undefined | ((id: string) => Promise<unknown>),
  persist: undefined as undefined | (() => Promise<void>),
  device: undefined as undefined | (() => Promise<boolean>),
  identityChanged: false,
  guest: false,
  credentialChanged: undefined as undefined | ((id: string) => void),
  autoHello: false,
  order: [] as string[],
  event: undefined as IpcMainInvokeEvent | undefined,
  registered: new Set<string>(),
  failRegistration: undefined as string | undefined,
  initRepo: vi.fn(),
  initHistory: vi.fn(),
}));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  const app = Object.assign(new EventEmitter(), {
    getPath: vi.fn(() => '/tmp/test/userData'),
    getAppPath: vi.fn(() => '/tmp/test-app'),
    getName: vi.fn(() => 'test-app'),
    getVersion: vi.fn(() => '1.0.0'),
    isReady: vi.fn(() => true),
    isPackaged: false,
  });
  return {
    app,
    ipcMain: { handle: vi.fn(), removeHandler: vi.fn(), on: vi.fn() },
    BrowserWindow: {
      fromWebContents: vi.fn(),
      getAllWindows: vi.fn(() => []),
      getFocusedWindow: vi.fn(() => null),
    },
    webContents: { fromFrame: vi.fn() },
    dialog: { showMessageBox: vi.fn() },
    protocol: { registerSchemesAsPrivileged: vi.fn() },
    session: { defaultSession: {} },
  };
});
vi.mock('../window', async () => ({
  ...(await import('../window-backend')),
  // This declared native boundary has no focused or main BrowserWindow.
  getFocusedWindowBackendId: () => 'local',
}));
vi.mock('../../features/backend/main/client-identity', () => ({
  buildMainClientHelloParams: async () => ({ clientId: 'lifecycle-control' }),
  getOrCreateClientId: async () => 'lifecycle-control',
  persistClientId: () => edge.persist?.() ?? Promise.resolve(),
  setLocalHostIdentity: () => {
    const changed = edge.identityChanged;
    edge.identityChanged = false;
    return changed;
  },
}));
vi.mock('../../features/backend/main/connections-store', () => ({
  list: () =>
    edge.list?.() ??
    Promise.resolve(
      ['remote-A', 'remote-B'].map((id) => ({
        id,
        host: id + '.test',
        hosts: [id + '.test'],
        port: 443,
        fingerprint: 'ab'.repeat(32),
      })),
    ),
  getActiveId: async () => 'local',
  getDecryptedToken: async () => 'controlled-owner-token',
  setDetectedDeviceKind: () => edge.device?.() ?? Promise.resolve(false),
  setHostname: async () => false,
  setDaemonVersion: async () => false,
  setUpdateSupported: async () => false,
  setTcAddress: async () => false,
  setHosts: async () => false,
  getDetectHosts: async () => false,
  onConnectionsMutated: () => () => {},
}));
vi.mock('../../features/backend/main/guest-sessions-store', () => ({
  list: async () => [],
  findById: (id: string) =>
    edge.findGuest?.(id) ??
    Promise.resolve(
      edge.guest && id === 'guest-1'
        ? {
            id,
            host: 'guest.test',
            hosts: ['guest.test'],
            port: 443,
            fingerprint: 'cd'.repeat(32),
            tcAddress: null,
            principalId: 'prn_control',
            updatedAt: 1,
            workspaces: [],
          }
        : null,
    ),
  getDecryptedToken: async () => 'controlled-guest-token',
  setPrincipal: async () => true,
  setWorkspaces: async () => false,
  setHostname: async () => false,
  setTcAddress: async () => false,
  setHosts: async () => false,
  onGuestSessionsMutated: () => () => {},
  onGuestCredentialReplaced: (fn: (id: string) => void) => {
    edge.credentialChanged = fn;
    return () => {};
  },
  onGuestSessionRemovedBySync: () => () => {},
  createInvitedSyncAdapter: () => ({}),
}));
vi.mock('../../features/backend/main/intentd-sidecar', () => ({
  onSidecarGaveUp: () => () => {},
  onSidecarStartupFailed: () => () => {},
  getLocalDaemonProtocolVersion: () => null,
  getSidecarStartupFailure: () => null,
  getSidecarRunLog: vi.fn(),
  spawnSidecarOnDemand: vi.fn(),
}));
vi.mock('../../features/browser/main/browser-exec-reverse', () => ({
  registerBrowserExecReverseHandler: vi.fn(),
}));
vi.mock('../../features/backend/main/backend-connection', async (original) => ({
  ...(await original<typeof import('../../features/backend/main/backend-connection')>()),
  createBackendSocket(config: { transport: string; host?: string }) {
    const socket = new ControlledSocket(config.transport === 'uds' ? 'local' : config.host!);
    edge.sockets.push(socket);
    edge.beforeSocketReturn?.(socket);
    return socket;
  },
}));

function defaultReply(frame: Frame): unknown {
  switch (frame.method) {
    case 'client.hello':
      return { clientId: 'physical-composition-client' };
    case 'host.status':
      return { hostname: 'control', deviceKind: 'desktop' };
    case 'system.status':
      return { updateSupported: false };
    case 'server.pairingInfo':
      return { token: 'control-only', certFingerprint: 'ef'.repeat(32), port: 443, localIps: [] };
    case 'principal.me':
      return {
        id: 'prn_control',
        login: null,
        displayName: null,
        avatarUrl: null,
        isAdministrator: false,
        hostRole: 'member',
        hostMembershipRevision: 1,
      };
    case 'events.subscribe':
      return { subscriptionId: 'original-subscription' };
    case 'workspace.list':
      return { workspaces: [] };
    case 'workspace.get':
      return { workspace: { id: frame.params!.workspaceId, title: 'Original' } };
    default:
      return { released: true };
  }
}
class ControlledSocket extends Duplex {
  readonly frames: Frame[] = [];
  readonly replies = new Set<Frame>();
  readonly claimed = new Set<Frame>();
  readonly waiters: Array<{ method: string; resolve(frame: Frame): void }> = [];
  constructor(readonly owner: string) {
    super();
  }
  _read() {}
  _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
    const frame = JSON.parse(chunk.toString()) as Frame;
    this.frames.push(frame);
    const index = this.waiters.findIndex((waiter) => waiter.method === frame.method);
    if (index !== -1) {
      this.claimed.add(frame);
      this.waiters.splice(index, 1)[0].resolve(frame);
    }
    if (frame.method !== 'client.hello' || edge.autoHello) {
      void Promise.resolve(edge.respond?.(this, frame) ?? defaultReply(frame)).then(
        (result) => this.reply(frame, result),
        (error: unknown) => this.fail(frame, error),
      );
    }
    done();
  }
  next(method: string): Promise<Frame> {
    const frame = this.frames.find((item) => item.method === method && !this.claimed.has(item));
    if (frame) {
      this.claimed.add(frame);
      return Promise.resolve(frame);
    }
    return new Promise((resolve) => this.waiters.push({ method, resolve }));
  }
  reply(frame: Frame, result = defaultReply(frame)): void {
    if (this.replies.has(frame) || this.destroyed) return;
    this.replies.add(frame);
    this.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }) + '\n'));
  }
  fail(frame: Frame, error: unknown): void {
    if (this.replies.has(frame) || this.destroyed) return;
    this.replies.add(frame);
    this.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error }) + '\n'));
  }
}

vi.unmock('../../features/protocol/main/protocol-adapter');
vi.mock('../../features/system/main/system.ipc', () => ({
  getFocusedWindowWorkspaceId: () => null,
}));
vi.mock('../../features/terminal/main/terminal.ipc', () => ({
  cleanupWorkspaceTerminals: vi.fn(),
}));
vi.mock('../../features/metadata-fs/main/metadata-fs-factory', () => ({
  clearMetadataFSCache: vi.fn(),
}));
vi.mock('../../features/workspace/main/workspace-path.service', () => ({
  getWorkspacePath: vi.fn(),
}));
vi.mock('../../features/workspace/main/repo-registry', () => ({
  initRepoRegistry: edge.initRepo,
  getAllRepos: () => [],
  addRepo: vi.fn(),
  removeRepo: vi.fn(),
  syncRepos: vi.fn(),
  clearRepos: vi.fn(),
}));
vi.mock('../../features/workspace/main/change-history-persistence', async (original) => ({
  ...(await original<typeof import('../../features/workspace/main/change-history-persistence')>()),
  initChangeHistory: edge.initHistory,
}));
vi.mock('../../features/tools/main/tool.service', () => ({ ToolService: class {} }));
vi.mock('../../features/tools/main/executor-manager', () => ({ executorManager: {} }));
vi.mock('../../features/acp-official/main/server/acp-server', () => ({ ACPServer: class {} }));

const windows = new Map<object, ElectronWindow>();
const cleanups: Array<() => void> = [];
type Pool = typeof import('../../features/backend/main/backend.ipc');
let lifecycle: ReturnType<Pool['enrollBackendClientLifecycle']> | undefined;
const originalIPCHandle = ipcMain.handle;
// Exact expected failures belong to each deliberately induced error below.
// Never exclude controlled transport/request failures from the physical receipt.
type Retirement = Awaited<ReturnType<NonNullable<typeof lifecycle>['retire']>>;
let expectedOutcome: Retirement['outcome'] = 'clean';
let expectedFailures: unknown[] = [];
const expectedClientFailures = new Map<number, unknown[]>();
const platform = process.platform;
const bootMocks: string[] = [];
const bootStops: Array<() => Promise<void>> = [];
beforeEach(() => {
  Object.defineProperty(ipcMain, 'handle', {
    value: originalIPCHandle,
    writable: true,
    configurable: true,
  });
  vi.resetModules();
  expectedOutcome = 'clean';
  expectedFailures = [];
  expectedClientFailures.clear();
  Object.defineProperty(process, 'platform', { value: 'linux' });
  vi.stubEnv('PATH', process.env.PATH);
  vi.stubEnv('INTENTD_SOCKET', '/controlled-workspace-load.sock');
  vi.stubEnv('INTENTD_WS_URL', '');
  vi.stubEnv('INTENTD_TCP', '');
  edge.sockets = [];
  edge.order = [];
  edge.beforeSocketReturn = undefined;
  edge.respond = undefined;
  edge.autoHello = false;
  edge.registered.clear();
  edge.failRegistration = undefined;
  edge.initRepo.mockReset();
  edge.initHistory.mockReset();
  resetMockIpcRouter();
  const events = new EventEmitter();
  Object.assign(app, {
    on: events.on.bind(events),
    once: events.once.bind(events),
    emit: events.emit.bind(events),
    removeListener: events.removeListener.bind(events),
  });
  vi.mocked(BrowserWindow.fromWebContents).mockImplementation(
    (sender) => windows.get(sender) ?? null,
  );
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
  Object.assign(webContents, {
    fromFrame: (frame: unknown) =>
      [...windows.keys()].find(
        (sender) => (sender as { mainFrame: unknown }).mainFrame === frame,
      ) ?? null,
  });
  vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
    if (channel === edge.failRegistration || edge.registered.has(channel))
      throw new Error('Controlled duplicate registration');
    edge.registered.add(channel);
    registerMockIpcHandler(channel, (payload) => handler(edge.event!, payload));
  });
  vi.mocked(ipcMain.removeHandler).mockImplementation((channel) => {
    edge.registered.delete(channel);
    unregisterMockIpcHandler(channel);
  });
});
afterEach(async () => {
  try {
    for (const stop of bootStops.splice(0).reverse()) await stop();
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    edge.autoHello = true;
    for (const socket of edge.sockets) {
      if (socket.destroyed) continue;
      if (!socket.frames.some((frame) => frame.method === 'client.hello')) socket.emit('connect');
      for (const frame of socket.frames) if (frame.method === 'client.hello') socket.reply(frame);
    }
    if (lifecycle) {
      const receipt = await lifecycle.retire({
        ready: () => true,
        subscribeChanged: () => () => {},
      });
      expect(receipt.ownersJoined).toBe(true);
      expect(receipt.admissionSealed).toBe(true);
      expect(receipt.outcome).toBe(expectedOutcome);
      expect(receipt.failures).toEqual(expectedFailures);
      expect(receipt.excludedOwners).toEqual([]);
      for (const client of receipt.clients) {
        const failures = expectedClientFailures.get(client.identity.generation) ?? [];
        expect(client.outcome).toBe(failures.length ? 'original-failure' : 'clean');
        expect(client.failures).toEqual(failures);
        expect(client.ownersJoined).toBe(true);
        expect(client.admissionSealed).toBe(true);
        expect(client.closes.length).toBeGreaterThan(0);
        for (const close of client.closes) {
          expect(close.destroyRequested).toBe(true);
          expect(close.closeObserved).toBe(true);
        }
      }
      expect(edge.sockets.every((socket) => socket.destroyed)).toBe(true);
    }
  } finally {
    lifecycle = undefined;
    Object.defineProperty(ipcMain, 'handle', {
      value: originalIPCHandle,
      writable: true,
      configurable: true,
    });
    for (const name of bootMocks.splice(0)) vi.doUnmock(name);
    windows.clear();
    resetMockIpcRouter();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    Object.defineProperty(process, 'platform', { value: platform });
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// Desktop/bootstrap edges only. These explicit export lists are not an oracle for
// the assertions below. The real index module, pool, physical enrollment, route
// registration, strict bindings, protocol adapter and workspace reads execute.
// Unrelated IPC/service/UI setup stays inert; boot stops at the held sidecar edge.
const bootstrapEdges: Record<string, string[]> = {
  './isolated-test-bootstrap.js': [],
  './isolated-test-profile.js': ['getIsolatedTestProfile', 'isIsolatedTestBuild'],
  './build-config.generated.js': ['BUILD_CONFIG'],
  './utils/resolve-dev-instance.js': [
    'resolveDevIntentdDataDir',
    'resolveDevUserDataDirName',
    'resolveUserDataBasePath',
    'shouldIsolateDevIntentdDataDir',
  ],
  './ipc-authorization.js': ['createAuthorizedIpcHandler'],
  './logging/console-log-capture.js': ['setupConsoleLogCapture'],
  '../shared/logger': ['Logger'],
  '../shared/utils/workspace-activity-time': ['compareWorkspaceActivityDisplayTimeDesc'],
  './ipc-handler-wrapper': ['exportHandlerDebugInfo', 'setupIPCInterceptor'],
  './utils/suppress-warnings': ['initializeWarningSuppression'],
  './utils/hard-exit-timeout': ['runWithHardExitTimeout'],
  './utils/process-error-handlers': ['handleUncaughtException', 'handleUnhandledRejection'],
  './webview-security': ['isWebviewPopupWindow', 'setupWebviewSecurity'],
  './app-command-navigation': ['attachAppCommandHistoryNavigation'],
  './swipe-navigation': ['attachSwipeHistoryNavigation'],
  './renderer-hang-monitor': ['attachRendererHangMonitor'],
  './app-activate': ['createBootWindowsGate', 'handleActivate'],
  './renderer-window-gate': ['markRendererWindowsAllowed'],
  '../features/hardware-console/main/hardware-console.ipc': ['setupHardwareConsoleMain'],
  '../features/hardware-console/main/console-owner': ['setupConsoleOwnerTracking'],
  '../features/hardware-console/main/clear-lighting-shutdown': [
    'requestHardwareConsoleLightingClear',
  ],
  '../features/debug-export/main/debug-bundle.service': ['createDebugBundle'],
  '../features/debug-export/main/stack-sample.service': [
    'createStackSampleFile',
    'shouldShowStackSampleMenuItem',
  ],
  '../shared/main/ipc-debug-tracker': ['ipcDebugTracker'],
  '../features/accept-changes/main/accept-changes.ipc': ['registerAcceptChangesHandlers'],
  '../features/agent/agent-context.ipc': ['registerAgentContextHandlers'],
  '../features/auggie/main/auggie.ipc': ['setupAuggieIPC'],
  '../features/opencode/main/opencode.ipc': ['setupOpencodeIPC'],
  '../features/claude-code/main/claude-code.ipc': ['setupClaudeCodeIPC'],
  '../features/pi/main/pi.ipc': ['setupPiIPC'],
  '../features/codex/main/codex.ipc': ['setupCodexIPC'],
  '../features/cortex/main/cortex.ipc': ['setupCortexIPC'],
  '../features/droid/main/droid.ipc': ['setupDroidIPC'],
  '../features/grok/main/grok.ipc': ['setupGrokIPC'],
  '../features/unsloth/main/unsloth.ipc': ['setupUnslothIPC'],
  '../features/antigravity/main/antigravity.ipc': ['setupAntigravityIPC'],
  '../features/feature-codes/main/feature-codes.ipc': ['setupFeatureCodesIPC'],
  '../features/providers/main/provider-availability.service': ['setupProviderAvailabilityIPC'],
  '../features/config/main/config.ipc': ['setupConfigIPC', 'getConfigManager'],
  '../features/events/main/events.ipc': ['setupEventsIPC'],
  '../features/external-editors/main/external-editors.ipc': ['registerExternalEditorsHandlers'],
  '../features/file/main/file.ipc': ['setupFileIPC'],
  '../features/ide/main/ide.ipc': ['registerIDEHandlers'],
  '../features/layout/main/panel-layout-history.ipc': ['setupPanelLayoutHistoryIPC'],
  '../features/log/main/log.ipc': ['setupLogIPC'],
  '../features/notifications/main/notification.ipc': ['setupNotificationIPC'],
  '../features/notifications/main/notification.service': ['getNotificationService'],
  '../features/rules/main/rules.ipc': ['setupRulesIPC'],
  '../features/specialists/main/specialists.ipc': ['setupSpecialistsIPC'],
  '../features/auto-update/main/auto-update.ipc': ['setupAutoUpdateIPC'],
  '../features/release-notes/main/release-notes.ipc': ['setupReleaseNotesIPC'],
  '../features/auto-update/main/auto-update.service': ['isInstallingUpdate'],
  '../features/backend/main/workspace-transfer.ipc': ['registerWorkspaceTransferHandlers'],
  '../features/backend/main/workspace-import.ipc': ['registerWorkspaceImportHandlers'],
  '../features/backend/main/connection-mode': ['getConnectionMode', 'getDaemonVersionInfo'],
  '../features/backend/main/guest-sessions-store': ['list'],
  '../features/backend/main/connections-store': ['getActiveId', 'list'],
  '../features/backend/main/intentd-sidecar': [
    'probeDaemonVersion',
    'resolveSocketPath',
    'startIntentdSidecar',
    'stopIntentdSidecar',
  ],
  '../features/backend/main/intentd-version-pin': ['readPinnedVersion'],
  '../features/backend/main/intentd-about-version': ['formatIntentdAboutVersion'],
  './memory-monitor': ['startMemoryMonitor', 'stopMemoryMonitor'],
  '../features/rules/main/user-rules.ipc': ['setupUserRulesIPC'],
  '../features/setup-scripts/main/setup-scripts.ipc': ['registerSetupScriptsHandlers'],
  '../features/system/main/system.ipc': [
    'setupSystemIPC',
    'isFocusedWindowInWorkspace',
    'getFocusedWindowWorkspaceId',
    'getAllOpenWorkspaceIds',
    'installIntentCli',
    'autoRepairCliSymlink',
  ],
  '../features/system/main/power-state': ['setupPowerStateIPC'],
  '../features/terminal/main/terminal.ipc': ['cleanupTerminals', 'setupTerminalIPC'],
  '../features/user-activity/main/user-activity.ipc': ['setupUserActivityIPC'],
  '../features/workspace/main/first-visit-state.ipc': ['setupFirstVisitStateIPC'],
  '../features/workspace/main/workspace-summary.ipc': ['setupWorkspaceSummaryIPC'],
  '../utils/startup-metrics': ['startupMetrics'],
  './main-locale': ['setMainLanguagePreference', 'getMainLanguagePreference'],
  './utils/cdp-debug': ['isCdpMcpBridgeEnabled'],
  './quit-confirmation': ['confirmQuitWithRunningAgents'],
  './menu-workspace-command': ['sendWorkspaceCommand'],
  './menu-new-window': ['openNewWindowFromMenu'],
  './menu-devtools-toggle': ['toggleWindowDevTools'],
  './menu-zoom': ['handleMenuZoom'],
  '../features/agent/main/agent-missing.ipc': ['registerMissingAgentHandlers'],
  '../features/voice/main/voice-local.ipc': ['registerVoiceLocalHandlers'],
  '../shared/main/temp-files': ['cleanupStaleTempFiles'],
  '../features/agent/main/specialists.service': [
    'initSpecialistsService',
    'refreshGitHubAuthStatus',
  ],
  '../features/workspace/main/app-settings.service': ['initAppSettingsService'],
  '../features/workspace/main/workspace.service': ['workspaceService'],
  '../features/collaboration-auth/main/collaboration-auth.ipc': [
    'registerCollaborationAuthHandlers',
  ],
  '../features/deeplink/main/deeplink.ipc': ['registerDeepLinkHandlers'],
  '../features/deeplink/deep-link-handler': ['DeepLinkHandler'],
  '../features/deeplink/main/invite-deep-link': ['handleInviteDeepLink', 'routeInviteLinkFromOs'],
  '../features/deeplink/main/pair-deep-link': ['handlePairDeepLink', 'routePairLinkFromOs'],
  '../features/deeplink/utils/scrub-token': ['scrubToken'],
  '../features/deeplink/utils/find-intent-url': ['findIntentUrl'],
  '../shared/utils/invite-uri': ['isInviteUri'],
  '../shared/utils/pairing-uri': ['isPairingUri'],
  '../features/export/main/export.ipc': ['registerChatExportHandlers'],
  '../features/debug-export/main/debug-export.ipc': ['registerDebugExportHandlers'],
  '../features/workspace/main/workspace-pr.ipc': ['registerWorkspacePRHandlers'],
  './ipc-cleanup-manager': ['ipcCleanupManager'],
  './utils/resolve-app-title.js': ['setResolvedAppName'],
  '../features/dev-console/main/dev-console-window': ['setupDevConsoleIPC', 'disposeDevConsole'],
  './hud-window.js': ['isHudWindow', 'isTrackedHudWindow'],
  './window-menu-entries.js': ['buildWindowMenuEntries'],
  './native-menu-model.js': ['buildNativeEditMenu', 'buildNativeViewMenu'],
  './about-dialog.js': ['buildAboutDialogOptions', 'formatThirdPartyCredits'],
  './state': ['getMainWindow'],
  './window.js': [
    'captureWindowSessionsSnapshot',
    'clearWindowSessionsSnapshot',
    'createWindow',
    'createWindowForDeepLink',
    'getWindowSessionsPath',
    'markWindowSessionTeardown',
    'restoreAllBackendWindowSessions',
    'saveAllWindowSessions',
    'setOnLastWindowClosedForBackend',
    'stampWindowWithBackend',
  ],
  './protocol-handlers.js': [
    'setupAppProtocolHandler',
    'setupWorkspaceAssetProtocolHandler',
    'setupWorkspaceFileProtocolHandler',
    'setupWorkspaceMediaBackendHinting',
  ],
};

async function loadMain(
  options: {
    enabled?: boolean;
    packaged?: boolean;
    importAllocation?: boolean;
    helperAllocation?: boolean;
    failRegistration?: boolean;
  } = {},
) {
  vi.stubEnv('INTENT_DEV_REACT', options.enabled === false ? '0' : '1');
  const pool = await import('../../features/backend/main/backend.ipc');
  lifecycle = pool.enrollBackendClientLifecycle();
  const workspace = await import('../../features/workspace/main/workspace.ipc');
  const protocol = await import('../../features/protocol/main/protocol-adapter');
  const realElectron = await import('electron');
  const ready = deferred<void>();
  const sidecar = deferred<void>();
  const enteredSidecar = deferred<void>();
  const finalizers: Promise<unknown>[] = [];
  const signals = new EventEmitter();
  let origins: ReturnType<Pool['enrollBackendConnectionOrigins']> | undefined;
  const fixtureError = new Error('Controlled boot failure');
  let originAtAllocation: ReturnType<NonNullable<typeof origins>['capture']> | undefined;
  edge.beforeSocketReturn = (socket) => {
    edge.order.push('allocation');
    originAtAllocation = origins?.capture('local');
    queueMicrotask(() => socket.emit('connect'));
  };
  edge.autoHello = true;
  const setupWebviewSecurity = () => {
    edge.order.push('first-helper');
    if (options.helperAllocation) pool.getBackendClient();
  };
  const overrides: Record<string, Record<string, unknown>> = {
    './isolated-test-profile.js': {
      getIsolatedTestProfile: () => null,
      isIsolatedTestBuild: () => false,
    },
    './build-config.generated.js': { BUILD_CONFIG: { GIT_COMMIT_HASH: '' } },
    './utils/resolve-dev-instance.js': {
      resolveDevUserDataDirName: () => null,
      resolveUserDataBasePath: () => '/tmp/controlled-main',
      shouldIsolateDevIntentdDataDir: () => false,
    },
    './utils/resolve-app-title.js': { setResolvedAppName: () => 'Controlled desktop' },
    // Authorization is an explicit controlled edge here. The separate real
    // ipc-authorization regressions own trusted-renderer/security acceptance.
    './ipc-authorization.js': {
      createAuthorizedIpcHandler: (_channel: string, handler: unknown) => handler,
    },
    './webview-security': { setupWebviewSecurity },
    './app-activate': { createBootWindowsGate: () => ({ ready: Promise.resolve(), release() {} }) },
    '../shared/logger': {
      Logger: class {
        info() {}
        warn() {}
        error() {}
        debug() {}
      },
    },
    '../utils/startup-metrics': { startupMetrics: { start() {}, end() {}, logSummary() {} } },
    '../shared/main/ipc-debug-tracker': { ipcDebugTracker: { dispose() {} } },
    './ipc-cleanup-manager': { ipcCleanupManager: { patchIPCMain() {}, cleanupAll() {} } },
    '../features/deeplink/deep-link-handler': { DeepLinkHandler: class {} },
    '../features/backend/main/intentd-sidecar': {
      startIntentdSidecar: () => {
        edge.order.push('sidecar');
        enteredSidecar.resolve();
        return sidecar.promise;
      },
    },
    '../features/backend/main/intentd-version-pin': { readPinnedVersion: () => null },
    '../features/backend/main/connections-store': {
      getActiveId: async () => 'local',
      list: async () => [],
    },
    '../features/backend/main/guest-sessions-store': { list: async () => [] },
    '../features/system/main/system.ipc': {
      isFocusedWindowInWorkspace: () => false,
      getAllOpenWorkspaceIds: () => [],
    },
    './main-locale': { getMainLanguagePreference: () => 'en' },
    './state': { getMainWindow: () => null },
    './window-menu-entries.js': { buildWindowMenuEntries: () => [] },
    './native-menu-model.js': { buildNativeEditMenu: () => ({}), buildNativeViewMenu: () => ({}) },
    './about-dialog.js': { formatThirdPartyCredits: () => '' },
    './utils/hard-exit-timeout': { runWithHardExitTimeout: async () => {} },
  };
  for (const [specifier, names] of Object.entries(bootstrapEdges)) {
    const modulePath = path.resolve(__dirname, '..', specifier);
    bootMocks.push(modulePath);
    const exported = Object.fromEntries(names.map((name) => [name, vi.fn()]));
    Object.assign(exported, overrides[specifier]);
    vi.doMock(modulePath, () => {
      if (options.importAllocation && specifier === './logging/console-log-capture.js')
        pool.getBackendClient();
      return exported;
    });
  }
  const backendPath = path.resolve(__dirname, '../../features/backend/main/backend.ipc');
  const workspacePath = path.resolve(__dirname, '../../features/workspace/main/workspace.ipc');
  const protocolPath = path.resolve(__dirname, '../../features/protocol/main/protocol-adapter');
  bootMocks.push(backendPath, workspacePath, protocolPath, 'module');
  vi.doMock(backendPath, () => ({
    ...pool,
    enrollBackendConnectionOrigins() {
      edge.order.push('enroll');
      origins = pool.enrollBackendConnectionOrigins();
      return origins;
    },
  }));
  vi.doMock(workspacePath, () => ({
    ...workspace,
    setupWorkspaceLoadIPC(input: Parameters<typeof workspace.setupWorkspaceLoadIPC>[0]) {
      edge.order.push('register');
      if (options.failRegistration) edge.failRegistration = IPC_CHANNELS.WORKSPACE_LOAD.READ;
      return workspace.setupWorkspaceLoadIPC(input);
    },
  }));
  vi.doMock(protocolPath, () => protocol);
  const electron = {
    ...realElectron,
    Menu: { buildFromTemplate: (items: unknown) => items, setApplicationMenu: vi.fn() },
  };
  const controlledCreateRequire = () => (name: string) => {
    if (name === 'electron') return electron;
    throw new Error('Undeclared bootstrap require: ' + name);
  };
  vi.doMock('module', async (importOriginal) => {
    const actual = await importOriginal<
      { default: typeof import('module') } & typeof import('module')
    >();
    expect(actual.default).toBeTypeOf('function');
    return {
      ...actual,
      createRequire: controlledCreateRequire,
      // CJS interop can read Module.createRequire through the default export.
      // Preserve the constructor and other properties without mutating Node's Module.
      default: new Proxy(actual.default, {
        get(target, key, receiver) {
          return key === 'createRequire'
            ? controlledCreateRequire
            : Reflect.get(target, key, receiver);
        },
      }),
    };
  });
  // Observe the otherwise fire-and-forget finally rejection without replacing
  // the real boot callback or any cleanup. This is test error drainage only.
  Object.assign(app, {
    isPackaged: !!options.packaged,
    commandLine: { appendSwitch() {}, getSwitchValue: () => '' },
    setPath() {},
    getPath: () => '/tmp/controlled-main',
    getVersion: () => '1.0.0',
    requestSingleInstanceLock: () => true,
    setAsDefaultProtocolClient: () => true,
    whenReady: () => ({
      then(callback: () => Promise<void>) {
        const boot = ready.promise.then(callback);
        const originalFinally = boot.finally.bind(boot);
        boot.finally = (callback) => {
          const result = originalFinally(callback);
          result.catch(() => {});
          finalizers.push(result);
          return result;
        };
        return boot;
      },
    }),
    quit: vi.fn(),
    exit: vi.fn(),
  });
  // `protocol`/`session` are actual Electron edges, not application owners.
  vi.spyOn(process, 'on').mockImplementation(((event: string, fn: (...args: unknown[]) => void) => {
    signals.on(event, fn);
    return process;
  }) as typeof process.on);
  const stopTimers = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
    callback: () => void,
    ms: number,
    ...args: unknown[]
  ) => {
    // Boot's diagnostic timers are inert. Transport timers retain normal ownership.
    if (ms === 5000 || ms === 2000) return { unref() {} } as NodeJS.Timeout;
    return originalSetTimeout(callback, ms, ...args);
  }) as typeof setTimeout);
  bootStops.push(async () => {
    sidecar.reject(fixtureError);
    sidecar.promise.catch(() => {});
    ready.resolve();
    await Promise.allSettled(finalizers);
    stopTimers.mockRestore();
    app.emit('will-quit');
  });
  let importError: unknown;
  try {
    // Check both paths before either may resolve a real Electron package.
    const moduleEdge = await import('module');
    expect(moduleEdge.createRequire).toBe(controlledCreateRequire);
    expect(moduleEdge.default.createRequire).toBe(controlledCreateRequire);
    await import('../index');
  } catch (error) {
    importError = error;
  }
  return {
    pool,
    get origins() {
      return origins;
    },
    get originAtAllocation() {
      return originAtAllocation;
    },
    importError,
    ready,
    sidecar,
    enteredSidecar,
    finalizers,
    fixtureError,
    signals,
  };
}
const originalSetTimeout = globalThis.setTimeout;

describe('actual main workspace-load startup ownership over declared desktop edges', () => {
  it('owns enrollment and registration before the first boot helper can allocate', async () => {
    const h = await loadMain({ helperAllocation: true });
    expect(h.importError).toBeUndefined();
    expect(edge.order).toEqual(['enroll', 'register']);
    h.ready.resolve();
    await h.enteredSidecar.promise;
    expect(edge.order.slice(0, 5)).toEqual([
      'enroll',
      'register',
      'first-helper',
      'allocation',
      'sidecar',
    ]);
    expect(h.originAtAllocation).toBeTruthy();
    expect(edge.registered.has('workspace-load:prepare')).toBe(true);
  });

  it('captures the real File-menu workspace.list allocation before the sidecar edge', async () => {
    const h = await loadMain();
    expect(h.importError).toBeUndefined();
    h.ready.resolve();
    await h.enteredSidecar.promise;
    const socket = edge.sockets[0];
    await socket.next('workspace.list');
    expect(h.originAtAllocation).toBeTruthy();
    expect(edge.order).toEqual(['enroll', 'register', 'first-helper', 'allocation', 'sidecar']);
  });

  it.each([{ enabled: false }, { packaged: true }])(
    'keeps ordinary startup unowned for %j',
    async (options) => {
      const h = await loadMain(options);
      expect(h.importError).toBeUndefined();
      expect(h.origins).toBeUndefined();
      expect(edge.registered.has('workspace-load:prepare')).toBe(false);
      h.ready.resolve();
      await h.enteredSidecar.promise;
      expect(edge.order).toEqual(['first-helper', 'allocation', 'sidecar']);
      const client = h.pool.getBackendClientForConnection('local');
      app.emit('will-quit');
      expect(h.pool.getBackendClientForConnection('local')).toBe(client);
    },
  );

  it('refuses a dependency import allocation rather than inventing its lost origin', async () => {
    const h = await loadMain({ importAllocation: true });
    expect(h.importError).toMatchObject({
      name: 'Error',
      message: 'Connection origin capture requires an unowned empty pool',
    });
    expect(h.origins).toBeUndefined();
    expect(edge.registered.has('workspace-load:prepare')).toBe(false);
    expect(h.pool.getBackendClientForConnection('local')).toBeDefined();
  });

  it('cleans a failed registration without disposing an unrelated client', async () => {
    const h = await loadMain({ failRegistration: true });
    expect(h.importError).toMatchObject({
      name: 'Error',
      message: 'Controlled duplicate registration',
    });
    expect(h.origins).toBeDefined(); // Enrollment succeeded before registration failed.
    expect(edge.registered.has('workspace-load:observe-origin')).toBe(false);
    expect(h.origins!.capture('local')).toBeNull();
    expect(() => h.pool.enrollBackendConnectionOrigins()).toThrow();
    expect(edge.sockets).toHaveLength(0);
    const cached = (
      globalThis as typeof globalThis & {
        __ipcHandlerFunctions: Map<string, (...args: unknown[]) => Promise<unknown>>;
      }
    ).__ipcHandlerFunctions;
    expect(
      await cached.get('workspace-load:read')!(
        {},
        { originId: 'o', requestId: 'r', workspaceId: 'w', routeId: 'route', operation: 'get' },
      ),
    ).toEqual({
      ok: false,
      error: {
        code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE',
        message: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE',
      },
    });
  });

  it.each(['failure', 'quit', 'signal'] as const)(
    'terminal %s retires captured handles and unregisters only its routes',
    async (cause) => {
      const h = await loadMain();
      expect(h.importError).toBeUndefined();
      h.ready.resolve();
      await h.enteredSidecar.promise;
      const captured = h.origins!.capture('local')!;
      const client = h.pool.getBackendClientForConnection('local');
      registerMockIpcHandler('independent:owner', () => 'alive');
      if (cause === 'failure') {
        h.sidecar.reject(h.fixtureError);
        await Promise.allSettled(h.finalizers);
      } else if (cause === 'signal') h.signals.emit('SIGTERM');
      else {
        app.emit('will-quit');
        app.emit('will-quit');
      }
      expect(captured.read().state).toBe('retired');
      expect(edge.registered.has('workspace-load:prepare')).toBe(false);
      // Existing main bookkeeping retains HTTP callbacks after native removal.
      // Their actual disposed guard must refuse rather than resurrect ownership.
      const cached = (
        globalThis as typeof globalThis & {
          __ipcHandlerFunctions: Map<string, (...args: unknown[]) => Promise<unknown>>;
        }
      ).__ipcHandlerFunctions;
      expect(
        await cached.get('workspace-load:prepare')!(
          {},
          { originId: 'o', requestId: 'r', workspaceId: 'w' },
        ),
      ).toEqual({
        ok: false,
        error: {
          code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE',
          message: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE',
        },
      });
      expect(await mockInvoke('independent:owner')).toBe('alive');
      expect(h.pool.getBackendClientForConnection('local')).toBe(client);
      expect(edge.sockets[0].destroyed).toBe(false);
      expect(() => h.pool.enrollBackendConnectionOrigins()).toThrow();
    },
  );
});

// @verify-changed-triggers: src/shared/ipc-registry.ts, scripts/inline-ipc-channels.ts, src/preload/index.template.ts
it('generates and executes the real preload allowlist for invoke/on/offById', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-load-preload-'));
  try {
    await fs.mkdir(path.join(directory, 'src/preload'), { recursive: true });
    await fs.copyFile(
      path.resolve(__dirname, '../../preload/index.template.ts'),
      path.join(directory, 'src/preload/index.template.ts'),
    );
    await promisify(execFile)(
      'pnpm',
      ['exec', 'tsx', 'scripts/inline-ipc-channels.ts', directory],
      {
        cwd: path.resolve(__dirname, '../../..'),
        // The generator's spawned Node cache shares this test's finally cleanup.
        env: { ...process.env, NODE_COMPILE_CACHE: path.join(directory, 'node-compile-cache') },
      },
    );
    const preloadFile = path.join(directory, 'src/preload/index.ts');
    // Compile the generator's actual file through TypeScript's file host. The VM
    // below tests emitted behavior; canonical preload typing is a separate gate.
    const program = ts.createProgram([preloadFile], {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      noCheck: true,
      types: [],
    });
    const preloadSource = program.getSourceFile(preloadFile);
    expect(preloadSource).toBeDefined();
    expect(program.getSyntacticDiagnostics(preloadSource)).toEqual([]);
    const emitted = new Map<string, string>();
    const emission = program.emit(preloadSource, (fileName, contents) => {
      emitted.set(fileName, contents);
    });
    expect(emission.emitSkipped).toBe(false);
    expect(emitted.size).toBe(1);
    const code = emitted.get(path.join(directory, 'src/preload/index.js'));
    expect(code).toBeDefined();
    const listeners = new EventEmitter();
    const invoke = vi.fn(async () => ({ ok: true, result: null }));
    let api!: Window['electronAPI'];
    const electron = {
      contextBridge: {
        exposeInMainWorld: (_name: string, value: typeof api) => {
          api = value;
        },
      },
      ipcRenderer: {
        invoke,
        on: listeners.on.bind(listeners),
        removeListener: listeners.removeListener.bind(listeners),
      },
      webUtils: {},
    };
    vm.runInNewContext(code!, {
      require: (id: string) => {
        if (id === 'electron') return electron;
        throw new Error(id);
      },
      exports: {},
      process: { platform: 'linux', arch: 'x64', versions: {} },
      console,
    });
    for (const channel of [
      'workspace-load:observe-origin',
      'workspace-load:prepare',
      'workspace-load:read',
      'workspace-load:release',
      'workspace-load:release-origin',
    ]) {
      await api.invoke(channel, { controlled: true });
      expect(invoke).toHaveBeenLastCalledWith(channel, { controlled: true });
    }
    const notice = vi.fn();
    const id = api.on('workspace-load:retired', notice);
    listeners.emit('workspace-load:retired', {}, { kind: 'origin', originId: 'original' });
    expect(notice).toHaveBeenCalledWith({ kind: 'origin', originId: 'original' });
    api.offById('workspace-load:retired', id!);
    listeners.emit('workspace-load:retired', {}, { kind: 'origin', originId: 'original' });
    expect(notice).toHaveBeenCalledTimes(1);
    await expect(api.invoke('workspace-load:not-registered')).rejects.toThrow();
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
