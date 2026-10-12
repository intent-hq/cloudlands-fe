import { createWorkspaceClientRuntime } from '$lib/client/live/backend-workspace-client';
import type { BackendRuntime } from '$lib/client/live/backend-transport-runtime';
import { BackendError } from '$lib/client/live/backend-transport-types';
import type {
  CapturedWorkspaceLoadRoute,
  createElectronWorkspaceLoadTransport,
} from '$lib/client/live/workspace-load-route-transport';
import { createWorkspaceDomainClientRuntime } from '../../../../../src/store/renderer/slices/workspace/utils/workspace-domain-client-factory';
import type {
  WorkspaceDomainClient,
  WorkspaceDomainClientDependencies,
} from '../../../../../src/store/renderer/slices/workspace/utils/workspace-domain-client-types';
import type {
  WorkspaceLoadReadScope,
  WorkspaceLoadRequestLifetime,
} from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-load-admission-types';
import type {
  PreparedWorkspaceLoadOrigin,
  WorkspaceOriginAuthority,
} from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-load-origin-types';

type Dependencies = {
  transport: ReturnType<typeof createElectronWorkspaceLoadTransport>;
  backend: BackendRuntime;
  store: WorkspaceDomainClientDependencies['store'];
  deletions: WorkspaceDomainClientDependencies['deletions'];
};

function unavailable() {
  // i18n-ignore (internal eligibility diagnostic; no new product-facing surface)
  return new BackendError({
    code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE',
    message: 'Workspace load route unavailable',
  });
}

/** Explicit ready-origin observation; import never allocates or initializes a product Store. */
export async function observeWorkspaceLoadAuthority(
  dependencies: Dependencies,
  observationSignal?: AbortSignal,
): Promise<(WorkspaceOriginAuthority & { release(): void }) | null> {
  let backend: BackendRuntime;
  let store: Dependencies['store'];
  let deletions: Dependencies['deletions'];
  let origin;
  try {
    if (observationSignal?.aborted) return null;
    ({ backend, store, deletions } = dependencies);
    origin = observationSignal
      ? await dependencies.transport.observeOrigin(observationSignal)
      : await dependencies.transport.observeOrigin();
  } catch {
    return null;
  }
  if (!origin) return null;
  if (observationSignal) {
    let refused = false;
    try {
      refused = observationSignal.aborted;
    } catch {
      refused = true;
    }
    if (refused) {
      try {
        origin.release();
      } catch {
        /* Refused handoff cannot transfer ownership, even when release throws. */
      }
      return null;
    }
  }
  const capturedOrigin = origin;
  const consumed = new WeakSet<object>();

  return {
    identity: capturedOrigin.identity,
    signal: capturedOrigin.signal,
    isCurrent: capturedOrigin.isCurrent,
    release: capturedOrigin.release,
    async prepare(
      request: WorkspaceLoadRequestLifetime,
    ): Promise<PreparedWorkspaceLoadOrigin | null> {
      let requestIdentity: object;
      let workspaceId: string;
      let requestSignal: AbortSignal;
      let requestCurrent: WorkspaceLoadRequestLifetime['isCurrent'];
      try {
        requestIdentity = request.identity;
        workspaceId = request.workspaceId;
        requestSignal = request.signal;
        requestCurrent = request.isCurrent;
        if (consumed.has(requestIdentity)) return null;
        consumed.add(requestIdentity);
        const current = requestCurrent.call(request);
        const aborted = requestSignal.aborted;
        const originCurrent = capturedOrigin.isCurrent();
        if (!current || aborted || !originCurrent) return null;
      } catch {
        capturedOrigin.retire();
        return null;
      }

      let route: CapturedWorkspaceLoadRoute | null = null;
      let cancelled = false;
      let detached = false;
      let released = false;
      let acquired = false;
      let domain: WorkspaceDomainClient | null = null;

      function detach(): void {
        if (detached) return;
        detached = true;
        requestSignal.removeEventListener('abort', cancel);
        route?.signal.removeEventListener('abort', release);
      }
      function release(): void {
        if (released) return;
        released = true;
        const ownedDomain = domain;
        domain = null;
        try {
          detach();
        } catch {
          /* Continue every owned cleanup. */
        }
        try {
          ownedDomain?.clearCache();
        } catch {
          /* Route release must still run. */
        }
        try {
          route?.release();
        } catch {
          /* Cleanup never changes a successor. */
        }
      }
      function cancel(): void {
        cancelled = true;
        release();
      }
      function current(): boolean {
        if (released || cancelled || !route) return false;
        try {
          // Do not call request.isCurrent: its owner calls this prepared currentness.
          const originalAborted = requestSignal.aborted;
          const routeCurrent = route.isCurrent();
          const routeAborted = route.signal.aborted;
          return !originalAborted && routeCurrent && !routeAborted && !released && !cancelled;
        } catch {
          capturedOrigin.retire();
          release();
          return false;
        }
      }

      try {
        requestSignal.addEventListener('abort', cancel, { once: true });
        if (requestSignal.aborted) cancel();
        if (cancelled || released || !capturedOrigin.isCurrent()) {
          release();
          return null;
        }
        const requestId = crypto.randomUUID();
        route = await capturedOrigin.prepare(requestId, workspaceId, requestSignal);
        // A late route has not yet subscribed to release, so release it directly.
        if (!route) {
          release();
          return null;
        }
        if (cancelled || released) {
          route.release();
          return null;
        }
        route.signal.addEventListener('abort', release, { once: true });
        const requestAccepted = requestCurrent.call(request);
        if (!requestAccepted || !current()) {
          release();
          return null;
        }
      } catch {
        capturedOrigin.retire();
        release();
        return null;
      }
      const capturedRoute = route;

      return {
        requestIdentity,
        signal: capturedRoute.signal,
        isCurrent: current,
        release,
        acquireReadScope(context): WorkspaceLoadReadScope | null {
          try {
            if (acquired || !current()) return null;
            acquired = true;
            if (typeof context !== 'string') {
              release();
              return null;
            }
            const genuineBackend = { ...backend };
            const genuineRequest = genuineBackend.backendRequest;
            const scopedRequest: BackendRuntime['backendRequest'] = <T>(
              method: string,
              params?: unknown,
              options?: Parameters<BackendRuntime['backendRequest']>[2],
            ) => {
              if (method !== 'workspace.get') return genuineRequest<T>(method, params, options);
              // The actual canonical get method supplies exactly this request shape.
              if (
                !params ||
                typeof params !== 'object' ||
                Object.keys(params).length !== 1 ||
                !('workspaceId' in params) ||
                params.workspaceId !== workspaceId ||
                options !== undefined
              ) {
                capturedOrigin.retire();
                return Promise.reject(unavailable());
              }
              if (!current()) return Promise.reject(unavailable());
              return capturedRoute.read<T>('get');
            };
            const scopedBackend: BackendRuntime = {
              ...genuineBackend,
              backendRequest: scopedRequest,
            };
            const WireClient = createWorkspaceClientRuntime(scopedBackend);
            const wire = new WireClient();
            const DomainClient = createWorkspaceDomainClientRuntime({
              store,
              workspaces: wire,
              deletions,
              transport: capturedRoute.createDomainReadTransport(),
            });
            const freshDomain = new DomainClient();
            if (released || cancelled) {
              freshDomain.clearCache();
              return null;
            }
            domain = freshDomain;
            const domainOpen = freshDomain.open.bind(freshDomain);
            const wireGet = wire.get.bind(wire);
            const scope: WorkspaceLoadReadScope = {
              requestIdentity,
              context,
              signal: capturedRoute.signal,
              isCurrent: current,
              release,
              workspaceClient: {
                async open(id) {
                  if (id !== workspaceId || !current()) throw unavailable();
                  const result = await domainOpen(id);
                  // Preserve canonical error folding; the original signal is the eligibility oracle.
                  current();
                  return result;
                },
              },
              appClient: {
                workspaces: {
                  async get(id) {
                    if (id !== workspaceId || !current()) throw unavailable();
                    const result = await wireGet(id);
                    if (!current()) throw unavailable();
                    return result;
                  },
                },
              },
            };
            // Dependencies/getters/constructors may reenter; all local latches are checked last.
            if (!current() || released || cancelled) {
              release();
              return null;
            }
            return scope;
          } catch {
            capturedOrigin.retire();
            release();
            return null;
          }
        },
      };
    },
  };
}
