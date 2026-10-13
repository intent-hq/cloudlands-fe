import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import type { EventRecoverySession } from '$shared/event-recovery/session';
import {
  EventRecoveryCoordinator,
  type AdmittedEventObserver,
  type ResourceOwner,
} from './event-recovery-coordinator';

export interface RendererRecoveryOwner<T> extends ResourceOwner<T> {
  /** Captured caller/workspace authority, including ABA transitions. */
  isCurrent(): boolean;
}
export type RendererRecoveryHandle = ReturnType<EventRecoveryCoordinator['registerResource']>;
export interface RendererRecoveryScope {
  registerResource<T>(owner: RendererRecoveryOwner<T>): RendererRecoveryHandle;
  request: EventRecoverySession['request'];
  /** Transient effects only; state writers use admitted resource lifetimes. */
  onNotification: EventRecoverySession['onNotification'];
  isCurrent(): boolean;
  subscribe: EventRecoveryCoordinator['subscribe'];
  unsubscribe: EventRecoveryCoordinator['unsubscribe'];
  ownsSubscription: EventRecoveryCoordinator['ownsSubscription'];
}
type Factory = (scope: RendererRecoveryScope) => () => void;
type Entry = {
  key: string;
  workspaceId: string | null;
  handle?: RendererRecoveryHandle;
  current(): boolean;
  retire(error: unknown): void;
  disposed: boolean;
};
type Attachment = {
  session: EventRecoverySession;
  coordinator: EventRecoveryCoordinator;
  scope: RendererRecoveryScope;
  cleanups: Map<Factory, () => void>;
  offRetired: () => void;
  observers: Set<() => void>;
};
const unavailable = () =>
  Object.assign(new Error('Event recovery authority retired'), { rpcCode: -32003 });

/**
 * One renderer session and one registered owner per read key. Domain factories
 * install demand-specific resources on each captured session. There is no global
 * subscription or implicit recovery opt-in here.
 */
export class RendererEventRecovery {
  private attachment: Attachment | undefined;
  private epoch: object = {};
  private physicalSessionIdentity: object = {};
  private readonly factories = new Set<Factory>();
  // Keep disposed entries as tombstones until session replacement: an old writer
  // must not regain the permissive legacy path after its owner is removed.
  private readonly entries = new Map<string, Entry>();

  onSession(factory: Factory): () => void {
    this.factories.add(factory);
    if (this.attachment) this.install(this.attachment, factory);
    return () => {
      this.factories.delete(factory);
      const attachment = this.attachment;
      const cleanup = attachment?.cleanups.get(factory);
      attachment?.cleanups.delete(factory);
      cleanup?.();
    };
  }

  attach(session: EventRecoverySession, admitted?: AdmittedEventObserver): RendererRecoveryScope {
    this.detach();
    if (!session.isCurrent()) throw unavailable();
    this.physicalSessionIdentity = session;
    const coordinator = new EventRecoveryCoordinator(session, undefined, (event, lifetimes) => {
      const guarded = new Map(lifetimes);
      for (const [key, token] of lifetimes) {
        const row = this.entries.get(key);
        if (!token || !row) continue;
        guarded.set(key, {
          key: token.key,
          isCurrent: () => row.current() && token.isCurrent(),
          commit: (mutation) => row.current() && token.commit(mutation),
        });
      }
      return admitted?.(event, guarded);
    });
    const attachment: Attachment = {
      session,
      coordinator,
      scope: {
        registerResource: (owner) => this.register(attachment, owner),
        request: async <T>(method: string, params?: unknown): Promise<T> => {
          if (this.attachment !== attachment || !session.isCurrent()) throw unavailable();
          const value = await session.request<T>(method, params);
          if (this.attachment !== attachment || !session.isCurrent()) throw unavailable();
          return value;
        },
        isCurrent: () => this.attachment === attachment && session.isCurrent(),
        onNotification: (handler) => {
          if (this.attachment !== attachment || !session.isCurrent()) return () => {};
          const off = session.onNotification((event) => {
            if (this.attachment === attachment && session.isCurrent()) return handler(event);
          });
          attachment.observers.add(off);
          return () => {
            attachment.observers.delete(off);
            off();
          };
        },
        subscribe: (...args) => coordinator.subscribe(...args),
        unsubscribe: (id) => coordinator.unsubscribe(id),
        ownsSubscription: (id) => coordinator.ownsSubscription(id),
      },
      cleanups: new Map(),
      offRetired: () => {},
      observers: new Set(),
    };
    this.attachment = attachment;
    attachment.offRetired = session.onRetired(() => {
      if (this.attachment === attachment) this.detach();
    });
    for (const factory of this.factories) this.install(attachment, factory);
    return attachment.scope;
  }

  private install(attachment: Attachment, factory: Factory) {
    const owned = new Set<RendererRecoveryHandle>();
    const observers = new Set<() => void>();
    let live = true;
    const current = () => live && attachment.scope.isCurrent();
    const cleanup = factory({
      ...attachment.scope,
      isCurrent: current,
      request: async <T>(method: string, params?: unknown): Promise<T> => {
        if (!current()) throw unavailable();
        const result = await attachment.scope.request<T>(method, params);
        if (!current()) throw unavailable();
        return result;
      },
      subscribe: async (...args) => {
        if (!current()) return;
        const lease = await attachment.scope.subscribe(...args);
        if (!current()) {
          if (lease) await attachment.scope.unsubscribe(lease.id);
          return;
        }
        return lease;
      },
      onNotification: (handler) => {
        if (!current()) return () => {};
        const off = attachment.scope.onNotification((event) => {
          if (current()) return handler(event);
        });
        observers.add(off);
        return () => {
          observers.delete(off);
          off();
        };
      },
      registerResource: (owner) => {
        if (!current()) throw unavailable();
        const handle = attachment.scope.registerResource(owner);
        owned.add(handle);
        return handle;
      },
    });
    attachment.cleanups.set(factory, () => {
      live = false;
      for (const off of observers) off();
      cleanup();
      for (const handle of owned) handle.dispose();
    });
  }

  private register<T>(attachment: Attachment, owner: RendererRecoveryOwner<T>) {
    if (this.attachment !== attachment || !attachment.session.isCurrent()) throw unavailable();
    const previous = this.entries.get(owner.key);
    if (previous && !previous.disposed) throw new Error(`Duplicate recovery owner: ${owner.key}`);
    const row: Entry = {
      key: owner.key,
      workspaceId: owner.workspaceId,
      disposed: false,
      current: () => {
        if (row.disposed || this.attachment !== attachment) return false;
        if (!attachment.session.isCurrent() || !owner.isCurrent()) {
          row.retire(unavailable());
          return false;
        }
        return true;
      },
      retire: (error) => {
        if (row.disposed) return;
        row.disposed = true;
        row.handle?.dispose();
        owner.retire(error);
      },
    };
    this.entries.set(owner.key, row);
    const wrap = (token: RecoveryLifetime): RecoveryLifetime => ({
      key: token.key,
      isCurrent: () => row.current() && token.isCurrent(),
      commit: (mutation) => row.current() && token.commit(mutation),
    });
    const handle = attachment.coordinator.registerResource({
      ...owner,
      read: (reader) => {
        if (!row.current()) return Promise.reject(unavailable());
        return owner.read({
          lifetime: wrap(reader.lifetime),
          request: async <R>(method: string, params?: unknown): Promise<R> => {
            if (!row.current()) throw unavailable();
            const value = await reader.request<R>(method, params);
            if (!row.current()) throw unavailable();
            return value;
          },
        });
      },
      apply: (value) => {
        if (row.current()) owner.apply(value);
      },
      invalidate: () => {
        if (row.current()) owner.invalidate();
      },
      retire: (error) => {
        row.retire(error);
      },
      onEvent: owner.onEvent
        ? (event, lifetime) => {
            if (row.current()) return owner.onEvent?.(event, wrap(lifetime));
          }
        : undefined,
    });
    row.handle = handle;
    return {
      ...handle,
      get status() {
        return handle.status;
      },
      captureLifetime: () => wrap(handle.captureLifetime()),
      push: () => row.current() && handle.push(),
      dispose: () => {
        row.disposed = true;
        handle.dispose();
      },
    };
  }

  /** Accounting only: never a permission or freshness receipt. Retirement keeps
   * the last token so draining physical work cannot gain a second lane. Before
   * first attachment the registry has one stable legacy token; a new captured
   * session replaces it, while resource/authority refreshes do not.
   */
  capturePhysicalSessionIdentity(): object {
    return this.physicalSessionIdentity;
  }

  /** Every asynchronous ordinary read captures before dispatch, not after await. */
  hasOwner(key: string): boolean {
    return !!this.attachment && this.entries.has(key);
  }

  /** Late failures may retire only the resource authority captured before the read. */
  captureRetirement(key: string): (error: unknown) => boolean {
    const epoch = this.epoch;
    const row = this.entries.get(key);
    return (error) => {
      if (!row || epoch !== this.epoch || this.entries.get(key) !== row || !row.current())
        return false;
      row.retire(error);
      return true;
    };
  }

  /** User commands retain caller authority across unrelated snapshot mutations. */
  captureAuthority(key: string): RecoveryLifetime {
    const epoch = this.epoch;
    const row = this.entries.get(key);
    const current = () =>
      epoch === this.epoch && this.entries.get(key) === row && (!row || row.current());
    return {
      key: epoch,
      isCurrent: current,
      commit: (mutation) => {
        if (!current()) return false;
        mutation();
        return true;
      },
    };
  }

  /** Capture owners now when asynchronous resolution will reveal the resource key later. */
  captureAuthoritySelector(): (key: string) => RecoveryLifetime {
    const epoch = this.epoch;
    const entries = new Map(this.entries);
    return (key) => {
      const row = entries.get(key);
      const current = () =>
        epoch === this.epoch && this.entries.get(key) === row && (!row || row.current());
      return {
        key: epoch,
        isCurrent: current,
        commit: (mutation) => {
          if (!current()) return false;
          mutation();
          return true;
        },
      };
    };
  }

  /** Snapshot data receipts before asynchronous discovery reveals a child key. */
  captureSelector(): (key: string) => RecoveryLifetime {
    const fallback = this.captureAuthoritySelector();
    const receipts = new Map<string, RecoveryLifetime>();
    for (const key of this.entries.keys()) receipts.set(key, this.capture(key));
    return (key) => receipts.get(key) ?? fallback(key);
  }

  capture(key: string): RecoveryLifetime {
    const epoch = this.epoch;
    const row = this.entries.get(key);
    const token = row?.handle?.captureLifetime();
    const current = () =>
      epoch === this.epoch &&
      this.entries.get(key) === row &&
      (!row || row.current()) &&
      (!token || token.isCurrent());
    return {
      key: token?.key ?? epoch,
      isCurrent: current,
      commit: (mutation) => {
        if (!current()) return false;
        if (token) return token.commit(mutation);
        mutation();
        return true;
      },
    };
  }

  /** Call once per direct push; capture its token only after this admission. */
  push(key: string): boolean {
    const row = this.entries.get(key);
    return row ? row.current() && !!row.handle?.push() : true;
  }

  invalidate(key: string): void {
    const row = this.entries.get(key);
    if (row?.current()) row.handle?.invalidate();
  }

  retireWorkspace(workspaceId: string): void {
    for (const row of this.entries.values())
      if (row.workspaceId === workspaceId) row.retire(unavailable());
  }

  /** Renderer authority can change while the physical connection and global lease stay live. */
  refreshAuthority(reconcile = false): void {
    const attachment = this.attachment;
    if (!attachment || !attachment.session.isCurrent()) return;
    this.epoch = {};
    for (const row of this.entries.values()) row.retire(unavailable());
    const cleanups = [...attachment.cleanups.values()];
    attachment.cleanups.clear();
    for (const cleanup of cleanups) cleanup();
    this.entries.clear();
    for (const factory of this.factories) this.install(attachment, factory);
    if (reconcile) for (const row of this.entries.values()) row.handle?.invalidate();
  }

  private detach() {
    const previous = this.attachment;
    this.attachment = undefined;
    this.epoch = {};
    previous?.offRetired();
    for (const off of previous?.observers ?? []) off();
    for (const row of this.entries.values()) row.retire(unavailable());
    for (const cleanup of previous?.cleanups.values() ?? []) cleanup();
    previous?.coordinator.dispose();
    this.entries.clear();
  }

  dispose(): void {
    this.detach();
  }
}

export const rendererEventRecovery = new RendererEventRecovery();
