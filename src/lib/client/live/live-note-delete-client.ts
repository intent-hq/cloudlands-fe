import type { NoteDeleteSubscription } from '$shared/note-delete-subscription-ledger';
import {
  parseNoteDeleteCancelRequest,
  parseNoteDeleteEvent,
  parseNoteDeleteOperationResponse,
  parseNoteDeleteScheduleRequest,
  parseNoteDeleteStatusRequest,
  parseNoteDeleteStatusResponse,
  type NoteDeleteCancelRequest,
  type NoteDeleteClient,
  type NoteDeleteEvent,
  type NoteDeleteScheduleRequest,
  type NoteDeleteStatusRequest,
} from '../note-delete';
import {
  backendRequest,
  subscribeBackendNoteDeletion,
  observeBackendNodeCapabilities,
  onBackendNotification,
  onBackendReconnected,
} from './backend-transport';

interface Registration {
  workspaceId: string;
  ready: Promise<void>;
  retryFailed(): void;
}
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const subscriptionId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256;

/** Uses the same transport seam for Electron IPC and browser WebSocket clients. */
export class LiveNoteDeleteClient implements NoteDeleteClient {
  private readonly registrations = new Set<Registration>();
  private readonly resetListeners = new Set<() => void>();

  async capability(): Promise<boolean> {
    const result = record(await observeBackendNodeCapabilities());
    return record(record(result?.server)?.capabilities)?.noteDeleteGrace === 1;
  }

  async status(input: NoteDeleteStatusRequest) {
    const request = parseNoteDeleteStatusRequest(input);
    // Subscribe -> snapshot must include wire registration, not just the local handler.
    const registrations = [...this.registrations].filter(
      (r) => r.workspaceId === request.workspaceId,
    );
    // A settled failure can be retried by the caller, never by a rejection loop.
    // Starting synchronously makes concurrent readers share the same pending ACK.
    for (const registration of registrations) registration.retryFailed();
    const ready = registrations.map((r) => r.ready);
    await Promise.all(ready);
    if (registrations.some((r, i) => !this.registrations.has(r) || r.ready !== ready[i]))
      throw new Error('Note deletion subscription changed');
    return parseNoteDeleteStatusResponse(
      await backendRequest('note.deleteStatus', request),
      request,
    );
  }

  async schedule(input: NoteDeleteScheduleRequest) {
    const request = parseNoteDeleteScheduleRequest(input);
    const result = parseNoteDeleteOperationResponse(
      await backendRequest('note.deleteSchedule', request),
      {
        workspaceId: request.workspaceId,
        noteId: request.noteId,
        operationKey: request.operationKey,
      },
      true,
    );
    if (
      result.operation.state === 'UNKNOWN' ||
      result.operation.noteInstanceId !== request.noteInstanceId
    )
      throw new Error('Mismatched note deletion incarnation');
    return result;
  }

  async cancel(input: NoteDeleteCancelRequest) {
    const request = parseNoteDeleteCancelRequest(input);
    return parseNoteDeleteOperationResponse(
      await backendRequest('note.deleteCancel', request),
      request,
    );
  }

  private reset() {
    for (const listener of this.resetListeners) listener();
  }

  onReconnected(listener: () => void): () => void {
    let disposed = false;
    this.resetListeners.add(listener);
    // Let all subscriptions install their replacement registration before the reader snapshots.
    const off = onBackendReconnected(() =>
      queueMicrotask(() => {
        if (!disposed) listener();
      }),
    );
    return () => {
      disposed = true;
      this.resetListeners.delete(listener);
      off();
    };
  }

  subscribe(workspaceId: string, listener: (event: NoteDeleteEvent) => void): () => void {
    parseNoteDeleteStatusRequest({ workspaceId });
    let disposed = false;
    let generation = 0;
    let id: string | undefined;
    let binding: NoteDeleteSubscription | undefined;
    let early: Array<{ id: string; event: NoteDeleteEvent }> = [];
    let lost = false;
    let failed = false;
    const registration: Registration = {
      workspaceId,
      ready: Promise.resolve(),
      retryFailed: () => {
        if (!disposed && failed) {
          register(false);
        }
      },
    };
    this.registrations.add(registration);
    const unsubscribe = (value: NoteDeleteSubscription) => {
      void value.unsubscribe().catch(() => {});
    };
    const off = onBackendNotification((notification) => {
      if (disposed || notification.method !== 'events.event') return;
      const params = record(notification.params);
      if (
        !subscriptionId(params?.subscriptionId) ||
        (id !== undefined && params.subscriptionId !== id)
      )
        return;
      const envelope = record(params.event);
      if (envelope?.type !== 'note:delete-operation') return;
      const raw = record(envelope.data);
      if (typeof raw?.workspaceId === 'string' && raw.workspaceId !== workspaceId) return;
      let event: NoteDeleteEvent;
      try {
        event = parseNoteDeleteEvent(raw, workspaceId);
      } catch {
        if (id !== undefined) this.reset();
        else lost = true;
        return;
      }
      if (id !== undefined) listener(event);
      else if (!lost) {
        if (early.length === 256) {
          early = [];
          lost = true;
        } else early.push({ id: params.subscriptionId, event });
      }
    });
    const register = (notifyFailure = true) => {
      const mine = ++generation;
      failed = false;
      if (binding) unsubscribe(binding);
      id = undefined;
      binding = undefined;
      early = [];
      lost = false;
      registration.ready = subscribeBackendNoteDeletion(workspaceId)
        .then((ack) => {
          if (disposed || mine !== generation) {
            if (subscriptionId(ack?.subscriptionId)) unsubscribe(ack);
            return;
          }
          if (!subscriptionId(ack?.subscriptionId))
            throw new Error('Invalid note deletion subscription');
          id = ack.subscriptionId;
          binding = ack;
          const buffered = early;
          early = [];
          if (lost) this.reset();
          else
            for (const item of buffered) {
              if (disposed || mine !== generation) break;
              if (item.id === id) listener(item.event);
            }
        })
        .catch((error: unknown) => {
          if (!disposed && mine === generation) {
            failed = true;
            // Retry failures are already delivered to their snapshot callers.
            // Another reset here would replenish the observer's finite retry budget.
            if (notifyFailure) this.reset();
          }
          throw error;
        });
      // Keep the rejection available to status(), without an unhandled idle subscription promise.
      void registration.ready.catch(() => {});
    };
    const offReconnect = onBackendReconnected(() => register());
    register();
    return () => {
      if (disposed) return;
      disposed = true;
      generation++;
      this.registrations.delete(registration);
      early = [];
      off();
      offReconnect();
      if (binding) unsubscribe(binding);
    };
  }
}
