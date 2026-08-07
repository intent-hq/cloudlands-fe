/**
 * Connections Slice Types
 *
 * Renderer state for the "Connect to another intentd" feature (multi-backend
 * connect). The wire/IPC contract itself lives in `shared/types/connections.ts`
 * (T0) — this module re-exports the shapes the slice/selectors/thunks consume
 * and adds the renderer-only slice-state type.
 *
 * Safe to import from any process.
 */

import type {
  ConnectionRecord,
  ConnectionCertMismatchEvent,
  ConnectionProtocolMismatchEvent,
} from '$shared/types/connections';

export type {
  ConnectionRecord,
  ConnectionsListResult,
  ConnectionCertMismatchEvent,
  ConnectionProtocolMismatchEvent,
} from '$shared/types/connections';

/**
 * Status of the current connect/switch operation (add or switch).
 *   - `idle`       → no operation in flight.
 *   - `connecting` → an add/switch invoke is pending.
 *   - `error`      → the last operation failed (see `error`).
 */
export type ConnectionOpStatus = 'idle' | 'connecting' | 'error';

/**
 * Connections slice state.
 */
export interface ConnectionsState {
  /** Full ordered list (local first, then remotes). Never carries a token. */
  connections: ConnectionRecord[];
  /** id of the active connection (`LOCAL_CONNECTION_ID` for the local sidecar). */
  activeId: string;
  /** Status of the in-flight add/switch operation. */
  status: ConnectionOpStatus;
  /** Error message from the last failed add/switch operation, or null. */
  error: string | null;
  /**
   * Last cert-mismatch push (`connections:cert-mismatch`), or null. A pinned
   * cert changed on (re)connect — the UI surfaces a blocking failure modal
   * (no silent re-trust). Cleared once the user dismisses it.
   */
  certMismatch: ConnectionCertMismatchEvent | null;
  /**
   * Last protocol-mismatch push (`connections:protocol-mismatch`), or null. A
   * remote's `protocolVersion` differs in major version from the local
   * intentd's — warn-but-allow (the connection still proceeds). Kept while the
   * mismatched backend stays active so the daemon-status menu can show a
   * persistent warning; selectors gate visibility on the active connection id.
   */
  protocolMismatch: ConnectionProtocolMismatchEvent | null;
  /**
   * Whether the user has dismissed the advisory protocol-mismatch modal for the
   * current {@link protocolMismatch}. Reset to `false` on each new push so a
   * later switch to a mismatched backend shows the modal again; the persistent
   * menu warning ignores this flag.
   */
  protocolMismatchModalDismissed: boolean;
}
