import { RecoveryRequestTimeoutError } from './session';

/** Entire begin/read/end cycles share this budget; successful data alone never resets it. */
const MIN_READ_INTERVAL_MS = 250;
const FAILURE_RETRY_DELAYS_MS = [1_000, 4_000] as const;
interface LeaseIdentity {
  id: string;
  lifetime: object;
}
/** Opaque identity includes every ownership transition, including same-name ABA changes. */
export interface RecoveryLifetime {
  readonly key: object;
  isCurrent(): boolean;
  /** Atomic synchronous mutation; stale, retired and pre-loss receipts cannot commit. */
  commit(mutation: () => undefined): boolean;
}
interface Owner<T> {
  sourceOrdered?: boolean;
  read(lifetime: RecoveryLifetime): Promise<T>;
  fence(ids: readonly string[], observe: () => void): Promise<void>;
  apply(value: T): undefined;
  invalidate(): void;
  /** Synchronously clear protected state when authority is gone. */
  retire(error: unknown): undefined;
}

function authorityLost(error: unknown): boolean {
  const code = (error as { rpcCode?: unknown } | null)?.rpcCode;
  const data = (error as { data?: unknown } | null)?.data;
  // Protocol §9: invalid-params alone is never proof of deletion.
  const absent =
    code === -32602 &&
    data !== null &&
    typeof data === 'object' &&
    (data as { code?: unknown }).code === 'not-found';
  return absent || code === -32003 || code === -32001;
}

/** One owner per authoritative read key. Timers and promises are not domain state. */
export class RecoveryResource<T> {
  private leases: readonly LeaseIdentity[] = [];
  private recoverable = true;
  private epoch: object = {};
  private recovered = false;
  private dirty = 0n;
  private mutation = 0n;
  private stale = false;
  private active = true;
  private running = false;
  private draining = false;
  private disposed = false;
  private failures = 0;
  private suspended = false;
  private lastRead = -Infinity;
  private retryAt = -Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly settlementWaiters = new Set<() => void>();
  constructor(private readonly owner: Owner<T>) {}
  /** Wait for fenced reconciliation or terminal retirement/retry exhaustion. */
  whenSettled(): Promise<void> {
    if (this.isSettled()) return Promise.resolve();
    return new Promise((resolve) => this.settlementWaiters.add(resolve));
  }
  private isSettled(): boolean {
    return this.disposed || (!this.running && !this.draining && (!this.stale || this.suspended));
  }
  private notifySettled(): void {
    if (!this.isSettled()) return;
    const waiters = [...this.settlementWaiters];
    this.settlementWaiters.clear();
    for (const resolve of waiters) resolve();
  }
  get status() {
    return {
      stale: this.stale,
      suspended: this.suspended || this.draining,
      failures: this.failures,
      running: this.running,
    };
  }
  captureLifetime(): RecoveryLifetime {
    const epoch = this.epoch;
    const dirty = this.dirty;
    const mutation = this.mutation;
    const isCurrent = () =>
      !this.disposed && this.active && epoch === this.epoch && mutation === this.mutation;
    return Object.freeze({
      key: epoch,
      isCurrent,
      commit: (mutation: () => undefined) => {
        if (!isCurrent() || this.stale || dirty !== this.dirty) return false;
        mutation();
        return true;
      },
    });
  }
  setLeases(leases: readonly LeaseIdentity[], recoverable = true) {
    if (
      this.recoverable === recoverable &&
      this.leases.length === leases.length &&
      this.leases.every(
        (lease, i) => lease.id === leases[i].id && lease.lifetime === leases[i].lifetime,
      )
    )
      return;
    this.leases = [...leases];
    this.recoverable = recoverable;
    this.epoch = {};
    this.cancelTimer();
    if (this.stale) this.schedule();
  }
  invalidate() {
    if (this.disposed) return;
    this.dirty++;
    this.stale = true;
    this.owner.invalidate();
    this.schedule();
  }
  /**
   * Every push writer must enter here. A bus fence cannot date unpublished payloads:
   * without proven source ordering, recovery permanently switches this lifetime to
   * invalidation-only delivery. Ordinary pre-loss push behavior is unchanged.
   */
  push(): boolean {
    if (this.disposed) return false;
    if (this.stale || (this.recovered && !this.owner.sourceOrdered)) {
      this.invalidate();
      return false;
    }
    // Accepted pushes supersede older async mutation receipts without making
    // the resource dirty or restoring reads to the ordinary push path.
    this.mutation++;
    return true;
  }
  setActive(active: boolean) {
    if (this.active === active || this.disposed) return;
    this.active = active;
    this.epoch = {};
    this.cancelTimer();
    if (active) {
      this.failures = 0;
      this.suspended = false;
      this.retryAt = -Infinity;
      this.schedule();
    }
  }
  /** Call at each workspace/entity ownership transition, including A→B→A. */
  changeLifetime() {
    if (this.disposed) return;
    this.epoch = {};
    this.cancelTimer();
    this.stale = false;
    this.recovered = false;
    this.failures = 0;
    this.suspended = false;
    this.retryAt = -Infinity;
    this.notifySettled();
  }
  refresh() {
    if (this.disposed) return;
    this.failures = 0;
    this.suspended = false;
    this.retryAt = -Infinity;
    this.invalidate();
  }
  dispose() {
    this.disposed = true;
    this.epoch = {};
    this.cancelTimer();
    this.notifySettled();
  }
  private cancelTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
  private schedule() {
    if (
      this.disposed ||
      !this.active ||
      !this.stale ||
      this.running ||
      this.suspended ||
      this.timer !== undefined ||
      !this.recoverable ||
      !this.leases.length ||
      this.leases.length > 64
    )
      return;
    const delay = Math.max(
      0,
      this.lastRead + MIN_READ_INTERVAL_MS - Date.now(),
      this.retryAt - Date.now(),
    );
    if (delay) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.schedule();
      }, delay);
      return;
    }
    this.running = true;
    void this.cycle();
  }
  private async cycle() {
    const epoch = this.epoch,
      leases = this.leases;
    const current = () => !this.disposed && this.active && epoch === this.epoch;
    let version = this.dirty;
    const ids = leases.map((l) => l.id);
    try {
      await this.owner.fence(ids, () => {
        if (current()) version = this.dirty;
      });
      if (!current()) return;
      this.lastRead = Date.now();
      const snapshot = await this.owner.read(this.captureLifetime());
      if (!current()) return;
      await this.owner.fence(ids, () => {
        if (!current() || version !== this.dirty) return;
        // Commit inside the ingress barrier, before callbacks following the end reply.
        this.owner.apply(snapshot);
        this.stale = false;
        this.recovered = true;
        this.failures = 0;
        this.retryAt = -Infinity;
      });
    } catch (error) {
      if (error instanceof RecoveryRequestTimeoutError) {
        // Keep the single-flight slot until the original driver and ingress work
        // drain. A deadline alone is not proof that another request is safe.
        if (current()) this.mutation++;
        this.draining = true;
        try {
          const outcome = await error.completion;
          if (!outcome.retired) error = outcome.errors.find(authorityLost) ?? error;
        } finally {
          this.draining = false;
        }
      }
      if (!current()) return;
      this.failures++;
      if (authorityLost(error)) {
        this.suspended = true;
        this.stale = false;
        this.dispose();
        // The owner clears protected domain state; this resource cannot resume.
        this.owner.retire(error);
      } else if (this.failures > FAILURE_RETRY_DELAYS_MS.length) this.suspended = true;
      else this.retryAt = Date.now() + FAILURE_RETRY_DELAYS_MS[this.failures - 1];
    } finally {
      this.running = false;
      this.schedule();
      this.notifySettled();
    }
  }
}
