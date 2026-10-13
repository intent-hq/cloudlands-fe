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
class RecoveryIngress {
  private tail: Promise<void> | undefined;
  private retired = false;
  constructor(private readonly failed: () => void) {}
  dispatch(work: () => void | Promise<void>): Promise<void> {
    if (this.retired) return Promise.reject(new Error('Recovery ingress retired'));
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
    const tracked = Promise.resolve(result).catch((error) => {
      this.retire();
      this.failed();
      throw error;
    });
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

/** Shared browser/Electron processing boundary, including asynchronous saga acknowledgements. */
export function createEventRecoverySession(driver: Driver): EventRecoverySession {
  let retired = false;
  const listeners = new Set<() => void>();
  const handlers = new Set<(n: RecoveryNotification) => void | Promise<void>>();
  const pending = new Set<(error: Error) => void>();
  const unavailable = () => new Error('Event recovery connection retired');
  const retire = () => {
    if (retired) return;
    retired = true;
    ingress.retire();
    for (const reject of [...pending]) reject(unavailable());
    for (const handler of [...listeners]) handler();
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
    ) => void,
  ): Promise<T> {
    if (!current()) return Promise.reject(unavailable());
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, value?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pending.delete(fail);
        if (error) reject(error);
        else resolve(value as T);
      };
      const fail = (error: Error) => finish(error);
      const timer = setTimeout(() => fail(new Error('Event recovery request timed out')), timeout);
      pending.add(fail);
      try {
        run(
          (value) => finish(undefined, value),
          fail,
          () => !settled,
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
      return bounded(READ_TIMEOUT_MS, (resolve, reject) => {
        driver.request(method, params).then((value) => {
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
      return bounded<void>(FENCE_TIMEOUT_MS, (resolve, reject, alive) => {
        let done = false;
        const fail = (error: Error) => {
          done = true;
          reject(error);
        };
        driver
          .request('events.fence', { subscriptionIds: [...ids] }, (result) => {
            if (done || !alive() || !current()) return;
            void ingress
              .dispatch(() => {
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
              })
              .catch(fail);
          })
          .catch(fail);
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
