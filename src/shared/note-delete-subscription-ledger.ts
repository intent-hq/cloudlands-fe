/** Private physical-owner admission. No expiry, renderer-owned reset, or inferred closure. */
const noteDeleteSubscriptionLimits = Object.freeze({
  perConnection: 64,
  global: 256,
  owners: 8,
});
export interface NoteDeleteSubscriptionAck {
  handle: string;
  subscriptionId: string;
}
export interface NoteDeleteSubscription {
  subscriptionId: string;
  unsubscribe(): Promise<void>;
}
export interface NoteDeleteSubscriptionOrigin {
  incarnation: object;
  principal: object;
  request(method: 'events.subscribe' | 'events.unsubscribe', params: unknown): Promise<unknown>;
  isLive(): boolean;
}
export class NoteDeleteSubscriptionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'NoteDeleteSubscriptionError';
  }
}
export function noteDeleteWorkspace(value: unknown): string {
  if (typeof value !== 'string' || !value || new TextEncoder().encode(value).byteLength > 128)
    throw new NoteDeleteSubscriptionError('NOTE_DELETE_SUBSCRIPTION_INVALID');
  return value;
}
type Slot = {
  handle: string;
  origin: NoteDeleteSubscriptionOrigin;
  workspaceId: string;
  subscriptionId?: string;
  pending?: Promise<unknown>;
  cleanup?: Promise<void>;
};
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Construct only at the physical owner module: main singleton or browser module singleton. */
export class NoteDeleteSubscriptionLedger {
  private readonly slots = new Map<string, Slot>();
  private readonly owners = new Map<object, number>();
  private readonly closed = new WeakSet<object>();
  constructor(private readonly mint: () => string = () => crypto.randomUUID()) {}

  async subscribe(
    origin: NoteDeleteSubscriptionOrigin,
    rawWorkspace: unknown,
  ): Promise<NoteDeleteSubscriptionAck> {
    const workspaceId = noteDeleteWorkspace(rawWorkspace);
    if (this.closed.has(origin.incarnation) || !origin.isLive())
      throw new NoteDeleteSubscriptionError('NOTE_DELETE_SUBSCRIPTION_RETIRED');
    const used = this.owners.get(origin.incarnation) ?? 0;
    if (
      used >= noteDeleteSubscriptionLimits.perConnection ||
      this.slots.size >= noteDeleteSubscriptionLimits.global ||
      (!used && this.owners.size >= noteDeleteSubscriptionLimits.owners)
    )
      throw new NoteDeleteSubscriptionError('NOTE_DELETE_REGISTRATION_LIMIT');
    const handle = this.mint();
    if (!handle || this.slots.has(handle))
      throw new NoteDeleteSubscriptionError('NOTE_DELETE_SUBSCRIPTION_INVALID');
    const slot: Slot = { handle, origin, workspaceId };
    this.slots.set(handle, slot);
    this.owners.set(origin.incarnation, used + 1);
    const pending = Promise.resolve().then(() => {
      // Ownership can retire between reservation and this send boundary.
      if (this.closed.has(origin.incarnation) || !origin.isLive()) {
        // No request was invoked: only this definitely unissued reservation is refundable.
        if (this.slots.get(handle) === slot) {
          this.slots.delete(handle);
          const reserved = this.owners.get(origin.incarnation)!;
          if (reserved === 1) this.owners.delete(origin.incarnation);
          else this.owners.set(origin.incarnation, reserved - 1);
        }
        throw new NoteDeleteSubscriptionError('NOTE_DELETE_SUBSCRIPTION_RETIRED');
      }
      // After invocation even a synchronous failure may have issued; retain its debt.
      return origin.request('events.subscribe', {
        workspaceId,
        eventTypes: ['note:delete-operation'],
      });
    });
    slot.pending = pending;
    try {
      const ack = object(await pending);
      if (this.slots.get(handle) !== slot)
        throw new NoteDeleteSubscriptionError('NOTE_DELETE_SUBSCRIPTION_RETIRED');
      if (
        typeof ack?.subscriptionId !== 'string' ||
        !ack.subscriptionId ||
        ack.subscriptionId.length > 256
      )
        throw new NoteDeleteSubscriptionError('NOTE_DELETE_SUBSCRIPTION_INVALID');
      slot.subscriptionId = ack.subscriptionId;
      if (!origin.isLive()) {
        void this.cleanup(origin.principal, handle).catch(() => {});
        throw new NoteDeleteSubscriptionError('NOTE_DELETE_SUBSCRIPTION_RETIRED');
      }
      return { handle, subscriptionId: ack.subscriptionId };
    } finally {
      if (slot.pending === pending) slot.pending = undefined;
    }
  }

  cleanup(principal: object, handle: unknown): Promise<void> {
    const slot =
      typeof handle === 'string' && handle.length <= 128 ? this.slots.get(handle) : undefined;
    if (!slot || slot.origin.principal !== principal)
      return Promise.reject(new NoteDeleteSubscriptionError('NOTE_DELETE_SUBSCRIPTION_RETIRED'));
    if (slot.cleanup) return slot.cleanup;
    if (!slot.subscriptionId)
      return Promise.reject(new NoteDeleteSubscriptionError('NOTE_DELETE_SUBSCRIPTION_UNKNOWN'));
    // Never re-route. This closure can send only on the originally captured connection.
    const pending = Promise.resolve().then(() =>
      slot.origin.request('events.unsubscribe', {
        subscriptionId: slot.subscriptionId,
        workspaceId: slot.workspaceId,
      }),
    );
    slot.pending = pending;
    slot.cleanup = pending
      .then((result) => {
        if (object(result)?.success !== true)
          throw new NoteDeleteSubscriptionError('NOTE_DELETE_SUBSCRIPTION_UNKNOWN');
        if (this.slots.get(slot.handle) !== slot) return;
        this.slots.delete(slot.handle);
        const used = this.owners.get(slot.origin.incarnation)!;
        if (used === 1) this.owners.delete(slot.origin.incarnation);
        else this.owners.set(slot.origin.incarnation, used - 1);
      })
      .finally(() => {
        if (slot.pending === pending) slot.pending = undefined;
      });
    return slot.cleanup;
  }
  /** Call only at an actual socket close event, never on requested close or identity retirement. */
  connectionClosed(incarnation: object): void {
    this.closed.add(incarnation);
    for (const [handle, slot] of this.slots) {
      if (slot.origin.incarnation === incarnation) this.slots.delete(handle);
    }
    this.owners.delete(incarnation);
  }
  // No retire()/reset(): neither current renderer nor generic reconnect proves physical close.
}
