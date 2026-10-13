import {
  RecoveryAdmission,
  type RecoveryLease,
  type RecoveryScope,
} from '$shared/event-recovery/admission';
import { RecoveryResource, type RecoveryLifetime } from '$shared/event-recovery/resource';
import type { EventRecoverySession, RecoveryNotification } from '$shared/event-recovery/session';

export interface RecoveryReader {
  readonly lifetime: RecoveryLifetime;
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
}
/** Null means the matching owner's push was rejected; absence means no matching owner. */
export type AdmittedEventLifetimes = ReadonlyMap<string, RecoveryLifetime | null>;
export type AdmittedEventObserver = (
  notification: RecoveryNotification,
  lifetimes: AdmittedEventLifetimes,
) => void | Promise<void>;
export interface ResourceOwner<T> extends RecoveryScope {
  /** Workspace/entity/read key local to this captured backend/principal session.
   * Use reader.lifetime.key (opaque object), never this string, for shared read caches.
   */
  key: string;
  active?: boolean;
  /** Filter irrelevant payloads without weakening lease loss coverage. */
  acceptsEvent?(notification: RecoveryNotification): boolean;
  /** Opt in only with source revisions or proven commit/publication serialization. */
  sourceOrdered?: boolean;
  read(reader: RecoveryReader): Promise<T>;
  /** Atomic store commit inside the end barrier; async preparation belongs in read. */
  apply(value: T): undefined;
  invalidate(): void;
  /** Synchronously clear protected state; terminal owners must be re-registered. */
  retire(error: unknown): undefined;
  /**
   * Own ALL mutations for this resource (including overlapping legacy leases).
   * After awaiting work, write via lifetime.commit. Return the entire processing
   * receipt so end-fence observation waits for it. Never await recovery here.
   */
  onEvent?(notification: RecoveryNotification, lifetime: RecoveryLifetime): void | Promise<void>;
}
interface Registration {
  scope: RecoveryScope;
  resource: Pick<
    RecoveryResource<unknown>,
    'setLeases' | 'invalidate' | 'push' | 'dispose' | 'captureLifetime'
  >;
  onEvent?: ResourceOwner<unknown>['onEvent'];
  acceptsEvent?: ResourceOwner<unknown>['acceptsEvent'];
}
interface SubscribeParams {
  eventTypes: readonly string[];
  workspaceId?: string;
  replaceGroup?: string;
}
const matches = (pattern: string, type: string) =>
  pattern === '*' ||
  pattern === type ||
  (pattern.endsWith('*') && type.startsWith(pattern.slice(0, -1)));
const overlaps = (a: RecoveryScope, b: RecoveryScope) =>
  (a.workspaceId === null || b.workspaceId === null || a.workspaceId === b.workspaceId) &&
  a.eventTypes.some((x) => b.eventTypes.some((y) => matches(x, y) || matches(y, x)));

/** Recovery machinery only. Resource adapters explicitly adopt complete writer/read ownership. */
export class EventRecoveryCoordinator {
  private readonly context = {};
  private readonly admission: RecoveryAdmission;
  private readonly resources = new Map<string, Registration>();
  private readonly groups = new Map<string, string>();
  private readonly groupAttempts = new Map<string, object>();
  private readonly deferredLoss = new Set<RecoveryLease>();
  private admitting = false;
  private disposed = false;
  private readonly offNotification: () => void;
  private readonly offRetired: () => void;
  constructor(
    private readonly session: EventRecoverySession,
    private readonly unhandled?: (notification: RecoveryNotification) => void | Promise<void>,
    private readonly admitted?: AdmittedEventObserver,
  ) {
    this.admission = new RecoveryAdmission(this.context, (lease) => {
      if (this.admitting) this.deferredLoss.add(lease);
      else this.invalidateLease(lease);
    });
    this.offNotification = session.onNotification((n) => this.receive(n));
    this.offRetired = session.onRetired(() => this.dispose());
  }
  ownsSubscription(id: string): boolean {
    return !this.disposed && this.admission.leases.has(id);
  }
  registerResource<T>(owner: ResourceOwner<T>) {
    if (this.disposed || this.resources.has(owner.key))
      throw new Error('Recovery resource owner already registered or retired');
    const resource = new RecoveryResource({
      sourceOrdered: owner.sourceOrdered,
      read: (lifetime) =>
        owner.read({
          lifetime,
          request: async <R>(method: string, params?: unknown): Promise<R> => {
            const assertCurrent = () => {
              if (!lifetime.isCurrent() || !this.session.isCurrent())
                throw new Error('Recovery read lifetime retired');
            };
            assertCurrent();
            const result = await this.session.request<R>(method, params);
            assertCurrent();
            return result;
          },
        }),
      fence: (ids, observe) => this.session.fence(ids, observe),
      apply: owner.apply,
      invalidate: owner.invalidate,
      retire: owner.retire,
    });
    const row: Registration = {
      scope: { workspaceId: owner.workspaceId, eventTypes: [...owner.eventTypes] },
      resource,
      onEvent: owner.onEvent,
      acceptsEvent: owner.acceptsEvent,
    };
    this.resources.set(owner.key, row);
    this.updateLeaseSets();
    if (owner.active === false) resource.setActive(false);
    return {
      get status() {
        return resource.status;
      },
      whenSettled: () => resource.whenSettled(),
      setActive: (active: boolean) => resource.setActive(active),
      changeLifetime: () => resource.changeLifetime(),
      refresh: () => resource.refresh(),
      invalidate: () => resource.invalidate(),
      /** Use for additional mutation owners which participate in this same lifetime. */
      push: () => resource.push(),
      captureLifetime: () => resource.captureLifetime(),
      dispose: () => {
        if (this.resources.get(owner.key) !== row) return;
        resource.dispose();
        this.resources.delete(owner.key);
      },
    };
  }
  async subscribe(
    params: SubscribeParams,
    options: { recover: boolean; signal?: AbortSignal },
  ): Promise<RecoveryLease | undefined> {
    if (this.disposed || !this.session.isCurrent() || options.signal?.aborted) return;
    const immutable = { ...params, eventTypes: [...params.eventTypes] };
    if (immutable.workspaceId === '') throw new Error('Empty recovery workspace');
    if (immutable.replaceGroup) {
      const previous = this.groups.get(immutable.replaceGroup);
      if (previous) this.retire(previous);
    }
    const requested = options.recover && this.session.supported;
    const attempt = this.admission.begin({
      workspaceId: immutable.workspaceId ?? null,
      eventTypes: immutable.eventTypes,
    });
    if (immutable.replaceGroup) {
      const previous = this.groupAttempts.get(immutable.replaceGroup);
      if (previous) this.admission.reject(previous);
      this.groupAttempts.set(immutable.replaceGroup, attempt);
    }
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      this.admission.reject(attempt);
    };
    options.signal?.addEventListener('abort', cancel, { once: true });
    const currentAttempt = () =>
      !cancelled &&
      (!immutable.replaceGroup || this.groupAttempts.get(immutable.replaceGroup) === attempt);
    try {
      const ack = await this.session.request<{ subscriptionId?: unknown; lossRecovery?: unknown }>(
        'events.subscribe',
        { ...immutable, ...(requested ? { lossRecovery: 1 } : {}) },
      );
      if (typeof ack?.subscriptionId !== 'string' || !ack.subscriptionId) return;
      if (this.disposed || !this.session.isCurrent() || !currentAttempt()) {
        await this.session
          .request('events.unsubscribe', { subscriptionId: ack.subscriptionId })
          .catch(() => {});
        return;
      }
      if (requested && ack.lossRecovery !== 1) {
        console.warn(
          '[event-recovery] Subscription recovery was not acknowledged; using legacy delivery',
        );
        this.admission.retire(ack.subscriptionId);
        await this.session.request('events.unsubscribe', { subscriptionId: ack.subscriptionId });
        // At most one legacy retry; it cannot silently become another opted-in attempt.
        if (!currentAttempt()) return;
        return this.subscribe(immutable, { recover: false, signal: options.signal });
      }
      this.admitting = true;
      const lease = this.admission.admit(
        attempt,
        ack.subscriptionId,
        requested && ack.lossRecovery === 1,
      );
      this.admitting = false;
      if (lease && immutable.replaceGroup) this.groups.set(immutable.replaceGroup, lease.id);
      this.updateLeaseSets();
      for (const lost of this.deferredLoss) this.invalidateLease(lost);
      this.deferredLoss.clear();
      return lease;
    } finally {
      options.signal?.removeEventListener('abort', cancel);
      if (immutable.replaceGroup && this.groupAttempts.get(immutable.replaceGroup) === attempt)
        this.groupAttempts.delete(immutable.replaceGroup);
      this.admitting = false;
      this.admission.reject(attempt);
    }
  }
  async unsubscribe(id: string) {
    this.retire(id);
    if (this.session.isCurrent())
      await this.session.request('events.unsubscribe', { subscriptionId: id }).catch(() => {});
  }
  private retire(id: string) {
    this.admission.retire(id);
    for (const [group, leaseId] of this.groups) if (leaseId === id) this.groups.delete(group);
    this.updateLeaseSets();
  }
  private updateLeaseSets() {
    for (const row of this.resources.values()) {
      const covering = [...this.admission.leases.values()].filter((lease) =>
        overlaps(row.scope, lease),
      );
      // An overlapping legacy mutation owner cannot be silently omitted from a fence.
      row.resource.setLeases(
        covering.map((lease) => ({ id: lease.id, lifetime: lease.lifetime })),
        covering.every((lease) => lease.recovery),
      );
    }
  }
  private invalidateLease(lease: RecoveryLease) {
    for (const row of this.resources.values())
      if (overlaps(row.scope, lease)) row.resource.invalidate();
  }
  private receive(notification: RecoveryNotification): void | Promise<void> {
    if (this.disposed || !this.session.isCurrent()) return;
    if (notification.method === 'events.lost') {
      this.admission.receive(this.context, notification.params);
      return;
    }
    if (notification.method !== 'events.event') return;
    const params = notification.params as {
      subscriptionId?: unknown;
      event?: { type?: unknown; workspaceId?: unknown };
    } | null;
    if (typeof params?.subscriptionId !== 'string') return;
    const lease = this.admission.leases.get(params.subscriptionId);
    if (!lease) return;
    const event = params.event;
    if (
      typeof event?.type !== 'string' ||
      !lease.eventTypes.some((pattern) => matches(pattern, event.type as string))
    )
      return;
    if (lease.workspaceId !== null && event.workspaceId !== lease.workspaceId) return;
    let handled = false;
    let blocked = false;
    const pending: Promise<void>[] = [];
    const lifetimes = new Map<string, RecoveryLifetime | null>();
    for (const [key, row] of this.resources) {
      if (
        !overlaps(row.scope, lease) ||
        !row.scope.eventTypes.some((pattern) => matches(pattern, event.type as string))
      )
        continue;
      if (row.scope.workspaceId !== null && event.workspaceId !== row.scope.workspaceId) continue;
      if (row.acceptsEvent && !row.acceptsEvent(notification)) {
        lifetimes.set(key, null);
        blocked = true;
        continue;
      }
      const accepted = row.resource.push();
      const lifetime = accepted ? row.resource.captureLifetime() : null;
      lifetimes.set(key, lifetime);
      if (row.onEvent) {
        handled = true;
        if (lifetime) {
          const result = row.onEvent(notification, lifetime);
          if (result) pending.push(result);
        }
      } else if (!accepted) blocked = true;
    }
    const receipt = this.admitted?.(notification, lifetimes);
    if (receipt) pending.push(receipt);
    if (!handled && !blocked) {
      const result = this.unhandled?.(notification);
      if (result) pending.push(result);
    }
    if (pending.length) return Promise.all(pending).then(() => {});
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.offNotification?.();
    this.offRetired?.();
    this.admission.dispose();
    for (const row of this.resources.values()) row.resource.dispose();
    this.resources.clear();
    this.groups.clear();
    this.groupAttempts.clear();
    this.deferredLoss.clear();
    this.session.dispose();
  }
}
