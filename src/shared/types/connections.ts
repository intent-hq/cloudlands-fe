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
 * crosses the IPC boundary is renderer→main at add/capture time
 * (`CaptureFingerprintParams`, `AddConnectionParams`), where the user has just
 * typed it — it is consumed by main and never returned.
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
export const CONNECTION_PROTOCOL_MISMATCH_EVENT = 'connections:protocol-mismatch';
export const CONNECTION_AUTH_REJECTED_EVENT = 'connections:auth-rejected';

/**
 * Reserved id for the always-present, non-forgettable local sidecar entry
 * ("This machine (local)"). Matches `LOCAL_CONNECTION_ID` in
 * `connections-store.ts`.
 */
export const LOCAL_CONNECTION_ID = 'local';

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
   * The remote machine's hostname (from `host.status`), captured on the first
   * successful connect so the menu can label a remote as `hostname (host:port)`
   * instead of the raw address. `null`/absent until captured or unavailable —
   * the UI then falls back to `host:port`. Never set for the local entry.
   */
  hostname?: string | null;
  /** True for the synthesized local sidecar entry. */
  isLocal: boolean;
}

/**
 * `connections:list` result: the full ordered list (local first, then remotes)
 * plus the active selection.
 */
export interface ConnectionsListResult {
  connections: ConnectionRecord[];
  activeId: string;
  /**
   * Sticky protocol mismatch for the currently active backend, replayed here so
   * a renderer that missed the one-shot `connections:protocol-mismatch`
   * broadcast (e.g. a window created by a backend switch, after the remote
   * handshake already fired) still surfaces the advisory. `null`/absent when the
   * active backend matches local (or is local itself).
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
  host: string;
  port: number;
  fingerprint: string;
  token: string;
  /**
   * "Detect all backend IPs" option (#1746), default ON. When enabled, the
   * connection refreshes its candidate-host list from the backend's
   * `server.pairingInfo` after each successful connect; when disabled, only
   * the user-entered host is ever stored (single-host behavior).
   */
  detectHosts?: boolean;
}

/** `connections:add` result: the stored, token-free record. */
export interface AddConnectionResult {
  connection: ConnectionRecord;
  /**
   * `true` when the add re-paired the ACTIVE backend and main already rebuilt
   * the live client (a switch-to-self), so the caller must NOT dispatch a
   * follow-up switch — it would tear down and reconnect the fresh client a
   * second time. `false` when the record is not active and a switch is still
   * the caller's decision.
   */
  switched: boolean;
}

/** `connections:forget` params. */
export interface ForgetConnectionParams {
  id: string;
}

/** `connections:forget` result: echoes the forgotten id. */
export interface ForgetConnectionResult {
  id: string;
}

/** `connections:switch` params. */
export interface SwitchConnectionParams {
  id: string;
}

/** `connections:switch` result: the newly active connection id. */
export interface SwitchConnectionResult {
  activeId: string;
}

// ============================================================================
// Push-event payloads (main → renderer)
// ============================================================================

/**
 * `connections:changed` — broadcast after any mutation (add/forget/switch) so
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
 * connect/switch and a persistent warning in the daemon-status menu. Unlike
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
   * advisory modal (the user did not just initiate a switch) and keeps the
   * persistent menu warning. `'switch'` (or absent, for older payloads) for an
   * explicit backend switch — modal-worthy. Carried on the sticky
   * `connections:list` replay too. Additive.
   */
  origin?: 'boot' | 'switch';
}

/**
 * Boot-time backend-restore fallback notice (T19). When the app relaunches with
 * a persisted remote `activeId` that turns out to be unreachable at boot, the FE
 * falls back to the always-available local sidecar and surfaces this
 * non-blocking notice ("Couldn't reach <label>; using this machine") so the user
 * understands why they are on local rather than the remote they last used.
 *
 * Latched in main and PULLED once by the renderer via the
 * `connections:get-boot-fallback` invoke channel (consume-once), rather than
 * pushed on a live channel: the fallback happens during boot reconciliation,
 * before any renderer window exists to receive a broadcast, so a one-shot push
 * would be lost. The renderer surfaces it as a non-blocking toast — it is never
 * stored as connections-slice state.
 */
export interface ConnectionBootFallbackEvent {
  /** id of the remote connection that could not be reached at boot. */
  id: string;
  /** Human label of that remote (hostname/`host:port`), for the notice copy. */
  label: string;
}
