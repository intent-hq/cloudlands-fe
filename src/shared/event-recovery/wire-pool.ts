import type { RecoveryRequestCompletion } from './session';
/** Bounds include cleanup: a logical timeout never releases physical capacity. */
const MAX_WIRE_REQUESTS = 64;
// Reserve before subscribing so the eventual cleanup queue also has a finite bound.
const MAX_LEASES = 128;
const MAX_ORDINARY_REQUESTS = 256;
const MAX_DRAIN_WAITERS = 64;
const unsubscribeMethods: Readonly<Record<string, string>> = {
  'events.subscribe': 'events.unsubscribe',
  'note.subscribe': 'note.unsubscribe',
  'task.subscribe': 'task.unsubscribe',
  'comment.subscribe': 'comment.unsubscribe',
  'workspace.subscribe': 'workspace.unsubscribe',
  'agent.subscribe': 'events.unsubscribe',
};
export function subscriptionCleanup(method: string, params: unknown, result: unknown) {
  const unsubscribe = Object.hasOwn(unsubscribeMethods, method)
    ? unsubscribeMethods[method]
    : undefined;
  const id = (result as { subscriptionId?: unknown } | null)?.subscriptionId;
  if (!unsubscribe || typeof id !== 'string') return undefined;
  const workspaceId = (params as { workspaceId?: unknown } | null)?.workspaceId;
  return {
    method: unsubscribe,
    params: {
      subscriptionId: id,
      ...(method !== 'events.subscribe' && typeof workspaceId === 'string' ? { workspaceId } : {}),
    },
  };
}
type RawRequest = (
  method: string,
  params?: unknown,
  observe?: (result: unknown) => void,
) => Promise<unknown>;
interface Capture {
  identity: unknown;
  current: () => boolean;
  raw: RawRequest;
  released: boolean;
  leases: Set<Lease>;
}
interface Lease {
  owner: Capture;
  control?: NonNullable<ReturnType<typeof subscriptionCleanup>>;
  cleanup?: {
    promise: Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  };
  observers?: Set<(result: unknown, abandoned: boolean) => void>;
  observed?: { result: unknown };
}
interface WireRequest {
  owner: Capture;
  expired: boolean;
}

/** One pool per physical socket, shared across captures and hello identities. */
export class RecoveryWirePool {
  private readonly pending = new Set<WireRequest>();
  private readonly leases = new Set<Lease>();
  private readonly cleanupQueue: Lease[] = [];

  private readonly ordinary = new Set<{ identity: unknown; expired: boolean }>();
  private drainWaiters = 0;
  trackOrdinary(identity: unknown, current: () => boolean = () => true) {
    if (this.ordinary.size >= MAX_ORDINARY_REQUESTS)
      throw new Error('Event recovery ordinary request limit reached');
    const row = { identity, expired: false };
    let finish!: (value: RecoveryRequestCompletion) => void;
    const completion = new Promise<RecoveryRequestCompletion>((resolve) => {
      finish = resolve;
    });
    this.ordinary.add(row);
    this.changed();
    return {
      completion,
      drained: completion.then(() => {}),
      timeout: () => {
        if (this.ordinary.has(row)) {
          row.expired = true;
          this.changed();
        }
      },
      settle: (error?: unknown) => {
        if (!this.ordinary.delete(row)) return;
        finish({ retired: !current(), errors: error === undefined ? [] : [error] });
        this.changed();
      },
    };
  }
  private ordinaryBlocked(identity: unknown) {
    return [...this.ordinary].some((row) => row.expired || row.identity !== identity);
  }
  waitForOrdinary(identity: unknown) {
    if (!this.ordinaryBlocked(identity)) return undefined;
    if (this.drainWaiters >= MAX_DRAIN_WAITERS)
      throw new Error('Event recovery drain waiter limit reached');
    this.drainWaiters++;
    let finish!: () => void, fail!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    let active = true;
    const stop = () => {
      if (!active) return;
      active = false;
      this.drainWaiters--;
      this.listeners.delete(check);
    };
    const check = () => {
      if (active && !this.ordinaryBlocked(identity)) {
        stop();
        finish();
      }
    };
    this.listeners.add(check);
    check();
    return {
      promise,
      cancel: () => {
        if (active) {
          stop();
          fail(new Error('Ordinary request wait cancelled'));
        }
      },
    };
  }
  private readonly listeners = new Set<() => void>();
  onChange(handler: () => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }
  canCapture(identity: unknown): boolean {
    return (
      identity !== undefined &&
      identity !== null &&
      !this.cleanupQueue.length &&
      !this.ordinaryBlocked(identity) &&
      ![...this.pending].some(
        (row) => row.expired || row.owner.released || row.owner.identity !== identity,
      )
    );
  }
  private changed() {
    for (const handler of [...this.listeners]) handler();
  }

  capture(identity: unknown, current: () => boolean, raw: RawRequest) {
    // Identity retirement releases daemon leases; never send cleanup onto its successor.
    for (const lease of [...this.leases])
      if (!lease.owner.current() && lease.control) void this.cleanup(lease).catch(() => {});
    if (!this.canCapture(identity)) return undefined;
    const owner: Capture = { identity, current, raw, released: false, leases: new Set() };
    return {
      request: (
        method: string,
        params?: unknown,
        observe?: (result: unknown, abandoned: boolean) => void,
      ): Promise<unknown> => {
        if (method === 'client.hello' || owner.released || !current())
          return Promise.reject(new Error('Event recovery connection unavailable'));
        const id = (params as { subscriptionId?: unknown } | null)?.subscriptionId;
        const owned = [...owner.leases].find(
          (lease) => lease.control?.method === method && lease.control.params.subscriptionId === id,
        );
        if (owned) return this.cleanup(owned, observe);
        if (Object.values(unsubscribeMethods).includes(method))
          return Promise.reject(new Error('Event recovery subscription unavailable'));
        const subscribe = Object.hasOwn(unsubscribeMethods, method);
        if (this.pending.size >= MAX_WIRE_REQUESTS || (subscribe && this.leases.size >= MAX_LEASES))
          return Promise.reject(new Error('Event recovery request limit reached'));
        const lease: Lease | undefined = subscribe ? { owner } : undefined;
        if (lease) {
          this.leases.add(lease);
          owner.leases.add(lease);
        }
        return this.run(owner, method, params, (result, expired) => {
          const abandoned = expired || owner.released || !current();
          if (lease) {
            lease.control = subscriptionCleanup(method, params, result);
            if (abandoned && lease.control) void this.cleanup(lease).catch(() => {});
          }
          observe?.(result, abandoned);
        })
          .catch((error) => {
            if (lease?.control) void this.cleanup(lease).catch(() => {});
            throw error;
          })
          .finally(() => {
            if (lease && !lease.control) this.release(lease);
          });
      },
      dispose: () => {
        owner.released = true;
        for (const lease of [...owner.leases])
          if (lease.control) void this.cleanup(lease).catch(() => {});
        this.changed();
      },
    };
  }

  private release(lease: Lease) {
    this.leases.delete(lease);
    lease.owner.leases.delete(lease);
  }
  private cleanup(
    lease: Lease,
    observe?: (result: unknown, abandoned: boolean) => void,
  ): Promise<unknown> {
    if (observe) {
      if (lease.observed)
        observe(lease.observed.result, lease.owner.released || !lease.owner.current());
      else (lease.observers ??= new Set()).add(observe);
    }
    if (lease.cleanup) return lease.cleanup.promise;
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<unknown>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    lease.cleanup = { promise, resolve, reject };
    // Automatic cleanup has no caller, but remains accounted until actual settlement.
    void lease.cleanup.promise.catch(() => {});
    this.cleanupQueue.push(lease);
    this.pump();
    return lease.cleanup.promise;
  }
  private pump() {
    while (this.pending.size < MAX_WIRE_REQUESTS && this.cleanupQueue.length) {
      const lease = this.cleanupQueue.shift();
      if (!lease?.cleanup) continue;
      const completion = lease.cleanup;
      if (!lease.control || !lease.owner.current()) {
        this.release(lease);
        completion.resolve(undefined);
        continue;
      }
      const { method, params } = lease.control;
      void this.run(
        lease.owner,
        method,
        params,
        (result) => {
          lease.observed = { result };
          for (const observe of lease.observers ?? [])
            observe(result, lease.owner.released || !lease.owner.current());
          lease.observers?.clear();
        },
        true,
      ).then(
        (result) => {
          this.release(lease);
          completion.resolve(result);
        },
        (error) => {
          this.release(lease);
          completion.reject(error);
        },
      );
    }
  }
  private run(
    owner: Capture,
    method: string,
    params: unknown,
    observe?: (result: unknown, expired: boolean) => void,
    cleanup = false,
  ): Promise<unknown> {
    const row = { owner, expired: cleanup };
    this.pending.add(row);
    this.changed();
    const deadline = cleanup
      ? undefined
      : setTimeout(
          () => {
            row.expired = true;
            this.changed();
          },
          method === 'events.fence' ? 5000 : 30000,
        );
    const settled = () => {
      clearTimeout(deadline);
      this.pending.delete(row);
      this.pump();
      this.changed();
    };
    try {
      const wait = cleanup ? undefined : this.waitForOrdinary(owner.identity);
      const invoke = () => {
        if (wait && (row.expired || owner.released || !owner.current()))
          throw new Error('Event recovery request expired before dispatch');
        return owner.raw(method, params, (result) => observe?.(result, row.expired));
      };
      return (wait ? wait.promise.then(invoke) : invoke()).finally(settled);
    } catch (error) {
      settled();
      return Promise.reject(error);
    }
  }
}
