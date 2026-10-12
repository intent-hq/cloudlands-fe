import { randomUUID } from 'node:crypto';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import {
  WorkspaceLoadOriginRefSchema,
  WorkspaceLoadPrepareSchema,
  WorkspaceLoadReadSchema,
  WorkspaceLoadReleaseSchema,
  type WorkspaceLoadReadOutcome,
  type WorkspaceLoadError,
  type WorkspaceLoadRetired,
  type WorkspaceLoadRouteRef,
} from '$shared/types/workspace-load-route';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import {
  getStrictBackendBindingForWebContents,
  onStrictBackendBindingRetired,
} from '../../../main/window-backend';
import type {
  BackendConnectionOrigin,
  BackendConnectionOrigins,
} from '../../backend/main/backend.ipc';
import type {
  ClientConnectionOriginState,
  JsonRpcClient,
  RepositoryConnection,
} from '../../backend/main/json-rpc-client';
import type { WorkspaceOpenReads } from './workspace-open-reads';

type Binding = NonNullable<ReturnType<typeof getStrictBackendBindingForWebContents>>;

type PhysicalAdmission = { kind: 'physical'; origins: BackendConnectionOrigins };

interface Dependencies {
  /** Explicit opt-in; capture ownership once, including its original pending dial. */
  originAdmission?: PhysicalAdmission;
  /** Actual pool lookup only; no lazy creation or local/focus fallback. */
  readBackend(id: string): JsonRpcClient | undefined;
  /** Invoke the shared validated OPEN handler with protocolAdapter.getWorkspace(id, reads). */
  open(event: IpcMainInvokeEvent, workspaceId: string, reads: WorkspaceOpenReads): Promise<unknown>;
  errorPayload(error: unknown): WorkspaceLoadError;
  /** Proposed bridge RETIRED channel; called only for the original live frame. */
  notify(frame: Electron.WebFrameMain, retirement: WorkspaceLoadRetired): void;
}

// These bound private resources, not daemon permissions or readiness waits.
const MAX_ORIGINS = 256;
const MAX_SENDER_ORIGINS = 8;
const MAX_REQUESTS_PER_ORIGIN = 128;
const MAX_ACTIVE_READS = 2;
const TTL_MS = 300_000;
const unavailable = () => new Error('WORKSPACE_LOAD_ROUTE_UNAVAILABLE'); // i18n-ignore (internal diagnostic)

type RouteOwner = ReturnType<typeof createWorkspaceLoadRouteOwner>;
type PreparedOwner<Result> = Omit<RouteOwner, 'prepare'> & {
  prepare(event: IpcMainInvokeEvent, payload: unknown): Result;
};

/**
 * Inert main-owned factory. No registration, startup, socket creation or retries.
 * Daemon read permission remains daemon-owned; no repository lease is involved.
 */
export function createWorkspaceLoadRoutes(
  deps: Dependencies & { originAdmission: PhysicalAdmission },
): PreparedOwner<Promise<WorkspaceLoadRouteRef>>;
export function createWorkspaceLoadRoutes(
  deps: Dependencies & { originAdmission?: undefined },
): PreparedOwner<WorkspaceLoadRouteRef>;
export function createWorkspaceLoadRoutes(deps: Dependencies): RouteOwner;
export function createWorkspaceLoadRoutes(deps: Dependencies): RouteOwner {
  return createWorkspaceLoadRouteOwner(deps);
}

function createWorkspaceLoadRouteOwner(deps: Dependencies) {
  type Origin = {
    originId: string;
    sender: WebContents;
    binding: Binding;
    client: JsonRpcClient;
    connection: RepositoryConnection | null;
    physical?: BackendConnectionOrigin;
    retired: boolean;
    expires: number;
    stops: Array<() => void>;
    timer?: ReturnType<typeof setTimeout>;
    requests: Map<string, Request>;
    routes: Set<Route>;
  };
  type Request = {
    workspaceId: string;
    pending?: { finish(route?: WorkspaceLoadRouteRef): void };
    route?: Route;
  };
  type Route = {
    ref: Readonly<WorkspaceLoadRouteRef>;
    origin: Origin;
    connection: RepositoryConnection;
    retired: boolean;
    activeReads: number;
  };
  const origins = new Map<string, Origin>();
  const routes = new Map<string, Route>();
  let disposed = false;

  function notify(origin: Origin, message: WorkspaceLoadRetired): void {
    try {
      const send = deps.notify;
      const frame = origin.binding.frame;
      const args = [frame, message] as const;
      if (getStrictBackendBindingForWebContents(origin.sender) !== origin.binding) return;
      Reflect.apply(send, deps, args);
    } catch {
      // Transport notification failure cannot restore the original main owner.
    }
  }
  function dropRoute(route: Route): void {
    if (route.retired) return;
    route.retired = true;
    routes.delete(route.ref.routeId);
    route.origin.routes.delete(route);
    notify(route.origin, { kind: 'route', ...route.ref });
  }
  function dropOrigin(origin: Origin): void {
    if (origin.retired) return;
    origin.retired = true;
    origins.delete(origin.originId);
    clearTimeout(origin.timer);
    // Pending ownership and subscriptions are removed before any retirement notice.
    for (const request of origin.requests.values()) request.pending?.finish();
    for (const route of [...origin.routes]) dropRoute(route);
    for (const stop of origin.stops.splice(0)) {
      try {
        stop();
      } catch {
        /* Retire every observer even if one teardown fails. */
      }
    }
    notify(origin, { kind: 'origin', originId: origin.originId });
  }
  function physicalState(origin: Origin): ClientConnectionOriginState | null {
    if (disposed || origin.retired) return null;
    try {
      const binding = getStrictBackendBindingForWebContents(origin.sender);
      const state = origin.physical!.read();
      const sameConnection =
        origin.connection === null ||
        (state.state === 'ready' && state.connection === origin.connection);
      // read() may reenter: consult local ownership LAST, without a new callback.
      if (
        binding !== origin.binding ||
        state.state === 'retired' ||
        !sameConnection ||
        Date.now() >= origin.expires ||
        origins.get(origin.originId) !== origin ||
        disposed ||
        origin.retired
      ) {
        dropOrigin(origin);
        return null;
      }
      if (state.state === 'ready') origin.connection = state.connection;
      return state;
    } catch {
      dropOrigin(origin);
      return null;
    }
  }
  function original(origin: Origin): boolean {
    if (origin.physical) return physicalState(origin) !== null;
    if (disposed || origin.retired) return false;
    try {
      // Dependency calls/getters may reenter. Sample them first, then consult
      // monotonic retirement and owned map membership LAST, without another callback.
      const binding = getStrictBackendBindingForWebContents(origin.sender);
      const client = deps.readBackend(origin.binding.backendId);
      const connection = origin.client.getRepositoryConnection();
      const current =
        binding === origin.binding &&
        client === origin.client &&
        connection === origin.connection &&
        Date.now() < origin.expires &&
        origins.get(origin.originId) === origin &&
        !disposed &&
        !origin.retired;
      if (!current) dropOrigin(origin);
      return current;
    } catch {
      dropOrigin(origin);
      return false;
    }
  }
  function owns(event: IpcMainInvokeEvent, origin: Origin): boolean {
    return event.sender === origin.sender && event.senderFrame === origin.binding.frame;
  }
  function current(route: Route): boolean {
    const originCurrent = !route.retired && original(route.origin);
    // original() can synchronously cause a release callback for this route.
    if (!originCurrent || route.retired || routes.get(route.ref.routeId) !== route) {
      dropRoute(route);
      return false;
    }
    return true;
  }
  function assertCurrent(route: Route): void {
    if (!current(route)) throw unavailable();
  }
  function ownedRoute(event: IpcMainInvokeEvent, ref: WorkspaceLoadRouteRef): Route | null {
    const route = routes.get(ref.routeId);
    return route &&
      owns(event, route.origin) &&
      route.ref.originId === ref.originId &&
      route.ref.requestId === ref.requestId &&
      route.ref.workspaceId === ref.workspaceId
      ? route
      : null;
  }
  function attach(origin: Origin, stop: () => void): void {
    if (origin.retired) stop();
    else origin.stops.push(stop);
  }

  function preparePhysical(
    event: IpcMainInvokeEvent,
    payload: unknown,
  ): Promise<WorkspaceLoadRouteRef> {
    // The executor runs synchronously: reserve before original()/subscribe can reenter.
    return new Promise((resolve, reject) => {
      const ref = WorkspaceLoadPrepareSchema.parse(payload);
      const origin = origins.get(ref.originId);
      if (
        !origin ||
        !owns(event, origin) ||
        origin.requests.has(ref.requestId) ||
        origin.requests.size >= MAX_REQUESTS_PER_ORIGIN
      )
        throw unavailable();
      let settled = false;
      let checking = false;
      let stop: (() => void) | undefined;
      const request: Request = { workspaceId: ref.workspaceId, pending: { finish } };
      origin.requests.set(ref.requestId, request);
      function finish(route?: WorkspaceLoadRouteRef): void {
        if (settled) return;
        settled = true;
        request.pending = undefined;
        const detach = stop;
        stop = undefined;
        try {
          detach?.();
        } catch {
          /* Settlement remains terminal. */
        }
        // Detaching can reenter RELEASE/dispose. Never resolve a route it just retired.
        if (route && request.route && !request.route.retired && !origin!.retired && !disposed)
          resolve(route);
        else reject(unavailable());
      }
      function wake(): void {
        if (settled || checking) return;
        checking = true;
        try {
          const state = physicalState(origin!);
          if (settled) return;
          if (!state) {
            finish();
            return;
          }
          if (state.state !== 'ready') return;
          const route: Route = {
            ref: Object.freeze({ ...ref, routeId: randomUUID() }),
            origin: origin!,
            connection: state.connection,
            retired: false,
            activeReads: 0,
          };
          request.route = route;
          routes.set(route.ref.routeId, route);
          origin!.routes.add(route);
          if (!current(route)) {
            finish();
            return;
          }
          if (settled) {
            dropRoute(route);
            return;
          }
          finish(route.ref);
        } finally {
          checking = false;
        }
      }
      try {
        // Check first so a retired/expired owner cannot retain a subscription.
        wake();
        if (!settled) {
          const detach = origin.physical!.subscribeChanged(wake);
          if (settled) detach();
          else {
            stop = detach;
            wake();
          }
        }
      } catch {
        finish();
        if (request.route) dropRoute(request.route);
      }
    });
  }

  return {
    /**
     * Obtain this anchor BEFORE an originating load intent is accepted. No await,
     * status inference or hello request here. Default mode refuses a missing hello.
     * Physical mode captures one actual pending composite; null still refuses.
     */
    observeOrigin(event: IpcMainInvokeEvent) {
      if (disposed) throw unavailable();
      const binding = getStrictBackendBindingForWebContents(event.sender);
      if (
        !binding ||
        binding.frame !== event.senderFrame ||
        binding.backendId !== LOCAL_CONNECTION_ID
      )
        throw unavailable();
      const admission = deps.originAdmission;
      const physical = admission?.origins.capture(binding.backendId);
      if (admission && !physical) throw unavailable();
      const client = physical ? physical.client : deps.readBackend(binding.backendId);
      const connection = physical ? null : client?.getRepositoryConnection();
      if (!client || (!physical && !connection) || client.getConfig().transport !== 'uds')
        throw unavailable();
      if (
        origins.size >= MAX_ORIGINS ||
        [...origins.values()].filter((o) => o.sender === event.sender).length >= MAX_SENDER_ORIGINS
      )
        throw unavailable();
      const origin: Origin = {
        originId: randomUUID(),
        sender: event.sender,
        binding,
        client,
        connection: connection ?? null,
        physical: physical ?? undefined,
        retired: false,
        expires: Date.now() + TTL_MS,
        stops: [],
        requests: new Map(),
        routes: new Set(),
      };
      origins.set(origin.originId, origin);
      try {
        attach(
          origin,
          onStrictBackendBindingRetired(origin.sender, () => dropOrigin(origin)),
        );
        if (physical) {
          attach(
            origin,
            physical.subscribeChanged(() => {
              original(origin);
            }),
          );
        } else {
          // The default observer still accepts only an already-acknowledged identity.
          attach(
            origin,
            client.onRepositoryConnectionEvent((event) => {
              if (
                (event.type === 'identity-retired' && event.connection === connection) ||
                (event.type === 'closed' && event.incarnation === connection!.incarnation) ||
                (event.type === 'opened' && event.incarnation !== connection!.incarnation)
              )
                dropOrigin(origin);
            }),
          );
        }
        if (!original(origin)) throw unavailable();
        origin.timer = setTimeout(
          () => dropOrigin(origin),
          physical ? Math.max(0, origin.expires - Date.now()) : TTL_MS,
        );
        origin.timer.unref();
        return { originId: origin.originId };
      } catch (error) {
        dropOrigin(origin);
        throw error;
      }
    },

    /** IPC is asynchronous to the renderer, but preparation issues no daemon reads. */
    prepare(
      event: IpcMainInvokeEvent,
      payload: unknown,
    ): WorkspaceLoadRouteRef | Promise<WorkspaceLoadRouteRef> {
      if (deps.originAdmission) return preparePhysical(event, payload);
      const ref = WorkspaceLoadPrepareSchema.parse(payload);
      const origin = origins.get(ref.originId);
      if (
        !origin ||
        !owns(event, origin) ||
        !original(origin) ||
        origin.requests.has(ref.requestId) ||
        origin.requests.size >= MAX_REQUESTS_PER_ORIGIN
      )
        throw unavailable();
      // A consumed request ID is never reused, even after release. It is correlation,
      // not authority: only the exact main-private origin establishes route ownership.
      const request: Request = { workspaceId: ref.workspaceId };
      origin.requests.set(ref.requestId, request);
      const route: Route = {
        ref: Object.freeze({ ...ref, routeId: randomUUID() }),
        origin,
        connection: origin.connection!,
        retired: false,
        activeReads: 0,
      };
      request.route = route;
      routes.set(route.ref.routeId, route);
      origin.routes.add(route);
      assertCurrent(route);
      return route.ref;
    },

    async read(event: IpcMainInvokeEvent, payload: unknown): Promise<WorkspaceLoadReadOutcome> {
      const input = WorkspaceLoadReadSchema.parse(payload);
      const { operation: _operation, ...ref } = input;
      const retired = (): WorkspaceLoadReadOutcome => ({ ref, current: false, reason: 'retired' });
      const route = ownedRoute(event, ref);
      if (!route || !current(route)) return retired();
      if (route.activeReads >= MAX_ACTIVE_READS) {
        dropRoute(route);
        return retired();
      }
      route.activeReads++;
      // Private transport helper; file.exists is never a renderer-selected method.
      const sendCaptured = async <T>(
        method: 'workspace.get' | 'git.getConfig' | 'settings.get' | 'file.exists',
        snapshot: Readonly<Record<string, unknown>>,
      ): Promise<T> => {
        const client = route.origin.client;
        const connection = route.connection;
        const send = client.requestOnCapturedConnection;
        const args = [
          connection,
          method,
          snapshot,
          undefined,
          undefined,
          () => current(route),
        ] as const;
        try {
          assertCurrent(route);
          return (await Reflect.apply(send, client, args)) as T;
        } finally {
          assertCurrent(route);
        }
      };
      const request: WorkspaceOpenReads['request'] = async <T>(
        method: 'workspace.get' | 'git.getConfig' | 'settings.get',
        params: Readonly<Record<string, unknown>>,
      ) => {
        assertCurrent(route);
        const keys = Object.keys(params);
        const target = method === 'settings.get' ? params.path : params.workspaceId;
        const allowed =
          method === 'settings.get'
            ? keys.length === 1 && keys[0] === 'path' && target === 'workspace.changeHistory'
            : (method === 'workspace.get' || method === 'git.getConfig') &&
              keys.length === 1 &&
              keys[0] === 'workspaceId' &&
              target === route.ref.workspaceId;
        if (!allowed) throw unavailable();
        // No parameter getter/toJSON can run during the actual captured send.
        const snapshot = Object.freeze(
          method === 'settings.get' ? { path: target } : { workspaceId: target },
        );
        return sendCaptured<T>(method, snapshot);
      };
      const reads: WorkspaceOpenReads = {
        request,
        async accessWorktree(path) {
          // Only the canonical service calls this, with its workspace.get path.
          // The daemon owns membership, root resolution and symlink containment.
          if (typeof path !== 'string' || !path) {
            dropRoute(route);
            throw unavailable();
          }
          const snapshot = Object.freeze({ workspaceId: route.ref.workspaceId, path });
          let result: unknown;
          try {
            result = await sendCaptured<unknown>('file.exists', snapshot);
          } catch (error) {
            assertCurrent(route);
            let rpcCode: number | undefined;
            try {
              const payload = deps.errorPayload(error);
              rpcCode = payload.rpcCode;
            } catch {
              dropRoute(route);
              throw unavailable();
            }
            assertCurrent(route);
            // Exact JSON-RPC method-not-found: deployment prerequisite missing.
            // Do not let the canonical catch-and-clear turn it into success.
            if (rpcCode === -32601) {
              dropRoute(route);
              throw unavailable();
            }
            // Known daemon membership/path/access errors retain source folding.
            // Other ordinary errors are not relabelled as physical retirement.
            throw error;
          }
          let exists: unknown, isFile: unknown, isDirectory: unknown;
          try {
            const row =
              result && typeof result === 'object' && !Array.isArray(result)
                ? (result as Record<string, unknown>)
                : null;
            exists = row?.exists;
            isFile = row?.isFile;
            isDirectory = row?.isDirectory;
          } catch {
            dropRoute(route);
            throw unavailable();
          }
          assertCurrent(route);
          if (
            typeof exists !== 'boolean' ||
            typeof isFile !== 'boolean' ||
            typeof isDirectory !== 'boolean' ||
            (!exists && (isFile || isDirectory)) ||
            (isFile && isDirectory)
          ) {
            dropRoute(route);
            throw unavailable();
          }
          if (!exists) throw new Error('WORKSPACE_WORKTREE_UNAVAILABLE'); // i18n-ignore (internal diagnostic)
        },
      };
      try {
        // Resolve the injected OPEN callback before the adjacent admission fence.
        const open = deps.open;
        const openArgs = [event, route.ref.workspaceId, reads] as const;
        assertCurrent(route);
        const result =
          input.operation === 'open'
            ? await Reflect.apply(open, deps, openArgs)
            : await request('workspace.get', { workspaceId: route.ref.workspaceId });
        if (!current(route)) return retired();
        return { ref, current: true, settlement: { status: 'fulfilled', value: result } };
      } catch (error) {
        if (!current(route)) return retired();
        // Resolve error conversion before the final fence; it may invoke getters.
        const payload = deps.errorPayload(error);
        const structuredError: WorkspaceLoadError = {
          code: payload.code,
          message: payload.message,
          data: payload.data,
          rpcCode: payload.rpcCode,
        };
        if (!current(route)) return retired();
        return { ref, current: true, settlement: { status: 'rejected', error: structuredError } };
      } finally {
        route.activeReads--;
      }
    },

    /** Idempotent cleanup never performs a backend lookup/send or releases a successor. */
    release(event: IpcMainInvokeEvent, payload: unknown): void {
      const ref = WorkspaceLoadReleaseSchema.parse(payload);
      if ('routeId' in ref) {
        const route = ownedRoute(event, ref);
        if (route) dropRoute(route);
        return;
      }
      const origin = origins.get(ref.originId);
      if (!origin || !owns(event, origin)) return;
      const request = origin.requests.get(ref.requestId);
      if (request) {
        if (request.workspaceId !== ref.workspaceId) return;
        request.pending?.finish();
        if (request.route) dropRoute(request.route);
      } else if (origin.requests.size < MAX_REQUESTS_PER_ORIGIN) {
        // A bounded one-use tombstone: a later PREPARE cannot reuse this ID.
        origin.requests.set(ref.requestId, { workspaceId: ref.workspaceId });
      }
    },
    releaseOrigin(event: IpcMainInvokeEvent, payload: unknown): void {
      const { originId } = WorkspaceLoadOriginRefSchema.parse(payload);
      const origin = origins.get(originId);
      if (origin && owns(event, origin)) dropOrigin(origin);
    },
    /** Required pool hook BEFORE detaching/replacing this exact client, including same ID. */
    retireClient(client: JsonRpcClient): void {
      for (const origin of [...origins.values()]) if (origin.client === client) dropOrigin(origin);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const origin of [...origins.values()]) dropOrigin(origin);
    },
  };
}
