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
import { cancelInflightHostExecStreamsForBackendSwitch } from '$shared/main/host-exec-stream';
import {
  AuthRejectedError,
  captureFingerprint,
  PinMismatchError,
  resolveBackendConfig,
  type BackendConnectionConfig,
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
  getOrphanedSidecarInfo,
  setDaemonVersionInfo,
  setOrphanedSidecarInfo,
} from './connection-mode';
import { computeDaemonVersionRefresh } from './daemon-version-refresh';
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
  ConnectionBootFallbackEvent,
  ConnectionCertMismatchEvent,
  ConnectionProtocolMismatchEvent,
  ConnectionsChangedEvent,
  ConnectionsListResult,
  ForgetConnectionResult,
  KeychainSyncStateResult,
  OpenConnectionResult,
  PublishSelfResult,
  RefreshSelfResult,
  SelfPublishedStateResult,
  SwitchConnectionResult,
} from '../../../shared/types/connections';
import { compareProtocolMajor } from './protocol-compat';
import {
  ConnectionsAddSchema,
  ConnectionsCaptureFingerprintSchema,
  ConnectionsForgetSchema,
  ConnectionsListSchema,
  ConnectionsOpenSchema,
  ConnectionsPublishSelfSchema,
  ConnectionsRefreshSelfSchema,
  ConnectionsSelfPublishedStateSchema,
  ConnectionsSwitchSchema,
  ConnectionsSyncGetStateSchema,
  ConnectionsSyncSetEnabledSchema,
} from '../../../main/ipc-schemas';
import { createValidatedHandler } from '../../../main/ipc-validation-middleware';
import { getBackendIdForWebContents, getFocusedWindowBackendId } from '../../../main/window';

const logger = new Logger('Backend-IPC');
const BACKEND = IPC_CHANNELS.BACKEND;
const CONNECTIONS = IPC_CHANNELS.CONNECTIONS;

let client: JsonRpcClient | null = null;
const backendClients = new Map<string, JsonRpcClient>();
const backendClientConnects = new Map<string, Promise<JsonRpcClient>>();
let handlersRegistered = false;

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
 * after a {@link switchBackend} disposed that client and built a new one, the
 * handlers were stranded on the dead client and never re-attached, and a
 * post-switch daemon reconnect would silently fail to replay their
 * subscriptions.
 *
 * The forwarder is a single long-lived emitter that outlives every client swap.
 * Each freshly constructed client's `reconnected` event is piped into it, and
 * {@link switchBackend} emits one `reconnected` through it right after building
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
 * live JsonRpcClient instance, so after a {@link switchBackend} disposed that
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
 * switch, so it registers here instead and observes the new client's
 * transitions.
 */
const backendStatusForwarder = new EventEmitter();
backendStatusForwarder.setMaxListeners(50);

/**
 * Connection target for the NEXT `getBackendClient()` construction. `null`
 * means "resolve the local/env default" (startup + switch-back-to-local); a
 * non-null value is the pinned `wss` target selected by the last
 * {@link switchBackend}. The live client is always rebuilt from this after a
 * {@link disposeBackendClient}, so the active transport follows the switch.
 */
let currentConfig: BackendConnectionConfig | null = null;

/**
 * Identity of the remote connection the live client is pinned to, carried onto
 * the {@link ConnectionCertMismatchEvent} when {@link PinMismatchError} fires.
 * `null` while connected to the local sidecar (UDS has no cert to mismatch).
 */
let activeConnectionMeta: { id: string; host: string; port: number } | null = null;

/**
 * One-shot guard so a pinned-cert mismatch surfaces a single failure event per
 * client — the reconnect loop re-raises {@link PinMismatchError} on every retry
 * against an unchanged cert, but the renderer only needs one blocking modal.
 * Reset whenever a fresh client is constructed.
 */
let certMismatchNotified = false;

/**
 * One-shot guard so a WSS auth rejection (HTTP 401/403) surfaces a single
 * failure event per client — the reconnect loop re-raises
 * {@link AuthRejectedError} on every retry against an unchanged token, but the
 * renderer only needs one notice. Reset whenever a fresh client is constructed
 * (parallels {@link certMismatchNotified}).
 */
let authRejectedNotified = false;

/**
 * The LOCAL intentd's `protocolVersion`, learned from the `client.hello`
 * handshake against the local sidecar (`activeConnectionMeta === null`). Used
 * as the baseline for the protocol-compatibility check when the FE later
 * switches to a remote (T15). `null` until the first local handshake resolves.
 *
 * This is only ONE of two baseline sources: it is populated by the disposable
 * local renderer client, so a fast switch to a remote before the local hello
 * resolves would dispose that client and leave this `null`. The stable fallback
 * is the sidecar manager's startup handshake probe
 * ({@link getLocalDaemonProtocolVersion}), which survives client disposal — see
 * {@link resolveLocalProtocolBaseline} (cloudlands-fe#823).
 */
let localProtocolVersion: string | null = null;

/**
 * One-shot guard so a remote's protocol mismatch surfaces a single non-blocking
 * warning per client — the reconnect loop re-runs `client.hello` on every
 * retry, but the renderer only needs one notice. Reset whenever a fresh client
 * is constructed (parallels {@link certMismatchNotified}).
 */
let protocolMismatchNotified = false;

/**
 * Sticky protocol-mismatch for the CURRENTLY active backend, or `null` when the
 * active backend matches local (or is local). Persisted here in main and
 * replayed on {@link listConnections} so a renderer that registered its
 * `connections:protocol-mismatch` listener AFTER the one-shot broadcast fired
 * still surfaces the advisory modal + menu warning (cloudlands-fe#823).
 *
 * A backend switch destroys the initiating renderer and creates a new window;
 * a fast remote can broadcast the mismatch before the new renderer subscribes,
 * so the one-shot event alone is lossy. This latched copy closes that race.
 * Cleared whenever a fresh client is constructed (see {@link getBackendClient})
 * — the next `client.hello` re-detects a mismatch for a mismatching remote and
 * leaves it null for a matching/local backend.
 */
let activeProtocolMismatch: ConnectionProtocolMismatchEvent | null = null;

/**
 * Origin of the flow that pinned the CURRENT client to a remote, stamped onto
 * any protocol-mismatch payload it latches (`ConnectionProtocolMismatchEvent.origin`).
 * `'boot'` while {@link reconcileActiveConnectionOnBoot} restores a persisted
 * remote — the renderer can then suppress the advisory modal (menu warning
 * only) since the user did not just initiate a switch. `'switch'` for an
 * explicit {@link switchBackend} — modal-worthy, current behavior. Reset to
 * `'switch'` on every {@link disposeBackendClient} (each explicit switch
 * disposes before rebuilding), so only the boot path re-tags it.
 */
let protocolMismatchOrigin: 'boot' | 'switch' = 'switch';

/**
 * Sticky auth-rejection for the CURRENTLY active backend, or `null` when its
 * auth is good (or it is local). Persisted here in main and replayed on
 * {@link listConnections} so a renderer/window created or reloaded AFTER the
 * one-shot `connections:auth-rejected` broadcast fired (including the boot
 * path) still surfaces the actionable "authentication rejected" state —
 * exactly the {@link activeProtocolMismatch} pattern. Cleared whenever a fresh
 * client is constructed (a re-pair or switch builds a new client whose own
 * connect re-detects any rejection).
 */
let activeAuthRejected: ConnectionAuthRejectedEvent | null = null;

/**
 * Sticky boot-time backend-restore fallback notice (T19), or `null`. Set by
 * {@link reconcileActiveConnectionOnBoot} when a persisted remote `activeId` was
 * unreachable at boot and the FE fell back to local. Replayed on
 * {@link listConnections} (the initial `connections:list` fetch) so the renderer
 * surfaces the non-blocking notice — the fallback happens before any window
 * exists, so a live broadcast alone would be lost. Cleared once consumed by
 * that first list fetch so it never re-pops on a later refresh.
 */
let bootFallbackNotice: ConnectionBootFallbackEvent | null = null;

/**
 * Handle for the keychain-sync lifecycle (T3), set once in
 * {@link registerBackendHandlers}. The T4 settings IPC reads its last-known
 * availability status and requests an immediate reconcile on enable.
 */
let keychainSyncLifecycle: KeychainSyncLifecycle | null = null;

/**
 * Bounded timeout for the boot reconnect attempt against a persisted remote
 * (T19). Long enough to ride out a slow-but-reachable LAN handshake, short
 * enough that an unreachable remote never stalls startup — on timeout the FE
 * falls back to the always-available local sidecar.
 */
let bootReconnectTimeoutMs = 4_000;

/**
 * Window-teardown seam for a backend switch (T4). Two split hooks, called
 * around the client swap so the outgoing backend's layout is captured while its
 * windows are still live and the incoming backend's windows only open once the
 * new client is connecting:
 *   - `captureAndClose(fromId)` — persist the outgoing backend's workspace/HUD
 *     windows under `fromId`, then destroy them all.
 *   - `restore(toId)` — restore `toId`'s saved sessions, or open a fresh window.
 * Injectable so switch-orchestration unit tests never pull in the Electron
 * window module.
 */
interface BackendWindowHooks {
  captureAndClose(fromBackendId: string): Promise<void>;
  restore(toBackendId: string): void | Promise<void>;
  openOrFocus?(backendId: string): void | Promise<void>;
  ensureLocalWindowBeforeClose?(backendId: string): void | Promise<void>;
  closeForBackend?(backendId: string): void | Promise<void>;
  /**
   * Idempotent failure-path clear of the window-all-closed teardown guard set
   * by `captureAndClose`. `restore` already clears it at its top; the switch
   * orchestration also calls this from a finally so a throw between the two
   * halves cannot leak the guard and suppress window-all-closed handling for
   * the rest of the session.
   */
  clearTeardownGuard?(): void | Promise<void>;
}
const defaultWindowHooks: BackendWindowHooks = {
  async captureAndClose(fromBackendId) {
    const mod = (await import('../../../main/window')) as unknown as {
      captureAndCloseWindowsForBackendSwitch: (id: string) => Promise<void>;
    };
    await mod.captureAndCloseWindowsForBackendSwitch(fromBackendId);
  },
  async restore(toBackendId) {
    const mod = (await import('../../../main/window')) as unknown as {
      restoreWindowsForBackend: (id: string) => void;
    };
    mod.restoreWindowsForBackend(toBackendId);
  },
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
  async clearTeardownGuard() {
    const mod = (await import('../../../main/window')) as unknown as {
      clearBackendSwitchWindowTeardownGuard: () => void;
    };
    mod.clearBackendSwitchWindowTeardownGuard();
  },
};
let windowHooks: BackendWindowHooks = defaultWindowHooks;

/** @internal Test seam: override the window-teardown hooks. */
export function __setBackendWindowHooksForTesting(hooks: BackendWindowHooks | null): void {
  windowHooks = hooks ?? defaultWindowHooks;
}

/**
 * @internal Test seams for the protocol-compat + sticky-mismatch flow (#823).
 * These poke the module-level baseline/active-mismatch state directly so the
 * early-switch and sticky-replay behaviors can be exercised without standing up
 * a live JsonRpcClient/transport.
 */
export function __setActiveConnectionMetaForTesting(
  meta: { id: string; host: string; port: number } | null,
): void {
  activeConnectionMeta = meta;
}
/** @internal Test seam: read the connection identity the live client is pinned to. */
export function __getActiveConnectionMetaForTesting(): {
  id: string;
  host: string;
  port: number;
} | null {
  return activeConnectionMeta;
}
export function __setLocalProtocolVersionForTesting(version: string | null): void {
  localProtocolVersion = version;
}
export function __handleHelloProtocolVersionForTesting(protocolVersion: string | null): void {
  handleHelloProtocolVersion(protocolVersion);
}
export function __getActiveProtocolMismatchForTesting(): ConnectionProtocolMismatchEvent | null {
  return activeProtocolMismatch;
}
export function __listConnectionsForTesting(): Promise<ConnectionsListResult> {
  return listConnections();
}
export function __resetBackendProtocolStateForTesting(): void {
  localProtocolVersion = null;
  protocolMismatchNotified = false;
  activeProtocolMismatch = null;
  protocolMismatchOrigin = 'switch';
  activeConnectionMeta = null;
  bootFallbackNotice = null;
  activeAuthRejected = null;
}
/** @internal Test seam: read the latched auth-rejection for the active backend. */
export function __getActiveAuthRejectedForTesting(): ConnectionAuthRejectedEvent | null {
  return activeAuthRejected;
}
/** @internal Test seam: poke the latched auth-rejection directly. */
export function __setActiveAuthRejectedForTesting(event: ConnectionAuthRejectedEvent | null): void {
  activeAuthRejected = event;
}
/** @internal Test seam: shorten the T19 boot-reconnect timeout. */
export function __setBootReconnectTimeoutForTesting(ms: number): void {
  bootReconnectTimeoutMs = ms;
}
/** @internal Test seam: read the latched T19 boot-fallback notice. */
export function __getBootFallbackNoticeForTesting(): ConnectionBootFallbackEvent | null {
  return bootFallbackNotice;
}

/**
 * Whether the focused window is bound to a remote backend. With no live window,
 * fall back to the compatibility client's explicit whole-app switch state.
 */
export function isRemoteBackendActive(): boolean {
  const hasLiveWindow = BrowserWindow.getAllWindows().some((window) => !window.isDestroyed());
  return hasLiveWindow
    ? getFocusedWindowBackendId() !== LOCAL_CONNECTION_ID
    : activeConnectionMeta !== null;
}

/**
 * Whether the live client targets a daemon that is guaranteed to run on THIS
 * host: no saved remote is active AND the resolved transport is UDS (a UDS
 * socket is same-host by construction). False for saved remotes and for the
 * env/dev transports (`INTENTD_WS_URL`, `INTENTD_TCP`, dev loopback WS), which
 * may point at a daemon on another machine — callers gating platform-dependent
 * daemon capabilities (e.g. the win32 stack-sampling menu gate, #1889) must
 * not assume those share the FE's platform.
 */
export function isSameHostBackendActive(): boolean {
  const hasLiveWindow = BrowserWindow.getAllWindows().some((window) => !window.isDestroyed());
  if (!hasLiveWindow && activeConnectionMeta !== null) return false;
  const backendId = getFocusedWindowBackendId();
  if (backendId !== LOCAL_CONNECTION_ID) return false;
  const config =
    backendClients.get(LOCAL_CONNECTION_ID)?.getConfig() ??
    resolveBackendConfig(process.env, { isDev: !app.isPackaged });
  return config.transport === 'uds';
}

/** Liveness heartbeat interval; reconnect-on-close cannot detect half-open sockets. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Lazily create, wire, and start the shared main-process JSON-RPC client. */
export function getBackendClient(): JsonRpcClient {
  if (client) return client;
  // A fresh client starts with clean cert- and protocol-mismatch guards. The
  // incoming backend's own `client.hello` re-detects any mismatch.
  certMismatchNotified = false;
  authRejectedNotified = false;
  protocolMismatchNotified = false;
  activeProtocolMismatch = null;
  activeAuthRejected = null;
  // Local and packaged builds default to UDS. Explicit transport overrides
  // (`INTENTD_SOCKET`, `INTENTD_WS_URL`, `INTENTD_TCP`) win either way — see
  // `resolveBackendConfig`. After a switch to a remote
  // backend, `currentConfig` pins the `wss` target selected by `switchBackend`;
  // it is `null` for the local sidecar (startup + switch-back-to-local).
  const isDev = !app.isPackaged;
  const connectionId = activeConnectionMeta?.id ?? LOCAL_CONNECTION_ID;
  // An explicit whole-app switch keeps its historical full-rebuild semantics.
  // If the target was already connected as a secondary pool member, dispose it
  // before replacing it with the newly wired primary client.
  const pooledTarget = backendClients.get(connectionId);
  if (pooledTarget) {
    backendClients.delete(connectionId);
    pooledTarget.dispose();
  }
  const instance = new JsonRpcClient({
    config: currentConfig ?? resolveBackendConfig(process.env, { isDev }),
    // Enable a liveness heartbeat: reconnect-on-close alone misses a silently
    // half-open socket. `host.status` is the transport-agnostic capability
    // probe (PROTOCOL.md §5.14) — answered on BOTH UDS and WSS — so it works
    // as a heartbeat regardless of which transport `resolveBackendConfig`
    // picked. `system.status` (PROTOCOL.md §5.7) is intentionally UDS-only.
    // A transport timeout/failure trips a reconnect.
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    // One slow control response does not prove that a live socket is dead. The
    // shared daemon can briefly exceed the request bound under dev load, so wait
    // for one confirming failure. Socket close/error events still reconnect
    // immediately in JsonRpcClient.
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
      // check — record it for local, compare it against local for a remote.
      handleHelloProtocolVersion(
        typeof obj?.protocolVersion === 'string' ? obj.protocolVersion : null,
      );
      // #3448: refresh the adopted external daemon's version info from the
      // live `server.version` on every (re)connect — the startup probe only
      // latches it once, so a daemon upgrade would otherwise stay stale. For
      // the handshake hello this runs BEFORE `finishConnect` emits
      // `connected`, so that broadcast already carries the refreshed info;
      // the explicit re-broadcast below covers caller-issued hellos while
      // connected (no status event follows those).
      const refreshed = computeDaemonVersionRefresh({
        helloResult: result,
        isLocalBackend: activeConnectionMeta === null,
        transport: instance.getConfig().transport,
        connectionMode: getConnectionMode(),
        pinnedVersion: getPinnedVersion(),
        current: getDaemonVersionInfo(),
      });
      if (refreshed) {
        setDaemonVersionInfo(refreshed);
        broadcast(BACKEND.STATUS, {
          status: instance.getStatus(),
          transport: formatTransportInfo(instance.getConfig(), getPinnedVersion()),
          reconnectAttempts: instance.getReconnectAttempts(),
        });
      }
    },
  });
  instance.on('notification', (notification: JsonRpcNotification) => {
    broadcast(BACKEND.NOTIFICATION, notification, connectionId);
    // Pipe the live client's notifications through the stable forwarder so
    // main-process services (attached once via onBackendNotification) keep
    // receiving daemon events regardless of how many client swaps have
    // happened since they registered. See `backendNotificationForwarder`.
    backendNotificationForwarder.emit('notification', connectionId, notification);
  });
  instance.on('status', (status: ConnectionStatus) => {
    const transport = formatTransportInfo(instance.getConfig(), getPinnedVersion());
    // `reconnectAttempts` counts retries since the last successful connect so
    // the daemon-loss overlay can show live retry progress (#1750).
    broadcast(
      BACKEND.STATUS,
      {
        status,
        transport,
        reconnectAttempts: instance.getReconnectAttempts(),
      },
      connectionId,
    );
    // Same stable-forwarder pipe for `status`; see `backendStatusForwarder`.
    backendStatusForwarder.emit('status', connectionId, status);
  });
  // On reconnect the daemon has already dropped every in-memory subscription
  // (see intentd's event-bus lifecycle); broadcast a distinct `{ status:
  // 'connected', reconnected: true }` marker AFTER the plain status event so
  // renderer consumers can replay their `events.subscribe` calls and refresh
  // coarse state. This piggybacks on the existing `backend:status` channel to
  // avoid growing the preload allow-list surface. See RESUB-1.
  instance.on('reconnected', () => {
    const transport = formatTransportInfo(instance.getConfig(), getPinnedVersion());
    broadcast(
      BACKEND.STATUS,
      {
        status: 'connected',
        reconnected: true,
        transport,
        reconnectAttempts: instance.getReconnectAttempts(),
      },
      connectionId,
    );
    // Pipe the live client's reconnect through the stable forwarder so
    // main-process services (attached once via onBackendReconnected) replay
    // their subscriptions — regardless of how many client swaps have happened
    // since they registered. See `backendReconnectForwarder`.
    backendReconnectForwarder.emit('reconnected', connectionId);
  });
  instance.on('error', (error: Error) => {
    // A pinned-cert mismatch (PROTOCOL §1.2) is NOT a transient transport blip:
    // the remote presented a certificate whose fingerprint differs from the one
    // captured at trust-on-first-use time. Surface a single blocking failure
    // event to the renderer instead of silently reconnecting into a changed
    // cert (spec "Trust-on-first-use flow", no silent re-trust).
    if (error instanceof PinMismatchError) {
      if (!certMismatchNotified && activeConnectionMeta) {
        certMismatchNotified = true;
        const payload: ConnectionCertMismatchEvent = {
          id: activeConnectionMeta.id,
          host: activeConnectionMeta.host,
          port: activeConnectionMeta.port,
          expectedFingerprint: error.expected,
          actualFingerprint: error.actual,
        };
        broadcast(CONNECTIONS.CERT_MISMATCH, payload);
      }
      logger.warn('Backend certificate fingerprint mismatch', {
        host: activeConnectionMeta?.host,
      });
      return;
    }
    // A 401/403 WebSocket-upgrade rejection (PROTOCOL §2.1: bad/rotated token,
    // or the WS API is disabled) is NOT a transient transport blip either:
    // reconnecting with the same token will keep failing. Surface a single
    // machine-readable auth-rejected event per client instead of a generic
    // transport error.
    if (error instanceof AuthRejectedError) {
      if (!authRejectedNotified && activeConnectionMeta) {
        authRejectedNotified = true;
        const payload: ConnectionAuthRejectedEvent = {
          id: activeConnectionMeta.id,
          host: activeConnectionMeta.host,
          port: activeConnectionMeta.port,
          statusCode: error.statusCode,
        };
        // Latch BEFORE broadcasting so a renderer that fetches
        // `connections:list` between the broadcast and its own listener
        // registration still replays it (same ordering as the sticky
        // protocol mismatch).
        activeAuthRejected = payload;
        broadcast(CONNECTIONS.AUTH_REJECTED, payload);
      }
      logger.warn('Backend rejected WebSocket authentication', {
        host: activeConnectionMeta?.host,
        statusCode: error.statusCode,
      });
      return;
    }
    logger.warn('Backend transport error', { error: error.message });
  });
  // FE-served reverse intents (PROTOCOL §5.14). `browser.exec` is dispatched
  // from the daemon back to us and executed against the ported browser action
  // pipeline. Screenshot assets are round-tripped through `note.saveAsset` via
  // this same client so the wire payload stays small (GAP-2b).
  registerBrowserExecReverseHandler(instance, {
    saveAsset: (params) => instance.request<{ url?: string } | undefined>('note.saveAsset', params),
  });
  client = instance;
  backendClients.set(connectionId, instance);
  instance.start();
  return instance;
}

/** Return a live pooled client by connection id, without creating one. */
export function getBackendClientForConnection(id: string): JsonRpcClient | undefined {
  return backendClients.get(id);
}

/** Resolve a renderer sender to its backend id, with the local fallback. */
export function getBackendIdForIpcSender(sender: Electron.WebContents): string {
  return getBackendIdForWebContents(sender);
}

/** Return the client bound to the focused window (local fallback for no window). */
export function getFocusedBackendClient(): JsonRpcClient {
  const backendId = getFocusedWindowBackendId();
  return backendClients.get(backendId) ?? getBackendClient();
}

/** Return the connection id currently represented by the compatibility client. */
export function getPrimaryBackendId(): string {
  for (const [id, instance] of backendClients) {
    if (instance === client) return id;
  }
  return activeConnectionMeta?.id ?? LOCAL_CONNECTION_ID;
}

/**
 * Connect an additional backend without changing or disposing the compatibility
 * client returned by {@link getBackendClient}. Concurrent connects for the same
 * id share one construction, and the connection store remains the only place
 * where a remote bearer token is decrypted.
 */
export function connectBackendClient(id: string): Promise<JsonRpcClient> {
  const existing = backendClients.get(id);
  if (existing) return Promise.resolve(existing);
  const pending = backendClientConnects.get(id);
  if (pending) return pending;

  const connecting = buildConfigForConnection(id)
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
  if (instance === client) {
    disposeBackendClient();
    return;
  }
  backendClients.delete(id);
  disposeTransferConnectionsForBackend(id);
  void cancelInflightHostExecStreamsForBackendSwitch(instance);
  instance.dispose();
}

/** Build a secondary pool member and route its renderer events by connection id. */
function createAdditionalBackendClient(id: string, config: BackendConnectionConfig): JsonRpcClient {
  const instance = new JsonRpcClient({
    config,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    healthCheckFailureThreshold: 2,
    healthCheck: async () => {
      await instance.request('host.status');
    },
    helloParams: async () => ({ clientId: await getOrCreateClientId() }),
    onHelloResult: (result) => {
      const clientId =
        result && typeof result === 'object'
          ? (result as { clientId?: unknown }).clientId
          : undefined;
      if (typeof clientId === 'string' && clientId.length > 0) {
        void persistClientId(clientId);
      }
    },
  });
  instance.on('notification', (notification: JsonRpcNotification) => {
    broadcast(BACKEND.NOTIFICATION, notification, id);
    backendNotificationForwarder.emit('notification', id, notification);
  });
  instance.on('status', (status: ConnectionStatus) => {
    broadcast(
      BACKEND.STATUS,
      {
        status,
        transport: formatTransportInfo(instance.getConfig(), getPinnedVersion()),
        reconnectAttempts: instance.getReconnectAttempts(),
      },
      id,
    );
    backendStatusForwarder.emit('status', id, status);
  });
  instance.on('reconnected', () => {
    broadcast(
      BACKEND.STATUS,
      {
        status: 'connected',
        reconnected: true,
        transport: formatTransportInfo(instance.getConfig(), getPinnedVersion()),
        reconnectAttempts: instance.getReconnectAttempts(),
      },
      id,
    );
    backendReconnectForwarder.emit('reconnected', id);
  });
  instance.on('error', (error: Error) => {
    logger.warn('Backend pool transport error', { id, error: error.message });
  });
  registerBrowserExecReverseHandler(instance, {
    saveAsset: (params) => instance.request<{ url?: string } | undefined>('note.saveAsset', params),
  });
  instance.start();
  return instance;
}

/**
 * Register a main-process listener for backend reconnects. Fires each time the
 * shared JsonRpcClient re-establishes the connection after a drop — AND once
 * per {@link switchBackend} — so consumers that hold long-lived
 * `events.subscribe` subscriptions (terminal registry, script manager,
 * notification/app-settings services, ACP terminal handler) can re-issue them.
 * Returns a disposer.
 *
 * The handler is attached to the stable {@link backendReconnectForwarder}, NOT
 * to the live client instance, so it survives client swaps: a service registers
 * once and keeps replaying subscriptions against whatever client is current,
 * even across an arbitrary number of backend switches.
 */
export function onBackendReconnected(handler: () => void, backendId?: string): () => void {
  // Ensure the shared client exists (and is wired into the forwarder) so a
  // reconnect against the current transport actually reaches this handler.
  getBackendClient();
  const listener = (emittingBackendId: string): void => {
    if (emittingBackendId === (backendId ?? getPrimaryBackendId())) handler();
  };
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
 * backend switches.
 */
export function onBackendNotification(
  handler: (notification: JsonRpcNotification) => void,
  backendId?: string,
): () => void {
  // Ensure the shared client exists (and is wired into the forwarder) so
  // notifications on the current transport actually reach this handler.
  getBackendClient();
  const listener = (emittingBackendId: string, notification: JsonRpcNotification): void => {
    if (emittingBackendId === (backendId ?? getPrimaryBackendId())) handler(notification);
  };
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
  getBackendClient();
  const listener = (emittingBackendId: string, status: ConnectionStatus): void => {
    if (emittingBackendId === (backendId ?? getPrimaryBackendId())) handler(status);
  };
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
  const pooledClient = getBackendClientForConnection(backendId);
  if (pooledClient) return { backendId, client: pooledClient };
  if (backendId === LOCAL_CONNECTION_ID && activeConnectionMeta === null) {
    return { backendId, client: getBackendClient() };
  }
  throw new Error(`Backend client is not connected: ${backendId}`);
}

/**
 * Consume a `protocolVersion` from a `client.hello` handshake (T15).
 *
 * The live client's identity discriminates local vs remote: `activeConnectionMeta`
 * is `null` for the local sidecar (UDS/env default) and set to the remote's
 * identity after a {@link switchBackend} to a remote.
 *   - Local handshake → record the value as the baseline `localProtocolVersion`.
 *   - Remote handshake → compare its **major** against the local baseline (see
 *     {@link resolveLocalProtocolBaseline}); on a mismatch latch it as the
 *     sticky {@link activeProtocolMismatch} AND broadcast a single non-blocking
 *     `connections:protocol-mismatch` notice (the connection still proceeds —
 *     warn-but-allow). An unknown/absent version on either side surfaces
 *     nothing.
 */
function handleHelloProtocolVersion(protocolVersion: string | null): void {
  const meta = activeConnectionMeta;
  if (!meta) {
    // Local sidecar / env default: remember the baseline protocolVersion.
    if (protocolVersion) localProtocolVersion = protocolVersion;
    return;
  }
  if (protocolMismatchNotified) return;
  const localBaseline = resolveLocalProtocolBaseline();
  if (compareProtocolMajor(localBaseline, protocolVersion) !== 'mismatch') return;
  protocolMismatchNotified = true;
  const payload: ConnectionProtocolMismatchEvent = {
    id: meta.id,
    host: meta.host,
    port: meta.port,
    // Both are non-null: `compareProtocolMajor` only returns 'mismatch' when both parse.
    localProtocolVersion: localBaseline as string,
    remoteProtocolVersion: protocolVersion as string,
    // 'boot' when this client was pinned by boot restore (suppresses the
    // renderer modal), 'switch' for an explicit backend switch.
    origin: protocolMismatchOrigin,
  };
  // Latch BEFORE broadcasting so a renderer that fetches `connections:list`
  // between the broadcast and its own listener registration still replays it.
  activeProtocolMismatch = payload;
  logger.warn('Remote backend protocol version differs from local (warn-only)', {
    id: meta.id,
    localProtocolVersion: localBaseline,
    remoteProtocolVersion: protocolVersion,
  });
  broadcast(CONNECTIONS.PROTOCOL_MISMATCH, payload);
}

/**
 * Resolve the local intentd protocolVersion baseline for the compat check.
 *
 * Prefers the local renderer client's own `client.hello` value
 * ({@link localProtocolVersion}) when available, and falls back to the sidecar
 * manager's stable startup-probe value ({@link getLocalDaemonProtocolVersion})
 * — which survives client disposal — so a switch to a remote before the local
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
// Multi-backend connect: switch orchestration + connections registry IPC.
// ============================================================================

/**
 * Restore the last-used backend at boot, with a graceful fallback to local
 * (T19). The persisted `activeId` records whichever backend was active when the
 * app last closed. On launch:
 *   - **Local (or no remote):** nothing to do — the shared client builds from
 *     the local/env default lazily, which already matches the persisted id.
 *   - **A remote:** pin the live client to that remote and attempt to connect
 *     with a **bounded timeout** ({@link bootReconnectTimeoutMs}). The connect
 *     goes through the normal pinned-cert/token contract, so a changed cert
 *     still routes to the existing mismatch failure modal (via the client's
 *     `error` handler) rather than silently re-trusting.
 *       - **Reachable:** stay on it — the persisted `activeId` already agrees
 *         with the live transport, so `connections:list` reports the remote.
 *       - **Unreachable / timed out:** dispose the remote client, fall back to
 *         the always-running local sidecar (reset `activeId = local`), and latch
 *         a non-blocking {@link bootFallbackNotice} ("Couldn't reach <label>;
 *         using this machine") for the renderer to surface on its first
 *         `connections:list` fetch. No hang — the timeout bounds the wait.
 *
 * This reverses the earlier T8 "always reset to local at boot" behavior. The
 * local sidecar is started before this runs (see main/index.ts) so local is
 * always available to fall back to.
 *
 * Fail-soft: any unexpected error (store read/write, config build) falls back to
 * local and must never block app startup.
 *
 * Post-condition / boot seam (T21): once this promise resolves,
 * `connectionsStore.getActiveId()` reflects the ACTUALLY-connected backend — the
 * restored remote when it was reachable, otherwise `local`. Every path that
 * flips the active id (all fallbacks `await setActiveId(local)`) is awaited
 * before returning, and the reachable-remote path leaves the already-correct
 * persisted id untouched. Boot code in main/index.ts must run this to
 * completion BEFORE window-session restore so restore keys off the real backend.
 */
export async function reconcileActiveConnectionOnBoot(): Promise<void> {
  let activeId: string;
  try {
    activeId = await connectionsStore.getActiveId();
  } catch (error) {
    logger.warn('Failed to read persisted active backend at boot', {
      error: error instanceof Error ? error.message : String(error),
    });
    return; // Nothing built yet; the lazy local client is the safe default.
  }
  if (activeId === LOCAL_CONNECTION_ID) return; // Already local — no-op.

  // A persisted activeId pointing at this machine's own (hidden) self entry —
  // e.g. selected on another device before this machine's list started hiding
  // it, then synced back — resolves to local: that record IS this daemon, and
  // the hidden entry must never be restored as a WSS "remote". Silent (no
  // boot-fallback notice — nothing is unreachable) and fail-soft: a detection
  // error just takes the normal restore path.
  let isSelfEntry = false;
  try {
    const [records, selfFingerprint] = await Promise.all([
      connectionsStore.list(),
      getStoredSelfFingerprint(),
    ]);
    const target = records.find((c) => c.id === activeId);
    isSelfEntry = target !== undefined && isSelfConnectionRecord(target, selfFingerprint);
  } catch (error) {
    logger.warn('Could not evaluate self-entry redirect at boot (fail-soft)', {
      id: activeId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (isSelfEntry) {
    logger.info('Persisted active backend is this machine\u2019s own self entry; using local', {
      id: activeId,
    });
    try {
      await connectionsStore.setActiveId(LOCAL_CONNECTION_ID);
    } catch (error) {
      logger.warn('Failed to persist local active backend for self-entry redirect', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  // Resolve the remote's config + label BEFORE building anything, so a bad
  // record (forgotten remote, missing token) falls back cleanly to local.
  let config: BackendConnectionConfig;
  let meta: { id: string; host: string; port: number } | null;
  let label: string;
  try {
    ({ config, meta } = await buildConfigForConnection(activeId));
    label = await resolveConnectionLabel(activeId);
  } catch (error) {
    logger.warn('Cannot restore persisted remote backend at boot; falling back to local', {
      id: activeId,
      error: error instanceof Error ? error.message : String(error),
    });
    await fallBackToLocalOnBoot(activeId, activeId);
    return;
  }

  // Pin the live client to the remote and attempt a bounded connect. The
  // handshake-labeled `host.status` probe (the same call the heartbeat uses,
  // answered on both transports) resolves once the pinned socket is connected.
  //
  // Dispose any client an EARLIER consumer already lazily built from the
  // local/env default before we got here (the About-panel provider-catalog task
  // races reconciliation and calls `getBackendClient()`). `currentConfig` only
  // steers the NEXT construction — it does not re-target a live client — so
  // without this dispose `getBackendClient()` below would return that stale LOCAL
  // client, the probe would hit local (reporting the remote "reachable" while the
  // live transport is actually local), and `activeId` would stay remote: a split
  // between `getActiveId()` and the real transport. Disposing first forces a
  // fresh client pinned to the remote, making this reconciliation authoritative —
  // it truly swaps the live transport onto the resolved backend.
  disposeBackendClient();
  currentConfig = meta ? config : null;
  activeConnectionMeta = meta;
  // Any protocol mismatch this boot-pinned client's hello latches is boot-origin
  // (advisory only — no modal); a later explicit switch disposes the client,
  // which resets the origin back to 'switch'.
  protocolMismatchOrigin = 'boot';
  logger.info('Restoring last-used remote backend at boot', { id: activeId });
  const reachable = await probeBackendReachable(getBackendClient(), bootReconnectTimeoutMs);
  if (reachable) {
    logger.info('Restored last-used remote backend at boot', { id: activeId });
    // Post-connect candidate-host refresh (#1746); fire-and-forget/fail-soft.
    void refreshRemoteHosts(activeId);
    // The initial application menu was built before reconciliation (local
    // assumed) — rebuild menu items gated on the active backend (#1889).
    app.emit('backend-connection-changed');
    return;
  }

  // Unreachable/timed out: tear the remote client down and fall back to local.
  // A pinned-cert mismatch already surfaced its own blocking modal via the
  // client `error` handler (certMismatchNotified) — skip the redundant notice.
  const certMismatch = certMismatchNotified;
  logger.warn('Last-used remote backend unreachable at boot; falling back to local', {
    id: activeId,
    certMismatch,
  });
  disposeBackendClient();
  currentConfig = null;
  activeConnectionMeta = null;
  await fallBackToLocalOnBoot(activeId, label, certMismatch);
}

/**
 * Fall back to the local sidecar during boot reconciliation: persist
 * `activeId = local` and, unless a cert-mismatch modal already fired, latch the
 * non-blocking boot-fallback notice for the renderer's first list fetch. The
 * store write is fail-soft — a failure must never block startup.
 */
async function fallBackToLocalOnBoot(
  id: string,
  label: string,
  certMismatch = false,
): Promise<void> {
  try {
    await connectionsStore.setActiveId(LOCAL_CONNECTION_ID);
  } catch (error) {
    logger.warn('Failed to persist local active backend at boot fallback', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (!certMismatch) {
    bootFallbackNotice = { id, label };
  }
}

/**
 * Human label for a connection id, for the boot-fallback notice copy. Prefers
 * the stored hostname, then the label, then `host:port`, then the raw id.
 * Fail-soft: any store error yields the id.
 */
async function resolveConnectionLabel(id: string): Promise<string> {
  try {
    const record = (await connectionsStore.list()).find((c) => c.id === id);
    if (!record) return id;
    return record.hostname || record.label || (record.host ? `${record.host}:${record.port}` : id);
  } catch {
    return id;
  }
}

/**
 * Resolve whether a freshly-pinned client can reach its backend within a bounded
 * timeout (T19 boot restore). Issues `host.status` — the transport-agnostic
 * capability probe answered on both UDS and WSS — and races it against the
 * timeout so an unreachable/black-hole remote can never hang boot. Resolves
 * `true` only on a successful response; `false` on rejection or timeout.
 */
function probeBackendReachable(client: JsonRpcClient, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    client.request('host.status', undefined, { timeoutMs }).then(
      () => done(true),
      () => done(false),
    );
  });
}

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
 * Fire-and-forget by design: it must never block or fail a switch. The
 * `host.status` request queues until the fresh socket connects, so awaiting it
 * inline would stall the switch on a slow/unreachable remote — instead the
 * label upgrades asynchronously once the hostname arrives. Any failure
 * (unreachable, malformed result, store write error) is swallowed with a warn;
 * the connection keeps its `host:port` label. Results that arrive after the
 * active connection has switched away are discarded (monorepo#2221).
 */
async function captureRemoteHostname(id: string): Promise<void> {
  try {
    // Snapshot the live client for symmetry with `refreshRemoteHosts` (where
    // awaits precede the request, so the snapshot matters). Here the request
    // is issued synchronously anyway; the real protection against a stale
    // capture is switch serialization plus the id guard below.
    const client = getBackendClient();
    const result = await client.request('host.status');
    const hostname = extractHostname(result);
    // Drop the result when the active connection changed mid-flight — the
    // snapshot client may have answered just before its disposal.
    if (hostname && activeConnectionMeta?.id === id) {
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
 * Pull the local-IP list out of a `server.pairingInfo` result (PROTOCOL §2 —
 * returns `{ token, certFingerprint, port, path, localIps, hostname }`).
 * Returns the non-empty string entries, else `null` when the shape is absent
 * or malformed.
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
 * list tracks the backend's current interfaces on every connect.
 */
async function refreshRemoteHosts(id: string): Promise<void> {
  try {
    // Snapshot the live client BEFORE the first await: a concurrent switch
    // replaces the mutable global client, and querying the NEW backend here
    // would persist another backend's IPs under this record.
    const client = getBackendClient();
    if (!(await connectionsStore.getDetectHosts(id))) return;
    const result = await client.request('server.pairingInfo');
    const ips = extractLocalIps(result);
    // Drop the result when the active connection changed mid-flight — the
    // snapshot client may have answered just before its disposal.
    if (ips && activeConnectionMeta?.id === id) {
      await connectionsStore.setHosts(id, ips);
      await broadcastConnectionsChanged();
    }
  } catch (error) {
    logger.debug('Could not refresh candidate hosts from server.pairingInfo (fail-soft)', {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Whether a stored record is THIS machine's own published self entry: its
 * fingerprint matches the persisted self cert fingerprint (normalized, so the
 * comparison mirrors the store's fingerprint-keyed dedupe). The local
 * pseudo-entry never matches (its fingerprint is null).
 */
function isSelfConnectionRecord(
  record: { fingerprint?: string | null },
  selfFingerprint: string | null,
): boolean {
  if (selfFingerprint === null) return false;
  const key = normalizeFingerprint(record.fingerprint);
  return key !== null && key === selfFingerprint;
}

/**
 * The connections list + persisted and window-scoped selections surfaced to
 * the renderer. The machine's own published self entry is hidden here —
 * connecting to yourself over WSS is meaningless when the same daemon is
 * already reachable as `local` — while the record stays in the store so the
 * keychain reconcile keeps pushing it to the user's OTHER devices (where it
 * must appear). Presentation-only: `getSelfPublishedState` still reports it
 * as published. Fail-soft: a self-fingerprint read error hides nothing.
 */
async function listConnections(
  windowBackendId: string = LOCAL_CONNECTION_ID,
): Promise<ConnectionsListResult> {
  const [connections, activeId, selfFingerprint] = await Promise.all([
    connectionsStore.list(),
    connectionsStore.getActiveId(),
    getStoredSelfFingerprint().catch(() => null),
  ]);
  // Replay any sticky protocol mismatch / auth rejection for the active
  // backend so a renderer that missed the one-shot broadcast (e.g. a window
  // created by a switch after the remote handshake already fired, or a boot
  // into a rejecting remote) still surfaces the advisory / actionable state
  // (cloudlands-fe#823 pattern).
  return {
    connections: connections.filter((c) => !isSelfConnectionRecord(c, selfFingerprint)),
    activeId,
    windowBackendId,
    protocolMismatch: activeProtocolMismatch,
    authRejected: activeAuthRejected,
  };
}

/** Broadcast the current list + selections, tailored to each recipient window. */
async function broadcastConnectionsChanged(): Promise<void> {
  const payload = await listConnections();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    const windowPayload: ConnectionsChangedEvent = {
      ...payload,
      windowBackendId: getBackendIdForWebContents(win.webContents),
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
export async function buildConfigForConnection(id: string): Promise<{
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
  const token = await connectionsStore.getDecryptedToken(id);
  if (!token) {
    throw new Error(`No stored token for connection: ${id}`);
  }
  return {
    config: {
      transport: 'wss',
      host: record.host,
      hosts: record.hosts ?? [record.host],
      port: record.port,
      token,
      fingerprint: record.fingerprint,
    },
    meta: { id, host: record.host, port: record.port },
  };
}

/**
 * Tail of the switch-serialization queue: every switch-affecting operation
 * chains onto it via {@link enqueueSwitchOperation}, so switches run strictly
 * one at a time. {@link performSwitchBackend} has several await points (store
 * reads/writes, window hooks) with module state mutated across them (`client`,
 * `currentConfig`, `activeConnectionMeta`); two interleaved switches could
 * leave the live client pinned to one backend while `activeId` names another,
 * and mislabel records via `captureRemoteHostname` (monorepo#2221). Always a
 * settled-or-pending promise that never rejects — a failed switch must not
 * poison subsequent switches.
 */
let switchQueue: Promise<void> = Promise.resolve();

/**
 * Run `fn` serialized with every backend switch (monorepo#2228). Beyond plain
 * switches, the `connections:forget` / `connections:add` handlers and
 * {@link switchToLocalAndSpawn} make read-decide-switch decisions on
 * `getActiveId()`; reading the active id OUTSIDE the queue and then
 * conditionally switching was a TOCTOU — a concurrent switch could land
 * between the read and the enqueued switch, making the decision stale (e.g.
 * forget's fall-back-to-local disconnecting a backend the user just selected).
 * Enqueuing the whole read-decide-switch sequence makes the decision atomic
 * with respect to switches.
 *
 * Inside `fn`, perform switches by calling `performSwitchBackend` DIRECTLY —
 * anything that enqueues (calling {@link switchBackend},
 * {@link switchToLocalAndSpawn}, or a nested `enqueueSwitchOperation`) would
 * chain onto the queue tail behind the currently-running `fn` and
 * self-deadlock. The returned promise settles with `fn`'s outcome; a rejection
 * propagates to the caller but never poisons the queue (the tail swallows it).
 */
function enqueueSwitchOperation<T>(fn: () => Promise<T>): Promise<T> {
  const result = switchQueue.then(fn);
  switchQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Switch the live backend to `id` with a clean full teardown + reload:
 *   1. Resolve+validate the target config first (throws early on a bad id/token,
 *      leaving the current backend untouched).
 *   2. **Dispose the previous client and all its subscriptions BEFORE** the new
 *      target connects — no leaked socket/timers/listeners (spec acceptance:
 *      "fully disconnects the old daemon ... before connecting the new one").
 *   3. Capture + close the outgoing backend's windows while they are still live
 *      (T4 `captureAndClose`), then flip the store's active id and build+start
 *      the new client so every `getBackendClient()` caller and the status menu
 *      see the new target.
 *   4. Restore the incoming backend's windows (T4 `restore`) — after the client
 *      swap, so restored windows reconnect to the new daemon (or open fresh).
 *   5. Broadcast the changed list/active selection.
 *
 * Invocations are serialized through {@link enqueueSwitchOperation}: each
 * switch runs to completion before the next begins, so overlapping switches
 * (e.g. the user clicks a slow backend, then quickly clicks another) can never
 * interleave across the await points above. Serialization covers every entry
 * point — the `connections:switch` handler, the `connections:forget`
 * fall-back-to-local, the `connections:add` switch-to-itself, and
 * {@link switchToLocalAndSpawn} — the latter three enqueue their whole
 * read-decide-switch sequence so the `getActiveId()` decision cannot go stale
 * behind an in-flight switch (monorepo#2228).
 */
export function switchBackend(id: string): Promise<SwitchConnectionResult> {
  return enqueueSwitchOperation(() => performSwitchBackend(id));
}

/** Connect one pooled backend and open/focus its windows without switching the app. */
export function openBackendWindow(id: string): Promise<OpenConnectionResult> {
  return enqueueSwitchOperation(() => performOpenBackendWindow(id));
}

async function performOpenBackendWindow(id: string): Promise<OpenConnectionResult> {
  const target = await connectBackendClient(id);
  try {
    // Do not create a renderer until the pinned transport has completed an
    // authenticated request. A cert/token failure rejects this remote only.
    await target.request('host.status');
    await windowHooks.openOrFocus?.(id);
    return { id };
  } catch (error) {
    if (target !== client) disconnectBackendClient(id);
    throw error;
  }
}

/**
 * The actual switch orchestration; only ever entered from within a serialized
 * {@link enqueueSwitchOperation} critical section (via {@link switchBackend}
 * or an enqueued read-decide-switch sequence).
 */
async function performSwitchBackend(id: string): Promise<SwitchConnectionResult> {
  const fromId = await connectionsStore.getActiveId();
  // (1) Validate + resolve BEFORE any teardown.
  const { config, meta } = await buildConfigForConnection(id);

  // captureAndClose sets the window-all-closed teardown guard partway through
  // (after saving sessions, before the destroy loop); restore clears it at its
  // top. A throw from anywhere in between — including from captureAndClose
  // itself after the flag is set — would leak the guard and suppress
  // window-all-closed handling for the rest of the session, so the finally
  // re-clears it (idempotent — a no-op when unset or already cleared).
  try {
    // (2) Capture + close the outgoing backend's windows while they're still live.
    await windowHooks.captureAndClose(fromId);

    // (2.5) Cancel + notify any in-flight `host.execStream` while the old client is
    // still connected. Its per-call subscription is bound to the client we are
    // about to dispose (it could not be migrated onto a stable forwarder like the
    // T8/T9 long-lived listeners), so without this the consumer's `done` would
    // hang on remaining output and an exit frame that can never arrive. This
    // best-effort cancels on the old daemon, then hands each consumer a terminal
    // cancelled-by-backend-switch frame — issue #1616. Runs BEFORE dispose.
    await cancelInflightHostExecStreamsForBackendSwitch(client ?? undefined);

    // (3) Dispose the previous client + subscriptions before connecting the new one.
    disposeBackendClient();

    // (4) Persist the new active target and build the new client.
    await connectionsStore.setActiveId(id);
    currentConfig = meta ? config : null; // null => local/env default on next build
    activeConnectionMeta = meta;
    getBackendClient(); // constructs, wires, and starts the new client

    // The new client's first connect is a plain `connected`, not a `reconnected`,
    // so its own `reconnected` event will not fire on this initial connect. Nudge
    // the stable forwarder once here so main-process services (attached via
    // onBackendReconnected) replay their `events.subscribe` calls against the new
    // client — their requests queue until the fresh socket connects (T8).
    backendReconnectForwarder.emit('reconnected', id);

    // (4.5) Label the remote by its hostname once it connects (T14). Reuses the
    // live client's `host.status`; fire-and-forget so a slow/unreachable remote
    // never stalls the switch — the label upgrades from `host:port` to
    // `hostname (host:port)` asynchronously. Skipped for the local sidecar (UDS
    // has no remote hostname to show; its label is fixed). The candidate-host
    // refresh (#1746) piggybacks on the same post-connect window, equally
    // fire-and-forget/fail-soft.
    if (meta) {
      void captureRemoteHostname(id);
      void refreshRemoteHosts(id);
    }

    // (5) Restore the incoming backend's windows (now targeting the new daemon).
    await windowHooks.restore(id);
  } finally {
    try {
      await windowHooks.clearTeardownGuard?.();
    } catch {
      // Best-effort: a throw from a finally would replace the in-flight
      // exception, so a rejection here (e.g. the default hook's dynamic
      // import) must never mask the original switch error.
    }
  }

  // (6) Notify the renderer, and the main process (menu items gated on the
  // active backend, e.g. Help ▸ Sample intentd Process on win32 — #1889).
  await broadcastConnectionsChanged();
  app.emit('backend-connection-changed');
  return { activeId: id };
}

/**
 * Spawn the app-managed sidecar on demand (#439 fallback). Probes the live
 * client's transport first — the on-demand sidecar always binds the local UDS
 * socket, so a WS/TCP client would keep reconnecting to its original target and
 * never reach the daemon we spawned, stranding the renderer on a pending spawn.
 * On a successful spawn, re-broadcast the current status so the reconnect UI
 * updates while the JsonRpcClient's ≤5s reconnect loop picks up the new socket.
 *
 * Extracted from the `backend:spawn-sidecar` handler so {@link switchToLocalAndSpawn}
 * can reuse the exact same spawn semantics after flipping the active backend to
 * local (the switch makes the transport `uds`, so the guard then passes).
 */
async function performSpawnSidecar(): Promise<{
  ok: boolean;
  spawned: boolean;
  reason?: string;
  error?: unknown;
}> {
  try {
    const transport = getBackendClient().getConfig().transport;
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
      // daemon is serving and broadcasts `backend:status` as usual.
      const client = getBackendClient();
      broadcast(BACKEND.STATUS, {
        status: client.getStatus(),
        transport: formatTransportInfo(client.getConfig(), getPinnedVersion()),
        reconnectAttempts: client.getReconnectAttempts(),
      });
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
      listRespondingAgents: () => listRespondingAgents(getBackendClient()),
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
      const client = getBackendClient();
      broadcast(BACKEND.STATUS, {
        status: client.getStatus(),
        transport: formatTransportInfo(client.getConfig(), getPinnedVersion()),
        reconnectAttempts: client.getReconnectAttempts(),
      });
    }
    return result;
  } catch (error) {
    return { ok: false, spawned: false, error: toErrorPayload(error) };
  }
}

/**
 * Atomic "Start local intentd" recovery from external/remote mode (T22 review):
 * switch the active backend to local AND spawn the app-managed sidecar in a
 * SINGLE main-process action.
 *
 * Why this must live wholly in main: {@link switchBackend} captures-and-closes
 * every window (destroying the renderer that initiated recovery) BEFORE the
 * switch IPC resolves, so a renderer that switched-to-local and then separately
 * dispatched the spawn could be torn down before the second step ran — leaving
 * the user on a fresh local window with intentd never started. Keeping both steps
 * here makes recovery independent of the initiating renderer's survival.
 *
 * Order matters: switch to local FIRST so the live transport becomes the local
 * UDS socket, THEN spawn — {@link performSpawnSidecar}'s uds guard only passes
 * once the switch has re-targeted the client. Already-local is a no-op switch
 * (just spawn), mirroring the renderer's prior guard. The active-id read and
 * the conditional switch are enqueued as ONE critical section so the no-op
 * decision cannot go stale behind a concurrent switch (monorepo#2228); the
 * spawn itself stays outside the queue.
 */
export async function switchToLocalAndSpawn(): Promise<{
  ok: boolean;
  spawned: boolean;
  reason?: string;
  error?: unknown;
}> {
  try {
    await enqueueSwitchOperation(async () => {
      const activeId = await connectionsStore.getActiveId();
      if (activeId !== LOCAL_CONNECTION_ID) {
        await performSwitchBackend(LOCAL_CONNECTION_ID);
      }
    });
  } catch (error) {
    // A switch failure still lets us attempt the spawn (main may already be
    // targeting local); surface nothing here — performSpawnSidecar reports its
    // own outcome and the connections slice carries any switch error.
    logger.warn('Switch to local before sidecar spawn failed; attempting spawn anyway', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return performSpawnSidecar();
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
    const transport = formatTransportInfo(client.getConfig(), getPinnedVersion());
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

  // Atomic recovery: switch active → local AND spawn the sidecar in one main-side
  // action so it survives the initiating window's teardown during the switch.
  ipcMain.handle(BACKEND.SWITCH_LOCAL_AND_SPAWN, async () => switchToLocalAndSpawn());

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
        transport: formatTransportInfo(instance.getConfig(), getPinnedVersion()),
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
        transport: formatTransportInfo(instance.getConfig(), getPinnedVersion()),
        reconnectAttempts: instance.getReconnectAttempts(),
      },
      LOCAL_CONNECTION_ID,
    );
  });

  registerConnectionsHandlers();

  // Keychain sync (T3): opt-in pref-gated, fail-soft, fully async. When a
  // reconcile pulls remote changes into the store, refresh every renderer via
  // the existing connections:changed broadcast. Availability changes push
  // connections:sync-status-changed so the settings UI stays live (T4).
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
  // token/fingerprint/label in place. If the upserted record is the ACTIVE
  // backend, rebuild the live client via a switch to itself so the refreshed
  // token takes effect immediately without closing any windows, and report
  // `switched: true` for compatibility; otherwise invalidate only that remote's
  // secondary pool entry. The whole
  // add + active-id read + conditional switch is ONE enqueued critical
  // section (monorepo#2228): a stale pre-queue read could re-switch back to
  // this record after the user had already selected another backend.
  ipcMain.handle(
    CONNECTIONS.ADD,
    createValidatedHandler(
      ConnectionsAddSchema,
      async (_event, params) =>
        enqueueSwitchOperation(async () => {
          const connection = await connectionsStore.add(params);
          const activeId = await connectionsStore.getActiveId();
          if (connection.id === activeId) {
            // Refresh an active target's credentials without destroying any
            // windows. The caller opens/focuses it through connections:open.
            const { config, meta } = await buildConfigForConnection(connection.id);
            disposeBackendClient();
            currentConfig = meta ? config : null;
            activeConnectionMeta = meta;
            getBackendClient();
            await broadcastConnectionsChanged();
            return { connection, switched: true } satisfies AddConnectionResult;
          }
          // Re-pairing a secondary remote invalidates only that pool entry; the
          // local primary and every other backend remain connected.
          disconnectBackendClient(connection.id);
          await broadcastConnectionsChanged();
          return { connection, switched: false } satisfies AddConnectionResult;
        }),
      CONNECTIONS.ADD,
    ),
  );

  // Open or focus one backend without changing activeId or tearing down any
  // other backend's windows/client. The authenticated probe rejects before a
  // window is created when the saved token or certificate is invalid.
  ipcMain.handle(
    CONNECTIONS.OPEN,
    createValidatedHandler(
      ConnectionsOpenSchema,
      async (_event, { id }) => openBackendWindow(id),
      CONNECTIONS.OPEN,
    ),
  );

  // Forget a remote connection. Close and disconnect only that backend. If it
  // also owns the compatibility client, retarget that client to local without
  // disturbing windows belonging to any other backend.
  // The active-id read + forget + conditional fallback is ONE enqueued
  // critical section (monorepo#2228): a stale pre-queue read could take the
  // fall-back-to-local after a concurrent switch had already landed on another
  // backend, disconnecting the backend the user just selected.
  ipcMain.handle(
    CONNECTIONS.FORGET,
    createValidatedHandler(
      ConnectionsForgetSchema,
      async (_event, { id }) =>
        enqueueSwitchOperation(async () => {
          const wasActive = (await connectionsStore.getActiveId()) === id;
          // Forgetting this machine's own published entry is a local
          // unpublish: set the persistent "do not auto-publish" marker so the
          // originator honors the removal and never silently re-asserts
          // (spec "Forget = fingerprint-keyed tombstone"). Cleared only by an
          // explicit re-publish. The fingerprint match is resolved BEFORE the
          // forget (the record is still readable), but the marker is set only
          // AFTER the forget succeeds — latching it first would leave a
          // published entry with refresh-self permanently disabled if the
          // forget throws. Fail-soft on any lookup error.
          let forgetsSelf = false;
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
          await connectionsStore.forget(id); // rejects the reserved local id
          if (forgetsSelf) await setAutoPublishSuppressed(true);
          const targetClient = backendClients.get(id);
          const retargetedPrimary =
            wasActive && (targetClient === client || activeConnectionMeta?.id === id);
          if (retargetedPrimary) {
            disposeBackendClient();
            currentConfig = null;
            activeConnectionMeta = null;
            getBackendClient();
            backendReconnectForwarder.emit('reconnected', LOCAL_CONNECTION_ID);
            app.emit('backend-connection-changed');
          }
          // If the forgotten backend owns every live window, create/focus local
          // before destroying any of them. This prevents window-all-closed from
          // entering the quit/session-clear path between teardown and fallback.
          await windowHooks.ensureLocalWindowBeforeClose?.(id);
          await windowHooks.closeForBackend?.(id);
          if (!retargetedPrimary) disconnectBackendClient(id);
          await broadcastConnectionsChanged();
          return { id } satisfies ForgetConnectionResult;
        }),
      CONNECTIONS.FORGET,
    ),
  );

  // Switch the live backend (full teardown + reload; see `switchBackend`).
  ipcMain.handle(
    CONNECTIONS.SWITCH,
    createValidatedHandler(
      ConnectionsSwitchSchema,
      async (_event, { id }) => switchBackend(id),
      CONNECTIONS.SWITCH,
    ),
  );

  // Pull the one-shot boot-restore fallback notice (T19), consume-once. The
  // renderer fetches this once on mount and surfaces a non-blocking toast; the
  // fallback happens before any window exists, so the notice is latched at boot
  // and delivered here on demand rather than pushed live. No params.
  ipcMain.handle(CONNECTIONS.GET_BOOT_FALLBACK, async () => {
    const bootFallback = bootFallbackNotice;
    bootFallbackNotice = null;
    return { bootFallback };
  });

  // Keychain sync settings surface (T4): read the opt-in pref + last-known
  // availability, and flip the pref. Enabling requests an immediate reconcile
  // so the settings UI gets a live availability verdict; disabling stops sync
  // but never touches existing keychain items.
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
 * Resolve a client guaranteed to target the LOCAL daemon: the pooled local
 * member when one is connected, else the compatibility client when no remote
 * is active (lazily created — the standard handler path). `null` when the
 * whole app is pinned to a remote and no local pool member exists —
 * `server.pairingInfo` is local-only (UDS; PROTOCOL §5), so there is no
 * client that could answer it.
 */
function getLocalClientForSelfPublish(): JsonRpcClient | null {
  const pooled = backendClients.get(LOCAL_CONNECTION_ID);
  if (pooled) return pooled;
  return activeConnectionMeta === null ? getBackendClient() : null;
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
 * no routable local IP to publish.
 */
async function publishSelfBackend(): Promise<PublishSelfResult> {
  const localClient = getLocalClientForSelfPublish();
  if (!localClient) {
    throw new Error('publish-self failed: local backend is not connected (remote backend active)');
  }
  const info = extractSelfPairingInfo(await localClient.request('server.pairingInfo'));
  if (!info) {
    throw new Error('publish-self failed: malformed server.pairingInfo result');
  }
  if (info.port === null) {
    throw new Error('publish-self failed: the WebSocket API is not enabled');
  }
  if (!info.localIps[0]) {
    throw new Error('publish-self failed: no routable local IP to publish');
  }
  const record = await upsertSelfRecord({ ...info, port: info.port });
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
 * token, detectHosts on). The store dedupes by fingerprint — a host/port
 * change collapses into the existing record with a fresh `updatedAt` — and
 * the mutation triggers the keychain reconcile push. Callers must have
 * validated `port` and `localIps[0]` as non-null.
 */
async function upsertSelfRecord(
  info: SelfPairingInfo & { port: number },
): Promise<ConnectionRecord> {
  const host = info.localIps[0];
  const label = info.prettyHostname ?? info.hostname ?? `${host}:${info.port}`;
  const record = await connectionsStore.add({
    label,
    host,
    port: info.port,
    fingerprint: info.certFingerprint,
    token: info.token,
    detectHosts: true,
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
 * incomplete (WSS off, no routable IP) it is a no-op (`refreshed: false`).
 * Unlike publish it NEVER sets or clears the suppression marker — refreshing
 * is not user intent to (re-)publish.
 */
async function refreshSelfBackend(): Promise<RefreshSelfResult> {
  if (await isAutoPublishSuppressed()) {
    return { refreshed: false } satisfies RefreshSelfResult;
  }
  const localClient = getLocalClientForSelfPublish();
  if (!localClient) {
    return { refreshed: false } satisfies RefreshSelfResult;
  }
  let info: ReturnType<typeof extractSelfPairingInfo>;
  try {
    info = extractSelfPairingInfo(await localClient.request('server.pairingInfo'));
  } catch (error) {
    logger.debug('Could not refresh the self entry from server.pairingInfo (fail-soft)', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { refreshed: false } satisfies RefreshSelfResult;
  }
  if (!info || info.port === null || !info.localIps[0]) {
    return { refreshed: false } satisfies RefreshSelfResult;
  }
  // Only refresh an entry that is actually published: a stored record whose
  // fingerprint matches the persisted self fingerprint or the live one.
  const [records, storedFingerprint] = await Promise.all([
    connectionsStore.list(),
    getStoredSelfFingerprint(),
  ]);
  const liveFingerprint = normalizeFingerprint(info.certFingerprint);
  const selfKeys = new Set(
    [storedFingerprint, liveFingerprint].filter((key): key is string => key !== null),
  );
  const published = records.some((c) => {
    const key = normalizeFingerprint(c.fingerprint);
    return key !== null && selfKeys.has(key);
  });
  if (!published) {
    return { refreshed: false } satisfies RefreshSelfResult;
  }
  await upsertSelfRecord({ ...info, port: info.port });
  await setStoredSelfFingerprint(info.certFingerprint);
  await broadcastConnectionsChanged();
  return { refreshed: true } satisfies RefreshSelfResult;
}

/**
 * `connections:self-published-state`: whether a self entry exists (a stored
 * record whose fingerprint matches the persisted self fingerprint OR the live
 * local daemon's cert fingerprint) and whether the persistent "do not
 * auto-publish" marker is set. The live `server.pairingInfo` probe is
 * fail-soft — when the local daemon is unreachable (or the app is pinned to a
 * remote), detection falls back to the persisted fingerprint alone.
 */
async function getSelfPublishedState(): Promise<SelfPublishedStateResult> {
  const [records, storedFingerprint, suppressed] = await Promise.all([
    connectionsStore.list(),
    getStoredSelfFingerprint(),
    isAutoPublishSuppressed(),
  ]);
  let liveFingerprint: string | null = null;
  const localClient = getLocalClientForSelfPublish();
  if (localClient) {
    try {
      const info = extractSelfPairingInfo(await localClient.request('server.pairingInfo'));
      liveFingerprint = normalizeFingerprint(info?.certFingerprint ?? null);
    } catch {
      // Fail-soft: the persisted fingerprint still detects the self entry.
    }
  }
  const selfKeys = new Set(
    [storedFingerprint, liveFingerprint].filter((key): key is string => key !== null),
  );
  const selfRecord =
    selfKeys.size > 0
      ? records.find((c) => {
          const key = normalizeFingerprint(c.fingerprint);
          return key !== null && selfKeys.has(key);
        })
      : undefined;
  return {
    published: selfRecord !== undefined,
    suppressed,
    selfConnectionId: selfRecord?.id ?? null,
  } satisfies SelfPublishedStateResult;
}

/** Dispose the shared client (used on shutdown and backend switch). */
export function disposeBackendClient(): void {
  // The next client is switch-origin unless the boot-restore path re-tags it
  // (see {@link protocolMismatchOrigin}).
  protocolMismatchOrigin = 'switch';
  if (client) {
    const primaryBackendId = getPrimaryBackendId();
    disposeTransferConnectionsForBackend(primaryBackendId);
    void cancelInflightHostExecStreamsForBackendSwitch(client);
    for (const [id, instance] of backendClients) {
      if (instance === client) backendClients.delete(id);
    }
    client.dispose();
  }
  client = null;
}
