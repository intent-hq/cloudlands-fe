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
  KeychainSyncStateResult,
} from '$shared/types/connections';
import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';

export type {
  AddConnectionParams,
  AddConnectionResult,
  CaptureFingerprintParams,
  CaptureFingerprintResult,
  ConnectionRecord,
  ConnectionsListResult,
  OpenConnectionResult,
  UpdateBackendResult,
  ConnectionAuthRejectedEvent,
  ConnectionCertMismatchEvent,
  ConnectionProtocolMismatchEvent,
  KeychainSyncStateResult,
  KeychainSyncUiStatus,
} from '$shared/types/connections';

/**
 * Status of the current connect operation (add or open).
 *   - `idle`       → no operation in flight.
 *   - `connecting` → an add/open invoke is pending.
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
  /** Backend bound to this renderer window. */
  windowBackendId: string;
  /**
   * True once at least one `connectionsListReceived` has landed. Until then
   * `activeId` is still the boot-time `LOCAL_CONNECTION_ID` default and must
   * not be trusted as the true active backend — destructive backend-scoped
   * work (e.g. workspace-tab reconciliation) gates on this flag.
   */
  hasReceivedList: boolean;
  /**
   * The app's pinned intentd version (from the `connections:list` result), or
   * null before the list has loaded or when the pin file is missing/malformed.
   * Compared against each remote's captured `daemonVersion`.
   */
  pinnedVersion: string | null;
  /**
   * ids of the connections with a live, currently-connected client in main's
   * pool (from the `connections:list` result / `connections:changed` push).
   * Gates connected-only actions (the remote Update button). Empty until the
   * first list payload carrying the field lands.
   */
  connectedIds: string[];
  /** Status of the in-flight add/open operation. */
  status: ConnectionOpStatus;
  /** Error message from the last failed add/open operation, or null. */
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
   * succeed, so the UI surfaces a "re-pair or open local" state instead of the
   * generic cannot-connect overlay. Latched per connection id: selectors gate
   * visibility on this window's connection, and a new add/open operation clears
   * it (a re-pair refreshes the token; a fresh open rebuilds the client).
   */
  authRejected: ConnectionAuthRejectedEvent | null;
  /**
   * Last protocol-mismatch push (`connections:protocol-mismatch`), or null. A
   * remote's `protocolVersion` differs in major version from the local
   * intentd's — warn-but-allow (the connection still proceeds). Kept while the
   * mismatched backend stays active so the daemon-status menu can show a
   * persistent warning; selectors gate visibility on this window's connection id.
   */
  protocolMismatch: ConnectionProtocolMismatchEvent | null;
  /**
   * Whether the user has dismissed the advisory protocol-mismatch modal for the
   * current {@link protocolMismatch}. Reset to `false` on each new push so a
   * later connect to a mismatched backend shows the modal again — except for
   * boot-origin pushes (`origin: 'boot'`), which set it to `true` up front so
   * only the persistent menu warning shows; the menu warning ignores this flag.
   */
  protocolMismatchModalDismissed: boolean;
  /**
   * iCloud-keychain backend sync state (`connections:sync-get-state` result),
   * or null before the settings UI first loads it. `status` inside is
   * refreshed live by the `connections:sync-status-changed` push.
   */
  keychainSync: KeychainSyncStateResult | null;
}
