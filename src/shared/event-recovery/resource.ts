/** Entire begin/read/end cycles share this budget; successful data alone never resets it. */
const MIN_READ_INTERVAL_MS = 250;
const FAILURE_RETRY_DELAYS_MS = [1_000, 4_000] as const;
interface LeaseIdentity {
  id: string;
  lifetime: object;
}
interface Owner<T> {
  read(): Promise<T>;
  fence(ids: readonly string[], observe: () => void): Promise<void>;
  apply(value: T): void;
  invalidate(): void;
  retire(error: unknown): void;
}

/** One owner per authoritative read key. Timers and promises are not domain state. */
export class RecoveryResource<T> {
  private leases: readonly LeaseIdentity[] = [];
  private epoch = 0;
  private dirty = 0n;
  private stale = false;
  private active = true;
  private running = false;
  private disposed = false;
  private failures = 0;
  private suspended = false;
  private lastRead = -Infinity;
  private retryAt = -Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly owner: Owner<T>) {}
  get status() {
    return {
      stale: this.stale,
      suspended: this.suspended,
      failures: this.failures,
      running: this.running,
    };
  }
  setLeases(leases: readonly LeaseIdentity[]) {
    if (
      this.leases.length === leases.length &&
      this.leases.every(
        (lease, i) => lease.id === leases[i].id && lease.lifetime === leases[i].lifetime,
      )
    )
      return;
    this.leases = [...leases];
    this.epoch++;
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
  /** Resource adapter calls this before applying ANY unversioned push. */
  push(): boolean {
    if (this.disposed) return false;
    if (this.stale) {
      this.invalidate();
      return false;
    }
    return true;
  }
  setActive(active: boolean) {
    if (this.active === active || this.disposed) return;
    this.active = active;
    this.epoch++;
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
    this.epoch++;
    this.cancelTimer();
    this.stale = false;
    this.failures = 0;
    this.suspended = false;
    this.retryAt = -Infinity;
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
    this.epoch++;
    this.cancelTimer();
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
      const snapshot = await this.owner.read();
      if (!current()) return;
      await this.owner.fence(ids, () => {
        if (!current() || version !== this.dirty) return;
        // Commit inside the ingress barrier, before callbacks following the end reply.
        this.owner.apply(snapshot);
        this.stale = false;
        this.failures = 0;
        this.retryAt = -Infinity;
      });
    } catch (error) {
      if (!current()) return;
      this.failures++;
      const code = (error as { rpcCode?: number; code?: string } | null)?.rpcCode;
      const name = (error as { code?: string } | null)?.code;
      if (code === -32003 || name === 'NOT_FOUND' || name === 'FORBIDDEN') {
        this.suspended = true;
        this.owner.retire(error);
      } else if (this.failures > FAILURE_RETRY_DELAYS_MS.length) this.suspended = true;
      else this.retryAt = Date.now() + FAILURE_RETRY_DELAYS_MS[this.failures - 1];
    } finally {
      this.running = false;
      this.schedule();
    }
  }
}
