/** Wire policy: docs/protocol/event-stream-recovery.md. */
const MAX_EARLY_IDS = 64;
const MAX_U64 = 18446744073709551615n;

export interface RecoveryScope {
  readonly workspaceId: string | null;
  readonly eventTypes: readonly string[];
}
export interface RecoveryLease extends RecoveryScope {
  readonly id: string;
  readonly lifetime: object;
  readonly recovery: boolean;
}
interface Attempt {
  scope: RecoveryScope;
  overflow: boolean;
}
interface Marker {
  subscriptionId: string;
  generation: bigint;
  workspaceId: string | null;
}
function parseMarker(value: unknown): Marker | undefined {
  if (!value || typeof value !== 'object') return;
  const { subscriptionId, generation, scope } = value as Record<string, unknown>;
  if (
    typeof subscriptionId !== 'string' ||
    !subscriptionId ||
    typeof generation !== 'string' ||
    generation.length > 20 ||
    !/^[1-9][0-9]*$/.test(generation) ||
    !scope ||
    typeof scope !== 'object'
  )
    return;
  const workspaceId = (scope as Record<string, unknown>).workspaceId;
  if (workspaceId !== null && (typeof workspaceId !== 'string' || !workspaceId)) return;
  const exact = BigInt(generation);
  if (exact > MAX_U64) return;
  return { subscriptionId, generation: exact, workspaceId };
}

/** One physical connection and principal identity; never reuse after retirement. */
export class RecoveryAdmission {
  readonly leases = new Map<string, RecoveryLease>();
  private readonly attempts = new Map<object, Attempt>();
  private readonly early = new Map<string, Marker>();
  private readonly retired = new Set<string>();
  private readonly generations = new WeakMap<RecoveryLease, bigint>();
  private disposed = false;
  constructor(
    private readonly context: object,
    private readonly invalidate: (lease: RecoveryLease) => void,
  ) {}
  get stagedCount() {
    return this.early.size;
  }
  begin(scope: RecoveryScope): object {
    const token = {};
    if (!this.disposed)
      this.attempts.set(token, {
        scope: Object.freeze({ ...scope, eventTypes: Object.freeze([...scope.eventTypes]) }),
        overflow: false,
      });
    return token;
  }
  admit(token: object, id: string, recovery: boolean): RecoveryLease | undefined {
    const attempt = this.attempts.get(token);
    if (this.disposed || !attempt || !id || this.retired.has(id) || this.leases.has(id)) {
      this.reject(token);
      return;
    }
    const lease: RecoveryLease = Object.freeze({
      ...attempt.scope,
      id,
      lifetime: Object.freeze({}),
      recovery,
    });
    this.generations.set(lease, 0n);
    this.leases.set(id, lease);
    const marker = this.early.get(id);
    if (recovery && marker?.workspaceId === lease.workspaceId) this.accept(lease, marker);
    else if (recovery && attempt.overflow) this.invalidate(lease);
    this.reject(token);
    return lease;
  }
  reject(token: object) {
    this.attempts.delete(token);
    if (!this.attempts.size) this.early.clear();
  }
  retire(id: string) {
    this.leases.delete(id);
    this.early.delete(id);
    this.retired.add(id);
  }
  receive(context: object, value: unknown) {
    if (this.disposed || context !== this.context) return;
    const marker = parseMarker(value);
    if (!marker || this.retired.has(marker.subscriptionId)) return;
    const lease = this.leases.get(marker.subscriptionId);
    if (lease) {
      this.accept(lease, marker);
      return;
    }
    if (!this.attempts.size || [...this.attempts.values()].every((a) => a.overflow)) return;
    const previous = this.early.get(marker.subscriptionId);
    if (!previous || marker.generation > previous.generation)
      this.early.set(marker.subscriptionId, marker);
    if (this.early.size > MAX_EARLY_IDS) {
      this.early.clear();
      for (const attempt of this.attempts.values()) attempt.overflow = true;
    }
  }
  private accept(lease: RecoveryLease, marker: Marker) {
    if (
      !lease.recovery ||
      lease.workspaceId !== marker.workspaceId ||
      marker.generation <= (this.generations.get(lease) ?? 0n)
    )
      return;
    this.generations.set(lease, marker.generation);
    this.invalidate(lease);
  }
  dispose() {
    this.disposed = true;
    this.leases.clear();
    this.early.clear();
    this.attempts.clear();
    this.retired.clear();
  }
}
