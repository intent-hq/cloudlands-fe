import { z } from 'zod';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import {
  WorkspaceLoadErrorSchema,
  WorkspaceLoadOriginRefSchema,
  WorkspaceLoadPrepareSchema,
  WorkspaceLoadReadOutcomeSchema,
  WorkspaceLoadRouteRefSchema,
  type WorkspaceLoadOriginRef,
  type WorkspaceLoadPrepare,
  type WorkspaceLoadRetired,
  type WorkspaceLoadRouteRef,
} from '$shared/types/workspace-load-route';
import type { WorkspaceDomainReadTransport } from '../../../store/renderer/slices/workspace/utils/workspace-domain-client-types';
import { BackendError } from './backend-transport-types';
import { electronAPI } from './electron-ipc-transport';

/** Proposed channel descriptor only; nothing registers or activates these channels. */
export type WorkspaceLoadBridgeChannels = Readonly<{
  OBSERVE_ORIGIN: string;
  PREPARE: string;
  READ: string;
  RELEASE: string;
  RELEASE_ORIGIN: string;
  RETIRED: string;
}>;

export interface CapturedWorkspaceLoadRoute {
  readonly ref: Readonly<WorkspaceLoadRouteRef>;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  read<T = unknown>(operation: 'open' | 'get'): Promise<T>;
  createDomainReadTransport(): WorkspaceDomainReadTransport;
  release(): void;
}

export interface CapturedWorkspaceLoadOrigin {
  readonly identity: object;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  onRetired(listener: () => void): () => void;
  prepare(
    requestId: string,
    workspaceId: string,
    requestSignal: AbortSignal,
  ): Promise<CapturedWorkspaceLoadRoute | null>;
  /** Eligibility failures retire the ORIGINAL authority before canonical error folding. */
  retire(): void;
  release(): void;
}

const ChannelsSchema = z
  .object({
    OBSERVE_ORIGIN: z.string().min(1),
    PREPARE: z.string().min(1),
    READ: z.string().min(1),
    RELEASE: z.string().min(1),
    RELEASE_ORIGIN: z.string().min(1),
    RETIRED: z.string().min(1),
  })
  .strict();
const EnvelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: z.unknown() }).strict(),
  z.object({ ok: z.literal(false), error: WorkspaceLoadErrorSchema }).strict(),
]);
const RetirementSchema = z.discriminatedUnion('kind', [
  WorkspaceLoadOriginRefSchema.extend({ kind: z.literal('origin') }).strict(),
  WorkspaceLoadRouteRefSchema.extend({ kind: z.literal('route') }).strict(),
]);
const OpenInputSchema = z.object({ id: z.string().min(1) }).strict();
const MAX_EARLY_NOTICES = 32;
const MAX_REQUESTS = 128;

function unavailable() {
  // i18n-ignore (internal eligibility diagnostic; canonical domain client folds it)
  return new BackendError({
    code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE',
    message: 'Workspace load route unavailable',
  });
}

function unwrap(response: unknown): unknown {
  const envelope = EnvelopeSchema.parse(response);
  if (!envelope.ok) throw new BackendError(envelope.error);
  if (!Object.hasOwn(envelope, 'result')) throw unavailable();
  return envelope.result;
}

function sameRef(left: WorkspaceLoadRouteRef, right: WorkspaceLoadRouteRef): boolean {
  return (
    left.originId === right.originId &&
    left.requestId === right.requestId &&
    left.workspaceId === right.workspaceId &&
    left.routeId === right.routeId
  );
}

/** No bridge lookup, request, listener or Store startup until explicit observeOrigin. */
export function createElectronWorkspaceLoadTransport(
  channels: WorkspaceLoadBridgeChannels,
  readApi: typeof electronAPI = electronAPI,
) {
  return {
    async observeOrigin(
      observationSignal?: AbortSignal,
    ): Promise<CapturedWorkspaceLoadOrigin | null> {
      if (observationSignal) {
        try {
          if (observationSignal.aborted) return null;
        } catch {
          return null;
        }
      }
      let api: NonNullable<ReturnType<typeof electronAPI>>;
      let invoke: typeof api.invoke;
      let on: typeof api.on;
      let off: typeof api.offById;
      let names: WorkspaceLoadBridgeChannels;
      try {
        const candidate = readApi();
        if (!candidate) return null;
        api = candidate;
        invoke = api.invoke;
        on = api.on;
        off = api.offById;
        names = Object.freeze(ChannelsSchema.parse(channels));
        if (
          new Set(Object.values(names)).size !== 6 ||
          typeof invoke !== 'function' ||
          typeof on !== 'function' ||
          typeof off !== 'function' ||
          readApi() !== api
        )
          return null;
      } catch {
        return null;
      }

      const controller = new AbortController();
      const identity = Object.freeze({});
      let retired = false;
      let ref: Readonly<WorkspaceLoadOriginRef> | undefined;
      let listenerId: string | undefined;
      let listenerRemoved = false;
      let originReleaseSent = false;
      let notifying = false;
      const cleanup: Array<() => void> = [];
      const listeners = new Set<() => void>();
      const early = new Map<string, WorkspaceLoadRetired>();
      const requests = new Set<string>();
      const pending = new Map<
        string,
        { workspaceId: string; signal: AbortSignal; cancel(): void }
      >();
      const releasedRoutes = new Set<string>();
      const routes = new Map<
        string,
        { ref: WorkspaceLoadRouteRef; end(): void; requestCancelled(): boolean; release(): void }
      >();

      function bestEffort(channel: string, payload: unknown): void {
        if (notifying) {
          cleanup.push(() => bestEffort(channel, payload));
          return;
        }
        try {
          void Promise.resolve(Reflect.apply(invoke, api, [channel, payload])).catch(() => {});
        } catch {
          // Main document disposal and TTL also retire the original resource.
        }
      }
      function releaseKnownOrigin(): void {
        if (!ref || originReleaseSent) return;
        originReleaseSent = true;
        bestEffort(names.RELEASE_ORIGIN, ref);
      }
      function detach(): void {
        if (listenerId === undefined || listenerRemoved) return;
        listenerRemoved = true;
        try {
          Reflect.apply(off, api, [names.RETIRED, listenerId]);
        } catch {
          /* Continue cleanup. */
        }
      }
      function releaseKnownRoute(value: WorkspaceLoadRouteRef): void {
        if (releasedRoutes.has(value.routeId)) return;
        releasedRoutes.add(value.routeId);
        bestEffort(names.RELEASE, value);
      }
      function retire(): void {
        if (retired) return;
        retired = true;
        notifying = true;
        const children = [...routes.values()];
        routes.clear();
        early.clear();
        controller.abort();
        for (const child of children) child.end();
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch {
            /* Every owner must learn retirement. */
          }
        }
        listeners.clear();
        notifying = false;
        detach();
        for (const finish of cleanup.splice(0)) finish();
        releaseKnownOrigin();
      }
      function isCurrent(): boolean {
        if (retired) return false;
        let same = false;
        try {
          same = readApi() === api;
        } catch {
          /* Treat a throwing getter as lost authority. */
        }
        if (!same || retired) {
          retire();
          return false;
        }
        return true;
      }
      function buffer(notice: WorkspaceLoadRetired): void {
        early.set(JSON.stringify(notice), notice);
        if (early.size > MAX_EARLY_NOTICES) retire();
      }
      function observeRetirement(payload: unknown): void {
        if (retired) return;
        try {
          const notice = RetirementSchema.parse(payload);
          if (!ref) {
            buffer(notice);
            return;
          }
          const owned = notice.kind === 'route' ? routes.get(notice.routeId) : undefined;
          if (owned) {
            // Request abort may precede composition receiving this prepared route.
            if (owned.requestCancelled()) owned.release();
            // Known live ID with either its exact tuple or a conflicting tuple is terminal.
            else retire();
            return;
          }
          if (notice.originId !== ref.originId) return;
          if (notice.kind === 'origin') {
            retire();
            return;
          }
          if (releasedRoutes.has(notice.routeId)) return;
          const admission = pending.get(notice.requestId);
          if (admission) {
            // Abort may be dispatching an earlier listener: remove ownership before reentry.
            if (admission.signal.aborted) admission.cancel();
            else if (admission.workspaceId !== notice.workspaceId) retire();
            else buffer(notice);
          }
        } catch {
          retire();
        }
      }

      let observationCancelled = false;
      let observationTransferred = false;
      let stopObservation: (() => void) | undefined;
      let cancellation: Promise<null> | undefined;
      let settleCancellation: (() => void) | undefined;
      function cancelObservation(): void {
        if (observationCancelled || observationTransferred) return;
        observationCancelled = true;
        retire();
        stopObservation?.();
        settleCancellation?.();
      }

      try {
        if (observationSignal) {
          cancellation = new Promise<null>((resolve) => {
            settleCancellation = () => resolve(null);
          });
          const add = observationSignal.addEventListener;
          const remove = observationSignal.removeEventListener;
          let registered = false;
          let removed = false;
          stopObservation = () => {
            if (!registered || removed) return;
            removed = true;
            try {
              Reflect.apply(remove, observationSignal, ['abort', cancelObservation]);
            } catch {
              /* Transfer/cancellation still ends this signal's ownership. */
            }
          };
          if (observationSignal.aborted) cancelObservation();
          if (observationCancelled) return null;
          try {
            Reflect.apply(add, observationSignal, ['abort', cancelObservation, { once: true }]);
          } finally {
            // Registration can abort or throw before returning its installed listener.
            registered = true;
            if (observationCancelled) stopObservation();
          }
          if (observationSignal.aborted) cancelObservation();
          if (observationCancelled) return null;
        }
        const id = Reflect.apply(on, api, [names.RETIRED, observeRetirement]);
        if (typeof id !== 'string' || !id) throw unavailable();
        listenerId = id;
        if (!isCurrent()) {
          detach();
          return null;
        }
        if (cancellation) {
          const invoked = Reflect.apply(invoke, api, [names.OBSERVE_ORIGIN]);
          const drained = Promise.resolve(invoked).then((response) => {
            ref = Object.freeze(WorkspaceLoadOriginRefSchema.parse(unwrap(response)));
            // Native invoke cannot be cancelled; retain its original response cleanup.
            if (observationCancelled) releaseKnownOrigin();
          });
          await Promise.race([drained, cancellation]);
          if (observationCancelled) return null;
        } else {
          const raw = unwrap(await Reflect.apply(invoke, api, [names.OBSERVE_ORIGIN]));
          ref = Object.freeze(WorkspaceLoadOriginRefSchema.parse(raw));
        }
        const notices = [...early.values()];
        early.clear();
        for (const notice of notices) observeRetirement(notice);
        if (!isCurrent()) {
          releaseKnownOrigin();
          return null;
        }
      } catch {
        retire();
        releaseKnownOrigin();
        return null;
      } finally {
        stopObservation?.();
      }

      const origin: CapturedWorkspaceLoadOrigin = {
        identity,
        signal: controller.signal,
        isCurrent,
        retire,
        release: retire,
        onRetired(listener) {
          if (!isCurrent()) {
            try {
              listener();
            } catch {
              /* Already retired; a listener cannot revive it. */
            }
            return () => {};
          }
          const entry = () => listener();
          listeners.add(entry);
          return () => {
            listeners.delete(entry);
          };
        },
        async prepare(requestId, workspaceId, requestSignal) {
          let expected: Readonly<WorkspaceLoadPrepare>;
          try {
            expected = Object.freeze(
              WorkspaceLoadPrepareSchema.parse({ ...ref, requestId, workspaceId }),
            );
          } catch {
            retire();
            return null;
          }
          if (!isCurrent() || requests.has(requestId)) return null;
          if (requests.size >= MAX_REQUESTS) {
            retire();
            return null;
          }
          requests.add(requestId);
          let cancelled = false;
          let cancellationSent = false;
          let removeAbort: AbortSignal['removeEventListener'] | undefined;
          let resolveCancelled!: (value: { kind: 'cancelled' }) => void;
          const cancellation = new Promise<{ kind: 'cancelled' }>((resolve) => {
            resolveCancelled = resolve;
          });
          const admission = { workspaceId, signal: requestSignal, cancel };
          function clearAdmission(): void {
            if (pending.get(requestId) === admission) pending.delete(requestId);
            for (const [key, notice] of early) {
              if (notice.kind === 'route' && notice.requestId === requestId) early.delete(key);
            }
          }
          function detachPreparation(): void {
            try {
              if (removeAbort) Reflect.apply(removeAbort, requestSignal, ['abort', cancel]);
            } catch {
              /* Continue local settlement even if old listener cleanup fails. */
            }
            controller.signal.removeEventListener('abort', cancelOrigin);
          }
          function cancel(): void {
            finishCancellation(true);
          }
          function cancelOrigin(): void {
            finishCancellation(false);
          }
          function finishCancellation(releaseRequest: boolean): void {
            if (cancelled) return;
            cancelled = true;
            clearAdmission();
            detachPreparation();
            resolveCancelled({ kind: 'cancelled' });
            if (releaseRequest && !cancellationSent) {
              cancellationSent = true;
              bestEffort(names.RELEASE, expected);
            }
          }
          function isCancelled(): boolean {
            if (cancelled) return true;
            if (requestSignal.aborted) cancel();
            return cancelled;
          }
          function preparationCurrent(): boolean {
            try {
              if (isCancelled()) return false;
              const originalCurrent = isCurrent();
              const originalCancelled = isCancelled();
              // Every external getter/callback has finished; read irreversible latches last.
              return originalCurrent && !originalCancelled && !retired && !cancelled;
            } catch {
              if (!cancelled) retire();
              return false;
            }
          }
          pending.set(requestId, admission);
          let prepared: Readonly<WorkspaceLoadRouteRef> | undefined;
          try {
            const addAbort = requestSignal.addEventListener;
            removeAbort = requestSignal.removeEventListener;
            Reflect.apply(addAbort, requestSignal, ['abort', cancel, { once: true }]);
            controller.signal.addEventListener('abort', cancelOrigin, { once: true });
            if (!preparationCurrent()) return null;
            // Drain the original invocation even when abort wins while IPC withholds its reply.
            const reply = Promise.resolve(
              Reflect.apply(invoke, api, [names.PREPARE, expected]),
            ).then(
              (response) => {
                if (cancelled || retired) {
                  try {
                    const late = WorkspaceLoadRouteRefSchema.parse(unwrap(response));
                    if (
                      late.originId === expected.originId &&
                      late.requestId === requestId &&
                      late.workspaceId === workspaceId
                    )
                      releaseKnownRoute(late);
                  } catch {
                    /* A late malformed/refused reply cannot retire a sibling. */
                  }
                }
                return { kind: 'reply' as const, response };
              },
              (error: unknown) => ({ kind: 'error' as const, error }),
            );
            const outcome = await Promise.race([reply, cancellation]);
            if (outcome.kind === 'cancelled') return null;
            if (outcome.kind === 'error') throw outcome.error;
            const raw = unwrap(outcome.response);
            const value = WorkspaceLoadRouteRefSchema.parse(raw);
            if (
              value.originId !== expected.originId ||
              value.requestId !== requestId ||
              value.workspaceId !== workspaceId ||
              routes.has(value.routeId) ||
              releasedRoutes.has(value.routeId)
            ) {
              throw unavailable();
            }
            prepared = Object.freeze(value);
            if (isCancelled()) {
              releaseKnownRoute(prepared);
              return null;
            }
            const notices = [...early.values()].filter(
              (notice) =>
                notice.kind === 'route' &&
                notice.originId === expected.originId &&
                notice.requestId === requestId,
            );
            for (const [key, notice] of early) {
              if (notice.kind === 'route' && notice.requestId === requestId) early.delete(key);
            }
            // One request has only one route; any retirement/conflict for it is terminal.
            if (notices.length > 0) retire();
            if (!preparationCurrent()) {
              releaseKnownRoute(value);
              return null;
            }
          } catch {
            if (!cancelled) retire();
            if (prepared) releaseKnownRoute(prepared);
            return null;
          } finally {
            clearAdmission();
            detachPreparation();
          }
          if (!preparationCurrent()) {
            releaseKnownRoute(prepared);
            return null;
          }

          const routeRef = prepared;
          const routeController = new AbortController();
          let ended = false;
          function end(): void {
            if (ended) return;
            ended = true;
            routes.delete(routeRef.routeId);
            routeController.abort();
          }
          function releaseRoute(): void {
            if (ended) return;
            end();
            releaseKnownRoute(routeRef);
          }
          function routeCurrent(): boolean {
            if (ended) return false;
            try {
              if (isCancelled()) {
                releaseRoute();
                return false;
              }
              const current = isCurrent();
              const requestCancelled = isCancelled();
              if (requestCancelled) releaseRoute();
              return (
                current &&
                !requestCancelled &&
                !ended &&
                !retired &&
                routes.get(routeRef.routeId)?.end === end
              );
            } catch {
              retire();
              return false;
            }
          }
          function fail(): never {
            retire();
            throw unavailable();
          }
          const route: CapturedWorkspaceLoadRoute = {
            ref: routeRef,
            signal: routeController.signal,
            isCurrent: routeCurrent,
            async read<T>(operation: 'open' | 'get'): Promise<T> {
              if (operation !== 'open' && operation !== 'get') return fail();
              if (!routeCurrent()) throw unavailable();
              let parsed;
              try {
                const payload = Object.freeze({ ...routeRef, operation });
                if (!routeCurrent()) throw unavailable();
                const response = await Reflect.apply(invoke, api, [names.READ, payload]);
                // A cancelled route cannot retire a sibling when its late reply arrives.
                if (ended) throw unavailable();
                const raw = unwrap(response);
                parsed = WorkspaceLoadReadOutcomeSchema.parse(raw);
                if (!sameRef(parsed.ref, routeRef) || !parsed.current) return fail();
                if (
                  parsed.settlement.status === 'fulfilled' &&
                  !Object.hasOwn(parsed.settlement, 'value')
                )
                  return fail();
                if (!routeCurrent()) {
                  // Normal explicit release is local; a stale reply cannot revive it.
                  if (!ended) retire();
                  throw unavailable();
                }
              } catch {
                if (!ended) retire();
                throw unavailable();
              }
              // Outside the eligibility catch: ordinary daemon errors preserve the origin.
              if (parsed.settlement.status === 'rejected')
                throw new BackendError(parsed.settlement.error);
              return parsed.settlement.value as T;
            },
            createDomainReadTransport() {
              return {
                available: routeCurrent,
                async invoke(channel, data) {
                  if (!routeCurrent()) throw unavailable();
                  if (channel === WORKSPACE_CHANNELS.OPEN) {
                    let input;
                    try {
                      input = OpenInputSchema.parse(data);
                    } catch {
                      return fail();
                    }
                    if (input.id !== routeRef.workspaceId) return fail();
                    return route.read('open');
                  }
                  if (
                    channel !== WORKSPACE_CHANNELS.LIST &&
                    channel !== WORKSPACE_CHANNELS.GET_DIFF_SUMMARY &&
                    channel !== WORKSPACE_CHANNELS.GET_GIT_SUMMARY &&
                    channel !== WORKSPACE_CHANNELS.GET_TASKS
                  )
                    return fail();
                  // Real original handlers, with their unchanged Result/CommandResponse envelopes.
                  if (!routeCurrent()) throw unavailable();
                  return Reflect.apply(invoke, api, [channel, data]);
                },
              };
            },
            release: releaseRoute,
          };
          routes.set(routeRef.routeId, {
            ref: routeRef,
            end,
            requestCancelled: isCancelled,
            release: releaseRoute,
          });
          return route;
        },
      };
      if (observationSignal) {
        try {
          if (observationSignal.aborted) cancelObservation();
        } catch {
          cancelObservation();
        }
        if (observationCancelled) return null;
        observationTransferred = true;
      }
      return origin;
    },
  };
}
