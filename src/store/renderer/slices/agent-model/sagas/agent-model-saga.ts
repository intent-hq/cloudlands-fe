import { call, cancelled, fork, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { appClient } from '$lib/client';
import { agentClient } from '$features/agent/agent.client';
import { buildLegacyReasoningEffortModelId } from '$features/agent/utils/legacy-reasoning-effort';
import { reconcileReasoningEffort } from '$features/agent/utils/reconcile-reasoning-effort';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import { m } from '$shared/paraglide/messages.js';
import { notify } from '$lib/components/patterns/notify';
import { updateSession } from '../../agent-session/agent-session-slice';
import { selectProviderModelsCacheEntry } from '../../provider-models/provider-models-selectors';
import { selectAgentModelWriteSnapshot } from '../agent-model-selectors';
import {
  agentEffortIntentMarked,
  agentEffortIntentReleased,
  agentModelMutationRequested,
} from '../agent-model-slice';
import type { AgentModelOutcome } from '../agent-model-types';

type RequestAction = ReturnType<typeof agentModelMutationRequested>;
type Snapshot = ReturnType<typeof selectAgentModelWriteSnapshot.select>;
type Write = { action: RequestAction; identity: string; intent: number; issued: boolean };
type Queue = {
  confirmed: string | null;
  confirmedIntent: number;
  identity: string;
  latestIntent: number;
  writes: Write[];
};

/** One ordered wire owner per captured connection/workspace/agent, not per control. */
export function* agentModelSaga() {
  const queues = new Map<string, Queue>();
  const reservations = new Map<string, { intent: number; ordinal: number }>();
  let nextIntent = 0;
  const intentKey = (agentId: string, workspaceId: string) =>
    JSON.stringify([workspaceId, agentId]);
  const keyOf = (request: RequestAction['payload'][0]) =>
    JSON.stringify([request.connection, request.workspaceId, request.agentId]);

  function* snapshot(write: Write) {
    const [request] = write.action.payload;
    return yield* selectAgentModelWriteSnapshot.effect(request.agentId, request.workspaceId);
  }

  function admitted(write: Write, current: Snapshot): boolean {
    const [request, options] = write.action.payload;
    return (
      request.connection !== null &&
      current.connection === request.connection &&
      current.canWrite &&
      options?.canSend?.() !== false
    );
  }

  function* owns(write: Write, queue: Queue) {
    const [, options] = write.action.payload;
    const current = yield* snapshot(write);
    return (
      admitted(write, current) &&
      current.identity === write.identity &&
      queue.latestIntent === write.intent &&
      options?.canMutate?.() !== false
    );
  }

  function* effort(
    write: Write,
    queue: Queue,
    value: string | null,
  ): SagaGenerator<AgentModelOutcome> {
    const [request, options] = write.action.payload;
    const current = yield* snapshot(write);
    options?.onConfirmedEffort?.(queue.confirmed);
    if (!admitted(write, current) || current.identity !== write.identity) {
      release(write, queue);
      return { status: 'cancelled' } satisfies AgentModelOutcome;
    }
    if (options?.source === 'encoder' && queue.confirmed === value)
      return { status: 'success' } satisfies AgentModelOutcome;
    let result: { success: boolean; error?: string };
    try {
      if (current.legacy) {
        const model = buildLegacyReasoningEffortModelId(
          current.session?.model,
          value,
          current.levels,
        );
        if (!model) result = { success: false, error: m.chat_effortPicker_updateFailed_error() };
        else {
          write.issued = true;
          const response = yield* call(
            [agentClient, agentClient.setModel],
            request.agentId,
            model,
            request.workspaceId,
            current.providerId,
          );
          result = response.ok ? response.data : { success: false, error: response.error };
        }
      } else {
        write.issued = true;
        result = yield* call([appClient.agents, appClient.agents.setReasoningEffort], {
          agentId: request.agentId,
          workspaceId: request.workspaceId,
          reasoningEffort: value,
        });
      }
    } catch (error) {
      result = {
        success: false,
        error: error instanceof Error ? error.message : m.chat_effortPicker_updateFailed_error(),
      };
    }
    const settled = yield* snapshot(write);
    if (
      settled.connection !== request.connection ||
      settled.session?.workspaceId !== request.workspaceId ||
      settled.identity !== write.identity
    )
      return { status: 'cancelled' } satisfies AgentModelOutcome;
    if (result.success && queue.identity === write.identity) {
      queue.confirmed = value;
      queue.confirmedIntent = write.intent;
    }
    options?.onConfirmedEffort?.(queue.confirmed);
    if (result.success) {
      if (queue.latestIntent === write.intent && options?.canReconcileAccepted?.()) {
        yield* put(updateSession(request.agentId, { reasoningEffort: value }));
      }
      return { status: 'success' } satisfies AgentModelOutcome;
    }
    if (yield* owns(write, queue)) {
      if ((settled.session?.reasoningEffort ?? null) === value) {
        yield* put(updateSession(request.agentId, { reasoningEffort: queue.confirmed }));
      }
      if (yield* owns(write, queue))
        yield* call(notify.error, result.error ?? m.chat_effortPicker_updateFailed_error());
    }
    return { status: 'failure', error: result.error } satisfies AgentModelOutcome;
  }

  function release(write: Write, queue: Queue) {
    if (queue.latestIntent !== write.intent) return;
    queue.latestIntent = Math.max(
      queue.confirmedIntent,
      ...queue.writes
        .filter(
          (other) =>
            other.issued || (other !== write && other.action.payload[1]?.canSend?.() !== false),
        )
        .map((other) => other.intent),
    );
  }

  function* execute(write: Write, queue: Queue) {
    const [request, options] = write.action.payload;
    const op = request.operation;
    const before = yield* snapshot(write);
    if (!admitted(write, before)) return { status: 'cancelled' } satisfies AgentModelOutcome;
    if (op.kind === 'effort') return yield* effort(write, queue, op.effort);
    if (op.kind === 'reconcile') {
      if (before.identity !== write.identity) {
        release(write, queue);
        return { status: 'cancelled' } satisfies AgentModelOutcome;
      }
      const value = reconcileReasoningEffort(op.current, op.levels);
      if (value === op.current) return { status: 'success' } satisfies AgentModelOutcome;
      yield* put(
        updateSession(
          request.agentId,
          { reasoningEffort: value },
          { reasoningEffortSource: options?.source ?? 'control' },
        ),
      );
      return yield* effort(write, queue, value);
    }
    let modelResult;
    if (op.kind === 'model') {
      write.issued = true;
      modelResult = yield* call(
        [agentClient, agentClient.setModel],
        request.agentId,
        op.model,
        request.workspaceId,
        op.providerId,
      );
      const current = yield* snapshot(write);
      if (!admitted(write, current) || options?.canMutate?.() === false)
        return { status: 'cancelled' } satisfies AgentModelOutcome;
      if (!modelResult.ok || !modelResult.data.success) {
        return {
          status: 'failure',
          modelResult,
          error: modelResult.ok ? modelResult.data.error : modelResult.error,
        } satisfies AgentModelOutcome;
      }
      if (!op.commit) return { status: 'success', modelResult } satisfies AgentModelOutcome;
      // An independent daemon/model update wins over this old acknowledgment.
      if (
        current.identity !== before.identity &&
        (current.session?.model !== op.model ||
          current.providerId !== (op.providerId ?? before.providerId))
      ) {
        return { status: 'cancelled' } satisfies AgentModelOutcome;
      }
    }
    const current = yield* snapshot(write);
    yield* put(
      updateSession(request.agentId, {
        model: op.model,
        ...(op.providerId
          ? {
              provider: op.providerId,
              metadata: { ...current.session?.metadata, provider: op.providerId },
              ...(current.providerId !== op.providerId ? { effortLevels: undefined } : {}),
            }
          : {}),
      }),
    );
    if (op.kind === 'session') return { status: 'success' } satisfies AgentModelOutcome;
    const accepted = yield* snapshot(write);
    write.identity = accepted.identity;
    queue.identity = accepted.identity;
    queue.confirmed = accepted.session?.reasoningEffort ?? null;
    const providerId = op.providerId ?? accepted.providerId;
    const catalog = providerId
      ? yield* selectProviderModelsCacheEntry.effect(providerId, request.workspaceId)
      : undefined;
    // Missing/degraded catalogs are not proof that a model has no effort support.
    if (catalog && !catalog.warning && !catalog.stale) {
      const row = catalog.models.find(
        (model) =>
          splitLegacyCompoundId(model.value).modelId === splitLegacyCompoundId(op.model).modelId,
      );
      if (row) {
        const value = reconcileReasoningEffort(queue.confirmed, row.effortLevels);
        if (value !== queue.confirmed && (yield* owns(write, queue))) {
          yield* put(
            updateSession(
              request.agentId,
              { reasoningEffort: value },
              { reasoningEffortSource: 'control' },
            ),
          );
          const outcome = yield* effort(write, queue, value);
          return { ...outcome, modelAccepted: true, modelResult };
        }
      }
    }
    return { status: 'success', modelAccepted: true, modelResult } satisfies AgentModelOutcome;
  }

  function* drain(key: string, queue: Queue) {
    try {
      while (queue.writes.length) {
        const write = queue.writes[0];
        if (!write) break;
        try {
          const result = yield* execute(write, queue);
          yield* put(write.action.success(result));
        } catch (error) {
          yield* put(
            write.action.failure(error instanceof Error ? error : new Error(String(error))),
          );
        }
        queue.writes.shift();
      }
    } finally {
      if (yield* cancelled()) {
        for (const write of queue.writes) yield* put(write.action.success({ status: 'cancelled' }));
      }
      if (queues.get(key) === queue) queues.delete(key);
    }
  }

  yield* takeEvery(
    agentEffortIntentMarked,
    function* ({ payload: [agentId, workspaceId, intent] }) {
      const ordinal = ++nextIntent;
      // Only the latest unsent detent needs a reservation. Issued writes already
      // carry their ordinal; retaining every coalesced detent would grow forever.
      reservations.set(intentKey(agentId, workspaceId), { intent, ordinal });
      for (const queue of queues.values()) {
        const request = queue.writes[0]?.action.payload[0];
        if (request?.agentId === agentId && request.workspaceId === workspaceId)
          queue.latestIntent = ordinal;
      }
    },
  );
  yield* takeEvery(
    agentEffortIntentReleased,
    function* ({ payload: [agentId, workspaceId, intent] }) {
      const key = intentKey(agentId, workspaceId);
      const reservation = reservations.get(key);
      const ordinal = reservation?.intent === intent ? reservation.ordinal : undefined;
      if (ordinal !== undefined) reservations.delete(key);
      for (const queue of queues.values()) {
        const request = queue.writes[0]?.action.payload[0];
        const released =
          ordinal ??
          queue.writes.find((write) => write.action.payload[1]?.intent === intent)?.intent;
        if (
          request?.agentId === agentId &&
          request.workspaceId === workspaceId &&
          queue.latestIntent === released
        ) {
          queue.latestIntent = Math.max(
            queue.confirmedIntent,
            ...queue.writes
              .filter(
                (write) =>
                  write.issued ||
                  (write.intent !== released && write.action.payload[1]?.canSend?.() !== false),
              )
              .map((write) => write.intent),
          );
        }
      }
    },
  );
  yield* takeEvery(agentModelMutationRequested, function* (action) {
    const [request, options] = action.payload;
    const current = yield* selectAgentModelWriteSnapshot.effect(
      request.agentId,
      request.workspaceId,
    );
    const reservationKey = intentKey(request.agentId, request.workspaceId);
    const reservation = reservations.get(reservationKey);
    const intent =
      reservation && reservation.intent === options?.intent ? reservation.ordinal : ++nextIntent;
    if (reservation && reservation.intent === options?.intent) reservations.delete(reservationKey);
    const write: Write = { action, identity: current.identity, intent, issued: false };
    if (!admitted(write, current)) {
      yield* put(action.success({ status: 'cancelled' }));
      return;
    }
    const key = keyOf(request);
    let queue = queues.get(key);
    const start = !queue;
    const previous =
      request.operation.kind === 'effort'
        ? request.operation.previous
        : (current.session?.reasoningEffort ?? null);
    if (!queue) {
      queue = {
        confirmed: previous,
        confirmedIntent: 0,
        identity: current.identity,
        latestIntent: intent,
        writes: [],
      };
      queues.set(key, queue);
    } else if (queue.identity !== current.identity) {
      queue.identity = current.identity;
      queue.confirmed = previous;
    }
    queue.latestIntent = Math.max(queue.latestIntent, intent);
    queue.writes.push(write);
    if (request.operation.kind === 'effort')
      yield* put(
        updateSession(
          request.agentId,
          { reasoningEffort: request.operation.effort },
          { reasoningEffortSource: options?.source ?? 'control' },
        ),
      );
    if (start) yield* fork(drain, key, queue);
  });
}
