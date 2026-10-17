import { captureRuntimeReadAuthority } from '$features/events/runtime-read-authority';
import { runtimeReadDrained } from '$features/events/runtime-read-lane';
import {
  rendererEventRecovery,
  type RendererRecoveryScope,
} from '$features/events/renderer-event-recovery';
import type { TerminalEventHandlers, TerminalMetadataEvent } from '../app-client';

type Consumer = { terminalId: string; handlers: TerminalEventHandlers; adopted(): void };
type Group = {
  consumers: Set<Consumer>;
  adopted: boolean;
  scope?: RendererRecoveryScope;
  ready: Promise<void>;
  refresh(): void;
  dispose(): void;
};
const groups = new Map<string, Group>();
export const terminalRuntimeKey = (workspaceId: string) =>
  'terminal-runtime:' + JSON.stringify([workspaceId]);
const pendingReads = new Map<string, { lifetime: object; settled: Promise<void> }>();
/** Share this lane with the lifecycle list owner; validate its receipt inside read. */
export function trackTerminalRuntimeRead<T>(
  workspaceId: string,
  read: () => Promise<T>,
): Promise<T> {
  // Both projections share terminal.list; retire only their original registered owners.
  const authorities = [
    captureRuntimeReadAuthority(terminalRuntimeKey(workspaceId), true),
    captureRuntimeReadAuthority('terminals:' + JSON.stringify([workspaceId]), true),
  ];
  const lifetime = rendererEventRecovery.capturePhysicalSessionIdentity();
  const previous = pendingReads.get(workspaceId);
  const invoke = () => {
    try {
      return Promise.resolve(read());
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const result = (previous?.lifetime === lifetime ? previous.settled.then(invoke) : invoke()).catch(
    (error: unknown) => {
      authorities.forEach((authority) => authority.failed(error));
      throw error;
    },
  );
  const settled = runtimeReadDrained(result, (outcome) => {
    authorities.forEach((authority) => authority.completed(outcome));
  });
  const entry = { lifetime, settled };
  pendingReads.set(workspaceId, entry);
  void settled.then(() => {
    if (pendingReads.get(workspaceId) === entry) pendingReads.delete(workspaceId);
  });
  return result;
}
/** Lease admission changes the owner lifetime; ordinary reads capture afterward. */
export function terminalRuntimeReady(workspaceId: string): Promise<void> {
  return groups.get(workspaceId)?.ready ?? Promise.resolve();
}
/** Ordinary existence checks and recovery share one workspace read lane. */
export function readTerminalRuntimeList<T>(
  workspaceId: string,
  fallback: () => Promise<T>,
): Promise<T> {
  const group = groups.get(workspaceId);
  if (!group?.scope) return trackTerminalRuntimeRead(workspaceId, fallback);
  const scope = group.scope;
  const token = rendererEventRecovery.capture(terminalRuntimeKey(workspaceId));
  return trackTerminalRuntimeRead(workspaceId, () => {
    if (!token.commit(() => {})) throw new Error('Terminal read superseded');
    return scope.request<T>('terminal.list', { workspaceId });
  });
}
function chunk(value: unknown): string {
  try {
    return typeof value === 'string'
      ? new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)))
      : '';
  } catch {
    return '';
  }
}
/** Shared metadata owner, with one captured lease per workspace and no output replay. */
export function subscribeTerminalRuntime(
  workspaceId: string,
  terminalId: string,
  handlers: TerminalEventHandlers,
  adopted: () => void,
) {
  const consumer: Consumer = { terminalId, handlers, adopted };
  let group = groups.get(workspaceId);
  if (!group) {
    group = {
      consumers: new Set([consumer]),
      adopted: false,
      ready: Promise.resolve(),
      refresh: () => {},
      dispose: () => {},
    };
    groups.set(workspaceId, group);
    const owned = group;
    group.dispose = rendererEventRecovery.onSession((scope) => {
      const reconnecting = owned.adopted;
      owned.adopted = true;
      owned.scope = scope;
      let live = true;
      let recovered = false;
      let leaseId: string | undefined;
      const abort = new AbortController();
      for (const row of owned.consumers) row.adopted();
      const emitSnapshot = (row: Consumer, value: TerminalMetadataEvent) => {
        row.handlers.onMetadata?.(value);
      };
      const readSnapshot = async (request: RendererRecoveryScope['request']) => {
        type TerminalRow = { id?: string; terminalId?: string; isExecutingCommand?: boolean };
        const raw = await request<{ terminals: TerminalRow[] } | TerminalRow[]>('terminal.list', {
          workspaceId,
        });
        const result = Array.isArray(raw) ? { terminals: raw } : raw;
        if (!Array.isArray(result?.terminals))
          throw new Error('Invalid terminal metadata snapshot');
        return result;
      };
      const applySnapshot = (result: Awaited<ReturnType<typeof readSnapshot>>) => {
        for (const row of owned.consumers) {
          const current = result.terminals.find((t) => (t.terminalId ?? t.id) === row.terminalId);
          emitSnapshot(row, {
            terminalId: row.terminalId,
            isConnected: !!current && current.isExecutingCommand !== false,
            // Spawn cwd/name are not current shell metadata. A live snapshot
            // preserves transient observations received after invalidation.
            ...(!current || current.isExecutingCommand === false ? { clearTransient: true } : {}),
          });
        }
      };
      const owner = scope.registerResource({
        key: terminalRuntimeKey(workspaceId),
        workspaceId,
        eventTypes: ['terminal:exit'],
        isCurrent: () => live && owned.scope === scope && groups.get(workspaceId) === owned,
        read: (reader) => trackTerminalRuntimeRead(workspaceId, () => readSnapshot(reader.request)),
        apply: (result) => {
          recovered = true;
          applySnapshot(result);
        },
        invalidate: () => {
          for (const row of owned.consumers)
            emitSnapshot(row, { terminalId: row.terminalId, clearTransient: true });
        },
        retire: () => {
          live = false;
          abort.abort();
          if (leaseId) void scope.unsubscribe(leaseId);
          for (const row of owned.consumers)
            emitSnapshot(row, {
              terminalId: row.terminalId,
              isConnected: false,
              clearTransient: true,
            });
        },
      });
      owned.refresh = () => {
        if (live && recovered) owner.invalidate();
      };
      const off = scope.onNotification((notification) => {
        if (!live || notification.method !== 'events.event') return;
        const params = notification.params as {
          subscriptionId?: string;
          event?: {
            type?: string;
            data?: {
              terminalId?: string;
              chunk?: unknown;
              exitCode?: number;
              cwd?: string;
              title?: string;
            };
          };
        };
        if (!leaseId || params.subscriptionId !== leaseId) return;
        const event = params.event;
        const metadataAllowed = !recovered && !owner.status.stale;
        for (const row of owned.consumers)
          if (event?.data?.terminalId === row.terminalId) {
            // Cwd/title are live observations, not authoritative list fields.
            if (event.type === 'terminal:cwd' && typeof event.data.cwd === 'string')
              row.handlers.onCwd?.({ terminalId: row.terminalId, cwd: event.data.cwd });
            if (event.type === 'terminal:title' && typeof event.data.title === 'string')
              row.handlers.onTitle?.({ terminalId: row.terminalId, title: event.data.title });
            if (event.type === 'terminal:data')
              row.handlers.onData?.({
                terminalId: row.terminalId,
                chunk: chunk(event.data.chunk),
                metadataAllowed,
              });
            if (event.type === 'terminal:exit')
              row.handlers.onExit?.({
                terminalId: row.terminalId,
                exitCode: event.data.exitCode ?? 0,
                metadataAllowed,
              });
          }
      });
      owned.ready = scope
        .subscribe(
          {
            workspaceId,
            eventTypes: ['terminal:data', 'terminal:exit', 'terminal:cwd', 'terminal:title'],
          },
          { recover: true, signal: abort.signal },
        )
        .then((lease) => {
          if (!live) return;
          leaseId = lease?.id;
          if (reconnecting) {
            const token = rendererEventRecovery.capture(terminalRuntimeKey(workspaceId));
            void trackTerminalRuntimeRead(workspaceId, () => {
              if (!token.commit(() => {})) throw new Error('Terminal read superseded');
              return readSnapshot(scope.request);
            })
              .then((result) => {
                token.commit(() => {
                  applySnapshot(result);
                });
              })
              .catch(() => {});
          }
        })
        .catch(() => {});
      return () => {
        live = false;
        abort.abort();
        off();
        owner.dispose();
        if (leaseId) void scope.unsubscribe(leaseId);
        if (owned.scope === scope) owned.scope = undefined;
      };
    });
  } else {
    group.consumers.add(consumer);
    if (group.adopted) adopted();
    group.refresh();
  }
  const owned = group;
  let disposed = false;
  return {
    isAdopted: () => owned.adopted,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      owned.consumers.delete(consumer);
      if (!owned.consumers.size) {
        owned.dispose();
        groups.delete(workspaceId);
      }
    },
  };
}
