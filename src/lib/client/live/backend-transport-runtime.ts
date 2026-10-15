import type { CheckoutCaptureQuery } from '$shared/types/repository-checkout';
import type { NativeReviewInput } from '$shared/types/native-review-operation';
import { hostExecutionAuthorizationMessage } from '$features/providers/host-execution-errors';
import { BackendError } from './backend-transport-types';
/**
 * Framework-neutral implementation of the live backend boundary.
 *
 * These module-level functions are the stable seam the LiveAppClient domains
 * build on. They delegate to the environment's `BackendTransport`
 * implementation selected by `backend-transport-factory.ts` — Electron IPC
 * (`electron-ipc-transport.ts`) when `window.electronAPI` exists. See
 * `backend-transport-types.ts` for the transport interface.
 */
import { m } from '$shared/paraglide/messages.js';
import {
  assertRemoteRequestEnabled,
  needsPlacementPolicy,
  prepareNodeRequest,
} from './node-placement-policy';
import { resolveBackendTransport } from './backend-transport-factory';
import type { BackendNotification, BackendRequestOptions } from './backend-transport-types';
import type { RepositoryRootIdentity } from '$shared/types/repository-context';

/** Fresh reads from the renderer's canonical preference and connection state. */
export interface BackendPlacementAccess {
  remoteEnabled(): boolean;
  connectionGeneration(): number;
}

/**
 * Bind placement state once per renderer without choosing a second transport.
 * The legacy facade loads its Store lazily; other renderers bind their own Store.
 */
export function createBackendRuntime(
  loadPlacementAccess: () => BackendPlacementAccess | Promise<BackendPlacementAccess>,
) {
  /** Separate explicit resource lifetime, bound to this exact transport. */
  function captureBackendRepositoryResource(workspaceId: string) {
    const transport = resolveBackendTransport();
    if (!transport.captureRepositoryResource)
      return Promise.reject(
        new BackendError({
          code: 'REPOSITORY_RESOURCE_UNAVAILABLE',
          message: 'REPOSITORY_RESOURCE_UNAVAILABLE',
        }),
      );
    return transport.captureRepositoryResource(workspaceId);
  }

  /** Capture once before enqueue; a missing bound path never uses ordinary routing. */
  function captureBackendRepositoryRoute(root: RepositoryRootIdentity) {
    const transport = resolveBackendTransport();
    if (!transport.captureRepositoryRoute) {
      return Promise.reject(
        new BackendError({
          code: 'REPOSITORY_ROUTE_UNAVAILABLE',
          message: 'Repository route unavailable',
        }),
      );
    }
    return transport.captureRepositoryRoute(root);
  }

  /** A new explicit edit captures this transport once, before confirmation. */
  function captureBackendRepositorySelection(root: RepositoryRootIdentity) {
    const transport = resolveBackendTransport();
    if (!transport.captureRepositorySelection)
      return Promise.reject(
        new BackendError({
          code: 'REPOSITORY_SELECTION_UNAVAILABLE',
          message: 'REPOSITORY_SELECTION_UNAVAILABLE',
        }),
      );
    return transport.captureRepositorySelection(root);
  }

  /**
   * Forward a JSON-RPC request to the daemon.
   *
   * `options.timeoutMs` overrides the transport's default request timeout for a
   * single call. Used for long-running daemon operations (e.g. `git.pull`)
   * whose own bound exceeds the flat 30s default so the daemon's structured
   * `{ok:false}` result wins over a transport timeout.
   */
  async function backendRequest<T = unknown>(
    method: string,
    params?: unknown,
    options?: BackendRequestOptions & { onDispatch?: () => void },
  ): Promise<T> {
    try {
      const transport = resolveBackendTransport();
      if (needsPlacementPolicy(method, params)) {
        const placement = await loadPlacementAccess();
        const remoteEnabled = placement.remoteEnabled;
        const generation = placement.connectionGeneration();
        const checkConnection = () => {
          if (
            transport !== resolveBackendTransport() ||
            generation !== placement.connectionGeneration()
          )
            throw new Error(m.agent_placement_backendChanged());
        };
        const request = async (name: string, data?: unknown): Promise<unknown> => {
          checkConnection();
          const result = await transport.request(name, data);
          checkConnection();
          return result;
        };
        const observeCapabilities = async () => {
          checkConnection();
          if (!transport.observeNodeCapabilities) throw new Error(m.agent_placement_unavailable());
          const result = await transport.observeNodeCapabilities();
          checkConnection();
          return result;
        };
        params = await prepareNodeRequest(
          method,
          params,
          request,
          remoteEnabled,
          observeCapabilities,
        );
        checkConnection();
        assertRemoteRequestEnabled(method, params, remoteEnabled());
      }
      // The caller's phase marker runs only after local placement validation.
      // Keep it in this renderer; functions must never enter the IPC options.
      if (options?.onDispatch) {
        const { onDispatch, ...transportOptions } = options;
        onDispatch();
        return await transport.request<T>(
          method,
          params,
          Object.keys(transportOptions).length ? transportOptions : undefined,
        );
      }
      return await transport.request<T>(method, params, options);
    } catch (error) {
      if (error instanceof BackendError) {
        const message = hostExecutionAuthorizationMessage(
          (error.data as { executionAuthorization?: unknown } | undefined)?.executionAuthorization,
        );
        if (message)
          throw new BackendError({
            code: error.code,
            rpcCode: error.rpcCode,
            data: error.data,
            message,
          });
      }
      throw error;
    }
  }

  /** Observe node capabilities on one current transport without issuing client.hello. */
  async function observeBackendNodeCapabilities(): Promise<unknown> {
    const transport = resolveBackendTransport();
    const placement = await loadPlacementAccess();
    const generation = placement.connectionGeneration();
    if (!transport.observeNodeCapabilities) throw new Error(m.agent_placement_unavailable());
    const result = await transport.observeNodeCapabilities();
    if (transport !== resolveBackendTransport() || generation !== placement.connectionGeneration())
      throw new Error(m.agent_placement_backendChanged());
    return result;
  }

  /** Subscribe to daemon events (`events.subscribe`). Returns its raw result. */
  async function backendSubscribe<T = { subscriptionId?: string }>(params: unknown): Promise<T> {
    return resolveBackendTransport().subscribe<T>(params);
  }

  /** Unsubscribe from daemon events (`events.unsubscribe`). Best-effort. */
  async function backendUnsubscribe(subscriptionId: string, workspaceId?: string): Promise<void> {
    return resolveBackendTransport().unsubscribe(subscriptionId, workspaceId);
  }

  /**
   * Server capabilities advertised in the `client.hello` handshake. Confirmed on
   * the wire that the daemon nests these inside the `server` block, i.e. the live
   * flag lives at `result.server.capabilities.liveState` (NOT a top-level
   * `capabilities`). The full server block is `{locality, hasDisplay, osArch,
   * version, capabilities}`.
   */
  interface ServerCapabilities {
    liveState?: boolean;
  }

  let liveStateCapabilityPromise: Promise<boolean> | null = null;

  /**
   * Resolve whether the connected daemon advertises snapshot/delta live-state via
   * `client.hello` (`server.capabilities.liveState === true`) — the PRIMARY,
   * up-front live-state signal. Cached for the process so the handshake runs once
   * and is shared across all subscriptions. Resolves `false` on any error so
   * callers fall back to runtime first-push detection (the safety net is never
   * regressed when the flag is absent or hello fails).
   *
   * Identity note (§5.17): the empty params here are safe — the main-process
   * JsonRpcClient merges the persisted stable `clientId` into EVERY
   * `client.hello` it forwards, so this probe re-presents the same identity
   * rather than minting a fresh one (which would orphan `drafts.*` state,
   * §5.16).
   */
  function detectLiveStateCapability(): Promise<boolean> {
    if (!liveStateCapabilityPromise) {
      liveStateCapabilityPromise = backendRequest<{
        server?: { capabilities?: ServerCapabilities };
      }>('client.hello', {})
        .then((result) => result?.server?.capabilities?.liveState === true)
        .catch(() => false);
    }
    return liveStateCapabilityPromise;
  }

  /** Listen for daemon notifications. Returns a disposer. */
  function onBackendNotification(handler: (n: BackendNotification) => void): () => void {
    return resolveBackendTransport().onNotification(handler);
  }

  /**
   * Listen for backend reconnects. Fires when the transport re-establishes its
   * daemon connection after a drop (for Electron IPC: the `{ status:
   * 'connected', reconnected: true }` marker broadcast by `backend.ipc.ts`).
   * Renderer consumers that hold long-lived `events.subscribe` subscriptions or
   * hydrated state derived from daemon events must re-issue their subscribes
   * and, where appropriate, refresh coarse state so anything missed during the
   * outage converges (RESUB-1). Returns a disposer.
   */
  function onBackendReconnected(handler: () => void): () => void {
    return resolveBackendTransport().onReconnected(handler);
  }

  /** One captured transport; no ordinary request fallback or subsequent re-resolution. */
  function prepareBackendNativeReview(input: NativeReviewInput) {
    const transport = resolveBackendTransport();
    if (!transport.prepareNativeReview)
      return Promise.reject(
        new BackendError({
          code: 'NATIVE_REVIEW_UNAVAILABLE',
          message: 'NATIVE_REVIEW_UNAVAILABLE',
        }),
      );
    return transport.prepareNativeReview(input);
  }

  /** Pre-workspace browsing requires the original admitted transport. */
  function captureBackendRepositoryCheckout(query: CheckoutCaptureQuery) {
    const transport = resolveBackendTransport();
    if (!transport.captureRepositoryCheckout)
      return Promise.reject(
        new BackendError({
          code: 'REPOSITORY_CHECKOUT_UNAVAILABLE',
          message: 'REPOSITORY_CHECKOUT_UNAVAILABLE',
        }),
      );
    return transport.captureRepositoryCheckout(query);
  }

  return {
    captureBackendRepositoryResource,
    captureBackendRepositoryRoute,
    captureBackendRepositorySelection,
    backendRequest,
    observeBackendNodeCapabilities,
    backendSubscribe,
    backendUnsubscribe,
    detectLiveStateCapability,
    onBackendNotification,
    onBackendReconnected,
    prepareBackendNativeReview,
    captureBackendRepositoryCheckout,
  };
}

export type BackendRuntime = ReturnType<typeof createBackendRuntime>;
