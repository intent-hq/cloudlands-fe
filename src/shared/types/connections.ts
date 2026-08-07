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

/** Which backend the FE is currently connected to. */
export interface ActiveBackendView {
  /** id of the active connection; `LOCAL_CONNECTION_ID` for the local sidecar. */
  activeId: string;
  /** True when the active backend is the local sidecar. */
  isLocal: boolean;
}

// ============================================================================
// Channel params & results
// ============================================================================

/** `connections:list` — no params. */
export type ConnectionsListParams = void;

/**
 * `connections:list` result: the full ordered list (local first, then remotes)
 * plus the active selection.
 */
export interface ConnectionsListResult {
  connections: ConnectionRecord[];
  activeId: string;
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

/** `connections:capture-fingerprint` result: the presented cert fingerprint. */
export interface CaptureFingerprintResult {
  /** SHA-256 cert fingerprint, colon-hex uppercase (PROTOCOL §1.2). */
  fingerprint: string;
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
}

/** `connections:add` result: the stored, token-free record. */
export interface AddConnectionResult {
  connection: ConnectionRecord;
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
}
