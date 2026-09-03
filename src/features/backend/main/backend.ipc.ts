/**
 * IPC bridge between the renderer's LiveAppClient and the main-process
 * JSON-RPC client for the intentd daemon.
 *
 * The renderer cannot open a UDS socket, so it reaches the daemon through these
 * channels:
 *   - `backend:request`   → forward a JSON-RPC request, return `{ ok, result }`
 *                           or `{ ok: false, error: { code, message, data } }`.
 *   - `backend:subscribe` → forward `events.subscribe`, return its result.
 *   - `backend:unsubscribe` → forward `events.unsubscribe`.
 *   - `backend:get-status` → current connection status.
 *   - `backend:spawn-sidecar` → spawn the app-managed sidecar on demand (the
 *     user chose the fallback in the daemon-loss UI, #439). Probes the socket
 *     first and never spawns alongside a live daemon; concurrent calls spawn
 *     at most once. Once mode flips to `sidecar` there is no mid-session
 *     auto-switching back — the JsonRpcClient target (socket path) is
 *     unchanged, so we simply stay connected to whatever serves the socket.
 * Daemon JSON-RPC notifications are sent to windows bound to that daemon on
 * `backend:notification`; connection-status changes use `backend:status`. The
 * status payload carries a `reconnected: true` marker on the successful
 * `connected` transition following an earlier drop, so renderer consumers can
 * replay `events.subscribe` calls and refresh coarse state without a relaunch
 * (RESUB-1). Main-process consumers observe the same signal directly via
 * `onBackendReconnected(handler)`.
 */
import { EventEmitter } from 'node:events';
import { app, BrowserWindow, ipcMain } from 'electron';
import { Logger } from '$shared/logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { isLoopbackHost } from '$shared/loopback-host';
import { cancelInflightHostExecStreamsForBackendSwitch } from '$shared/main/host-exec-stream';
import {
  AuthRejectedError,
  captureFingerprint,
  normalizeFingerprint as normalizeTransportFingerprint,
  PinMismatchError,
  resolveBackendConfig,
  type BackendConnectionConfig,
  type HostCertMismatch,
} from './backend-connection';
import { JsonRpcClient, type ConnectionStatus, type JsonRpcNotification } from './json-rpc-client';
import {
  disposeTransferConnectionsForBackend,
  requestOverTransferConnection,
  shouldUseTransferConnection,
} from './transfer-connections';
import { JsonRpcError } from './json-rpc-errors';
import { getOrCreateClientId, persistClientId } from './client-identity';
import { formatTransportInfo } from './transport-info';
import { readPinnedVersion } from './intentd-version-pin';
import {
  getLocalDaemonProtocolVersion,
  getSidecarRunLog,
  getSidecarStartupFailure,
  onSidecarGaveUp,
  onSidecarStartupFailed,
  spawnSidecarOnDemand,
} from './intentd-sidecar';
import {
  getConnectionMode,
  getDaemonVersionInfo,
  getLocalUpdateSupported,
  getOrphanedSidecarInfo,
  setDaemonVersionInfo,
  setLocalUpdateSupported,
  setOrphanedSidecarInfo,
} from './connection-mode';
import { computeDaemonVersionRefresh } from './daemon-version-refresh';
import { daemonHelloBuildKey, extractDaemonHelloBuildInfo } from './daemon-hello-build-info';
import { detectOrphanedSidecar } from './intentd-orphan';
import { defaultKill, restartOrphanedSidecar } from './orphan-recovery';
import * as connectionsStore from './connections-store';
import {
  initKeychainSyncLifecycle,
  isKeychainSyncEnabled,
  KEYCHAIN_SYNC_ENABLED_KEY,
  type KeychainSyncLifecycle,
} from './keychain-sync-lifecycle';
import { setLocalPref } from '../../../main/local-prefs';
import {
  extractSelfPairingInfo,
  getStoredSelfFingerprint,
  isAutoPublishSuppressed,
  normalizeFingerprint,
  setAutoPublishSuppressed,
  setStoredSelfFingerprint,
  type SelfPairingInfo,
} from './self-publish';
import { registerBrowserExecReverseHandler } from '../../browser/main/browser-exec-reverse';
import { LOCAL_CONNECTION_ID, type ConnectionRecord } from '../../../shared/types/connections';
import type {
  AddConnectionResult,
  CaptureFingerprintResult,
  ConnectionAuthRejectedEvent,
  ConnectionCertMismatchEvent,
  ConnectionCertWarningsEvent,
  ConnectionHostCertWarning,
  ConnectionProtocolMismatchEvent,
  ConnectionsChangedEvent,
  ConnectionsListResult,
  ForgetConnectionResult,
  KeychainSyncStateResult,
  OpenConnectionResult,
  PublishSelfResult,
  RefreshSelfResult,
  RotateConnectionSecretResult,
  SelfPublishedStateResult,
  TestConnectionResult,
  UnpublishSelfResult,
  UpdateConnectionResult,
  UpdateBackendResult,
} from '../../../shared/types/connections';
import { compareProtocolMajor } from './protocol-compat';
import {
  ConnectionsAddSchema,
  ConnectionsCaptureFingerprintSchema,
  ConnectionsForgetSchema,
  ConnectionsListSchema,
  ConnectionsOpenSchema,
  ConnectionsRotateSecretSchema,
  ConnectionsPublishSelfSchema,
  ConnectionsRefreshSelfSchema,
  ConnectionsSelfPublishedStateSchema,
  ConnectionsTestSchema,
  ConnectionsSyncGetStateSchema,
  ConnectionsSyncSetEnabledSchema,
  ConnectionsUnpublishSelfSchema,
  ConnectionsUpdateSchema,
  ConnectionsUpdateBackendSchema,
} from '../../../main/ipc-schemas';
import { createValidatedHandler } from '../../../main/ipc-validation-middleware';
import { getBackendIdForWebContents, getFocusedWindowBackendId } from '../../../main/window';

const logger = new Logger('Backend-IPC');
const BACKEND = IPC_CHANNELS.BACKEND;
const CONNECTIONS = IPC_CHANNELS.CONNECTIONS;

// Last daemon build identity logged per connection from a `client.hello`
// result (#3649): the handshake re-runs on every (re)connect, so dedupe on
// version+commit per connection id to log each connected daemon's build once
// instead of once per reconnect (a daemon upgrade logs again).
const lastLoggedDaemonBuildKeys = new Map<string, string>();
const connectedDaemonVersions = new Map<string, string>();

/**
 * #3649: log the connected daemon's build identity once at INFO so the log
 * file records which daemon build each connection talked to. Shared by every
 * pool member; `connectionId` disambiguates
 * which backend the line refers to and scopes the reconnect dedupe. The
 * BuildInfo category is pinned to INFO in logging-config.ts so the line
 * survives the packaged build's WARN default level.
 */
const buildInfoLogger = new Logger('BuildInfo');

function logDaemonHelloBuild(helloResult: unknown, connectionId: string): void {
  const helloBuild = extractDaemonHelloBuildInfo(helloResult);
  if (!helloBuild) {
    connectedDaemonVersions.delete(connectionId);
    return;
  }
  connectedDaemonVersions.set(connectionId, helloBuild.version);
  const key = daemonHelloBuildKey(helloBuild);
  if (lastLoggedDaemonBuildKeys.get(connectionId) === key) return;
  lastLoggedDaemonBuildKeys.set(connectionId, key);
  // i18n-ignore (developer log message)
  buildInfoLogger.info('Connected to intentd', {
    connectionId,
    version: helloBuild.version,
    buildCommit: helloBuild.buildCommit ?? 'unknown',
  });
}

/** @internal Test seam: clear the per-connection daemon-build log dedupe. */
export function __resetDaemonBuildLogForTesting(): void {
  lastLoggedDaemonBuildKeys.clear();
  connectedDaemonVersions.clear();
}

/**
 * Capture a REMOTE backend's daemon version from its `client.hello` result
 * (`server.version`) and persist it on the connection record, following the
 * `setHostname` capture pattern. The handshake re-runs on every (re)connect,
 * so a daemon upgrade refreshes the stored value. Fire-and-forget/fail-soft
 * by design — a store write error must never disturb the handshake — and the
 * `connections:changed` broadcast fires only when the stored value actually
 * changed (the store dedupes the common every-reconnect same-version case).
 * Never called for the local entry: the `DaemonVersionInfo` path owns the
 * local daemon's version.
 */
function captureRemoteDaemonVersion(helloResult: unknown, connectionId: string): void {
  const helloBuild = extractDaemonHelloBuildInfo(helloResult);
  if (!helloBuild) return;
  void connectionsStore
    .setDaemonVersion(connectionId, helloBuild.version)
    .then((changed) => (changed ? broadcastConnectionsChanged() : undefined))
    .catch((error: unknown) => {
      logger.warn('Failed to capture remote daemon version', {
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}
const backendClients = new Map<string, JsonRpcClient>();
const backendClientConnects = new Map<string, Promise<JsonRpcClient>>();
let handlersRegistered = false;

/** Main-process lifecycle signal for services caching state by pooled client. */
export const BACKEND_CLIENT_DISCONNECTED_EVENT = 'backend-client-disconnected';

/**
 * Lazily-read intentd.version pin, injected into every transport payload so
 * the renderer can compare the connected daemon's version against the pin in
 * any connection mode. Cached: the pin file cannot change while running.
 */
let pinnedVersionCache: string | null | undefined;
function getPinnedVersion(): string | null {
  if (pinnedVersionCache === undefined) {
    pinnedVersionCache = readPinnedVersion({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
    });
  }
  return pinnedVersionCache;
}

/**
 * Stable/persistent reconnect forwarder (T8). Main-process services
 * (terminal registry, notification.service,
 * app-settings, ACP terminal) attach their reconnect/resubscribe handlers via
 * {@link onBackendReconnected} exactly ONCE at registration time. Historically
 * those handlers were attached directly to the live JsonRpcClient instance — so
 * after a client swap (e.g. an active re-pair via `connections:add`) disposed
 * that client and built a new one, the handlers were stranded on the dead
 * client and never re-attached, and a later daemon reconnect would silently
 * fail to replay their subscriptions.
 *
 * The forwarder is a single long-lived emitter that outlives every client swap.
 * Each freshly constructed client's `reconnected` event is piped into it, and
 * a client rebuild emits one `reconnected` through it right after building
 * the new client so registered services re-subscribe against the new target
 * (a fresh client's FIRST connect is a plain `connected`, not a `reconnected`,
 * so without this nudge the swap would not trigger a resubscribe).
 */
const backendReconnectForwarder = new EventEmitter();
// One listener per main-process service; the default cap of 10 is comfortable
// today but raise the ceiling so adding services never trips a false leak warn.
backendReconnectForwarder.setMaxListeners(50);

/**
 * Stable/persistent notification forwarder (T9). Same rationale as
 * {@link backendReconnectForwarder}, applied to the daemon `notification`
 * stream: long-lived main-process services (terminal registry,
 * notification.service, app-settings, ACP terminal)
 * attach their notification listener exactly ONCE via
 * {@link onBackendNotification}. Historically each attached directly to the
 * live JsonRpcClient instance, so after a client swap disposed that
 * client the listener was stranded on the dead client — every daemon
 * `events.event` on the new client (terminal output/exit, script state/output,
 * `agent:idle`, `settings:changed`) was silently dropped for the rest of the
 * session. The forwarder outlives every client swap; each freshly built
 * client's `notification` event is piped into it.
 */
const backendNotificationForwarder = new EventEmitter();
backendNotificationForwarder.setMaxListeners(50);

/**
 * Stable/persistent status forwarder (T9). Mirrors
 * {@link backendNotificationForwarder} for the `status` stream that the
 * app-settings / notification.service `armStatusRetry` connect-retry hooks
 * need: a `status` listener attached to the live client would be stranded by a
 * client swap, so it registers here instead and observes the new client's
 * transitions.
 */
const backendStatusForwarder = new EventEmitter();
backendStatusForwarder.setMaxListeners(50);

// Keep the renderer's per-connection connectivity view (`connectedIds` on the
// connections list payload) current: any client's connected/disconnected
// transition re-broadcasts `connections:changed`. Both the primary and every
// pool member pipe `status` through this stable forwarder, so one listener
// covers all clients across swaps. 'connecting' is skipped — connectivity has
// not changed yet at that point (still disconnected).
backendStatusForwarder.on('status', (_id: string, status: ConnectionStatus) => {
  if (status === 'connecting') return;
  void broadcastConnectionsChanged().catch(() => {});
});

/**
 * One-shot guards so a pinned-cert mismatch surfaces a single failure event per
 * client — the reconnect loop re-raises {@link PinMismatchError} on every retry
 * against an unchanged cert, but the renderer only needs one blocking modal.
 * Keyed by connection id so each pooled backend (and the primary) tracks its
 * own guard; an id's entry is cleared whenever a fresh client for that id is
 * constructed (see {@link clearBackendFailureState}).
 */
const certMismatchNotifiedIds = new Set<string>();

/**
 * One-shot guards so a WSS auth rejection (HTTP 401/403) surfaces a single
 * failure event per client — the reconnect loop re-raises
 * {@link AuthRejectedError} on every retry against an unchanged token, but the
 * renderer only needs one notice. Keyed by connection id (parallels
 * {@link certMismatchNotifiedIds}).
 */
const authRejectedNotifiedIds = new Set<string>();

/**
 * The LOCAL intentd's `protocolVersion`, learned from the `client.hello`
 * handshake against the local pooled client. Used as the baseline for the
 * protocol-compatibility check for every remote backend (T15). `null` until
 * the first local handshake resolves.
 *
 * This is only ONE of two baseline sources: it is populated by the disposable
 * local pooled client, so a remote handshake landing before the local hello
 * resolves would find it `null`. The stable fallback is the sidecar manager's
 * startup handshake probe ({@link getLocalDaemonProtocolVersion}), which
 * survives client disposal — see {@link resolveLocalProtocolBaseline}
 * (cloudlands-fe#823).
 */
let localProtocolVersion: string | null = null;

/**
 * One-shot guards so a remote's protocol mismatch surfaces a single non-blocking
 * warning per client — the reconnect loop re-runs `client.hello` on every
 * retry, but the renderer only needs one notice. Keyed by connection id; an
 * id's entry is cleared whenever a fresh client for that id is constructed
 * (parallels {@link certMismatchNotifiedIds}).
 */
const protocolMismatchNotifiedIds = new Set<string>();

/**
 * Sticky protocol-mismatch per backend connection id (no entry when that
 * backend matches local or is local). Persisted here in main and replayed on
 * {@link listConnections} so a renderer that registered its
 * `connections:protocol-mismatch` listener AFTER the one-shot broadcast fired
 * still surfaces the advisory modal + menu warning (cloudlands-fe#823).
 *
 * A window can be created after its backend's handshake already fired —
 * a fast remote can broadcast the mismatch before the new renderer subscribes,
 * so the one-shot event alone is lossy. This latched copy closes that race.
 * An id's entry is cleared whenever a fresh client for that id is constructed
 * (see {@link clearBackendFailureState}) — the next `client.hello` re-detects
 * a mismatch for a mismatching remote and latches nothing for a matching/local
 * backend.
 */
const protocolMismatchById = new Map<string, ConnectionProtocolMismatchEvent>();

/**
 * Sticky auth-rejection per backend connection id (no entry when that
 * backend's auth is good or it is local). Persisted here in main and replayed
 * on {@link listConnections} so a renderer/window created or reloaded AFTER the
 * one-shot `connections:auth-rejected` broadcast fired (including the boot
 * path) still surfaces the actionable "authentication rejected" state —
 * exactly the {@link protocolMismatchById} pattern. An id's entry is cleared
 * whenever a fresh client for that id is constructed (a re-pair
 * builds a new client whose own connect re-detects any rejection).
 */
const authRejectedById = new Map<string, ConnectionAuthRejectedEvent>();

/**
 * Sticky cert-mismatch per backend connection id (no entry when that backend's
 * pinned cert matches or it is local). Persisted here in main and replayed on
 * {@link listConnections} so a renderer/window created AFTER the one-shot
 * `connections:cert-mismatch` broadcast fired still surfaces the blocking
 * trust warning — exactly the {@link authRejectedById} pattern. Critical for
 * the boot-wide restore: pooled clients start before any of their windows
 * exist, so a changed cert detected then would otherwise never be seen. An
 * id's entry is cleared whenever a fresh client for that id is constructed
 * (a re-pair builds a new client whose own connect re-detects a
 * still-changed cert).
 */
const certMismatchById = new Map<string, ConnectionCertMismatchEvent>();

/**
 * Sticky NON-FATAL per-host cert warnings per backend connection id, keyed by
 * host inside (latest fingerprint per host, accumulated across reconnect
 * attempts). The multi-host connection race (#1746) can succeed through one
 * candidate host while another presents a mismatching pinned cert — each such
 * observation is recorded here and broadcast as `connections:cert-warnings`,
 * and the aggregate is replayed on {@link listConnections} so a renderer
 * created after the broadcast still surfaces it (the {@link certMismatchById}
 * pattern, but informative rather than blocking). An id's entry is cleared
 * whenever a fresh client for that id is constructed (see
 * {@link clearBackendFailureState}).
 */
const certWarningsById = new Map<string, Map<string, ConnectionHostCertWarning>>();

/**
 * Handle for the keychain-sync lifecycle (T3), set once in
 * {@link registerBackendHandlers}. The T4 settings IPC reads its last-known
 * availability status and requests an immediate reconcile on enable.
 */
let keychainSyncLifecycle: KeychainSyncLifecycle | null = null;

/**
 * Window seam for backend open/forget flows. Injectable so orchestration unit
 * tests never pull in the Electron window module.
 */
interface BackendWindowHooks {
  openOrFocus?(backendId: string): void | Promise<void>;
  ensureLocalWindowBeforeClose?(backendId: string): void | Promise<void>;
  closeForBackend?(backendId: string): void | Promise<void>;
}
const defaultWindowHooks: BackendWindowHooks = {
  async openOrFocus(backendId) {
    const mod = (await import('../../../main/window')) as unknown as {
      openOrFocusWindowsForBackend: (id: string) => void;
    };
    mod.openOrFocusWindowsForBackend(backendId);
  },
  async ensureLocalWindowBeforeClose(backendId) {
    const mod = (await import('../../../main/window')) as unknown as {
      ensureLocalWindowBeforeClosingBackend: (id: string) => void;
    };
    mod.ensureLocalWindowBeforeClosingBackend(backendId);
  },
  async closeForBackend(backendId) {
    const mod = (await import('../../../main/window')) as unknown as {
      closeWindowsForBackend: (id: string) => void;
    };
    mod.closeWindowsForBackend(backendId);
  },
};
let windowHooks: BackendWindowHooks = defaultWindowHooks;

/** @internal Test seam: override the window-teardown hooks. */
export function __setBackendWindowHooksForTesting(hooks: BackendWindowHooks | null): void {
  windowHooks = hooks ?? defaultWindowHooks;
}

/**
 * @internal Test seams for the protocol-compat + sticky-mismatch flow (#823).
 * These poke the module-level baseline/mismatch state directly so the
 * sticky-replay behaviors can be exercised without standing up a live
 * JsonRpcClient/transport.
 */
export function __setLocalProtocolVersionForTesting(version: string | null): void {
  localProtocolVersion = version;
}
export function __handleHelloProtocolVersionForTesting(
  protocolVersion: string | null,
  connectionMeta: { id: string; host: string; port: number } | null = null,
): void {
  handleHelloProtocolVersion(protocolVersion, connectionMeta);
}
export function __getProtocolMismatchForTesting(
  id: string,
): ConnectionProtocolMismatchEvent | null {
  return protocolMismatchById.get(id) ?? null;
}
export function __listConnectionsForTesting(
  windowBackendId?: string,
): Promise<ConnectionsListResult> {
  return listConnections(windowBackendId);
}
export function __resetBackendProtocolStateForTesting(): void {
  localProtocolVersion = null;
  protocolMismatchNotifiedIds.clear();
  protocolMismatchById.clear();
  authRejectedById.clear();
  certMismatchById.clear();
  certWarningsById.clear();
}
/** @internal Test seam: read the latched per-host cert warnings for one backend id. */
export function __getCertWarningsForTesting(id: string): ConnectionCertWarningsEvent | null {
  return getCertWarningsEvent(id);
}
/** @internal Test seam: read the latched auth-rejection for one backend id. */
export function __getAuthRejectedForTesting(id: string): ConnectionAuthRejectedEvent | null {
  return authRejectedById.get(id) ?? null;
}
/** @internal Test seam: poke the latched auth-rejection directly. */
export function __setAuthRejectedForTesting(event: ConnectionAuthRejectedEvent | null): void {
  if (event) authRejectedById.set(event.id, event);
  else authRejectedById.clear();
}

/** Whether the focused window is bound to a remote backend (local when no window). */
export function isRemoteBackendActive(): boolean {
  const hasLiveWindow = BrowserWindow.getAllWindows().some((window) => !window.isDestroyed());
  return hasLiveWindow ? getFocusedWindowBackendId() !== LOCAL_CONNECTION_ID : false;
}

/**
 * Whether the focused window targets a daemon that is guaranteed to run on
 * THIS host: the window is bound to the local backend AND the resolved
 * transport is UDS (a UDS socket is same-host by construction). False for
 * saved remotes and for the env/dev transports (`INTENTD_WS_URL`,
 * `INTENTD_TCP`, dev loopback WS), which may point at a daemon on another
 * machine — callers gating platform-dependent daemon capabilities (e.g. the
 * win32 stack-sampling menu gate, #1889) must not assume those share the FE's
 * platform.
 */
export function isSameHostBackendActive(): boolean {
  const backendId = getFocusedWindowBackendId();
  if (backendId !== LOCAL_CONNECTION_ID) return false;
  const config =
    backendClients.get(LOCAL_CONNECTION_ID)?.getConfig() ??
    resolveBackendConfig(process.env, { isDev: !app.isPackaged });
  return config.transport === 'uds';
}

/** Liveness heartbeat interval; reconnect-on-close cannot detect half-open sockets. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Bound on the pre-window `host.status` probe for a REMOTE open. A remote
 * probe failure opens the window anyway (the connection-lost overlay owns
 * recovery), so a black-holed connect waiting out the client's 30s default
 * request timeout would only delay that window. 5s comfortably covers a
 * healthy WAN round-trip; a slower-but-healthy remote still opens fine — the
 * retained client finishes connecting in the background.
 */
const REMOTE_OPEN_PROBE_TIMEOUT_MS = 5_000;

/**
 * Drop every latched failure state (cert/auth one-shot guards, sticky protocol
 * mismatch and auth rejection, accumulated per-host cert warnings) for one
 * backend connection id. Called whenever
 * a fresh client for that id is constructed — its own connect + `client.hello`
 * re-detects any still-present failure — and when the id's client is disposed.
 */
function clearBackendFailureState(id: string): void {
  certMismatchNotifiedIds.delete(id);
  authRejectedNotifiedIds.delete(id);
  protocolMismatchNotifiedIds.delete(id);
  protocolMismatchById.delete(id);
  authRejectedById.delete(id);
  certMismatchById.delete(id);
  const hadWarnings = (certWarningsById.get(id)?.size ?? 0) > 0;
  certWarningsById.delete(id);
  // The warning contract promises an empty `warnings` broadcast on clear, so a
  // renderer relying solely on the dedicated channel drops its stale hosts.
  if (hadWarnings) broadcast(CONNECTIONS.CERT_WARNINGS, { id, warnings: [] }, id);
}

/**
 * Build the `connections:cert-warnings` payload for one backend id from the
 * accumulated per-host map, or `null` when nothing has been observed.
 */
function getCertWarningsEvent(id: string): ConnectionCertWarningsEvent | null {
  const byHost = certWarningsById.get(id);
  if (!byHost || byHost.size === 0) return null;
  return { id, warnings: [...byHost.values()] };
}

/**
 * Record one NON-FATAL per-host pin mismatch observed by a pool member's
 * connection race (#1746): accumulate it (latest fingerprint per host) and
 * broadcast the updated aggregate to the backend's windows. Deduped — an
 * unchanged fingerprint for an already-recorded host re-broadcasts nothing
 * (the race re-observes the same mismatch on every reconnect attempt).
 */
function recordCertWarning(
  meta: { id: string; host: string; port: number },
  info: HostCertMismatch,
): void {
  const warning: ConnectionHostCertWarning = {
    host: info.host,
    expectedFingerprint: info.expected,
    actualFingerprint: info.actual,
  };
  let byHost = certWarningsById.get(meta.id);
  if (!byHost) {
    byHost = new Map();
    certWarningsById.set(meta.id, byHost);
  }
  const previous = byHost.get(warning.host);
  if (
    previous &&
    previous.expectedFingerprint === warning.expectedFingerprint &&
    previous.actualFingerprint === warning.actualFingerprint
  ) {
    return;
  }
  byHost.set(warning.host, warning);
  const payload = getCertWarningsEvent(meta.id);
  if (payload) broadcast(CONNECTIONS.CERT_WARNINGS, payload, meta.id);
  logger.warn('Backend pool observed a non-fatal per-host cert mismatch', {
    id: meta.id,
    host: warning.host,
  });
}

/**
 * Compatibility alias for the pooled LOCAL client (see
 * {@link getLocalBackendClient}). Main-process services whose data must come
 * from the local daemon (app settings, workspace paths, config persistence,
 * sidecar surfaces) call this; per-window request routing goes through
 * {@link getBackendClientForIpcEvent} instead.
 */
export function getBackendClient(): JsonRpcClient {
  return getLocalBackendClient();
}

/** Return a live pooled client by connection id, without creating one. */
export function getBackendClientForConnection(id: string): JsonRpcClient | undefined {
  return backendClients.get(id);
}

/**
 * Snapshot of every live pooled backend id. Ensures the local client exists
 * first (parity with the `on*` forwarder hooks) so the always-on local
 * backend is always included. For services that partition per-backend state
 * (e.g. the notification service's per-backend `agent:idle` subscriptions)
 * and need to seed it for backends that connected before they started.
 */
export function getLiveBackendIds(): string[] {
  getLocalBackendClient();
  return [...backendClients.keys()];
}

/**
 * Resolve a backend id to its live pooled client — fail-closed. The one
 * exception: the local sidecar id lazily creates its pooled client
 * (startup boot order), matching {@link getBackendClientForIpcEvent}. Any
 * other id without a live pooled client throws instead of silently
 * retargeting another backend.
 */
export function getBackendClientForId(backendId: string): JsonRpcClient {
  const pooledClient = backendClients.get(backendId);
  if (pooledClient) return pooledClient;
  if (backendId === LOCAL_CONNECTION_ID) {
    return getLocalBackendClient();
  }
  throw new Error(`Backend client is not connected: ${backendId}`);
}

/**
 * Local-pinned accessor for services whose data must always come from the
 * local sidecar (app settings, workspace paths, config persistence). Lazily
 * builds the pooled LOCAL client from the env/UDS default on first use —
 * explicit transport overrides (`INTENTD_SOCKET`, `INTENTD_WS_URL`,
 * `INTENTD_TCP`) win either way; see `resolveBackendConfig`.
 */
export function getLocalBackendClient(): JsonRpcClient {
  const existing = backendClients.get(LOCAL_CONNECTION_ID);
  if (existing) return existing;
  const config = resolveBackendConfig(process.env, { isDev: !app.isPackaged });
  const instance = createAdditionalBackendClient(LOCAL_CONNECTION_ID, config);
  backendClients.set(LOCAL_CONNECTION_ID, instance);
  return instance;
}

/**
 * Ask one connected backend's daemon to self-update via
 * `system.requestUpdate` (the daemon signals its serve-mode sitter, which
 * installs the newer version and restarts the daemon). Returns a structured
 * {@link UpdateBackendResult} instead of throwing for daemon-side failures so
 * the renderer can toast a specific message:
 *   - local id in sidecar/unknown mode, or over a non-UDS transport →
 *     'unsupported' (the FE's app updater owns the app-managed sidecar; only
 *     an adopted `external` local daemon over UDS is routed like a remote,
 *     over the pooled local client — the same predicate as
 *     {@link captureLocalUpdateSupported});
 *   - no live pooled client → 'not-connected' (saved-but-disconnected remote,
 *     or a disconnected external local daemon);
 *   - JSON-RPC -32601 → 'unsupported' (daemon too old to know the method);
 *   - any other daemon/transport error → 'failed' with the error message.
 */
async function requestBackendUpdate(id: string): Promise<UpdateBackendResult> {
  if (id === LOCAL_CONNECTION_ID) {
    // Same predicate as captureLocalUpdateSupported: only an adopted
    // `external` daemon over UDS is self-updatable. External mode is also set
    // for env transport overrides (e.g. the INTENTD_WS_URL two-terminal dev
    // flow), where the pooled local client is not UDS — the UI never offers
    // Update there, and a direct IPC call must not route around that.
    const config =
      backendClients.get(LOCAL_CONNECTION_ID)?.getConfig() ??
      resolveBackendConfig(process.env, { isDev: !app.isPackaged });
    if (getConnectionMode() !== 'external' || config.transport !== 'uds') {
      return { ok: false, reason: 'unsupported' };
    }
  }
  const target = backendClients.get(id);
  if (!target || target.getStatus() !== 'connected') {
    return { ok: false, reason: 'not-connected' };
  }
  try {
    await target.request('system.requestUpdate');
    return { ok: true };
  } catch (error) {
    if (error instanceof JsonRpcError && error.rpcCode === -32601) {
      logger.warn('Daemon does not support system.requestUpdate', { id });
      return { ok: false, reason: 'unsupported' };
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Daemon update request failed', { id, error: message });
    return { ok: false, reason: 'failed', message };
  }
}

/** Resolve a renderer sender to its backend id, with the local fallback. */
export function getBackendIdForIpcSender(sender: Electron.WebContents): string {
  return getBackendIdForWebContents(sender);
}

/** Return the client bound to the focused window (local fallback for no window). */
export function getFocusedBackendClient(): JsonRpcClient {
  const backendId = getFocusedWindowBackendId();
  return backendClients.get(backendId) ?? getLocalBackendClient();
}

/**
 * Connect one pooled backend without disturbing clients for other ids.
 * Concurrent connects for the same id share one construction, and the
 * connection store remains the only place where a remote bearer token is
 * decrypted.
 */
export function connectBackendClient(id: string, tokenOverride?: string): Promise<JsonRpcClient> {
  const existing = backendClients.get(id);
  if (existing) return Promise.resolve(existing);
  const pending = backendClientConnects.get(id);
  if (pending) return pending;

  const connecting = buildConfigForConnection(id, tokenOverride)
    .then(({ config }) => {
      const raced = backendClients.get(id);
      if (raced) return raced;
      const instance = createAdditionalBackendClient(id, config);
      backendClients.set(id, instance);
      return instance;
    })
    .finally(() => {
      backendClientConnects.delete(id);
    });
  backendClientConnects.set(id, connecting);
  return connecting;
}

/** Dispose one pooled backend without disturbing clients for other ids. */
export function disconnectBackendClient(id: string): void {
  const instance = backendClients.get(id);
  if (!instance) return;
  backendClients.delete(id);
  connectedDaemonVersions.delete(id);
  clearBackendFailureState(id);
  disposeTransferConnectionsForBackend(id);
  void cancelInflightHostExecStreamsForBackendSwitch(instance);
  app.emit(BACKEND_CLIENT_DISCONNECTED_EVENT, instance);
  instance.dispose();
}

/** Build a pool member and route its renderer events by connection id. */
function createAdditionalBackendClient(id: string, config: BackendConnectionConfig): JsonRpcClient {
  // A fresh pool member starts with clean cert/auth/protocol-mismatch guards
  // for its backend — its own connect + `client.hello` re-detects any failure.
  clearBackendFailureState(id);
  // The failure-event identity for this pool member. `null` for a pooled
  // local/UDS client (no cert/auth/protocol mismatch to attribute).
  const meta =
    id !== LOCAL_CONNECTION_ID && config.host != null && config.port != null
      ? { id, host: config.host, port: config.port }
      : null;
  const instance = new JsonRpcClient({
    config,
    // Enable a liveness heartbeat: reconnect-on-close alone misses a silently
    // half-open socket. `host.status` is the transport-agnostic capability
    // probe (PROTOCOL.md §5.14) — answered on BOTH UDS and WSS.
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    healthCheckFailureThreshold: 2,
    healthCheck: async () => {
      await instance.request('host.status');
    },
    // §5.17 stable identity: present the persisted clientId on every
    // (re)connect so daemon-side client-scoped state (`drafts.*`, §5.16)
    // survives app restarts and renderer reloads.
    helloParams: async () => ({ clientId: await getOrCreateClientId() }),
    onHelloResult: (result) => {
      const obj =
        result && typeof result === 'object'
          ? (result as { clientId?: unknown; protocolVersion?: unknown })
          : undefined;
      const clientId = obj?.clientId;
      if (typeof clientId === 'string' && clientId.length > 0) {
        void persistClientId(clientId);
      }
      // T15: `protocolVersion` from the handshake feeds the protocol-compat
      // check — record it for local, compare it against local for a remote,
      // latched per connection id and broadcast to this backend's windows only.
      handleHelloProtocolVersion(
        typeof obj?.protocolVersion === 'string' ? obj.protocolVersion : null,
        meta,
      );
      // #3649: log each connected daemon's build identity once at INFO, keyed
      // by connection id so multi-backend setups record every daemon build.
      logDaemonHelloBuild(result, id);
      // Pool members capture their remote's daemon version; the id is fixed
      // at construction so no active-meta guard is needed. Skipped for the
      // pooled local client — the #3448 refresh below owns local.
      if (id !== LOCAL_CONNECTION_ID) {
        captureRemoteDaemonVersion(result, id);
        // Re-capture the remote's hostname on every (re)connect hello — not
        // just the explicit open path — so a backend machine rename
        // propagates on the next reconnect. Fire-and-forget/fail-soft like
        // the version capture; the store dedupes the unchanged common case.
        void captureRemoteHostname(id);
        // Capture whether the daemon supports self-update (system.status
        // `updateSupported`) so the renderer can gate the Update affordance.
        // Fire-and-forget/fail-soft like the captures above.
        void captureRemoteUpdateSupported(id);
      } else {
        // #3448: refresh the adopted external daemon's version info from the
        // live `server.version` on every (re)connect — the startup probe only
        // latches it once, so a daemon upgrade would otherwise stay stale.
        // For the handshake hello this runs BEFORE `finishConnect` emits
        // `connected`, so that broadcast already carries the refreshed info;
        // the explicit re-broadcast below covers caller-issued hellos while
        // connected (no status event follows those).
        const refreshed = computeDaemonVersionRefresh({
          helloResult: result,
          isLocalBackend: true,
          transport: instance.getConfig().transport,
          connectionMode: getConnectionMode(),
          pinnedVersion: getPinnedVersion(),
          current: getDaemonVersionInfo(),
        });
        if (refreshed) {
          setDaemonVersionInfo(refreshed);
          broadcast(
            BACKEND.STATUS,
            {
              status: instance.getStatus(),
              transport: formatTransportInfo(
                instance.getConfig(),
                getPinnedVersion(),
                instance.getConnectedVia(),
              ),
              reconnectAttempts: instance.getReconnectAttempts(),
            },
            id,
          );
        }
        // Capture whether the adopted external local daemon supports
        // self-update (system.status `updateSupported`), mirroring the
        // remote capture above. Fire-and-forget/fail-soft; the capture
        // itself guards on external + UDS and clears otherwise.
        void captureLocalUpdateSupported();
      }
    },
  });
  instance.on('notification', (notification: JsonRpcNotification) => {
    broadcast(BACKEND.NOTIFICATION, notification, id);
    backendNotificationForwarder.emit('notification', id, notification);
  });
  instance.on('status', (status: ConnectionStatus) => {
    if (status !== 'connected') connectedDaemonVersions.delete(id);
    broadcast(
      BACKEND.STATUS,
      {
        status,
        transport: formatTransportInfo(
          instance.getConfig(),
          getPinnedVersion(),
          instance.getConnectedVia(),
        ),
        reconnectAttempts: instance.getReconnectAttempts(),
      },
      id,
    );
    backendStatusForwarder.emit('status', id, status);
    refreshConnectionsForStatusChange();
  });
  instance.on('reconnected', () => {
    broadcast(
      BACKEND.STATUS,
      {
        status: 'connected',
        reconnected: true,
        transport: formatTransportInfo(
          instance.getConfig(),
          getPinnedVersion(),
          instance.getConnectedVia(),
        ),
        reconnectAttempts: instance.getReconnectAttempts(),
      },
      id,
    );
    backendReconnectForwarder.emit('reconnected', id);
  });
  // Non-fatal per-host pin mismatches from the multi-host connection race
  // (#1746): a connect can succeed through one candidate host while another
  // presents a mismatching pinned cert. Accumulated per host and pushed as
  // `connections:cert-warnings` — informative only, never blocks anything.
  instance.on('cert-warning', (info: HostCertMismatch) => {
    if (meta) recordCertWarning(meta, info);
  });
  instance.on('error', (error: Error) => {
    // Same non-transient failure handling as the primary client (see
    // getBackendClient's `error` handler), latched per connection id and
    // broadcast to this backend's windows only.
    if (error instanceof PinMismatchError) {
      if (meta && !certMismatchNotifiedIds.has(meta.id)) {
        certMismatchNotifiedIds.add(meta.id);
        const payload: ConnectionCertMismatchEvent = {
          id: meta.id,
          host: meta.host,
          port: meta.port,
          expectedFingerprint: error.expected,
          actualFingerprint: error.actual,
          // Every per-host mismatch the failing race observed (#1746), so the
          // trust modal can name each candidate host. Empty below the race
          // layer (single-host failures carry no host attribution).
          ...(error.mismatches.length > 0
            ? {
                mismatches: error.mismatches.map((m) => ({
                  host: m.host,
                  expectedFingerprint: m.expected,
                  actualFingerprint: m.actual,
                })),
              }
            : {}),
        };
        // Latch BEFORE broadcasting (same ordering as the primary). The boot
        // restore starts pooled clients before their windows exist, so the
        // one-shot broadcast alone can fire into zero windows; the latch is
        // replayed on each window's initial `connections:list` fetch.
        certMismatchById.set(meta.id, payload);
        broadcast(CONNECTIONS.CERT_MISMATCH, payload, meta.id);
      }
      logger.warn('Backend pool certificate fingerprint mismatch', { id, host: meta?.host });
      return;
    }
    if (error instanceof AuthRejectedError) {
      if (meta && !authRejectedNotifiedIds.has(meta.id)) {
        authRejectedNotifiedIds.add(meta.id);
        const payload: ConnectionAuthRejectedEvent = {
          id: meta.id,
          host: meta.host,
          port: meta.port,
          statusCode: error.statusCode,
        };
        // Latch BEFORE broadcasting so a renderer that fetches
        // `connections:list` between the broadcast and its own listener
        // registration still replays it (same ordering as the primary).
        authRejectedById.set(meta.id, payload);
        broadcast(CONNECTIONS.AUTH_REJECTED, payload, meta.id);
      }
      logger.warn('Backend pool rejected WebSocket authentication', {
        id,
        statusCode: error.statusCode,
      });
      return;
    }
    logger.warn('Backend pool transport error', { id, error: error.message });
  });
  registerBrowserExecReverseHandler(instance, {
    saveAsset: (params) => instance.request<{ url?: string } | undefined>('note.saveAsset', params),
    backendId: id,
    savedRemote: id !== LOCAL_CONNECTION_ID,
  });
  instance.start();
  return instance;
}

/**
 * Register a main-process listener for backend reconnects. Fires each time the
 * shared JsonRpcClient re-establishes the connection after a drop — AND once
 * per client rebuild (e.g. an active re-pair) — so consumers that hold
 * long-lived `events.subscribe` subscriptions (terminal registry, script
 * manager, notification/app-settings services, ACP terminal handler) can
 * re-issue them. Returns a disposer.
 *
 * The handler is attached to the stable {@link backendReconnectForwarder}, NOT
 * to the live client instance, so it survives client swaps: a service registers
 * once and keeps replaying subscriptions against whatever client is current,
 * even across an arbitrary number of client rebuilds.
 */
export function onBackendReconnected(handler: () => void, backendId?: string): () => void {
  // Ensure the local client exists (and is wired into the forwarder) so a
  // reconnect against the default transport actually reaches this handler.
  getLocalBackendClient();
  const listener = (emittingBackendId: string): void => {
    if (emittingBackendId === (backendId ?? LOCAL_CONNECTION_ID)) handler();
  };
  backendReconnectForwarder.on('reconnected', listener);
  return () => backendReconnectForwarder.off('reconnected', listener);
}

/**
 * Register a main-process listener for reconnects on ANY backend, receiving
 * the emitting backend id. For consumers whose state is partitioned per
 * backend (e.g. the user-activity cache) rather than pinned to one id.
 * Returns a disposer.
 */
export function onAnyBackendReconnected(handler: (backendId: string) => void): () => void {
  getLocalBackendClient();
  const listener = (emittingBackendId: string): void => handler(emittingBackendId);
  backendReconnectForwarder.on('reconnected', listener);
  return () => backendReconnectForwarder.off('reconnected', listener);
}

/**
 * Register a main-process listener for daemon JSON-RPC notifications
 * (`events.event` and friends). Fires for every notification on whatever client
 * is currently live. Returns a disposer.
 *
 * Like {@link onBackendReconnected}, the handler is attached to the stable
 * {@link backendNotificationForwarder}, NOT to the live client instance, so it
 * survives client swaps: a service registers once and keeps receiving daemon
 * events against whatever client is current, even across an arbitrary number of
 * client rebuilds.
 */
export function onBackendNotification(
  handler: (notification: JsonRpcNotification) => void,
  backendId?: string,
): () => void {
  // Ensure the local client exists (and is wired into the forwarder) so
  // notifications on the default transport actually reach this handler.
  getLocalBackendClient();
  const listener = (emittingBackendId: string, notification: JsonRpcNotification): void => {
    if (emittingBackendId === (backendId ?? LOCAL_CONNECTION_ID)) handler(notification);
  };
  backendNotificationForwarder.on('notification', listener);
  return () => backendNotificationForwarder.off('notification', listener);
}

/**
 * Register a main-process listener for daemon JSON-RPC notifications on ANY
 * backend, receiving the emitting backend id. For consumers whose state is
 * partitioned per backend (e.g. the notification service's per-backend
 * `agent:idle` subscriptions) rather than pinned to one id. Returns a disposer.
 */
export function onAnyBackendNotification(
  handler: (backendId: string, notification: JsonRpcNotification) => void,
): () => void {
  getLocalBackendClient();
  const listener = (emittingBackendId: string, notification: JsonRpcNotification): void =>
    handler(emittingBackendId, notification);
  backendNotificationForwarder.on('notification', listener);
  return () => backendNotificationForwarder.off('notification', listener);
}

/**
 * Register a main-process listener for backend connection-status transitions
 * (the same values broadcast on `backend:status`). Fires for every status
 * change on whatever client is currently live. Returns a disposer.
 *
 * Attached to the stable {@link backendStatusForwarder}, so a connect-retry
 * `status` listener (app-settings / notification.service `armStatusRetry`)
 * survives client swaps instead of stranding on the disposed client.
 */
export function onBackendStatus(
  handler: (status: ConnectionStatus) => void,
  backendId?: string,
): () => void {
  getLocalBackendClient();
  const listener = (emittingBackendId: string, status: ConnectionStatus): void => {
    if (emittingBackendId === (backendId ?? LOCAL_CONNECTION_ID)) handler(status);
  };
  backendStatusForwarder.on('status', listener);
  return () => backendStatusForwarder.off('status', listener);
}

/**
 * Register a main-process listener for status transitions on ANY backend,
 * receiving the emitting backend id. This is also the "new backend appeared"
 * signal: a freshly pooled client's first `connected` transition flows
 * through here (its first connect is a plain `connected`, never a
 * `reconnected`), so per-backend services can pick up late-opened remotes.
 * Returns a disposer.
 */
export function onAnyBackendStatus(
  handler: (backendId: string, status: ConnectionStatus) => void,
): () => void {
  getLocalBackendClient();
  const listener = (emittingBackendId: string, status: ConnectionStatus): void =>
    handler(emittingBackendId, status);
  backendStatusForwarder.on('status', listener);
  return () => backendStatusForwarder.off('status', listener);
}

/** Broadcast a payload to live renderer windows, optionally scoped to one backend. */
function broadcast(channel: string, payload: unknown, backendId?: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (backendId && getBackendIdForWebContents(win.webContents) !== backendId) continue;
    try {
      win.webContents.send(channel, payload);
    } catch (error) {
      logger.warn('Failed to broadcast backend message', {
        channel,
        windowId: win.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Resolve a renderer invoke event to the client bound to its window's backend. */
export function getBackendClientForIpcEvent(event?: Electron.IpcMainInvokeEvent): {
  backendId: string;
  client: JsonRpcClient;
} {
  const backendId = event?.sender ? getBackendIdForWebContents(event.sender) : LOCAL_CONNECTION_ID;
  return { backendId, client: getBackendClientForId(backendId) };
}

/**
 * Consume a `protocolVersion` from a `client.hello` handshake (T15).
 *
 * `connectionMeta` is the pool member's failure-event identity (built from its
 * config): `null` for the local/UDS client, the remote's identity otherwise.
 *   - Local handshake → record the value as the baseline `localProtocolVersion`.
 *   - Remote handshake → compare its **major** against the local baseline (see
 *     {@link resolveLocalProtocolBaseline}); on a mismatch latch it in the
 *     sticky {@link protocolMismatchById} AND broadcast a single non-blocking
 *     `connections:protocol-mismatch` notice (the connection still proceeds —
 *     warn-but-allow). An unknown/absent version on either side surfaces
 *     nothing. Latched per connection id and broadcast to that backend's
 *     windows only.
 */
function handleHelloProtocolVersion(
  protocolVersion: string | null,
  connectionMeta: { id: string; host: string; port: number } | null,
): void {
  const meta = connectionMeta;
  if (!meta) {
    // Local sidecar / env default: remember the baseline protocolVersion.
    if (protocolVersion) localProtocolVersion = protocolVersion;
    return;
  }
  if (protocolMismatchNotifiedIds.has(meta.id)) return;
  const localBaseline = resolveLocalProtocolBaseline();
  if (compareProtocolMajor(localBaseline, protocolVersion) !== 'mismatch') return;
  protocolMismatchNotifiedIds.add(meta.id);
  const payload: ConnectionProtocolMismatchEvent = {
    id: meta.id,
    host: meta.host,
    port: meta.port,
    // Both are non-null: `compareProtocolMajor` only returns 'mismatch' when both parse.
    localProtocolVersion: localBaseline as string,
    remoteProtocolVersion: protocolVersion as string,
    // A pool member is only built for a window the user pointed at that
    // backend (boot restore included), so the advisory is always modal-worthy
    // (`'switch'` is the legacy wire value for a user-initiated connect).
    origin: 'switch',
  };
  // Latch BEFORE broadcasting so a renderer that fetches `connections:list`
  // between the broadcast and its own listener registration still replays it.
  protocolMismatchById.set(meta.id, payload);
  logger.warn('Remote backend protocol version differs from local (warn-only)', {
    id: meta.id,
    localProtocolVersion: localBaseline,
    remoteProtocolVersion: protocolVersion,
  });
  // Scoped to the mismatching backend's windows — primary or pooled — so
  // windows bound to other backends never surface this backend's advisory.
  broadcast(CONNECTIONS.PROTOCOL_MISMATCH, payload, meta.id);
}

/**
 * Resolve the local intentd protocolVersion baseline for the compat check.
 *
 * Prefers the local renderer client's own `client.hello` value
 * ({@link localProtocolVersion}) when available, and falls back to the sidecar
 * manager's stable startup-probe value ({@link getLocalDaemonProtocolVersion})
 * — which survives client disposal — so a remote connect before the local
 * hello resolved still has a baseline to compare against (cloudlands-fe#823).
 */
function resolveLocalProtocolBaseline(): string | null {
  return localProtocolVersion ?? getLocalDaemonProtocolVersion();
}

/** Normalize a thrown error into a serializable IPC error payload. */
function toErrorPayload(error: unknown): {
  code: string;
  message: string;
  data: unknown;
  rpcCode?: number;
} {
  if (error instanceof JsonRpcError) return error.toErrorPayload();
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'TRANSPORT_ERROR', message, data: { code: 'TRANSPORT_ERROR' } };
}

// ============================================================================
// Multi-backend connect: open orchestration + connections registry IPC.
// ============================================================================

/**
 * Pull the hostname out of a `host.status` result (PROTOCOL §5.14 — returns
 * `{ hostname, prettyHostname?, os, arch, ... }`). Prefers a trimmed non-empty
 * `prettyHostname` (the human-friendly machine name, e.g. macOS ComputerName)
 * over the network `hostname`; returns `null` when neither is present so
 * callers keep the `host:port` fallback.
 */
function extractHostname(result: unknown): string | null {
  if (result && typeof result === 'object') {
    const { hostname, prettyHostname } = result as {
      hostname?: unknown;
      prettyHostname?: unknown;
    };
    for (const value of [prettyHostname, hostname]) {
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
  }
  return null;
}

/**
 * Label a freshly-connected remote by its hostname (T14). Reuses the live
 * client's `host.status` capability probe — the same call the heartbeat issues —
 * to read the remote machine's hostname, persists it on the connection record,
 * and re-broadcasts the list so the menu upgrades `host:port` to
 * `hostname (host:port)`.
 *
 * Fire-and-forget by design: it must never block or fail an open. The
 * `host.status` request queues until the fresh socket connects, so awaiting it
 * inline would stall the open on a slow/unreachable remote — instead the
 * label upgrades asynchronously once the hostname arrives. Any failure
 * (unreachable, malformed result, store write error) is swallowed with a warn;
 * the connection keeps its `host:port` label. Results that arrive after the
 * backend's client was disposed are discarded (monorepo#2221).
 */
async function captureRemoteHostname(id: string): Promise<void> {
  try {
    // Snapshot this backend's pooled client; the id-keyed pool lookup below
    // protects against a stale capture after the client is disposed.
    const client = getBackendClientForId(id);
    const result = await client.request('host.status');
    const hostname = extractHostname(result);
    // Drop the result when this backend's client changed mid-flight — the
    // snapshot client may have answered just before its disposal.
    if (hostname && backendClients.get(id) === client) {
      await connectionsStore.setHostname(id, hostname);
      await broadcastConnectionsChanged();
    }
  } catch (error) {
    logger.warn('Failed to capture remote hostname for connection label', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Pull the `updateSupported` flag out of a `system.status` result. Returns
 * `null` when the field is absent or malformed (a daemon too old to report
 * it) so callers persist "unknown" for a conclusive-but-flagless response.
 */
function extractUpdateSupported(result: unknown): boolean | null {
  if (result && typeof result === 'object') {
    const value = (result as { updateSupported?: unknown }).updateSupported;
    if (typeof value === 'boolean') return value;
  }
  return null;
}

/**
 * Pull the daemon's tailcat tunnel endpoint (`tcAddress`, PROTOCOL §12.3) out
 * of a `system.status` or `server.pairingInfo` result (both carry the same
 * field with the same semantics). Returns `null` when the field is absent,
 * empty, or malformed — a conclusive "no tunnel" for a successful response.
 *
 * Known trade-off: the wire shape cannot distinguish "tunnel disabled" from
 * "tunnel sidecar momentarily down" — `system.status` omits the field in both
 * cases (including the daemon's restart-backoff window after an unexpected
 * sidecar exit). A reconnect landing in that window therefore clears a stored
 * address that would have come back on its own; it is re-learned from the
 * next post-connect status once the sidecar recovers. Now that the address is
 * keychain-synced, the blast radius is fleet-wide: the clear bumps the LWW
 * clock and propagates, so a device that can ONLY dial through the tunnel
 * loses its route until any directly-connected device reconnects after the
 * sidecar recovers and re-captures the address (the tunnel-only device cannot
 * rediscover it on its own). Deliberately accepted
 * over retaining stale values: a kept address whose tunnel was genuinely
 * disabled would add a perpetually-failing race candidate to every connect,
 * and the field's contract ("never advertises a route nothing is serving")
 * argues for mirroring it faithfully. Distinguishing the two states needs a
 * protocol change (tracked upstream), not FE-side guessing.
 */
function extractTcAddress(result: unknown): string | null {
  if (result && typeof result === 'object') {
    const value = (result as { tcAddress?: unknown }).tcAddress;
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

/**
 * Capture whether a freshly-connected remote's daemon supports self-update
 * (`updateSupported` from `system.status`) and persist it on the connection
 * record, following the `captureRemoteHostname` capture pattern. Runs on
 * every (re)connect hello so a daemon upgrade/downgrade (or a supervision
 * change) refreshes the stored flag; the renderer gates the Update affordance
 * on it. The same response also refreshes the stored tailcat tunnel endpoint
 * (`tcAddress`, PROTOCOL §12.3) used as a connect-race candidate, so a
 * daemon gaining/losing its tunnel is reflected without re-pairing, and the
 * candidate-host list (`localIps`) for records whose "detect all backend IPs"
 * option is on — `server.pairingInfo` (the {@link refreshRemoteHosts} path)
 * is local-only on the daemon, so this is how REMOTE records converge on the
 * backend's current interfaces. `system.status` `localIps` is the DIAGNOSTIC
 * surface (PROTOCOL §system.status): it keeps bound loopback entries and is
 * empty while the listener is down, so loopback is filtered out first and an
 * empty result leaves the stored list untouched (never wiping candidates on a
 * listener-down answer). A
 * SUCCESSFUL response lacking a boolean field (a daemon too old to
 * report it — e.g. the machine's daemon was replaced/downgraded) is a
 * conclusive "unknown" and clears any previously-stored flag to `null`, so a
 * stale `true` never keeps offering Update against a daemon whose capability
 * is no longer known (and likewise a stale `tcAddress` never keeps dialing a
 * tunnel the daemon no longer advertises). Only a FAILED request
 * (unreachable, method unknown, store write error) is fail-soft: swallowed
 * with a warn, stored value kept as-is. Results that arrive after the
 * backend's client was disposed are discarded (monorepo#2221). Never called
 * for the local entry.
 */
async function captureRemoteUpdateSupported(id: string): Promise<void> {
  try {
    // Snapshot this backend's pooled client; the id-keyed pool lookup below
    // protects against a stale capture after the client is disposed.
    const client = getBackendClientForId(id);
    const result = await client.request('system.status');
    const supported = extractUpdateSupported(result);
    const tcAddress = extractTcAddress(result);
    // Loopback entries are only reachable from the backend itself (the
    // daemon's pairing surfaces filter them the same way); an empty list
    // after filtering (listener down, loopback-only bind) is not persisted.
    const ips = (extractLocalIps(result) ?? []).filter((ip) => !isLoopbackHost(ip));
    // Drop the result when this backend's client changed mid-flight — the
    // snapshot client may have answered just before its disposal.
    if (backendClients.get(id) === client) {
      const changed = await connectionsStore.setUpdateSupported(id, supported);
      const tcChanged = await connectionsStore.setTcAddress(id, tcAddress);
      const hostsRefreshed = ips.length > 0 && (await connectionsStore.getDetectHosts(id));
      if (hostsRefreshed) await connectionsStore.setHosts(id, ips);
      if (changed || tcChanged || hostsRefreshed) await broadcastConnectionsChanged();
    }
  } catch (error) {
    logger.warn('Failed to capture remote updateSupported flag', {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Capture whether the adopted external LOCAL daemon supports self-update
 * (`updateSupported` from `system.status`), mirroring
 * {@link captureRemoteUpdateSupported} but storing the flag in the
 * connection-mode module state (the local entry is synthesized, never
 * persisted). Runs from the local `onHelloResult` branch on every
 * (re)connect. Only an `external` connection mode over UDS captures —
 * sidecar/unresolved modes and non-UDS transports clear the flag to `null`
 * (unknown). A (re)connect first resets a previously-captured flag to `null`
 * synchronously — the daemon behind the socket may have been replaced, so the
 * old value must not be advertised during the capture window — which also
 * makes a FAILED request conclude as "unknown" rather than retaining a stale
 * value (the failure itself stays fail-soft: swallowed with a warn). A
 * successful flagless response is a conclusive "unknown" and stays `null` the
 * same way. Results that arrive after the local client was disposed/replaced
 * are discarded (monorepo#2221). Broadcasts `connections:changed` only when
 * the value actually changed; a changed capture also re-pushes
 * `backend:status` so the daemon-health saga's behind-pin suppression sees
 * the flag-bearing transport payload (its earlier connected status is emitted
 * before this capture resolves).
 */
async function captureLocalUpdateSupported(): Promise<void> {
  try {
    // Snapshot the pooled local client; the pool lookup below protects
    // against a stale capture after the client is disposed/replaced.
    const client = backendClients.get(LOCAL_CONNECTION_ID);
    if (!client) return;
    if (getConnectionMode() !== 'external' || client.getConfig().transport !== 'uds') {
      if (getLocalUpdateSupported() !== null) {
        setLocalUpdateSupported(null);
        await broadcastConnectionsChanged();
      }
      return;
    }
    // Reset before the async capture: the connected daemon's capability is
    // unknown until this hello's own capture answers, and the reset runs
    // synchronously within the hello callback so no broadcast in the capture
    // window carries the previous daemon's flag.
    if (getLocalUpdateSupported() !== null) {
      setLocalUpdateSupported(null);
      await broadcastConnectionsChanged();
    }
    const result = await client.request('system.status');
    const supported = extractUpdateSupported(result);
    // Drop the result when the local client changed mid-flight — the
    // snapshot client may have answered just before its disposal.
    if (backendClients.get(LOCAL_CONNECTION_ID) === client) {
      if (getLocalUpdateSupported() !== supported) {
        setLocalUpdateSupported(supported);
        await broadcastConnectionsChanged();
        // The daemon-health saga decides the passive mismatch warning from
        // `backend:status`, whose connected event precedes this capture —
        // push a flag-bearing status so its behind-pin suppression can
        // resolve (see daemon-health-saga `maybeNotifyVersionMismatch`).
        broadcast(
          BACKEND.STATUS,
          {
            status: client.getStatus(),
            transport: formatTransportInfo(
              client.getConfig(),
              getPinnedVersion(),
              client.getConnectedVia(),
            ),
            reconnectAttempts: client.getReconnectAttempts(),
          },
          LOCAL_CONNECTION_ID,
        );
      }
    }
  } catch (error) {
    logger.warn('Failed to capture local updateSupported flag', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Re-run the local updateSupported capture after the startup connection-mode
 * resolution (see {@link captureLocalUpdateSupported}). The pooled local
 * client is constructed — and its hello can resolve — during `setupConfigIPC`,
 * BEFORE `startIntentdSidecar` resolves the mode, so an adopted external
 * daemon's hello-time capture sees `unknown` and skips, and nothing re-runs it
 * while the socket stays connected (the Devices row then shows the behind-pin
 * dot without the Update menu). Called by the sidecar manager whenever it
 * resolves an `external` mode; a no-op when no local client exists yet (the
 * eventual hello captures with the mode already resolved).
 */
export function refreshLocalUpdateSupported(): Promise<void> {
  return captureLocalUpdateSupported();
}

/**
 * Pull the local-IP list out of a `server.pairingInfo` result (PROTOCOL §2 —
 * returns `{ token, certFingerprint, port, path, localIps, hostname }`) or a
 * `system.status` result (same `localIps` field name; note that surface may
 * include loopback entries — callers filter). Returns the non-empty string
 * entries, else `null` when the shape is absent or malformed.
 */
function extractLocalIps(result: unknown): string[] | null {
  if (result && typeof result === 'object') {
    const value = (result as { localIps?: unknown }).localIps;
    if (Array.isArray(value)) {
      const ips = value.filter((ip): ip is string => typeof ip === 'string' && ip.trim() !== '');
      if (ips.length > 0) return ips;
    }
  }
  return null;
}

/**
 * Refresh a remote connection's candidate-host list from the live backend's
 * `server.pairingInfo` (#1746). Skipped when the record's "detect all backend
 * IPs" option is off. Fire-and-forget / fail-soft by design — the daemon
 * currently answers `server.pairingInfo` only on LOCAL (UDS) connections and
 * rejects remote callers with -32001 ("server.* methods are local-only"), so
 * until the daemon relaxes that gating this refresh quietly no-ops; the stored
 * host list keeps whatever candidates it already has, and the multi-host
 * reconnect racing still applies. When the daemon does answer, the persisted
 * list tracks the backend's current interfaces on every connect, and the same
 * response also refreshes the stored tunnel tc address (PROTOCOL §12.3) —
 * conclusively, so a successful answer without the field clears a stale
 * address. The every-connect `system.status` capture
 * ({@link captureRemoteUpdateSupported}) is what actually refreshes remote
 * records today: it covers the tc address for records whose detectHosts is
 * off (this path early-returns for those) AND the candidate-host list from
 * the remotely-served `localIps` (loopback-filtered) for records with
 * detectHosts on.
 */
async function refreshRemoteHosts(id: string): Promise<void> {
  try {
    // Snapshot this backend's pooled client BEFORE the first await: a
    // concurrent disconnect/reconnect replaces the pool entry, and querying
    // the NEW client here would persist another socket's answer.
    const client = getBackendClientForId(id);
    if (!(await connectionsStore.getDetectHosts(id))) return;
    const result = await client.request('server.pairingInfo');
    const ips = extractLocalIps(result);
    // Drop the result when this backend's client changed mid-flight — the
    // snapshot client may have answered just before its disposal.
    if (backendClients.get(id) === client) {
      if (ips) await connectionsStore.setHosts(id, ips);
      const tcChanged = await connectionsStore.setTcAddress(id, extractTcAddress(result));
      if (ips || tcChanged) await broadcastConnectionsChanged();
    }
  } catch (error) {
    logger.debug('Could not refresh candidate hosts from server.pairingInfo (fail-soft)', {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Cached single-flight probe of the LIVE local daemon's cert fingerprint
 * (normalized), used alongside the persisted self fingerprint for self-entry
 * detection. The daemon's cert is stable for the app session, so a successful
 * probe is cached (concurrent callers share the one in-flight promise); a
 * FAILED/unusable probe caches nothing and is retried on a later call.
 * Fail-soft: resolves `null` when the local daemon is unreachable or the app
 * is pinned to a remote with no local pool member — callers fall back to the
 * persisted fingerprint alone. `timeoutMs` bounds a NEWLY started probe's
 * request (an already-cached value or in-flight probe is returned as-is);
 * callers on a latency-sensitive path (boot) pass a short bound so a hung
 * local daemon cannot stall them for the client's 30s default.
 */
let cachedLiveSelfFingerprint: string | null = null;
let liveSelfFingerprintProbe: Promise<string | null> | null = null;

function getLiveSelfFingerprint(timeoutMs?: number): Promise<string | null> {
  if (cachedLiveSelfFingerprint !== null) return Promise.resolve(cachedLiveSelfFingerprint);
  if (liveSelfFingerprintProbe) return liveSelfFingerprintProbe;
  const localClient = getLocalBackendClient();
  const probe: Promise<string | null> = localClient
    .request('server.pairingInfo', undefined, { timeoutMs })
    .then(
      (result) => normalizeFingerprint(extractSelfPairingInfo(result)?.certFingerprint ?? null),
      () => null,
    )
    .then(async (fingerprint) => {
      // Fail-soft: never cache an unusable probe (unreachable daemon,
      // malformed result) — a later call retries it.
      if (liveSelfFingerprintProbe === probe) liveSelfFingerprintProbe = null;
      if (fingerprint !== null && cachedLiveSelfFingerprint === null) {
        cachedLiveSelfFingerprint = fingerprint;
        // A list served before the probe resolved could not hide a
        // live-matching entry — refresh every renderer now that it can, but
        // only when the new key actually hides a stored record (the common
        // no-match session would otherwise pay one redundant re-render).
        // Fail-soft: a store read error just skips the refresh.
        try {
          const records = await connectionsStore.list();
          const selfKeys = buildSelfFingerprintKeys(fingerprint);
          if (records.some((c) => isSelfConnectionRecord(c, selfKeys))) {
            void broadcastConnectionsChanged().catch(() => {});
          }
        } catch {
          // Ignored — the next listConnections call serves the corrected list.
        }
      }
      return fingerprint;
    });
  liveSelfFingerprintProbe = probe;
  return probe;
}

/** Collapse persisted/live self fingerprints into a non-null normalized key set. */
function buildSelfFingerprintKeys(...fingerprints: Array<string | null>): Set<string> {
  return new Set(fingerprints.filter((key): key is string => key !== null));
}

/**
 * Whether a stored record is THIS machine's own published self entry: its
 * fingerprint matches one of the self keys (the persisted self cert
 * fingerprint and/or the live local daemon's), normalized so the comparison
 * mirrors the store's fingerprint-keyed dedupe. The local pseudo-entry never
 * matches (its fingerprint is null).
 */
function isSelfConnectionRecord(
  record: { fingerprint?: string | null },
  selfKeys: ReadonlySet<string>,
): boolean {
  if (selfKeys.size === 0) return false;
  const key = normalizeFingerprint(record.fingerprint);
  return key !== null && selfKeys.has(key);
}

/**
 * The connections list + persisted and window-scoped selections surfaced to
 * the renderer. The machine's own published self entry is hidden here —
 * connecting to yourself over WSS is meaningless when the same daemon is
 * already reachable as `local` — while the record stays in the store so the
 * keychain reconcile keeps pushing it to the user's OTHER devices (where it
 * must appear). Presentation-only: `getSelfPublishedState` still reports it
 * as published. Detection matches the persisted self fingerprint AND the live
 * local daemon's cert fingerprint, so the entry hides even when this machine
 * never published it (e.g. it synced in from another device). The live probe
 * is NOT awaited — a slow local daemon must never delay the list (or a
 * mutation, which awaits the changed-list broadcast): the cached value
 * is used when available, and the probe's own resolution re-broadcasts the
 * list. Fail-soft: a fingerprint read/probe error hides nothing.
 */
async function listConnections(
  windowBackendId: string = LOCAL_CONNECTION_ID,
): Promise<ConnectionsListResult> {
  const [connections, activeId, storedFingerprint] = await Promise.all([
    connectionsStore.list(),
    connectionsStore.getActiveId(),
    getStoredSelfFingerprint().catch(() => null),
  ]);
  // Kick off (or reuse) the live probe without awaiting it (see above).
  void getLiveSelfFingerprint();
  const selfKeys = buildSelfFingerprintKeys(storedFingerprint, cachedLiveSelfFingerprint);
  // Replay any sticky protocol mismatch / auth rejection for THIS WINDOW'S
  // backend so a renderer that missed the one-shot broadcast (e.g. a window
  // created after the remote handshake already fired, a boot into
  // a rejecting remote, or a reload of a pooled-backend window) still surfaces
  // the advisory / actionable state (cloudlands-fe#823 pattern), per backend.
  // The local entry is synthesized (never persisted), so its adopted external
  // daemon observations live in connection-mode state rather than the store:
  // enrich it here with the daemon's version and updateSupported capture.
  // Sidecar/unresolved modes leave both fields absent.
  const localVersionInfo = getConnectionMode() === 'external' ? getDaemonVersionInfo() : null;
  const localUpdateSupported =
    getConnectionMode() === 'external' ? getLocalUpdateSupported() : null;
  return {
    connections: connections
      .filter((c) => !isSelfConnectionRecord(c, selfKeys))
      .map((connection) => {
        const status = backendClients.get(connection.id)?.getStatus() ?? 'not-open';
        // `connectedDaemonVersions` only holds remote captures (the local id
        // skips captureRemoteDaemonVersion) — the connected local row's inline
        // version comes from the external-daemon version handshake instead,
        // so it renders like every connected remote's.
        const intentdVersion =
          status === 'connected'
            ? connection.id === LOCAL_CONNECTION_ID
              ? (localVersionInfo?.daemonVersion ?? undefined)
              : connectedDaemonVersions.get(connection.id)
            : undefined;
        return {
          ...connection,
          ...(connection.id === LOCAL_CONNECTION_ID
            ? {
                ...(localVersionInfo?.daemonVersion
                  ? { daemonVersion: localVersionInfo.daemonVersion }
                  : {}),
                ...(localUpdateSupported !== null ? { updateSupported: localUpdateSupported } : {}),
              }
            : {}),
          status,
          ...(intentdVersion ? { intentdVersion } : {}),
        };
      }),
    activeId,
    windowBackendId,
    protocolMismatch: protocolMismatchById.get(windowBackendId) ?? null,
    authRejected: authRejectedById.get(windowBackendId) ?? null,
    certMismatch: certMismatchById.get(windowBackendId) ?? null,
    certWarnings: getCertWarningsEvent(windowBackendId),
    // The app's pinned intentd version so the renderer can compare each
    // remote's captured `daemonVersion` without a separate channel.
    pinnedVersion: getPinnedVersion(),
    // Live per-connection connectivity so the renderer can gate
    // connected-only actions (the remote Update button). Kept fresh by the
    // status-forwarder re-broadcast of `connections:changed`.
    connectedIds: [...backendClients.entries()]
      .filter(([, instance]) => instance.getStatus() === 'connected')
      .map(([id]) => id),
  };
}

/** Broadcast the current list + selections, tailored to each recipient window. */
async function broadcastConnectionsChanged(): Promise<void> {
  // Also notify main-process listeners (the Window menu labels entries with
  // connection labels) — renderers get the tailored payload below.
  app.emit('connections-changed');
  const payload = await listConnections();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    const windowBackendId = getBackendIdForWebContents(win.webContents);
    // Re-derive the per-backend sticky replay for THIS window's backend — the
    // shared payload was computed for the local default.
    const windowPayload: ConnectionsChangedEvent = {
      ...payload,
      windowBackendId,
      protocolMismatch: protocolMismatchById.get(windowBackendId) ?? null,
      authRejected: authRejectedById.get(windowBackendId) ?? null,
      certMismatch: certMismatchById.get(windowBackendId) ?? null,
      certWarnings: getCertWarningsEvent(windowBackendId),
    };
    try {
      win.webContents.send(CONNECTIONS.CHANGED, windowPayload);
    } catch (error) {
      logger.warn('Failed to broadcast connections change', {
        windowId: win.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Push a fresh list after a pooled client's transient status changes. */
function refreshConnectionsForStatusChange(): void {
  void broadcastConnectionsChanged().catch((error) => {
    logger.warn('Failed to refresh connection statuses', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * Resolve the transport config + cert-mismatch identity for a connection id.
 * `local` maps to the env/UDS default (no pinned cert); a remote id builds the
 * pinned `wss` config from its stored host/port/fingerprint + decrypted token.
 * Throws for an unknown/incomplete connection or a missing token — the caller
 * runs this BEFORE any teardown so a bad target never disrupts the live backend.
 *
 * Exported for the workspace-transfer relay, which builds a second,
 * short-lived JsonRpcClient to the chosen target while the active client
 * stays pinned to the source.
 */
class ConnectionSecretUnavailableError extends Error {
  constructor() {
    // i18n-ignore (internal error)
    super('Connection secret unavailable');
    this.name = 'ConnectionSecretUnavailableError';
  }
}

export async function buildConfigForConnection(
  id: string,
  tokenOverride?: string,
): Promise<{
  config: BackendConnectionConfig;
  meta: { id: string; host: string; port: number } | null;
}> {
  if (id === LOCAL_CONNECTION_ID) {
    return { config: resolveBackendConfig(process.env, { isDev: !app.isPackaged }), meta: null };
  }
  const record = (await connectionsStore.list()).find((c) => c.id === id && !c.isLocal);
  if (!record || record.host == null || record.port == null || record.fingerprint == null) {
    throw new Error(`Unknown or incomplete connection: ${id}`);
  }
  let token: string | null | undefined = tokenOverride;
  if (token === undefined) {
    try {
      token = await connectionsStore.getDecryptedToken(id);
    } catch {
      throw new ConnectionSecretUnavailableError();
    }
  }
  if (!token) {
    throw new Error(`No stored token for connection: ${id}`);
  }
  // The store's list() already sanitizes `hosts` (a legacy loopback primary
  // is excluded whenever a routable candidate exists), so the race dials
  // hosts[0] first — not the raw stored primary, which can be loopback on
  // records synced from before self-publish filtered it out.
  const dialHosts = record.hosts?.length ? record.hosts : [record.host];
  return {
    config: {
      transport: 'wss',
      host: dialHosts[0],
      hosts: dialHosts,
      port: record.port,
      token,
      fingerprint: record.fingerprint,
      tcAddress: record.tcAddress ?? undefined,
    },
    meta: { id, host: record.host, port: record.port },
  };
}

/**
 * Tail of the connection-operation serialization queue: every
 * connection-affecting operation chains onto it via
 * {@link enqueueConnectionOperation}, so operations run strictly one at a
 * time. The open/forget/publish flows have several await points (store
 * reads/writes, window hooks) with pool state mutated across them; two
 * interleaved operations could tear down one backend's client while another
 * operation still uses it, and mislabel records via `captureRemoteHostname`
 * (monorepo#2221). Always a settled-or-pending promise that never rejects — a
 * failed operation must not poison subsequent operations.
 */
let connectionOperationQueue: Promise<void> = Promise.resolve();

/**
 * Run `fn` serialized with every connection-affecting operation
 * (monorepo#2228). The `connections:forget` / `connections:add` handlers make
 * read-decide decisions on `getActiveId()`; reading the active id OUTSIDE the
 * queue and then acting on it was a TOCTOU — a concurrent operation could land
 * between the read and the enqueued action, making the decision stale (e.g.
 * forget disconnecting a backend the user just opened). Enqueuing the whole
 * read-decide sequence makes the decision atomic with respect to every other
 * connection operation.
 *
 * Inside `fn`, never enqueue (a nested `enqueueConnectionOperation` would
 * chain onto the queue tail behind the currently-running `fn` and
 * self-deadlock). The returned promise settles with `fn`'s outcome; a
 * rejection propagates to the caller but never poisons the queue (the tail
 * swallows it).
 */
function enqueueConnectionOperation<T>(fn: () => Promise<T>): Promise<T> {
  const result = connectionOperationQueue.then(fn);
  connectionOperationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Connect one pooled backend and open/focus its windows.
 * `options.probeTimeoutMs` bounds the authenticated `host.status` probe
 * for a single call — used by deadline-driven callers like
 * {@link openLocalAndSpawn} whose own budget is shorter than the 30s client
 * default. When omitted, a REMOTE open is bounded by
 * {@link REMOTE_OPEN_PROBE_TIMEOUT_MS} (a probe failure opens the window
 * anyway, so a black-holed connect must not sit out the 30s default before
 * the window appears); a LOCAL open keeps the client's flat request timeout.
 *
 * A failed probe on a REMOTE no longer rejects the open: the window is created
 * anyway and the pooled client's reconnect loop keeps retrying, so the
 * renderer's connection-lost overlay (or the latched cert-mismatch /
 * auth-rejected failure event, replayed on `connections:list`) owns recovery.
 * Only a missing secret ({@link ConnectionSecretUnavailableError}, thrown
 * before any client is built) still blocks the window — there is nothing for
 * a window to retry against. The LOCAL open keeps strict probe semantics:
 * {@link openLocalAndSpawn}'s deadline/retry loop depends on the rejection.
 */
export function openBackendWindow(
  id: string,
  options?: { probeTimeoutMs?: number },
): Promise<{ id: string }> {
  return enqueueConnectionOperation(() => performOpenBackendWindow(id, options));
}

async function performOpenBackendWindow(
  id: string,
  options?: { probeTimeoutMs?: number },
): Promise<{ id: string }> {
  const target = await connectBackendClient(id);
  try {
    try {
      // Complete one authenticated request over the pinned transport before
      // creating a renderer, so the common healthy open never flashes the
      // connection-lost overlay. A remote probe is bounded well below the 30s
      // client default: a timing-out remote already opens the window on
      // failure, so a long probe only delays that window — and a healthy
      // remote slower than this bound still opens fine (the retained client
      // finishes connecting and the renderer never sees a 'down' health).
      const probeTimeoutMs =
        options?.probeTimeoutMs ??
        (id !== LOCAL_CONNECTION_ID ? REMOTE_OPEN_PROBE_TIMEOUT_MS : undefined);
      await target.request('host.status', undefined, { timeoutMs: probeTimeoutMs });
    } catch (error) {
      // Local keeps the strict reject: openLocalAndSpawn's deadline loop
      // retries on it, and a local window without a daemon has no client
      // reconnect posture worth showing.
      if (id === LOCAL_CONNECTION_ID) throw error;
      // Remote probe failure (unreachable, cert mismatch, auth rejected):
      // open the window anyway. The retained pooled client keeps
      // reconnecting, the renderer shows the daemon-loss overlay, and a
      // latched cert-mismatch/auth-rejected failure event is replayed to the
      // new window via `connections:list` — instead of a silent failed click.
      logger.warn('Backend probe failed on open; opening window and retrying in background', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    // Label the remote by its hostname once it connects (T14). Reuses the
    // live client's `host.status`; fire-and-forget so a slow remote never
    // stalls the open — the label upgrades from `host:port` to
    // `hostname (host:port)` asynchronously (the request queues until the
    // socket connects, so this also covers a probe-failed open once the
    // client eventually reconnects). Skipped for the local sidecar
    // (UDS has no remote hostname to show; its label is fixed). The
    // candidate-host refresh (#1746) piggybacks on the same post-connect
    // window, equally fire-and-forget/fail-soft.
    if (id !== LOCAL_CONNECTION_ID) {
      void captureRemoteHostname(id);
      void refreshRemoteHosts(id);
    }
    await windowHooks.openOrFocus?.(id);
    return { id };
  } catch (error) {
    // The always-on local member is never torn down on a failed probe; it
    // lazily rebuilds and main-process services depend on it.
    if (id !== LOCAL_CONNECTION_ID) disconnectBackendClient(id);
    throw error;
  }
}

/**
 * Spawn the app-managed sidecar on demand (#439 fallback). Probes the live
 * client's transport first — the on-demand sidecar always binds the local UDS
 * socket, so a WS/TCP client would keep reconnecting to its original target and
 * never reach the daemon we spawned, stranding the renderer on a pending spawn.
 * On a successful spawn, re-broadcast the current status so the reconnect UI
 * updates while the JsonRpcClient's ≤5s reconnect loop picks up the new socket.
 *
 * Extracted from the `backend:spawn-sidecar` handler so {@link openLocalAndSpawn}
 * can reuse the exact same spawn semantics before opening the local backend's
 * windows (the always-on local pooled client keeps the `uds` transport, so the
 * guard passes without any switch).
 */
async function performSpawnSidecar(): Promise<{
  ok: boolean;
  spawned: boolean;
  reason?: string;
  error?: unknown;
}> {
  try {
    const transport = getLocalBackendClient().getConfig().transport;
    if (transport !== 'uds') {
      return {
        ok: false,
        spawned: false,
        reason: `connection target is not a local socket (transport: ${transport})`,
      };
    }
    const result = await spawnSidecarOnDemand(
      process.env,
      app.isPackaged,
      process.resourcesPath,
      process.cwd(),
    );
    if (result.ok) {
      // The daemon-loss modal resolves as soon as the spawn kicked off; the
      // JsonRpcClient's ≤5s reconnect loop picks up the socket once the
      // daemon is serving and broadcasts `backend:status` as usual. Scoped to
      // local windows: this is the LOCAL client's status, and openLocalAndSpawn
      // makes the spawn reachable from remote windows — an unscoped broadcast
      // would let an already-connected local client mark a remote window's
      // still-dead backend healthy and wrongly dismiss its overlay.
      const client = getLocalBackendClient();
      broadcast(
        BACKEND.STATUS,
        {
          status: client.getStatus(),
          transport: formatTransportInfo(
            client.getConfig(),
            getPinnedVersion(),
            client.getConnectedVia(),
          ),
          reconnectAttempts: client.getReconnectAttempts(),
        },
        LOCAL_CONNECTION_ID,
      );
    }
    return result;
  } catch (error) {
    return { ok: false, spawned: false, error: toErrorPayload(error) };
  }
}

interface RestartOrphanedSidecarIpcResult {
  ok: boolean;
  spawned: boolean;
  cancelled?: boolean;
  reason?: string;
  error?: unknown;
}

/**
 * In-flight orphan recovery; concurrent invocations (toast double-click, a
 * second window) share the same promise so the verify/confirm/kill sequence
 * runs at most once at a time (mirrors `spawnOnDemandInFlight`).
 */
let restartOrphanInFlight: Promise<RestartOrphanedSidecarIpcResult> | null = null;

/**
 * Kill-and-restart recovery for an orphaned sidecar (#2444): the user accepted
 * the renderer's offer to replace the adopted leftover daemon (executable
 * inside our own bundle) with the bundled sidecar. Wires the real main-process
 * collaborators into {@link restartOrphanedSidecar}: agent-safety via the live
 * client's `isResponding` flags, a native confirmation dialog when agents
 * would be interrupted, and the existing on-demand spawn path (which re-probes
 * the socket and never runs two daemons side by side). On success the new
 * transport posture is re-broadcast.
 */
function performRestartOrphanedSidecar(): Promise<RestartOrphanedSidecarIpcResult> {
  if (restartOrphanInFlight) return restartOrphanInFlight;
  restartOrphanInFlight = doPerformRestartOrphanedSidecar().finally(() => {
    restartOrphanInFlight = null;
  });
  return restartOrphanInFlight;
}

async function doPerformRestartOrphanedSidecar(): Promise<RestartOrphanedSidecarIpcResult> {
  try {
    const [{ dialog }, { listRespondingAgents }, { buildOrphanRestartDialogOptions }] =
      await Promise.all([
        import('electron'),
        import('../../../main/running-agents'),
        import('../../../main/orphan-restart-dialog'),
      ]);
    const result = await restartOrphanedSidecar({
      getOrphanedSidecarInfo,
      clearOrphanState: () => {
        setOrphanedSidecarInfo(null);
        setDaemonVersionInfo(null);
      },
      detectOrphan: () => detectOrphanedSidecar(process.env, process.resourcesPath),
      listRespondingAgents: () => listRespondingAgents(getLocalBackendClient()),
      confirmInterrupt: async (agents) => {
        const focused = BrowserWindow.getFocusedWindow();
        const options = buildOrphanRestartDialogOptions(agents);
        const outcome = focused
          ? await dialog.showMessageBox(focused, options)
          : await dialog.showMessageBox(options);
        return outcome.response === 0;
      },
      kill: defaultKill,
      spawnSidecar: () =>
        spawnSidecarOnDemand(process.env, app.isPackaged, process.resourcesPath, process.cwd()),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    if (result.ok) {
      const client = getLocalBackendClient();
      broadcast(BACKEND.STATUS, {
        status: client.getStatus(),
        transport: formatTransportInfo(
          client.getConfig(),
          getPinnedVersion(),
          client.getConnectedVia(),
        ),
        reconnectAttempts: client.getReconnectAttempts(),
      });
    }
    return result;
  } catch (error) {
    return { ok: false, spawned: false, error: toErrorPayload(error) };
  }
}

/** How long "Open local" keeps probing for the freshly spawned daemon. */
const OPEN_LOCAL_PROBE_DEADLINE_MS = 15_000;
/** Cadence between "Open local" probe retries while the daemon starts up. */
const OPEN_LOCAL_PROBE_RETRY_MS = 500;

/**
 * Open-only "Open local" recovery from a remote window's stopped overlay:
 * spawn the app-managed sidecar (if needed) AND open/focus the local backend's
 * windows in a SINGLE main-process action. Nothing retargets any existing
 * window — the initiating remote window keeps its own (dead) backend and its
 * overlay; the user lands in a local window alongside it.
 *
 * Why this lives wholly in main: the two steps must complete even if the
 * initiating renderer is closed mid-flight, and spawn-then-open belongs in one
 * action so a fresh local window never opens against a socket nobody serves.
 *
 * Order matters: spawn FIRST so the local UDS socket is (about to be) served,
 * THEN open. `spawnSidecarOnDemand` resolves as soon as the child is forked —
 * before the daemon binds the socket — and a connect attempt against an
 * unserved socket rejects fast, so the open retries on a short cadence until
 * the daemon answers the authenticated probe (or the deadline lapses). A spawn
 * that reports a live daemon already on the socket (`spawned: false`) still
 * proceeds to the open. The spawn's uds guard needs no switch: the always-on
 * local pooled client is UDS-configured regardless of any window's backend.
 *
 * Each probe is bounded by the REMAINING deadline budget (not the client's
 * flat 30s request default): a socket that accepts but never answers would
 * otherwise hold this IPC — and the overlay's disabled button — well past the
 * documented deadline.
 */
export async function openLocalAndSpawn(): Promise<{
  ok: boolean;
  spawned: boolean;
  reason?: string;
  error?: unknown;
}> {
  const spawnResult = await performSpawnSidecar();
  if (!spawnResult.ok) return spawnResult;
  const deadline = Date.now() + OPEN_LOCAL_PROBE_DEADLINE_MS;
  for (;;) {
    try {
      const remainingMs = Math.max(deadline - Date.now(), OPEN_LOCAL_PROBE_RETRY_MS);
      await openBackendWindow(LOCAL_CONNECTION_ID, { probeTimeoutMs: remainingMs });
      return spawnResult;
    } catch (error) {
      if (Date.now() >= deadline) {
        return { ...spawnResult, ok: false, error: toErrorPayload(error) };
      }
      await new Promise((resolve) => setTimeout(resolve, OPEN_LOCAL_PROBE_RETRY_MS));
    }
  }
}

/**
 * Remove one stored connection with full teardown: forget it in the store
 * (tombstone written so keychain sync propagates the deletion; the store
 * resets a matching persisted `activeId` to local itself), dispose its pooled
 * client, close its windows, and broadcast. Runs INSIDE the connection-operation
 * queue — callers must already hold the enqueued critical section
 * (monorepo#2228): a stale pre-queue read could disconnect the backend the
 * user just selected behind a concurrent operation.
 *
 * `latchSuppression` controls the self-entry marker. `connections:forget`
 * passes `true`: forgetting this machine's own published entry is a local
 * unpublish, so the persistent "do not auto-publish" marker is set so the
 * originator honors the removal and never silently re-asserts (spec "Forget =
 * fingerprint-keyed tombstone"); cleared only by an explicit re-publish.
 * `connections:unpublish-self` passes `false`: the record is removed but
 * auto-publish offers stay allowed.
 */
async function forgetConnectionLocked(id: string, latchSuppression: boolean): Promise<void> {
  const wasActive = (await connectionsStore.getActiveId()) === id;
  // The fingerprint match is resolved BEFORE the forget (the record is still
  // readable), but the marker is set only AFTER the forget succeeds —
  // latching it first would leave a published entry with refresh-self
  // permanently disabled if the forget throws. Fail-soft on any lookup error.
  let forgetsSelf = false;
  if (latchSuppression) {
    try {
      const [records, selfFingerprint] = await Promise.all([
        connectionsStore.list(),
        getStoredSelfFingerprint(),
      ]);
      const target = records.find((c) => c.id === id);
      const targetKey = normalizeFingerprint(target?.fingerprint);
      forgetsSelf = selfFingerprint !== null && targetKey === selfFingerprint;
    } catch (error) {
      logger.warn('Could not evaluate self-entry suppression on forget (fail-soft)', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await connectionsStore.forget(id); // rejects the reserved local id; resets a matching activeId
  if (forgetsSelf) await setAutoPublishSuppressed(true);
  if (wasActive) {
    // The persisted activeId fell back to local; rebuild anything gated on it.
    app.emit('backend-connection-changed');
  }
  // If the forgotten backend owns every live window, create/focus local
  // before destroying any of them. This prevents window-all-closed from
  // entering the quit/session-clear path between teardown and fallback.
  await windowHooks.ensureLocalWindowBeforeClose?.(id);
  await windowHooks.closeForBackend?.(id);
  disconnectBackendClient(id);
  await broadcastConnectionsChanged();
}

/** Register the backend bridge IPC handlers (idempotent). */
export function registerBackendHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle(
    BACKEND.REQUEST,
    async (event, payload: { method?: string; params?: unknown; timeoutMs?: number }) => {
      const method = payload?.method;
      if (typeof method !== 'string' || method.length === 0) {
        return { ok: false, error: { code: 'INVALID_PARAMS', message: 'method is required' } };
      }
      // `timeoutMs` is an optional per-call override forwarded verbatim to the
      // JSON-RPC client. Long daemon operations (e.g. `git.pull`, whose own
      // bound exceeds the flat 30s default) pass a larger value so the daemon's
      // structured `{ok:false}` result wins over a transport timeout.
      const timeoutMs = typeof payload?.timeoutMs === 'number' ? payload.timeoutMs : undefined;
      try {
        const { backendId, client } = getBackendClientForIpcEvent(event);
        // Bulk attachment transfers on a remote backend ride their own
        // short-lived connection so a slow-draining 20+ MiB frame never
        // head-of-line-blocks the main channel (its heartbeat and unrelated
        // RPCs stay unaffected) — monorepo#2458. The local UDS sidecar keeps
        // the single socket: no uplink to saturate, same-host bandwidth.
        if (shouldUseTransferConnection(method, client.getConfig())) {
          const result = await requestOverTransferConnection(
            client.getConfig(),
            method,
            payload?.params,
            { timeoutMs },
            backendId,
          );
          return { ok: true, result };
        }
        const result = await client.request(method, payload?.params, { timeoutMs });
        return { ok: true, result };
      } catch (error) {
        return { ok: false, error: toErrorPayload(error) };
      }
    },
  );

  ipcMain.handle(BACKEND.SUBSCRIBE, async (event, params: unknown) => {
    try {
      const result = await getBackendClientForIpcEvent(event).client.request(
        'events.subscribe',
        params,
      );
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: toErrorPayload(error) };
    }
  });

  ipcMain.handle(BACKEND.UNSUBSCRIBE, async (event, params: { subscriptionId?: string }) => {
    try {
      const result = await getBackendClientForIpcEvent(event).client.request(
        'events.unsubscribe',
        params,
      );
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: toErrorPayload(error) };
    }
  });

  ipcMain.handle(BACKEND.GET_STATUS, async (event) => {
    const { backendId, client } = getBackendClientForIpcEvent(event);
    const transport = formatTransportInfo(
      client.getConfig(),
      getPinnedVersion(),
      client.getConnectedVia(),
    );
    // Boot-time startup failures fire before this module registers its
    // `onSidecarStartupFailed` listener and before any window exists, so the
    // broadcast alone is lossy. Expose the latched failure here so the
    // renderer's boot-time get-status fetch learns about it regardless of
    // ordering (PR #402 review; spec addendum under "Pinned IPC contract").
    const startupFailure = backendId === LOCAL_CONNECTION_ID ? getSidecarStartupFailure() : null;
    if (startupFailure) {
      return {
        status: client.getStatus(),
        transport,
        reconnectAttempts: client.getReconnectAttempts(),
        sidecarStartupFailed: true as const,
        sidecarStartupFailedReason: startupFailure.reason,
      };
    }
    return {
      status: client.getStatus(),
      transport,
      reconnectAttempts: client.getReconnectAttempts(),
    };
  });

  ipcMain.handle(BACKEND.SPAWN_SIDECAR, async () => performSpawnSidecar());

  // Kill-and-restart recovery for an orphaned sidecar (#2444).
  ipcMain.handle(BACKEND.RESTART_ORPHANED_SIDECAR, async () => performRestartOrphanedSidecar());

  // Open-only recovery: spawn the sidecar (if needed) AND open/focus the local
  // backend's windows in one main-side action; no window is retargeted.
  ipcMain.handle(BACKEND.OPEN_LOCAL_AND_SPAWN, async () => openLocalAndSpawn());

  // Per-run sidecar log capture: the renderer's daemon-loss dialog offers to
  // show the captured stdout/stderr tail from the last sidecar run. The
  // payload is renderer-safe by construction (no env values, no secrets).
  ipcMain.handle(BACKEND.GET_SIDECAR_RUN_LOG, async () => getSidecarRunLog());

  // Sidecar posture but the spawn could not happen at all (binary not found,
  // spawn error): broadcast a `sidecarStartupFailed` marker on the status
  // channel (same pattern as `sidecarGaveUp`) so the renderer says the
  // app-managed intentd failed to start instead of "connection was lost".
  onSidecarStartupFailed((reason) => {
    const instance = getBackendClient();
    broadcast(
      BACKEND.STATUS,
      {
        status: instance.getStatus(),
        sidecarStartupFailed: true,
        reason,
        transport: formatTransportInfo(
          instance.getConfig(),
          getPinnedVersion(),
          instance.getConnectedVia(),
        ),
        reconnectAttempts: instance.getReconnectAttempts(),
      },
      LOCAL_CONNECTION_ID,
    );
  });

  // Crash-looping sidecar: the restart policy exhausted its attempts. Reuse
  // the `backend:status` channel with a `sidecarGaveUp` marker (same pattern
  // as `reconnected`) so the renderer surfaces the daemon-loss modal instead
  // of the sidecar dying invisibly (#439).
  onSidecarGaveUp((reason) => {
    const instance = getBackendClient();
    // Report the client's ACTUAL status: in the probe→spawn TOCTOU race the
    // crash-looping child lost the socket to an external daemon the client
    // has meanwhile connected to — hardcoding 'disconnected' would flip a
    // healthy renderer to 'down' until the next poll corrected it.
    broadcast(
      BACKEND.STATUS,
      {
        status: instance.getStatus(),
        sidecarGaveUp: true,
        reason,
        transport: formatTransportInfo(
          instance.getConfig(),
          getPinnedVersion(),
          instance.getConnectedVia(),
        ),
        reconnectAttempts: instance.getReconnectAttempts(),
      },
      LOCAL_CONNECTION_ID,
    );
  });

  registerConnectionsHandlers();

  // Keychain sync (T3): pref-gated (opt-out — absent reads as enabled on
  // macOS), fail-soft, fully async. When a reconcile pulls remote changes into
  // the store, refresh every renderer via the existing connections:changed
  // broadcast. Availability changes push connections:sync-status-changed so
  // the settings UI stays live (T4).
  keychainSyncLifecycle = initKeychainSyncLifecycle({
    onRemoteApplied: () => broadcastConnectionsChanged(),
    onStatusChanged: (status) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;
        try {
          win.webContents.send(CONNECTIONS.SYNC_STATUS_CHANGED, status);
        } catch (error) {
          logger.warn('Failed to broadcast keychain sync status', {
            windowId: win.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
  });

  logger.info('Backend bridge IPC handlers registered');
}

type SavedRemoteConnection = ConnectionRecord & {
  host: string;
  port: number;
  fingerprint: string;
};

async function getRemoteConnection(id: string): Promise<SavedRemoteConnection> {
  if (id === LOCAL_CONNECTION_ID) throw new Error('Cannot update the local connection');
  const connection = (await connectionsStore.list()).find((candidate) => candidate.id === id);
  if (!connection) throw new Error(`Unknown connection id: ${id}`);
  if (connection.isLocal || !connection.host || !connection.port || !connection.fingerprint) {
    throw new Error(`Connection is not a saved remote: ${id}`);
  }
  return connection as SavedRemoteConnection;
}

async function loadSavedConnectionSecret(
  id: string,
): Promise<{ status: 'success'; token: string } | { status: 'secret-unavailable' }> {
  try {
    const token = await connectionsStore.getDecryptedToken(id);
    return token ? { status: 'success', token } : { status: 'secret-unavailable' };
  } catch {
    return { status: 'secret-unavailable' };
  }
}

async function validateConnectionAddress(
  connection: ConnectionRecord,
  host: string,
  port: number,
  token: string,
  confirmedFingerprint?: string,
): Promise<TestConnectionResult> {
  // Trust before transmission (monorepo#3782): probe the address WITHOUT the
  // bearer token first — the saved secret must never reach a host whose
  // certificate the user has not confirmed. The unauthenticated upgrade is
  // expected to be rejected (PROTOCOL §2.1); only the TLS-layer fingerprint
  // matters here.
  const probe = await captureFingerprint({ host, port });
  if (!probe.ok) {
    // No pin is passed on this probe, so `fingerprint-mismatch` cannot occur;
    // the branch only satisfies the narrowed result union.
    return {
      status: 'failed',
      reason: probe.code === 'fingerprint-mismatch' ? 'connect-failed' : probe.code,
    };
  }
  const actualFingerprint = normalizeTransportFingerprint(probe.fingerprint ?? '');
  const expectedFingerprint = normalizeTransportFingerprint(connection.fingerprint ?? '');
  if (!actualFingerprint || !expectedFingerprint) {
    return { status: 'failed', reason: 'no-certificate' };
  }
  const confirmed = confirmedFingerprint
    ? normalizeTransportFingerprint(confirmedFingerprint)
    : undefined;
  if (actualFingerprint !== expectedFingerprint && confirmed !== actualFingerprint) {
    return {
      status: 'fingerprint-confirmation-required',
      expectedFingerprint,
      actualFingerprint,
    };
  }
  // The presented certificate is trusted (saved pin or explicit user
  // confirmation) — only now is the token transmitted, exercising the real
  // authenticated upgrade path. The trusted fingerprint is pinned at the TLS
  // handshake (`expectedFingerprint`): a certificate swap between the two
  // probes aborts the connection before the upgrade request — and the token —
  // is written (TOCTOU, monorepo#3782), surfacing as a fresh confirmation
  // requirement instead of a disclosure.
  const captured = await captureFingerprint({
    host,
    port,
    token,
    expectedFingerprint: actualFingerprint,
  });
  if (!captured.ok) {
    if (captured.code === 'fingerprint-mismatch') {
      const swappedFingerprint = normalizeTransportFingerprint(captured.actualFingerprint);
      // An empty presented fingerprint means no certificate — a plain failure,
      // not something to ask the user to confirm.
      if (!swappedFingerprint) {
        return { status: 'failed', reason: 'no-certificate' };
      }
      return {
        status: 'fingerprint-confirmation-required',
        expectedFingerprint,
        actualFingerprint: swappedFingerprint,
      };
    }
    return { status: 'failed', reason: captured.code };
  }
  if (!captured.tokenValid) {
    return { status: 'authentication-rejected', statusCode: captured.statusCode ?? 401 };
  }
  if (!captured.connected) {
    return {
      status: 'failed',
      reason: 'connect-failed',
      ...(captured.statusCode !== undefined ? { statusCode: captured.statusCode } : {}),
    };
  }
  return { status: 'success', fingerprint: actualFingerprint };
}

/** Rebuild only an already-open client after its durable transport config changed. */
async function rebuildConnectionClientIfOpen(id: string): Promise<void> {
  if (!backendClients.has(id)) return;
  disconnectBackendClient(id);
  await connectBackendClient(id);
}

/**
 * Register the multi-backend connections registry IPC handlers (part of
 * {@link registerBackendHandlers}). Each channel validates its params against
 * the T0 Zod schema before touching the store/transport. The bearer token
 * crosses renderer→main only at capture/add time (the user just typed it); it
 * is consumed here and never echoed onto any returned connection shape.
 */
function registerConnectionsHandlers(): void {
  // List all connections (local first, then remotes) + the active selection.
  ipcMain.handle(
    CONNECTIONS.LIST,
    createValidatedHandler(
      ConnectionsListSchema,
      async (event) =>
        listConnections(
          event.sender ? getBackendIdForWebContents(event.sender) : LOCAL_CONNECTION_ID,
        ),
      CONNECTIONS.LIST,
    ),
  );

  // Trust-on-first-use: open a `wss` connection, read the presented cert's
  // fingerprint for the user to confirm, then close. On a structured capture
  // failure (timeout / connect-failed / no-certificate) reject so the renderer
  // surfaces the reason; on success return the fingerprint (no token) plus
  // whether the daemon accepted the token on the capture upgrade, so a bad or
  // stale token surfaces during pairing instead of after the entry is stored.
  ipcMain.handle(
    CONNECTIONS.CAPTURE_FINGERPRINT,
    createValidatedHandler(
      ConnectionsCaptureFingerprintSchema,
      async (_event, params) => {
        const result = await captureFingerprint(params);
        if (!result.ok) {
          throw new Error(result.error);
        }
        return {
          fingerprint: result.fingerprint,
          tokenValid: result.tokenValid,
          ...(result.statusCode !== undefined ? { statusCode: result.statusCode } : {}),
        } satisfies CaptureFingerprintResult;
      },
      CONNECTIONS.CAPTURE_FINGERPRINT,
    ),
  );

  // Add a remote connection (token encrypted at rest by the store). The store
  // upserts by host:port, so re-adding an existing target refreshes its
  // token/fingerprint/label in place. If the upserted record has a LIVE pooled
  // client (windows are open on it) — or is the persisted active selection —
  // rebuild that client immediately so the refreshed token takes effect
  // without closing any windows; a re-pair of a dormant remote only invalidates
  // its pool entry. `switched` stays pinned to the persisted active id for
  // wire compatibility. The whole
  // add + live-client/active-id read + conditional rebuild is ONE enqueued
  // critical section (monorepo#2228): a stale pre-queue read could rebuild
  // against this record after another backend operation had already run.
  ipcMain.handle(
    CONNECTIONS.ADD,
    createValidatedHandler(
      ConnectionsAddSchema,
      async (_event, params) =>
        enqueueConnectionOperation(async () => {
          const connection = await connectionsStore.add(params);
          const activeId = await connectionsStore.getActiveId();
          // Open-only model: the persisted activeId no longer tracks which
          // backends have windows, so the rebuild decision keys off the live
          // pool — any backend serving windows gets the refreshed credentials
          // applied in place, active or not.
          const hadLiveClient = backendClients.has(connection.id);
          disconnectBackendClient(connection.id);
          if (hadLiveClient || connection.id === activeId) {
            // Refresh a live (or active) target's credentials without
            // destroying any windows. The caller opens/focuses it through
            // connections:open.
            const rebuilt = await connectBackendClient(connection.id);
            // The rebuilt client's FIRST connect is a plain `connected`, not a
            // `reconnected`, and this backend's windows stay alive across the
            // swap. Replay the reconnect marker exactly as the instance's own
            // `reconnected` handler would, so main-process services and
            // renderer consumers holding daemon `events.subscribe` leases
            // re-subscribe against the new client (requests queue until the
            // fresh socket connects, T8).
            broadcast(
              BACKEND.STATUS,
              {
                status: 'connected',
                reconnected: true,
                transport: formatTransportInfo(
                  rebuilt.getConfig(),
                  getPinnedVersion(),
                  rebuilt.getConnectedVia(),
                ),
                reconnectAttempts: rebuilt.getReconnectAttempts(),
              },
              connection.id,
            );
            backendReconnectForwarder.emit('reconnected', connection.id);
          }
          await broadcastConnectionsChanged();
          return {
            connection,
            switched: connection.id === activeId,
          } satisfies AddConnectionResult;
        }),
      CONNECTIONS.ADD,
    ),
  );

  // Update remote metadata without carrying a token. Address changes are
  // validated with the saved main-only secret before any durable mutation.
  // `detectHosts` / `syncExcluded` flips ride the same call; the store's
  // mutation notification drives the keychain reconcile that pushes an
  // exclusion tombstone or re-publishes a re-included record.
  ipcMain.handle(
    CONNECTIONS.UPDATE,
    createValidatedHandler(
      ConnectionsUpdateSchema,
      async (_event, params) =>
        enqueueConnectionOperation(async () => {
          const saved = await getRemoteConnection(params.id);
          const host = params.host ?? saved.host;
          const port = params.port ?? saved.port;
          const addressChanged = host !== saved.host || port !== saved.port;
          const detectHostsChanged =
            params.detectHosts !== undefined && params.detectHosts !== (saved.detectHosts ?? true);
          let fingerprint = saved.fingerprint;
          if (addressChanged) {
            const secret = await loadSavedConnectionSecret(params.id);
            if (secret.status === 'secret-unavailable') return secret;
            const validation = await validateConnectionAddress(
              saved,
              host,
              port,
              secret.token,
              params.confirmedFingerprint,
            );
            if (validation.status !== 'success') return validation;
            fingerprint = validation.fingerprint;
          }
          const connection = await connectionsStore.updateMetadata(params.id, {
            label: params.label,
            accent: params.accent,
            host,
            port,
            fingerprint,
            detectHosts: params.detectHosts,
            syncExcluded: params.syncExcluded,
          });
          // An open pooled client froze its dial candidates at build time, so a
          // detectHosts flip (which clears the detected extras) must rebuild it
          // too — otherwise reconnects keep racing the IPs the user just disabled.
          if (addressChanged || detectHostsChanged) {
            await rebuildConnectionClientIfOpen(params.id);
          }
          await broadcastConnectionsChanged();
          return { status: 'updated', connection } satisfies UpdateConnectionResult;
        }),
      CONNECTIONS.UPDATE,
    ),
  );

  // Probe unsaved address values with a write-only override or the saved secret.
  // This intentionally has no store mutation and no window hook.
  ipcMain.handle(
    CONNECTIONS.TEST,
    createValidatedHandler(
      ConnectionsTestSchema,
      async (_event, { id, host, port, token }) =>
        enqueueConnectionOperation(async () => {
          const connection = await getRemoteConnection(id);
          const secret = token
            ? ({ status: 'success', token } as const)
            : await loadSavedConnectionSecret(id);
          if (secret.status === 'secret-unavailable') return secret;
          return validateConnectionAddress(connection, host, port, secret.token);
        }),
      CONNECTIONS.TEST,
    ),
  );

  // Secret rotation is a separate write-only operation. The replacement is
  // persisted only after authentication and certificate validation succeed.
  ipcMain.handle(
    CONNECTIONS.ROTATE_SECRET,
    createValidatedHandler(
      ConnectionsRotateSecretSchema,
      async (_event, { id, token, confirmedFingerprint }) =>
        enqueueConnectionOperation(async () => {
          const connection = await getRemoteConnection(id);
          const validation = await validateConnectionAddress(
            connection,
            connection.host,
            connection.port,
            token,
            confirmedFingerprint,
          );
          if (validation.status !== 'success') return validation;
          const updated = await connectionsStore.replaceSecret(id, token, validation.fingerprint);
          await rebuildConnectionClientIfOpen(id);
          await broadcastConnectionsChanged();
          return {
            status: 'updated',
            connection: updated,
          } satisfies RotateConnectionSecretResult;
        }),
      CONNECTIONS.ROTATE_SECRET,
    ),
  );

  // Open or focus one backend without changing activeId or tearing down any
  // other backend's windows/client. A failed remote probe (unreachable, bad
  // token/cert) still opens the window — the renderer's connection-lost
  // overlay / latched failure events own recovery; only a missing stored
  // secret blocks the open (structured `secret-unavailable`, no window).
  ipcMain.handle(
    CONNECTIONS.OPEN,
    createValidatedHandler(
      ConnectionsOpenSchema,
      async (_event, { id }) => {
        try {
          const opened = await openBackendWindow(id);
          return { status: 'opened', id: opened.id } satisfies OpenConnectionResult;
        } catch (error) {
          if (error instanceof ConnectionSecretUnavailableError) {
            return { status: 'secret-unavailable' } satisfies OpenConnectionResult;
          }
          throw error;
        }
      },
      CONNECTIONS.OPEN,
    ),
  );

  // Forget a remote connection. Close and disconnect only that backend.
  // Forgetting this machine's own published entry additionally latches the "do not
  // auto-publish" marker. The whole removal is ONE enqueued critical section
  // (see {@link forgetConnectionLocked}).
  ipcMain.handle(
    CONNECTIONS.FORGET,
    createValidatedHandler(
      ConnectionsForgetSchema,
      async (_event, { id }) =>
        enqueueConnectionOperation(async () => {
          await forgetConnectionLocked(id, true);
          return { id } satisfies ForgetConnectionResult;
        }),
      CONNECTIONS.FORGET,
    ),
  );

  // Ask one connected remote backend's daemon to self-update: route
  // `system.requestUpdate` to that backend's pooled client. The daemon signals
  // its serve-mode sitter (SIGUSR1), which installs the newer version and
  // gracefully restarts the daemon — the client then reconnects on its own.
  // The result is structured (never a thrown daemon error) so the renderer can
  // toast a specific message per failure mode: local/method-unknown daemons →
  // 'unsupported', no live client → 'not-connected', a structured daemon error
  // (unsupervised, non-unix) → 'failed' with the daemon's message.
  ipcMain.handle(
    CONNECTIONS.UPDATE_BACKEND,
    createValidatedHandler(
      ConnectionsUpdateBackendSchema,
      async (_event, { id }) => requestBackendUpdate(id),
      CONNECTIONS.UPDATE_BACKEND,
    ),
  );

  // Keychain sync settings surface (T4): read the opt-out pref (absent =
  // enabled on macOS) + last-known availability, and flip the pref. Enabling
  // requests an immediate reconcile so the settings UI gets a live
  // availability verdict; disabling stops sync but never touches existing
  // keychain items.
  ipcMain.handle(
    CONNECTIONS.SYNC_GET_STATE,
    createValidatedHandler(
      ConnectionsSyncGetStateSchema,
      async () => getKeychainSyncState(),
      CONNECTIONS.SYNC_GET_STATE,
    ),
  );

  ipcMain.handle(
    CONNECTIONS.SYNC_SET_ENABLED,
    createValidatedHandler(
      ConnectionsSyncSetEnabledSchema,
      async (_event, { enabled }) => {
        await setLocalPref(KEYCHAIN_SYNC_ENABLED_KEY, enabled);
        if (enabled) {
          // Drop the pre-disable verdict so the returned state (and any
          // sync-get-state until the fresh reconcile lands) shows "checking"
          // instead of a stale status (PR #1715 review).
          keychainSyncLifecycle?.resetStatus();
          keychainSyncLifecycle?.requestReconcile();
        }
        return getKeychainSyncState();
      },
      CONNECTIONS.SYNC_SET_ENABLED,
    ),
  );

  // Self-publish: upsert THIS machine's own backend into the connections
  // store so the store→keychain reconcile pushes it to the user's other
  // devices. Main gathers everything from `server.pairingInfo` over the
  // LOCAL client — the bearer token never crosses to the renderer.
  ipcMain.handle(
    CONNECTIONS.PUBLISH_SELF,
    createValidatedHandler(
      ConnectionsPublishSelfSchema,
      async () => publishSelfBackend(),
      CONNECTIONS.PUBLISH_SELF,
    ),
  );

  // Whether a self entry exists + whether auto-publish offers are suppressed
  // (gates the publish/removal modals and the explicit re-publish button).
  ipcMain.handle(
    CONNECTIONS.SELF_PUBLISHED_STATE,
    createValidatedHandler(
      ConnectionsSelfPublishedStateSchema,
      async () => getSelfPublishedState(),
      CONNECTIONS.SELF_PUBLISHED_STATE,
    ),
  );

  // Refresh the published self entry after a local change to its published
  // fields (token rotation, WSS port change). Strict no-op while unpublished
  // or while the "do not auto-publish" marker is set.
  ipcMain.handle(
    CONNECTIONS.REFRESH_SELF,
    createValidatedHandler(
      ConnectionsRefreshSelfSchema,
      async () => refreshSelfBackend(),
      CONNECTIONS.REFRESH_SELF,
    ),
  );

  // Unpublish THIS machine's published self entry: remove the stored record
  // through the standard forget/teardown path (tombstone included, so
  // keychain sync propagates the deletion) WITHOUT setting the "do not
  // auto-publish" marker — unlike forgetting the self entry via
  // `connections:forget`, auto-publish offers stay allowed afterwards.
  ipcMain.handle(
    CONNECTIONS.UNPUBLISH_SELF,
    createValidatedHandler(
      ConnectionsUnpublishSelfSchema,
      async () => unpublishSelfBackend(),
      CONNECTIONS.UNPUBLISH_SELF,
    ),
  );
}

/** Assemble the `connections:sync-get-state` / `sync-set-enabled` result. */
async function getKeychainSyncState(): Promise<KeychainSyncStateResult> {
  return {
    supported: process.platform === 'darwin',
    enabled: await isKeychainSyncEnabled(),
    status: keychainSyncLifecycle?.getStatus() ?? null,
  };
}

/**
 * `connections:publish-self`: query the local daemon's `server.pairingInfo`,
 * build the record per the spec Mechanics (label = hostname with `host:port`
 * fallback, host = first local IP, hosts = all local IPs, port = bound wsApi
 * port, fingerprint = cert fingerprint, token, detectHosts on), and upsert it
 * via the store (fingerprint-keyed dedupe; the mutation triggers the keychain
 * reconcile push). Persists the machine's own cert fingerprint for self
 * detection and clears the "do not auto-publish" marker — publishing is
 * explicit user intent. Rejects when the local backend is unreachable
 * (remote-pinned app), the wsApi listener is off (`port: null`), or there is
 * neither a routable local IP nor a tunnel tc address to publish (tunnel-only
 * posture publishes with the tc address as host). Runs as ONE enqueued
 * critical section,
 * serialized with `connections:unpublish-self` and every forget: a
 * rapid WSS off→on could otherwise land this upsert while the unpublish is
 * still queued, which would then delete the fresh record (PR #1781 review).
 */
async function publishSelfBackend(): Promise<PublishSelfResult> {
  return enqueueConnectionOperation(() => performPublishSelfBackend());
}

/** The actual publish; only entered from the serialized critical section. */
async function performPublishSelfBackend(): Promise<PublishSelfResult> {
  const localClient = getLocalBackendClient();
  const info = extractSelfPairingInfo(await localClient.request('server.pairingInfo'));
  if (!info) {
    throw new Error('publish-self failed: malformed server.pairingInfo result');
  }
  if (info.port === null) {
    throw new Error('publish-self failed: the WebSocket API is not enabled');
  }
  if (!info.localIps[0] && !info.tcAddress) {
    throw new Error('publish-self failed: no routable local IP or tunnel address to publish');
  }
  // Publishing is explicit user intent to sync this machine, so force-clear
  // any per-backend exclusion on the record (mirrors clearing the marker).
  const record = await upsertSelfRecord({ ...info, port: info.port }, { syncExcluded: false });
  await setStoredSelfFingerprint(info.certFingerprint);
  await setAutoPublishSuppressed(false);
  await broadcastConnectionsChanged();
  const connection = (await connectionsStore.list()).find((c) => c.id === record.id) ?? record;
  return { connection } satisfies PublishSelfResult;
}

/**
 * Shared upsert of this machine's self record from validated pairing info
 * (label = hostname with `host:port` fallback, host = first local IP, hosts =
 * all local IPs, port = bound wsApi port, fingerprint = cert fingerprint,
 * token, detectHosts on). In tunnel-only posture — the daemon binds loopback
 * only, so no routable local IP exists — the tc address stands in as the
 * host, matching the manual tunnel-entry convention (ConnectBackendModal
 * stores the tc address as the record's host). The store dedupes by
 * fingerprint — a host/port change collapses into the existing record with a
 * fresh `updatedAt` — and the mutation triggers the keychain reconcile push.
 * `opts.syncExcluded` follows the store's tri-state: publish passes `false`
 * (explicit intent to sync), refresh omits it so the store preserves an
 * existing per-backend exclusion — a freshness re-upsert must never flip the
 * user's opt-out. Callers must have validated `port` as non-null and at
 * least one of `localIps[0]` / `tcAddress` as present.
 */
async function upsertSelfRecord(
  info: SelfPairingInfo & { port: number },
  opts: { syncExcluded?: boolean } = {},
): Promise<ConnectionRecord> {
  const host = info.localIps[0] ?? info.tcAddress;
  if (!host) {
    throw new Error('upsertSelfRecord requires a routable local IP or a tc address');
  }
  const label = info.prettyHostname ?? info.hostname ?? `${host}:${info.port}`;
  const record = await connectionsStore.add({
    label,
    host,
    port: info.port,
    fingerprint: info.certFingerprint,
    token: info.token,
    detectHosts: true,
    ...(opts.syncExcluded !== undefined ? { syncExcluded: opts.syncExcluded } : {}),
  });
  // Persist the full candidate-host list + the machine hostname on the
  // record, matching what post-connect refreshes capture for remotes.
  // ALWAYS set it — even for a single IP — so extras from an interface that
  // has since disappeared are dropped instead of syncing stale addresses
  // (add() only removes the new primary from preserved extras).
  await connectionsStore.setHosts(record.id, info.localIps);
  const hostname = info.prettyHostname ?? info.hostname;
  if (hostname) {
    await connectionsStore.setHostname(record.id, hostname);
  }
  // Persist the daemon's tunnel tc address conclusively: pairingInfo omits
  // it whenever the tunnel is down, so `null` clears a stale address and a
  // rotation propagates to the user's other devices via keychain sync.
  await connectionsStore.setTcAddress(record.id, info.tcAddress);
  return record;
}

/**
 * `connections:refresh-self`: re-upsert the published self entry from the
 * live `server.pairingInfo` so a token rotation or WSS port/host change gets
 * a fresh `updatedAt` and propagates to the user's other devices via the
 * keychain reconcile (a host:port change is collapsed by the store's
 * fingerprint dedupe, and the reconcile tombstones the stale keychain account
 * — the record is rewritten under the new account).
 *
 * Strictly a freshness path, entirely fail-soft: while the "do not
 * auto-publish" marker is set, while no published self entry exists, when the
 * app is pinned to a remote, or when the pairing info is unavailable/
 * incomplete (WSS off, neither a routable IP nor a tc address) it is a no-op
 * (`refreshed: false`).
 * Unlike publish it NEVER sets or clears the suppression marker, and its
 * upsert omits `syncExcluded` so the store preserves a per-backend exclusion
 * — refreshing is not user intent to (re-)publish or to sync.
 */
async function refreshSelfBackend(): Promise<RefreshSelfResult> {
  if (await isAutoPublishSuppressed()) {
    return { refreshed: false } satisfies RefreshSelfResult;
  }
  const localClient = getLocalBackendClient();
  let info: ReturnType<typeof extractSelfPairingInfo>;
  try {
    info = extractSelfPairingInfo(await localClient.request('server.pairingInfo'));
  } catch (error) {
    logger.debug('Could not refresh the self entry from server.pairingInfo (fail-soft)', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { refreshed: false } satisfies RefreshSelfResult;
  }
  if (!info || info.port === null || (!info.localIps[0] && !info.tcAddress)) {
    return { refreshed: false } satisfies RefreshSelfResult;
  }
  // Only refresh an entry that is actually published: a stored record whose
  // fingerprint matches the persisted self fingerprint or the live one.
  const [records, storedFingerprint] = await Promise.all([
    connectionsStore.list(),
    getStoredSelfFingerprint(),
  ]);
  const liveFingerprint = normalizeFingerprint(info.certFingerprint);
  const selfKeys = buildSelfFingerprintKeys(storedFingerprint, liveFingerprint);
  const published = records.some((c) => isSelfConnectionRecord(c, selfKeys));
  if (!published) {
    return { refreshed: false } satisfies RefreshSelfResult;
  }
  await upsertSelfRecord({ ...info, port: info.port });
  await setStoredSelfFingerprint(info.certFingerprint);
  await broadcastConnectionsChanged();
  return { refreshed: true } satisfies RefreshSelfResult;
}

/**
 * Resolve this machine's published self record among `records`: a stored
 * record whose fingerprint matches the persisted self fingerprint OR the
 * live local daemon's cert fingerprint (via the shared cached
 * {@link getLiveSelfFingerprint} probe). Shared by
 * `connections:self-published-state` and `connections:unpublish-self` so the
 * UI's "published" decision and the unpublish target can never diverge
 * (PR #1781 review). The live probe is fail-soft — when the local daemon is
 * unreachable (or the app is pinned to a remote), detection falls back to
 * the persisted fingerprint alone.
 */
async function findSelfRecord(records: ConnectionRecord[]): Promise<ConnectionRecord | undefined> {
  const [storedFingerprint, liveFingerprint] = await Promise.all([
    getStoredSelfFingerprint(),
    getLiveSelfFingerprint(),
  ]);
  const selfKeys = buildSelfFingerprintKeys(storedFingerprint, liveFingerprint);
  return records.find((c) => isSelfConnectionRecord(c, selfKeys));
}

/**
 * `connections:unpublish-self`: remove this machine's published self entry —
 * resolved via {@link findSelfRecord}, the same lookup (persisted OR live
 * fingerprint) that decides `published` in `connections:self-published-state`
 * — through the standard forget/teardown path, WITHOUT latching the "do not
 * auto-publish" marker. No-op (`removed: false`) when no self entry exists.
 * The lookup + removal run as ONE enqueued critical section so a concurrent
 * forget cannot interleave (monorepo#2228).
 */
async function unpublishSelfBackend(): Promise<UnpublishSelfResult> {
  return enqueueConnectionOperation(async () => {
    const selfRecord = await findSelfRecord(await connectionsStore.list());
    if (!selfRecord) {
      return { removed: false } satisfies UnpublishSelfResult;
    }
    await forgetConnectionLocked(selfRecord.id, false);
    return { removed: true } satisfies UnpublishSelfResult;
  });
}

/**
 * `connections:self-published-state`: whether a self entry exists (per
 * {@link findSelfRecord}) and whether the persistent "do not auto-publish"
 * marker is set.
 */
async function getSelfPublishedState(): Promise<SelfPublishedStateResult> {
  const [records, suppressed] = await Promise.all([
    connectionsStore.list(),
    isAutoPublishSuppressed(),
  ]);
  const selfRecord = await findSelfRecord(records);
  return {
    published: selfRecord !== undefined,
    suppressed,
    selfConnectionId: selfRecord?.id ?? null,
  } satisfies SelfPublishedStateResult;
}

/** Dispose every pooled backend client (app shutdown). */
export function disposeAllBackendClients(): void {
  for (const [id, instance] of backendClients) {
    backendClients.delete(id);
    clearBackendFailureState(id);
    disposeTransferConnectionsForBackend(id);
    instance.dispose();
  }
}
