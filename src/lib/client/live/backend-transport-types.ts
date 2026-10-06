import type { RepositoryResourceSession } from '$shared/types/repository-resource-read';
import type { NativeReviewInput, NativeReviewSession } from '$shared/types/native-review-operation';
import type { RepositorySelectionSession } from '$shared/types/repository-selection';
/**
 * Transport-agnostic contract for the renderer's live backend seam.
 *
 * A `BackendTransport` carries JSON-RPC traffic between the renderer and the
 * intentd daemon. The Electron implementation rides the `backend:*` IPC
 * channels through the main process (`electron-ipc-transport.ts`); future
 * implementations (e.g. a direct browser WebSocket) plug in behind the same
 * interface via `backend-transport-factory.ts`. Consumers should keep using
 * the module-level functions in `backend-transport.ts`, which delegate to the
 * factory-selected transport.
 */

import type { RepositoryRootIdentity } from '$shared/types/repository-context';

/** Serializable error payload returned by the transport. */
export interface BackendErrorPayload {
  code: string;
  message: string;
  data?: unknown;
  /**
   * Raw numeric JSON-RPC code from the daemon, threaded through so the renderer
   * can detect the optimistic-concurrency conflict (`-32005`) precisely (§11.4-D).
   * Absent for non-JSON-RPC transport failures.
   */
  rpcCode?: number;
}

/** Error thrown when a backend request fails, preserving the daemon string code. */
export class BackendError extends Error {
  readonly code: string;
  readonly data: unknown;
  readonly rpcCode?: number;
  constructor(payload: BackendErrorPayload) {
    super(payload.message);
    this.name = 'BackendError';
    this.code = payload.code;
    this.data = payload.data;
    this.rpcCode = payload.rpcCode;
  }
}

/**
 * Whether a request failure is a structured daemon error response (the daemon
 * received the request and rejected it) rather than a transport-level failure
 * (bridge unavailable, socket drop, request timeout). Callers use this to
 * decide retry-ability: transport failures are transient, daemon rejections
 * are not. Duck-typed on the numeric JSON-RPC `rpcCode`, which the transports
 * thread through ONLY for daemon-issued error responses, so it works
 * regardless of how the transport layer is mocked in tests.
 */
export function isDaemonErrorResponse(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return typeof (error as { rpcCode?: unknown }).rpcCode === 'number';
}

/** JSON-RPC code the daemon answers owner-/administrator-only methods with when the bound caller lacks the capability. */
const FORBIDDEN_RPC_CODE = -32003;

/**
 * Whether a request failure is the daemon's `-32003 Forbidden` capability
 * refusal (multiplayer w3): the caller is a collaborator on a method reserved
 * for the workspace owner / administrator (terminals, browser tabs, port
 * forwarding, host exec). Not transient — a retry gets the same answer until
 * the client reconnects under a different credential — so read paths treat it
 * as an empty state rather than an error. Duck-typed like
 * {@link isDaemonErrorResponse}.
 */
export function isForbiddenErrorResponse(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { rpcCode?: unknown }).rpcCode === FORBIDDEN_RPC_CODE;
}

/** Daemon JSON-RPC notification delivered to `onNotification` handlers. */
export interface BackendNotification {
  method: string;
  params?: unknown;
}

/** Per-call options for `BackendTransport.request`. */
export interface BackendRequestOptions {
  /** Address this desktop's daemon from a window bound to another device. */
  localMachine?: boolean;
  /**
   * Overrides the transport's default request timeout for a single call. Used
   * for long-running daemon operations (e.g. `git.pull`) whose own bound
   * exceeds the flat 30s default so the daemon's structured `{ok:false}`
   * result wins over a transport timeout.
   */
  timeoutMs?: number;
}

/** Original operation facts; current=false forbids application to the current UI. */
export interface BoundRepositoryResult<T> {
  operationId: string;
  current: boolean;
  settlement:
    { status: 'fulfilled'; value: T } | { status: 'rejected'; error: BackendErrorPayload };
}

/**
 * Main owns the opaque ID and scope. This object captures one bridge instance.
 * The operation owner releases it in finally after completion or cancellation;
 * interstage calls keep the original route, never a newly captured one.
 */
export interface BoundRepositoryRoute {
  /** Subscribe immediately; an already retired route calls back synchronously. */
  onRetired(listener: () => void): () => void;
  request<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<BoundRepositoryResult<T>>;
  release(): Promise<void>;
}

/**
 * Pluggable transport carrying the renderer's live JSON-RPC traffic to the
 * intentd daemon. Implementations must throw `BackendError` on request /
 * subscribe failures, keep `unsubscribe` best-effort (never throw on
 * teardown), and return no-op disposers from the listener registrations when
 * the underlying bridge is unavailable.
 */
export interface BackendTransport {
  captureNoteSaveConnection?(
    identity: import('$shared/types/note-save-connection').NoteSaveConnectionIdentity,
  ): Promise<import('$shared/types/note-save-connection').NoteSaveConnection>;
  /** Read the current acknowledged hello; never initiate a replacement handshake. */
  observeNodeCapabilities?(): Promise<unknown>;
  captureRepositoryCheckout?(
    query: import('$shared/types/repository-checkout').CheckoutCaptureQuery,
  ): Promise<
    import('$shared/types/repository-checkout').CheckoutResult<
      import('$shared/types/repository-checkout').RepositoryCheckoutSession
    >
  >;
  captureRepositoryResource?(workspaceId: string): Promise<RepositoryResourceSession>;
  prepareNativeReview?(input: NativeReviewInput): Promise<NativeReviewSession>;
  captureRepositorySelection?(root: RepositoryRootIdentity): Promise<RepositorySelectionSession>;
  /** Absent on older or non-Electron transports; never fall back to ordinary request. */
  captureRepositoryRoute?(root: RepositoryRootIdentity): Promise<BoundRepositoryRoute>;
  /** Whether the live backend bridge is reachable in this environment. */
  isAvailable(): boolean;
  /** Forward a JSON-RPC request to the daemon. */
  request<T = unknown>(
    method: string,
    params?: unknown,
    options?: BackendRequestOptions,
  ): Promise<T>;
  /** Subscribe to daemon events (`events.subscribe`). Returns its raw result. */
  subscribe<T = { subscriptionId?: string }>(params: unknown): Promise<T>;
  /** Unsubscribe from daemon events (`events.unsubscribe`). Best-effort. */
  unsubscribe(subscriptionId: string, workspaceId?: string): Promise<void>;
  /** Listen for daemon notifications. Returns a disposer. */
  onNotification(handler: (notification: BackendNotification) => void): () => void;
  /**
   * Listen for backend reconnects — fired when the transport re-establishes
   * its connection to the daemon after a drop. Returns a disposer.
   */
  onReconnected(handler: () => void): () => void;
}
