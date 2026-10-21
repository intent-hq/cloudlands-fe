/** Transport lifetime for one agent's `agent.workers.subscribe` channel (PROTOCOL §5.5b).
 * Domain projections belong to Redux; this adapter only validates and orders wire frames. */
import {
  backendRequest,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
} from '$lib/client/live/backend-transport';
import type {
  AgentWorkersState,
  WorkerObservation,
  WorkerSnapshot,
  WorkerStopResult,
} from './types';

const MAX_ROWS = 256;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
/** The §5.5b wire-ID rule: nonempty, at most 256 UTF-8 bytes, no ASCII control characters. */
const wireId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  new TextEncoder().encode(value).length <= 256 &&
  // eslint-disable-next-line no-control-regex
  !/[\u0000-\u001f\u007f]/u.test(value);
const time = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const WORKER_STATUSES = new Set(['running', 'completed', 'failed', 'stopped', 'unknown']);

function isMethodMissing(error: unknown): boolean {
  return record(error) && error.rpcCode === -32601;
}

function parseWorker(value: unknown, snapshot: Record<string, unknown>): WorkerObservation | null {
  if (!record(value) || !record(value.identity)) return null;
  const identity = value.identity;
  for (const key of ['workspaceId', 'agentId', 'provider', 'acpSessionId', 'connectionGeneration'])
    if (identity[key] !== snapshot[key] || !wireId(identity[key])) return null;
  if (!wireId(identity.asyncTaskId)) return null;
  if (value.toolCallId !== undefined && !wireId(value.toolCallId)) return null;
  if (value.name !== undefined && typeof value.name !== 'string') return null;
  if (value.taskType !== undefined && typeof value.taskType !== 'string') return null;
  if (typeof value.canStop !== 'boolean') return null;
  if (!time(value.firstObservedAt) || !time(value.observedAt)) return null;
  if (typeof value.status !== 'string' || !WORKER_STATUSES.has(value.status)) return null;
  return value as unknown as WorkerObservation;
}

/** Validate a complete snapshot owned by this channel's scope. */
function parseWorkerSnapshot(
  value: unknown,
  workspaceId: string,
  agentId: string,
): WorkerSnapshot | null {
  if (!record(value) || value.workspaceId !== workspaceId || value.agentId !== agentId) return null;
  if (!time(value.asOf) || typeof value.truncated !== 'boolean') return null;
  if (!record(value.support) || typeof value.support.status !== 'string') return null;
  if (!Array.isArray(value.workers) || value.workers.length > MAX_ROWS) return null;
  const workers: WorkerObservation[] = [];
  for (const row of value.workers) {
    const parsed = parseWorker(row, value);
    if (!parsed) return null;
    workers.push(parsed);
  }
  return { ...(value as unknown as WorkerSnapshot), workers };
}

/** A frontend that lost its connection shows running rows as unknown until a new snapshot. */
function demoteDisconnected(snapshot: WorkerSnapshot): WorkerSnapshot {
  return {
    ...snapshot,
    workers: snapshot.workers.map((row) =>
      row.status === 'running' ? { ...row, status: 'unknown', unknownReason: 'disconnected' } : row,
    ),
  };
}

export interface AgentWorkersChannel {
  retry(): void;
  stop(asyncTaskId: string): Promise<WorkerStopResult>;
  dispose(): void;
}

/** Attach the listener before subscribing: seq 0 can race the subscribe reply. Only the
 * currently acknowledged subscription may update the view; pushes need seq 0 first, then
 * strictly increasing seq (a gap is safe: every push is a complete replacement). */
export function subscribeAgentWorkers(
  workspaceId: string,
  agentId: string,
  handler: (state: AgentWorkersState) => void,
): AgentWorkersChannel {
  let disposed = false;
  let epoch = 0;
  let subscriptionId: string | undefined;
  let lastSeq = -1;
  let registering = false;
  let beforeAck: Array<{ subscriptionId: string; seq: number; snapshot: WorkerSnapshot }> = [];
  let state: AgentWorkersState = { status: 'loading' };
  const emit = () => {
    if (!disposed) handler(state);
  };
  const release = () => {
    if (subscriptionId) void backendUnsubscribe(subscriptionId, workspaceId).catch(() => {});
    subscriptionId = undefined;
  };
  const accept = (frame: { subscriptionId: string; seq: number; snapshot: WorkerSnapshot }) => {
    if (frame.subscriptionId !== subscriptionId) return;
    if (lastSeq === -1 ? frame.seq !== 0 : frame.seq <= lastSeq) return;
    lastSeq = frame.seq;
    state = { status: 'ready', snapshot: frame.snapshot };
    emit();
  };
  const offNotification = onBackendNotification(({ method, params }) => {
    if (disposed || method !== 'subscription.push' || !record(params)) return;
    if (params.kind !== 'snapshot' || !wireId(params.subscriptionId)) return;
    if (!Number.isSafeInteger(params.seq) || (params.seq as number) < 0) return;
    const snapshot = parseWorkerSnapshot(params.snapshot, workspaceId, agentId);
    if (!snapshot) return;
    const frame = { subscriptionId: params.subscriptionId, seq: params.seq as number, snapshot };
    if (registering) {
      // Bounded even if unrelated registrations send a burst before our ack.
      if (beforeAck.length === 32) beforeAck.shift();
      beforeAck.push(frame);
    } else accept(frame);
  });

  async function start() {
    const version = ++epoch;
    release();
    lastSeq = -1;
    beforeAck = [];
    registering = true;
    const stale = () => disposed || version !== epoch;
    try {
      const hello = await backendRequest<{ server?: { capabilities?: { agentWorkers?: number } } }>(
        'client.hello',
        {},
      );
      if (stale()) return;
      if (hello?.server?.capabilities?.agentWorkers !== 1) {
        registering = false;
        state = { status: 'unsupported' };
        emit();
        return;
      }
      const ack = await backendRequest<{ subscriptionId?: unknown }>('agent.workers.subscribe', {
        workspaceId,
        agentId,
      });
      if (stale()) {
        if (wireId(ack?.subscriptionId))
          void backendUnsubscribe(ack.subscriptionId, workspaceId).catch(() => {});
        return;
      }
      if (!wireId(ack?.subscriptionId)) throw new Error('invalid agent.workers.subscribe ack');
      subscriptionId = ack.subscriptionId;
      registering = false;
      const queued = beforeAck;
      beforeAck = [];
      for (const frame of queued) accept(frame);
    } catch (error) {
      if (stale()) return;
      registering = false;
      state = isMethodMissing(error)
        ? { status: 'unsupported' }
        : { status: 'failed', snapshot: state.snapshot };
      emit();
    }
  }

  const offReconnected = onBackendReconnected(() => {
    if (disposed) return;
    // The old subscription died with the connection; show its running rows as unknown.
    subscriptionId = undefined;
    if (state.snapshot) {
      state = { ...state, snapshot: demoteDisconnected(state.snapshot) };
      emit();
    }
    void start();
  });

  void start();

  return {
    retry() {
      if (!disposed) void start();
    },
    async stop(asyncTaskId) {
      const row = state.snapshot?.workers.find((w) => w.identity.asyncTaskId === asyncTaskId);
      if (!row) throw new Error('unknown worker');
      const result = await backendRequest<WorkerStopResult>('agent.workers.stop', {
        workspaceId,
        agentId,
        connectionGeneration: row.identity.connectionGeneration,
        asyncTaskId,
      });
      return { asyncTaskId, stopped: result?.stopped === true };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      epoch += 1;
      offNotification();
      offReconnected();
      release();
    },
  };
}
