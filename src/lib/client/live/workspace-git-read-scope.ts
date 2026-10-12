import {
  WorkspaceGitOperationSchema,
  WorkspaceLoadPrepareSchema,
  type WorkspaceGitOperation,
  type WorkspaceGitProvenance,
} from '$shared/types/workspace-load-route';
import { BackendError } from './backend-transport-types';
import type {
  CapturedWorkspaceGitOrigin,
  CapturedWorkspaceGitRoute,
  CapturedWorkspaceLoadRoute,
  createElectronWorkspaceLoadTransport,
} from './workspace-load-route-transport';

interface PreparedWorkspacePrRead {
  readonly provenance: WorkspaceGitProvenance;
  /** Before settlement fences the child; after success or an opted-in current failure
   * fences the surviving original scope.
   * This is local observed currentness, not an instantaneous main-process freshness query.
   */
  isCurrent(): boolean;
  read<T = unknown>(
    operation: Extract<WorkspaceGitOperation, { operation: 'pr-refresh' }>,
  ): Promise<T>;
  /** Caller finally releases the complete scope after mapping/publication, or immediately on skip.
   * Never retain an origin for a freshness window. Default errors/cancellation already release it; retained current failures require caller finally.
   */
  release(): void;
}

interface WorkspaceGitReadScope {
  readonly identity: object;
  readonly workspaceId: string;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  /** Attest without PR traffic. Caller finally always releases the original scope.
   * Explicit publication mode keeps an ordinary current READ rejection's parent alive
   * until its owner publishes failure; default errors and all external retirement still release.
   */
  preparePrRefresh(options?: { retainCurrentFailure: true }): Promise<PreparedWorkspacePrRead>;
  /** Each operation is consumed once; no mapper, cache, publication or retry is owned here. */
  read<T = unknown>(operation: WorkspaceGitOperation): Promise<T>;
  release(): void;
}

function unavailable() {
  // i18n-ignore (internal acquisition failure; never an empty successful domain read)
  return new BackendError({
    code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE',
    message: 'Captured Git scope unavailable',
  });
}

/** Inactive raw transport boundary. The caller already owns canonical admission and a read slot. */
export async function acquireWorkspaceGitReadScope(
  transport: Pick<ReturnType<typeof createElectronWorkspaceLoadTransport>, 'observeOrigin'>,
  workspaceId: string,
  signal: AbortSignal,
): Promise<{ kind: 'unavailable' } | { kind: 'acquired'; scope: WorkspaceGitReadScope }> {
  let origin: CapturedWorkspaceGitOrigin | null = null;
  const controller = new AbortController();
  const routes = new Set<CapturedWorkspaceLoadRoute>();
  const consumed = new Set<WorkspaceGitOperation['operation']>();
  let released = false;
  function release(): void {
    if (released) return;
    released = true;
    const children = [...routes];
    routes.clear();
    // Attempt every owned cleanup even if a listener/disposer fails.
    try {
      signal.removeEventListener('abort', release);
    } catch {
      /* Continue cleanup. */
    }
    try {
      origin?.signal.removeEventListener('abort', release);
    } catch {
      /* Continue cleanup. */
    }
    try {
      controller.abort();
    } catch {
      /* Pending original invokes still drain in transport. */
    }
    for (const route of children) {
      try {
        route.release();
      } catch {
        /* Release all siblings and the origin. */
      }
    }
    try {
      origin?.release();
    } catch {
      /* Original main document/TTL also retires ownership. */
    }
  }
  function current(): boolean {
    if (released || !origin) return false;
    try {
      const parentAborted = signal.aborted;
      const accepted = origin.isCurrent();
      const originAborted = origin.signal.aborted;
      if (parentAborted || !accepted || originAborted || released) {
        release();
        return false;
      }
      return true;
    } catch {
      release();
      return false;
    }
  }
  try {
    WorkspaceLoadPrepareSchema.shape.workspaceId.parse(workspaceId);
    if (signal.aborted) return { kind: 'unavailable' };
    signal.addEventListener('abort', release, { once: true });
    // Registration may synchronously cancel. Do not start a replacement observation.
    if (signal.aborted || released) {
      release();
      return { kind: 'unavailable' };
    }
    const captured = await transport.observeOrigin(controller.signal);
    if (!captured) {
      release();
      return { kind: 'unavailable' };
    }
    if (released) {
      captured.release();
      return { kind: 'unavailable' };
    }
    origin = captured;
    origin.signal.addEventListener('abort', release, { once: true });
    if (!current()) return { kind: 'unavailable' };
  } catch {
    release();
    return { kind: 'unavailable' };
  }
  const scope: WorkspaceGitReadScope = {
    identity: origin.identity,
    workspaceId,
    signal: controller.signal,
    isCurrent: current,
    release,
    async preparePrRefresh(options?: {
      retainCurrentFailure: true;
    }): Promise<PreparedWorkspacePrRead> {
      const retainCurrentFailure = options?.retainCurrentFailure === true;
      if (!current() || consumed.has('pr-refresh')) throw unavailable();
      consumed.add('pr-refresh');
      let route: CapturedWorkspaceGitRoute | null;
      try {
        route = await origin!.prepareGit(
          crypto.randomUUID(),
          workspaceId,
          'pr-refresh',
          controller.signal,
        );
      } catch (error) {
        release();
        throw error;
      }
      if (!route) {
        release();
        throw unavailable();
      }
      if (!current()) {
        route.release();
        throw unavailable();
      }
      const child = route;
      routes.add(child);
      let readStarted = false;
      let readSucceeded = false;
      let currentFailureRetained = false;
      function preparedCurrent(): boolean {
        if (!current()) return false;
        // Normal consumed-child cleanup must not retire its surviving publication parent.
        if (readSucceeded || currentFailureRetained) return true;
        const childCurrent = child.isCurrent();
        if (!childCurrent || released) {
          release();
          return false;
        }
        return true;
      }
      return {
        provenance: child.provenance,
        isCurrent: preparedCurrent,
        release,
        async read<T>(
          operation: Extract<WorkspaceGitOperation, { operation: 'pr-refresh' }>,
        ): Promise<T> {
          // Duplicate calls neither consult a consumed child nor retire the publication parent.
          if (readStarted || !preparedCurrent()) throw unavailable();
          readStarted = true;
          let rejectedByRead = false;
          try {
            let input: WorkspaceGitOperation;
            try {
              input = WorkspaceGitOperationSchema.parse(operation);
            } catch {
              throw unavailable();
            }
            if (input.operation !== 'pr-refresh' || !preparedCurrent()) throw unavailable();
            let value: T;
            try {
              value = await child.readGit<T>(input);
            } catch (error) {
              rejectedByRead = true;
              throw error;
            }
            if (!preparedCurrent()) throw unavailable();
            // Preserve the final live-child fence, then transfer currentness to the original origin.
            readSucceeded = true;
            routes.delete(child);
            child.release();
            // Cleanup can reenter cancellation or bridge replacement before fulfillment.
            if (!current()) throw unavailable();
            return value;
          } catch (error) {
            // Classify before our own cleanup makes currentness false.
            const stillCurrent = preparedCurrent();
            const failure = stillCurrent ? error : unavailable();
            if (
              retainCurrentFailure &&
              rejectedByRead &&
              stillCurrent &&
              !(error instanceof BackendError && error.code === 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE')
            ) {
              // The owner may settle this one current failure before its finally releases the parent.
              currentFailureRetained = true;
              const failures: unknown[] = [failure];
              try {
                child.release();
                routes.delete(child);
              } catch (cleanupError) {
                failures.push(cleanupError);
              }
              // Consumed-child cleanup can itself reenter external retirement.
              if (!current()) {
                release();
                throw unavailable();
              }
              // i18n-ignore (internal failure aggregate retaining the original rejection)
              if (failures.length > 1)
                throw new AggregateError(failures, 'Captured PR failure cleanup failed');
              throw failure;
            }
            release();
            throw failure;
          }
        },
      };
    },
    async read<T>(operation: WorkspaceGitOperation): Promise<T> {
      if (!current()) throw unavailable();
      let input: WorkspaceGitOperation;
      try {
        input = WorkspaceGitOperationSchema.parse(operation);
      } catch {
        release();
        throw unavailable();
      }
      if (consumed.has(input.operation)) throw unavailable();
      consumed.add(input.operation);
      let route: CapturedWorkspaceLoadRoute | null = null;
      try {
        if (!current()) throw unavailable();
        route = await origin!.prepare(crypto.randomUUID(), workspaceId, controller.signal);
        if (!route) {
          release();
          throw unavailable();
        }
        if (!current()) throw unavailable();
        routes.add(route);
        const value = await route.readGit<T>(input);
        if (!current()) throw unavailable();
        return value;
      } catch (error) {
        if (!current()) throw unavailable();
        throw error;
      } finally {
        if (route) {
          routes.delete(route);
          route.release();
        }
      }
    },
  };
  if (!current()) return { kind: 'unavailable' };
  return { kind: 'acquired', scope };
}
