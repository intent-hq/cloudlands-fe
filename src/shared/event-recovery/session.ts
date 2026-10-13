export interface RecoveryNotification {
  method: string;
  params?: unknown;
}
/** Captured backend + principal + physical connection. Never route onto a successor. */
export interface EventRecoverySession {
  readonly supported: boolean;
  isCurrent(): boolean;
  onRetired(handler: () => void): () => void;
  onNotification(handler: (notification: RecoveryNotification) => void | Promise<void>): () => void;
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  /** Runs observe after prior owner callbacks, before later notifications. */
  fence(subscriptionIds: readonly string[], observe: () => void): Promise<void>;
  dispose(): void;
}

/** Serial observation without deferring synchronous consumers. Fail closed on callback error. */
const MAX_PENDING_INGRESS = 1_024;

class RecoveryIngress {
  private pending = 0;
  private tail: Promise<void> | undefined;
  private retired = false;
  constructor(private readonly failed: () => void) {}
  dispatch(work: () => void | Promise<void>): Promise<void> {
    if (this.retired) return Promise.reject(new Error('Recovery ingress retired'));
    if (this.pending >= MAX_PENDING_INGRESS) {
      this.retire();
      this.failed();
      return Promise.reject(new Error('Recovery ingress overflow'));
    }
    const run = () => {
      if (this.retired) throw new Error('Recovery ingress retired');
      return work();
    };
    let result: void | Promise<void>;
    try {
      result = this.tail ? this.tail.then(run) : run();
    } catch (error) {
      this.retire();
      this.failed();
      return Promise.reject(error);
    }
    if (!result) return Promise.resolve();
    this.pending++;
    const tracked = Promise.resolve(result).then(
      () => {
        this.pending--;
      },
      (error) => {
        this.pending--;
        this.retire();
        this.failed();
        throw error;
      },
    );
    this.tail = tracked;
    void tracked.then(
      () => {
        if (this.tail === tracked) this.tail = undefined;
      },
      () => {},
    );
    return tracked;
  }
  retire() {
    this.retired = true;
  }
}

interface Driver {
  supported: boolean;
  isCurrent(): boolean;
  onRetired(handler: () => void): () => void;
  onNotification(handler: (notification: RecoveryNotification) => void): () => void;
  /** observe must run synchronously at decode, before decoding the next frame. */
  request(method: string, params?: unknown, observe?: (result: unknown) => void): Promise<unknown>;
  dispose(): void;
}
const FENCE_TIMEOUT_MS = 5_000;
const READ_TIMEOUT_MS = 30_000;

/**
 * A deadline rejects the result, not the outstanding driver/owner work.
 * Adapters must preserve actual completion or retire the capture: a lower
 * transport's logical timeout is not proof that its wire request drained.
 */
export class RecoveryRequestTimeoutError extends Error {
  constructor(readonly drained: Promise<void>) {
    super('Event recovery request timed out');
  }
}

/** Shared browser/Electron processing boundary, including asynchronous saga acknowledgements. */
export function createEventRecoverySession(driver: Driver): EventRecoverySession {
  let retired = false;
  const listeners = new Set<() => void>();
  const handlers = new Set<(n: RecoveryNotification) => void | Promise<void>>();
  const pending = new Set<(error: Error) => void>();
  const drains = new Set<() => void>();
  const unavailable = () => new Error('Event recovery connection retired');
  const retire = () => {
    if (retired) return;
    retired = true;
    ingress.retire();
    for (const reject of [...pending]) reject(unavailable());
    for (const handler of [...listeners]) handler();
    for (const drain of [...drains]) drain();
    listeners.clear();
    handlers.clear();
  };
  const ingress = new RecoveryIngress(retire);
  const current = () => {
    if (!driver.isCurrent()) retire();
    return !retired;
  };
  const offRetired = driver.onRetired(retire);
  const offNotification = driver.onNotification((n) => {
    if (!current()) return;
    void ingress
      .dispatch(() => {
        const work: Promise<void>[] = [];
        for (const handler of [...handlers]) {
          const result = handler(n);
          if (result) work.push(result);
        }
        if (work.length) return Promise.all(work).then(() => {});
      })
      .catch(() => {});
  });
  function bounded<T>(
    timeout: number,
    run: (
      resolve: (value: T) => void,
      reject: (error: Error) => void,
      alive: () => boolean,
      track: <V>(work: Promise<V>) => Promise<V>,
    ) => void,
  ): Promise<T> {
    if (!current()) return Promise.reject(unavailable());
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const work = new Set<Promise<unknown>>();
      const track = <V>(promise: Promise<V>): Promise<V> => {
        work.add(promise);
        void promise.then(
          () => work.delete(promise),
          () => work.delete(promise),
        );
        return promise;
      };
      const finish = (error?: Error, value?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pending.delete(fail);
        if (error) reject(error);
        else resolve(value as T);
      };
      const fail = (error: Error) => finish(error);
      const timer = setTimeout(() => {
        const drained = new Promise<void>((resolveDrain) => {
          const finishDrain = () => {
            drains.delete(finishDrain);
            resolveDrain();
          };
          drains.add(finishDrain);
          // No later observer work can enter once fail() invalidates alive().
          void Promise.allSettled([...work]).then(finishDrain);
        });
        fail(new RecoveryRequestTimeoutError(drained));
      }, timeout);
      pending.add(fail);
      try {
        run(
          (value) => finish(undefined, value),
          fail,
          () => !settled,
          track,
        );
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  return {
    supported: driver.supported,
    isCurrent: current,
    onRetired(handler) {
      if (!current()) {
        handler();
        return () => {};
      }
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
    onNotification(handler) {
      if (!current()) return () => {};
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    request<T>(method: string, params?: unknown): Promise<T> {
      return bounded(READ_TIMEOUT_MS, (resolve, reject, alive, track) => {
        if (method === 'events.subscribe') {
          // Admission's await continuation must finish before following domain callbacks.
          // Merely resolving an IPC invoke promise does not establish this ordering.
          track(
            driver.request(method, params, (value) => {
              if (!alive() || !current()) return;
              void track(
                ingress.dispatch(() => {
                  if (!alive() || !current()) return;
                  resolve(value as T);
                  return new Promise<void>((release) => queueMicrotask(release));
                }),
              ).catch(reject);
            }),
          ).catch(reject);
        } else
          track(driver.request(method, params)).then((value) => {
            if (current()) resolve(value as T);
            else reject(unavailable());
          }, reject);
      });
    },
    fence(ids, observe) {
      if (!driver.supported) return Promise.reject(new Error('Event recovery unsupported'));
      if (
        !ids.length ||
        ids.length > 64 ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !id)
      )
        return Promise.reject(new Error('Invalid recovery subscription set'));
      return bounded<void>(FENCE_TIMEOUT_MS, (resolve, reject, alive, track) => {
        let done = false;
        const fail = (error: Error) => {
          done = true;
          reject(error);
        };
        track(
          driver.request('events.fence', { subscriptionIds: [...ids] }, (result) => {
            if (done || !alive() || !current()) return;
            void track(
              ingress.dispatch(() => {
                if (done || !alive() || !current()) return;
                const echoed = (result as { subscriptionIds?: unknown } | null)?.subscriptionIds;
                if (
                  !Array.isArray(echoed) ||
                  echoed.length !== ids.length ||
                  echoed.some((id, i) => id !== ids[i])
                )
                  throw new Error('Invalid recovery fence reply');
                observe();
                done = true;
                resolve();
              }),
            ).catch(fail);
          }),
        ).catch(fail);
      });
    },
    dispose() {
      retire();
      offRetired();
      offNotification();
      driver.dispose();
    },
  };
}
