import { randomUUID } from 'node:crypto';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import {
  WorkspaceLoadOriginRefSchema,
  WorkspaceLoadPrepareSchema,
  WorkspaceLoadReadSchema,
  WorkspaceLoadRouteRefSchema,
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
import type { JsonRpcClient, RepositoryConnection } from '../../backend/main/json-rpc-client';
import type { WorkspaceOpenReads } from './workspace-open-reads';

type Binding = NonNullable<ReturnType<typeof getStrictBackendBindingForWebContents>>;

interface Dependencies {
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

/**
 * Inert main-owned factory. No registration, startup, socket creation or retries.
 * Daemon read permission remains daemon-owned; no repository lease is involved.
 */
export function createWorkspaceLoadRoutes(deps: Dependencies) {
  type Origin = {
    originId: string;
    sender: WebContents;
    binding: Binding;
    client: JsonRpcClient;
    connection: RepositoryConnection;
    retired: boolean;
    expires: number;
    stops: Array<() => void>;
    timer?: ReturnType<typeof setTimeout>;
    requests: Set<string>;
    routes: Set<Route>;
  };
  type Route = {
    ref: Readonly<WorkspaceLoadRouteRef>;
    origin: Origin;
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
  function original(origin: Origin): boolean {
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

  return {
    /**
     * Obtain this anchor BEFORE an originating load intent is accepted. No await,
     * status inference or hello request here. A missing hello yields refusal;
     * prehello/initial-open/reconnect waiting needs a separate physical attempt owner.
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
      const client = deps.readBackend(binding.backendId);
      const connection = client?.getRepositoryConnection();
      if (!client || !connection || client.getConfig().transport !== 'uds') throw unavailable();
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
        connection,
        retired: false,
        expires: Date.now() + TTL_MS,
        stops: [],
        requests: new Set(),
        routes: new Set(),
      };
      origins.set(origin.originId, origin);
      try {
        // The existing hello object positively attests the already-live identity.
        // This late observer claims nothing about any earlier prehello attempt.
        attach(
          origin,
          onStrictBackendBindingRetired(origin.sender, () => dropOrigin(origin)),
        );
        attach(
          origin,
          client.onRepositoryConnectionEvent((event) => {
            if (
              (event.type === 'identity-retired' && event.connection === connection) ||
              (event.type === 'closed' && event.incarnation === connection.incarnation) ||
              (event.type === 'opened' && event.incarnation !== connection.incarnation)
            )
              dropOrigin(origin);
          }),
        );
        if (!original(origin)) throw unavailable();
        origin.timer = setTimeout(() => dropOrigin(origin), TTL_MS);
        origin.timer.unref();
        return { originId: origin.originId };
      } catch (error) {
        dropOrigin(origin);
        throw error;
      }
    },

    /** IPC is asynchronous to the renderer, but preparation issues no daemon reads. */
    prepare(event: IpcMainInvokeEvent, payload: unknown): WorkspaceLoadRouteRef {
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
      origin.requests.add(ref.requestId);
      const route: Route = {
        ref: Object.freeze({ ...ref, routeId: randomUUID() }),
        origin,
        retired: false,
        activeReads: 0,
      };
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
        const connection = route.origin.connection;
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
      const ref = WorkspaceLoadRouteRefSchema.parse(payload);
      const route = ownedRoute(event, ref);
      if (route) dropRoute(route);
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
