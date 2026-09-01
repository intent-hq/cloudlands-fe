/**
 * Multi-backend connect — shared IPC contract (main ⇄ preload ⇄ renderer).
 *
 * Single source of truth for the "Connect to another intentd" feature: the
 * renderer-facing connection record, the active-backend view, the IPC channel
 * names, and the per-channel param/result/event payload types. Both tracks
 * import from here — main IPC (T3), renderer slice (T5), and menu/modals UI
 * (T6) MUST consume these types rather than redeclaring them.
 *
 * Token boundary: the bearer token is main-only (encrypted at rest via
 * Electron `safeStorage`, see `connections-store.ts`). It NEVER appears on any
 * stored, listed, or broadcast connection shape. The only place a token
 * crosses the IPC boundary is renderer→main at add/capture/rotation time,
 * where the user has just typed it — it is consumed by main and never returned.
 *
 * `ConnectionRecord` here is structurally identical to the token-free record
 * returned by `connections-store.ts` (`list()`), so main can pass the store's
 * output straight across IPC and the renderer consumes the same shape.
 *
 * This module is dependency-light (only the channel-name registry) so it is
 * safe to import from the renderer and preload as well as main.
 */

import { IPC_CHANNELS } from '../ipc-registry';

// ============================================================================
// Channel names
// ============================================================================

/** Request/response channel names for the connections feature. */
export const CONNECTION_CHANNELS = IPC_CHANNELS.CONNECTIONS;

/**
 * Push-event channel names (main → renderer). Mirrored as literals in
 * `EVENT_CHANNELS` (ipc-registry.ts) so the preload allow-list includes them.
 */
export const CONNECTIONS_CHANGED_EVENT = 'connections:changed';
export const CONNECTION_CERT_MISMATCH_EVENT = 'connections:cert-mismatch';
export const CONNECTION_CERT_WARNINGS_EVENT = 'connections:cert-warnings';
export const CONNECTION_PROTOCOL_MISMATCH_EVENT = 'connections:protocol-mismatch';
export const CONNECTION_AUTH_REJECTED_EVENT = 'connections:auth-rejected';
export const KEYCHAIN_SYNC_STATUS_EVENT = 'connections:sync-status-changed';

/**
 * Reserved id for the always-present, non-forgettable local sidecar entry
 * ("This machine (local)"). Matches `LOCAL_CONNECTION_ID` in
 * `connections-store.ts`.
 */
export const LOCAL_CONNECTION_ID = 'local';

/** Stable semantic identifiers accepted from persisted and synced connection records. */
export const CONNECTION_ACCENTS = [
  'blue',
  'indigo',
  'violet',
  'rose',
  'orange',
  'emerald',
  'teal',
] as const;

export type ConnectionAccentName = (typeof CONNECTION_ACCENTS)[number];

/** Accents offered for new selections; legacy indigo, rose, and orange values remain valid above. */
export const SELECTABLE_CONNECTION_ACCENTS: readonly ConnectionAccentName[] =
  CONNECTION_ACCENTS.filter((accent) => !['indigo', 'rose', 'orange'].includes(accent));

/** A named palette accent, or an explicit request for no accent. */
export type ConnectionAccent = ConnectionAccentName | null;

/** Deterministic fallback for records written before accent metadata existed. */
export const DEFAULT_CONNECTION_ACCENT: ConnectionAccentName = 'blue';

/** Transient state derived only from an already-created backend client. */
export type ConnectionOpenStatus = 'connecting' | 'connected' | 'disconnected' | 'not-open';

export function isConnectionAccent(value: unknown): value is ConnectionAccent {
  return (
    value === null ||
    (typeof value === 'string' && (CONNECTION_ACCENTS as readonly string[]).includes(value))
  );
}

// ============================================================================
// Core types
// ============================================================================

/**
 * A connection as surfaced to the renderer. NEVER carries the bearer token.
 *
 * The synthesized local sidecar entry (`id === LOCAL_CONNECTION_ID`) has
 * `isLocal: true` and null `host`/`port`/`fingerprint` (UDS carries no
 * IP/port/cert). Remote connections have all three populated.
 *
 * Structurally identical to `ConnectionRecord` in `connections-store.ts`.
 */
export interface ConnectionRecord {
  id: string;
  label: string;
  /** Palette-backed remote identity accent; missing is legacy, `null` is explicitly blank. */
  accent?: ConnectionAccent;
  /** Remote host/IP; `null` for the local UDS entry. */
  host: string | null;
  /**
   * Candidate hosts for the remote (primary/user-entered host first, then any
   * additional IPs reported by the backend via `server.pairingInfo`). Every
   * (re)connect tries all candidates so a backend whose IP changed stays
   * reachable (#1746). Always contains `host` when populated; `null` for the
   * local UDS entry. Optional so pre-existing fixtures/records remain valid —
   * absent is equivalent to `[host]`.
   */
  hosts?: string[] | null;
  /** Remote port; `null` for the local UDS entry. */
  port: number | null;
  /** Pinned self-signed cert fingerprint, SHA-256 colon-hex (PROTOCOL §1.2); `null` for local. */
  fingerprint: string | null;
  /**
   * tc address of the remote daemon's tailcat tunnel endpoint (PROTOCOL §12.3;
   * pairing URI `tc=` / `system.status.tcAddress`), captured at add time and
   * refreshed after each successful connect. When present, every (re)connect
   * adds a tunnel candidate to the host race so the backend stays reachable
   * with no directly routable host. `null`/absent when the daemon has no
   * tunnel configured (or predates the field). Never set for the local entry.
   */
  tcAddress?: string | null;
  /**
   * The remote machine's hostname (from `host.status`), captured on the first
   * successful connect so the menu can label a remote as `hostname (host:port)`
   * instead of the raw address. `null`/absent until captured or unavailable —
   * the UI then falls back to `host:port`. Never set for the local entry.
   */
  hostname?: string | null;
  /**
   * The remote daemon's reported version (`server.version` from its
   * `client.hello` handshake, PROTOCOL §5.17), captured on connect and
   * refreshed on every reconnect so the UI can compare it against the app's
   * pinned intentd version. `null`/absent until captured (or for daemons that
   * predate the field). On the synthesized local entry it is populated only
   * in `external` connection mode from the `DaemonVersionInfo` path (absent
   * for the spawned sidecar).
   */
  daemonVersion?: string | null;
  /**
   * Whether the daemon reports self-update support (`updateSupported` from
   * `system.status`), captured after connect and refreshed on every
   * reconnect. `null`/absent = unknown (capture pending, or a daemon too old
   * to report the field) — the UI treats anything but `true` as "do not offer
   * the Update action". On the synthesized local entry it is populated only
   * for an adopted external daemon over UDS (absent for the spawned sidecar).
   */
  updateSupported?: boolean | null;
  /**
   * Per-backend keychain-sync exclusion (spec Phase 2): `true` when the user
   * opted this backend out of iCloud sync at add time, making the record
   * local-only (never pushed to the keychain, never touched by pulls).
   * Optional so pre-existing fixtures/records remain valid — absent is
   * equivalent to `false` (synced). Never set for the local entry.
   */
  syncExcluded?: boolean;
  /** True for the synthesized local sidecar entry. */
  isLocal: boolean;
  /** Present on list/broadcast payloads; never persisted. */
  status?: ConnectionOpenStatus;
  /** From an already-open connected client's `client.hello`; transient and never persisted. */
  intentdVersion?: string;
}

/**
 * `connections:list` result: the full ordered list (local first, then remotes)
 * plus the active selection.
 */
export interface ConnectionsListResult {
  connections: ConnectionRecord[];
  /** Persisted whole-app selection used for boot restore. */
  activeId: string;
  /** Backend bound to the renderer window receiving this payload. */
  windowBackendId: string;
  /**
   * Sticky protocol mismatch for the currently active backend, replayed here so
   * a renderer that missed the one-shot `connections:protocol-mismatch`
   * broadcast (e.g. a window created after the remote handshake already fired)
   * still surfaces the advisory. `null`/absent when the active backend matches
   * local (or is local itself).
   */
  protocolMismatch?: ConnectionProtocolMismatchEvent | null;
  /**
   * Sticky auth rejection for the currently active backend, replayed here so a
   * renderer created or reloaded after the one-shot `connections:auth-rejected`
   * broadcast (including the boot path) still surfaces the actionable
   * "authentication rejected" state. `null`/absent when the active backend's
   * auth is good (or it is local).
   */
  authRejected?: ConnectionAuthRejectedEvent | null;
  /**
   * Sticky cert mismatch for this window's backend, replayed here so a
   * renderer created or reloaded after the one-shot `connections:cert-mismatch`
   * broadcast (e.g. the boot-wide restore connects pooled clients before their
   * windows exist) still surfaces the blocking trust warning. `null`/absent
   * when the backend's pinned cert matches (or it is local).
   */
  certMismatch?: ConnectionCertMismatchEvent | null;
  /**
   * Sticky NON-FATAL per-host cert warnings for this window's backend
   * (latest fingerprint per host, accumulated across reconnect attempts),
   * replayed here so a renderer created after the `connections:cert-warnings`
   * broadcast still surfaces them. `null`/absent when no per-host mismatch
   * has been observed (or the backend is local).
   */
  certWarnings?: ConnectionCertWarningsEvent | null;
  /**
   * The app's pinned intentd version (the `intentd.version` file bundled with
   * the FE), or `null` when the pin is missing/malformed. Carried here so the
   * renderer can compare each remote's captured `daemonVersion` against the
   * version the app expects without a separate channel.
   */
  pinnedVersion?: string | null;
  /**
   * ids of the connections with a live, currently-connected pooled client
   * (includes the local sidecar when its client is up). Refreshed on every
   * pool status transition via a `connections:changed` broadcast so the
   * renderer can gate connected-only actions (the remote Update button).
   * Optional so payloads from an older main process remain valid.
   */
  connectedIds?: string[];
}

/**
 * `connections:capture-fingerprint` params (trust-on-first-use cert capture).
 * Matches the `captureFingerprint({host, port, token})` helper (T1).
 */
export interface CaptureFingerprintParams {
  host: string;
  port: number;
  token: string;
}

/**
 * `connections:capture-fingerprint` result: the presented cert fingerprint
 * plus whether the daemon accepted the bearer token on the capture upgrade —
 * a 401/403 rejection (bad token / WS API disabled, PROTOCOL §2.1) is reported
 * here so the add flow can surface it before the connection is stored.
 */
export interface CaptureFingerprintResult {
  /** SHA-256 cert fingerprint, colon-hex uppercase (PROTOCOL §1.2). */
  fingerprint: string;
  /** `false` when the capture upgrade was rejected with HTTP 401/403. */
  tokenValid: boolean;
  /** HTTP status the upgrade was rejected with when `tokenValid` is false (401 or 403). */
  statusCode?: number;
}

/**
 * `connections:add` params. Carries the token renderer→main so main can
 * encrypt+store it; the token never appears on any returned/stored shape.
 * Field set matches `NewConnection` in `connections-store.ts`.
 */
export interface AddConnectionParams {
  label: string;
  /** Absent callers receive {@link DEFAULT_CONNECTION_ACCENT}; `null` explicitly clears it. */
  accent?: ConnectionAccent;
  host: string;
  port: number;
  fingerprint: string;
  token: string;
  /**
   * tc address from the pairing URI's `tc=` parameter (PROTOCOL §12.3), when
   * the daemon advertises a tailcat tunnel endpoint. Stored on the record so
   * connects can race a tunnel candidate alongside the direct hosts.
   */
  tcAddress?: string;
  /**
   * "Detect all backend IPs" option (#1746), default ON. When enabled, the
   * connection refreshes its candidate-host list from the backend's
   * `server.pairingInfo` after each successful connect; when disabled, only
   * the user-entered host is ever stored (single-host behavior).
   */
  detectHosts?: boolean;
  /**
   * Per-backend keychain-sync opt-out (spec Phase 2): `true` when the user
   * unchecked "Save to iCloud" at add time, storing the record local-only
   * (never pushed to the keychain, never touched by pulls). Absent = `false`
   * (synced).
   */
  syncExcluded?: boolean;
}

/** `connections:add` result: the stored, token-free record. */
export interface AddConnectionResult {
  connection: ConnectionRecord;
  /**
   * `true` when the add re-paired the persisted active backend (kept for wire
   * compatibility). Main rebuilds the pooled client in place for ANY re-paired
   * backend that is live (serving windows) or active, so the refreshed
   * credentials always reach open windows. Either way, callers may follow with
   * `connections:open`; opening never performs a whole-app switch.
   */
  switched: boolean;
}

/** `connections:update` params. Never carries or mutates the bearer token. */
export interface UpdateConnectionParams {
  id: string;
  label: string;
  accent: ConnectionAccent;
  /** Optional for compatibility with presentation-only callers. */
  host?: string;
  /** Must be supplied together with `host`. */
  port?: number;
  /** Explicit user confirmation of a newly presented certificate. */
  confirmedFingerprint?: string;
}

/** Machine-readable validation outcomes; renderer copy is localized by status/reason. */
type ConnectionValidationResult =
  | { status: 'success'; fingerprint: string }
  | { status: 'secret-unavailable' }
  | {
      status: 'fingerprint-confirmation-required';
      expectedFingerprint: string;
      actualFingerprint: string;
    }
  | { status: 'authentication-rejected'; statusCode: number }
  | {
      status: 'failed';
      reason: 'no-certificate' | 'connect-failed' | 'timeout';
      statusCode?: number;
    };

export type ConnectionValidationBlockedResult = Exclude<
  ConnectionValidationResult,
  { status: 'success' }
>;

/** `connections:update` result: either an updated token-free record or validation guidance. */
export type UpdateConnectionResult =
  { status: 'updated'; connection: ConnectionRecord } | ConnectionValidationBlockedResult;

/** Test current unsaved address values with the saved main-process-only secret. */
export interface TestConnectionParams {
  id: string;
  host: string;
  port: number;
  /** Write-only override for this probe; never persisted or returned. */
  token?: string;
}

export type TestConnectionResult = ConnectionValidationResult;

/** Replace a saved secret without ever returning the old or new value. */
export interface RotateConnectionSecretParams {
  id: string;
  token: string;
  /** Explicit user confirmation of a newly presented certificate. */
  confirmedFingerprint?: string;
}

export type RotateConnectionSecretResult =
  { status: 'updated'; connection: ConnectionRecord } | ConnectionValidationBlockedResult;

/** `connections:open` params. */
export interface OpenConnectionParams {
  id: string;
}

/** `connections:open` result: echoes the opened or focused backend id. */
export type OpenConnectionResult =
  { status: 'opened'; id: string } | { status: 'secret-unavailable' };

/** `connections:forget` params. */
export interface ForgetConnectionParams {
  id: string;
}

/** `connections:forget` result: echoes the forgotten id. */
export interface ForgetConnectionResult {
  id: string;
}

/** `connections:update-backend` params. */
export interface UpdateBackendParams {
  id: string;
}

/**
 * `connections:update-backend` result. Structured rather than thrown so the
 * renderer can toast a specific message per failure mode:
 *   - `ok: true`        → `system.requestUpdate` was accepted; the remote's
 *                          sitter will install the newer version and restart
 *                          the daemon (the FE reconnects automatically).
 *   - `'not-connected'` → no live pooled client for that id (saved but
 *                          disconnected remote, or the id is unknown).
 *   - `'unsupported'`   → the daemon rejected the method (JSON-RPC -32601:
 *                          too old to know `system.requestUpdate`) or the id
 *                          was the local entry (never updated this way).
 *   - `'failed'`        → the daemon returned a structured error (e.g. not
 *                          sitter-supervised, non-unix host); `message`
 *                          carries the daemon's error text.
 */
export type UpdateBackendResult =
  | { ok: true }
  | { ok: false; reason: 'not-connected' | 'unsupported' | 'failed'; message?: string };

// ============================================================================
// Push-event payloads (main → renderer)
// ============================================================================

/**
 * `connections:changed` — broadcast after any mutation (add/forget/open) so
 * every window refreshes its list + active selection. Same shape as the
 * `connections:list` result.
 */
export type ConnectionsChangedEvent = ConnectionsListResult;

/**
 * `connections:cert-mismatch` — broadcast when a (re)connect presents a cert
 * whose fingerprint differs from the pinned one. The renderer surfaces a
 * blocking failure modal (no silent re-trust; spec "Trust-on-first-use flow").
 */
export interface ConnectionCertMismatchEvent {
  /** id of the connection whose cert changed. */
  id: string;
  host: string;
  port: number;
  /** The pinned fingerprint we expected. */
  expectedFingerprint: string;
  /** The fingerprint actually presented on this connect. */
  actualFingerprint: string;
  /**
   * Every per-host mismatch the failing multi-host connection race observed
   * (#1746), latest fingerprint per host. Absent/empty for single-host
   * failures raised below the race layer (where the host is not known).
   * Additive — older payloads omit it.
   */
  mismatches?: ConnectionHostCertWarning[];
}

/**
 * One observed per-host certificate-pin mismatch, as surfaced to the renderer.
 * Mirrors `HostCertMismatch` in `backend-connection.ts` (main-only module)
 * with the fingerprint fields renamed to match the sibling connection events.
 */
export interface ConnectionHostCertWarning {
  /** Candidate host that presented the mismatching certificate. */
  host: string;
  /** The pinned fingerprint we expected (colon-hex uppercase). */
  expectedFingerprint: string;
  /** The fingerprint that host actually presented (colon-hex uppercase). */
  actualFingerprint: string;
}

/**
 * `connections:cert-warnings` — broadcast whenever the set of NON-FATAL
 * per-host cert mismatches observed for a connection changes. The multi-host
 * connection race (#1746) can connect successfully through one candidate while
 * another candidate presents a foreign pinned cert; each such observation is
 * accumulated per host (latest fingerprint per host, across reconnect
 * attempts) and pushed here. Unlike {@link ConnectionCertMismatchEvent}, this
 * NEVER blocks the connection — it is informative only. An empty `warnings`
 * array is broadcast when the set is cleared (fresh client for the id).
 */
export interface ConnectionCertWarningsEvent {
  /** id of the connection the warnings belong to. */
  id: string;
  /** Observed per-host mismatches, latest fingerprint per host. */
  warnings: ConnectionHostCertWarning[];
}

/**
 * `connections:auth-rejected` — broadcast when a remote backend rejects the
 * WebSocket upgrade with HTTP 401/403 (bad/rotated token, or the WS API is
 * disabled — PROTOCOL §2.1). Distinct from a transient transport error so the
 * renderer can surface "authentication rejected" instead of silently retrying.
 */
export interface ConnectionAuthRejectedEvent {
  /** id of the connection whose auth was rejected. */
  id: string;
  host: string;
  port: number;
  /** HTTP status the upgrade was rejected with (401 or 403). */
  statusCode: number;
}

/**
 * `connections:protocol-mismatch` — broadcast when a remote backend's
 * `protocolVersion` (from its `client.hello` handshake) differs in **major
 * version** from the local intentd's. Warn-but-allow: the connection still
 * proceeds; the renderer surfaces a non-blocking advisory modal on first
 * connect and a persistent warning in the daemon-status menu. Unlike
 * {@link ConnectionCertMismatchEvent}, this NEVER blocks the connection.
 */
export interface ConnectionProtocolMismatchEvent {
  /** id of the connection whose protocol differs. */
  id: string;
  host: string;
  port: number;
  /** The local (bundled sidecar) intentd's protocolVersion. */
  localProtocolVersion: string;
  /** The remote daemon's reported protocolVersion. */
  remoteProtocolVersion: string;
  /**
   * Which flow detected the mismatch. `'boot'` when it was latched while boot
   * reconciliation restored a persisted remote — the renderer suppresses the
   * advisory modal (the user did not just initiate a connect) and keeps the
   * persistent menu warning. `'switch'` (or absent, for older payloads) for a
   * user-initiated connect — modal-worthy ('switch' is the legacy wire value,
   * kept for compatibility). Carried on the sticky `connections:list` replay
   * too. Additive.
   */
  origin?: 'boot' | 'switch';
}

// ============================================================================
// iCloud-keychain backend sync (T4 settings UI)
// ============================================================================

/**
 * Why the keychain cannot be used. Mirrors `HelperErrorCode` in
 * `features/backend/main/keychain-sync.ts` (main-only module; renderer code
 * must not import it, so the union is restated here as the wire shape).
 */
type KeychainSyncUnavailableReason =
  | 'unsupported-platform'
  | 'helper-missing'
  | 'helper-failed'
  | 'unavailable'
  | 'not-found'
  | 'bad-arguments'
  | 'keychain-error';

/**
 * Sync availability as surfaced to the renderer — structurally identical to
 * `KeychainSyncStatus` in `keychain-sync.ts`, so main passes the reconcile
 * status straight across IPC. Also the `connections:sync-status-changed`
 * push payload.
 */
export type KeychainSyncUiStatus =
  | { state: 'active'; errorCount?: number }
  | { state: 'unavailable'; reason: KeychainSyncUnavailableReason; message: string };

/** Result of `connections:sync-get-state` / `connections:sync-set-enabled`. */
export interface KeychainSyncStateResult {
  /** True only on macOS — elsewhere the toggle renders disabled. */
  supported: boolean;
  /** The opt-out local pref (per-machine; absent = ON on macOS, explicit false = OFF). */
  enabled: boolean;
  /** Last completed reconcile's availability; null before the first run. */
  status: KeychainSyncUiStatus | null;
}

/** Params for `connections:sync-set-enabled`. */
export interface SetKeychainSyncEnabledParams {
  enabled: boolean;
}

// ============================================================================
// Self-publish (publish THIS machine's backend to the synced registry)
// ============================================================================

/**
 * `connections:publish-self` result. Main queries `server.pairingInfo` over
 * the LOCAL client itself, builds the record (label = hostname, host = first
 * local IP, port = bound wsApi port, fingerprint = cert fingerprint, token —
 * main-only), and upserts it into the connections store; the store→keychain
 * reconcile then pushes it to the user's other devices. The bearer token
 * never appears here — only the stored, token-free record.
 */
export interface PublishSelfResult {
  /** The created/updated token-free record for this machine's backend. */
  connection: ConnectionRecord;
}

/**
 * `connections:self-published-state` result — gates the publish/removal
 * modals and the explicit re-publish button (spec "Decisions").
 */
export interface SelfPublishedStateResult {
  /**
   * Whether a self entry currently exists in the connections store: a record
   * whose fingerprint matches the persisted self fingerprint or the live
   * local daemon's cert fingerprint.
   */
  published: boolean;
  /**
   * Whether auto-publish offers are suppressed: the persistent "do not
   * auto-publish" marker set when this machine's entry was forgotten
   * elsewhere (tombstone honored) or unpublished locally. Cleared only by an
   * explicit `connections:publish-self`.
   */
  suppressed: boolean;
  /**
   * The stored self entry's record id when `published` is true (the removal
   * modal forgets it through the standard `connections:forget` path); null
   * when no self entry exists.
   */
  selfConnectionId: string | null;
}

/**
 * `connections:refresh-self` result. Fired after a local change to the
 * published self entry's fields (token rotation, WSS port change) so the
 * stored record — and via keychain sync, the user's other devices — picks up
 * the new values. `refreshed` is `false` when the refresh was a no-op: no
 * published self entry exists, the "do not auto-publish" marker is set, the
 * app is pinned to a remote, or the local pairing info is unavailable. The
 * refresh never sets or clears the suppression marker.
 */
export interface RefreshSelfResult {
  /** Whether the stored self entry was actually re-upserted. */
  refreshed: boolean;
}

/**
 * `connections:unpublish-self` result. Removes this machine's published self
 * entry — the stored record whose fingerprint matches the persisted self
 * fingerprint — through the standard forget/teardown path (tombstone
 * included, so keychain sync propagates the deletion) WITHOUT setting the
 * "do not auto-publish" marker: unlike forgetting the self entry via
 * `connections:forget`, auto-publish offers stay allowed afterwards.
 */
export interface UnpublishSelfResult {
  /** Whether a stored self entry existed and was removed (`false` = no-op). */
  removed: boolean;
}
