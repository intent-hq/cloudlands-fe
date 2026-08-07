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

import type { ConnectionRecord, ConnectionCertMismatchEvent } from '$shared/types/connections';

export type {
  ConnectionRecord,
  ConnectionsListResult,
  ConnectionCertMismatchEvent,
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
}
