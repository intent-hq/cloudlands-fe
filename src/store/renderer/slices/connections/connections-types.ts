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
  ConnectionAuthRejectedEvent,
  ConnectionCertMismatchEvent,
  ConnectionProtocolMismatchEvent,
} from '$shared/types/connections';
import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';

export type {
  AddConnectionParams,
  AddConnectionResult,
  CaptureFingerprintParams,
  CaptureFingerprintResult,
  ConnectionRecord,
  ConnectionsListResult,
  ConnectionAuthRejectedEvent,
  ConnectionCertMismatchEvent,
  ConnectionProtocolMismatchEvent,
} from '$shared/types/connections';

/**
 * Status of the current connect/switch operation (add or switch).
 *   - `idle`       → no operation in flight.
 *   - `connecting` → an add/switch invoke is pending.
 *   - `error`      → the last operation failed (see `error`).
 */
type ConnectionOpStatus = 'idle' | 'connecting' | 'error';

/**
 * Connections slice state.
 */
export interface ConnectionsState {
  /** Full ordered list (local first, then remotes). Never carries a token. */
  connections: Collection<ConnectionRecord, 'id'>;
  /** id of the active connection (`LOCAL_CONNECTION_ID` for the local sidecar). */
  activeId: string;
  /**
   * True once at least one `connectionsListReceived` has landed. Until then
   * `activeId` is still the boot-time `LOCAL_CONNECTION_ID` default and must
   * not be trusted as the true active backend — destructive backend-scoped
   * work (e.g. workspace-tab reconciliation) gates on this flag.
   */
  hasReceivedList: boolean;
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
   * Last auth-rejected push (`connections:auth-rejected`), or null. The remote
   * backend rejected the WebSocket upgrade with HTTP 401/403 (bad/rotated
   * token, or the WS API is disabled) — retrying with the same token cannot
   * succeed, so the UI surfaces a "re-pair or switch" state instead of the
   * generic cannot-connect overlay. Latched per connection id: selectors gate
   * visibility on the active connection, and a new add/switch operation clears
   * it (a re-pair refreshes the token; a switch changes the target).
   */
  authRejected: ConnectionAuthRejectedEvent | null;
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
   * later switch to a mismatched backend shows the modal again — except for
   * boot-origin pushes (`origin: 'boot'`), which set it to `true` up front so
   * only the persistent menu warning shows; the menu warning ignores this flag.
   */
  protocolMismatchModalDismissed: boolean;
}
