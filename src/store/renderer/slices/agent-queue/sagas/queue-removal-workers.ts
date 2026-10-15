import { sameSubmissionScope } from '../../pending-submissions/pending-submissions-model';
import { m } from '$shared/paraglide/messages.js';
import { call, cancelled, put, type SagaGenerator } from 'typed-redux-saga';
import type { StoreAction } from '@themislib/themis/types';
import type { AgentsClient } from '$lib/client/app-client';
import type { QueuedMessage } from '$shared/types';
import {
  queuedMessageMutationFinished,
  queuedMessageMutationRequested,
  queuedMessageRemovalApplied,
  queuedMessageRemovalDispatched,
} from '../agent-queue-slice';
import type {
  QueueRemovalAuthority,
  QueuedMessageMutation,
  QueuedMessageMutationRequest,
  QueuedMessageMutationResult,
} from '../agent-queue-types';

type RemovalAction = ReturnType<typeof queuedMessageMutationRequested>;
type EffectReader<Args extends unknown[], R> = { effect(...args: Args): SagaGenerator<R> };

/** Shared worker; each app's existing command FIFO remains the sole action watcher. */
export function createQueueRemovalWorkers({
  agents,
  dispatch,
  captureAuthority,
  selectQueuedMessageMutation,
  selectQueueRemovalUncertain,
  selectAgentQueueMessages,
  selectQueueMutationBlocked,
  hydrateAgentQueue,
  getAgentQueueEventSnapshotSeq,
  noteAgentQueueEventSnapshotApplied,
}: {
  agents: Pick<AgentsClient, 'removeQueued'>;
  dispatch(action: StoreAction<unknown>): unknown;
  /** Called at FIFO intake, never after waiting behind another command. */
  captureAuthority(request: QueuedMessageMutationRequest): QueueRemovalAuthority | undefined;
  selectQueuedMessageMutation: EffectReader<[string], QueuedMessageMutation | undefined>;
  selectQueueRemovalUncertain: EffectReader<[QueuedMessageMutationRequest], boolean>;
  selectAgentQueueMessages: EffectReader<[string, string?], QueuedMessage[]>;
  selectQueueMutationBlocked: EffectReader<[string, string, string?], boolean>;
  hydrateAgentQueue(agentId: string, workspaceId: string): Promise<void>;
  getAgentQueueEventSnapshotSeq(agentId: string, workspaceId: string): number;
  noteAgentQueueEventSnapshotApplied(agentId: string, workspaceId: string): void;
}) {
  // Runtime leases follow the queued action; all request/receipt facts live in Redux.
  const admissions = new WeakMap<RemovalAction, QueueRemovalAuthority | undefined>();
  function capture(action: RemovalAction): void {
    if (action.payload[0].operation.kind !== 'remove' || admissions.has(action)) return;
    const request = action.payload[0];
    if (
      request.removalScope &&
      (!request.removalBackendId ||
        request.removalScope.agentId !== request.agentId ||
        request.removalScope.workspaceId !== request.workspaceId)
    ) {
      admissions.set(action, undefined);
      return;
    }
    const authority = captureAuthority(request);
    admissions.set(action, authority?.isCurrent() ? authority : undefined);
  }

  function* handleRemove(action: RemovalAction): SagaGenerator<void> {
    const [request] = action.payload;
    const { agentId, workspaceId, messageId, requestId } = request;
    const authority = admissions.get(action);
    admissions.delete(action);
    let sent = false;
    let settled = false;
    let result: QueuedMessageMutationResult = { status: 'cancelled' };
    try {
      const mutation = yield* selectQueuedMessageMutation.effect(requestId);
      // Releasing a consumer drops unsent requests. A queued old action cannot adopt a new lease.
      if (
        !mutation ||
        mutation.status !== 'pending' ||
        mutation.removalDispatched ||
        mutation.kind !== 'remove' ||
        mutation.removalBackendId !== request.removalBackendId ||
        mutation.consumerId !== request.consumerId ||
        mutation.agentId !== agentId ||
        mutation.workspaceId !== workspaceId ||
        mutation.messageId !== messageId ||
        (mutation.removalScope
          ? !request.removalScope ||
            !sameSubmissionScope(mutation.removalScope, request.removalScope)
          : !!request.removalScope)
      ) {
        settled = true;
        return;
      }
      if (!authority?.isCurrent()) return;
      if (yield* selectQueueRemovalUncertain.effect(request)) {
        result = { status: 'failed', removalOutcome: 'unknown' };
        return;
      }
      if (yield* selectQueueMutationBlocked.effect(agentId, workspaceId, messageId)) {
        result = { status: 'failed', removalOutcome: 'failed' };
        return;
      }
      // Strict consumers admit only a visible authoritative row. A drained row needs no write.
      if (request.removalScope) {
        const messages = yield* selectAgentQueueMessages.effect(agentId, workspaceId);
        if (!messages.some((message) => message.id === messageId)) {
          result = { status: 'succeeded', removalOutcome: 'no-longer-queued' };
          return;
        }
      }
      const sequence = getAgentQueueEventSnapshotSeq(agentId, workspaceId);
      const receipt = yield* call([agents, agents.removeQueued], agentId, messageId, workspaceId, {
        requireRemovalReceipt: true as const,
        onDispatch() {
          if (!authority.isCurrent()) throw new Error(m.agent_chatSend_sendNowRejected_error());
          dispatch(queuedMessageRemovalDispatched(requestId));
          sent = true;
        },
      });
      if (sent && receipt?.success === true && receipt.removalOutcome === 'no-longer-queued') {
        result = { status: 'succeeded', removalOutcome: 'no-longer-queued' };
        if (
          authority.canPublish() &&
          sequence === getAgentQueueEventSnapshotSeq(agentId, workspaceId)
        ) {
          // This receipt is newer evidence than every read already in flight.
          // Fence those reads before applying absence, including when the trailing read fails.
          yield* call(noteAgentQueueEventSnapshotApplied, agentId, workspaceId);
          yield* put(queuedMessageRemovalApplied(agentId, messageId));
        }
      } else {
        result = {
          status: 'failed',
          removalOutcome: !sent || receipt?.removalOutcome === 'failed' ? 'failed' : 'unknown',
          ...(receipt?.error ? { error: receipt.error } : {}),
        };
      }
      yield* put(queuedMessageMutationFinished(requestId, result));
      settled = true;
      // Reuse the sole coalesced reader. Never synthesize a row or automatically replay a write.
      if (authority.canPublish()) yield* call(hydrateAgentQueue, agentId, workspaceId);
    } catch (error) {
      if (!settled) {
        result = {
          status: 'failed',
          removalOutcome: sent ? 'unknown' : 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
        yield* put(queuedMessageMutationFinished(requestId, result));
        settled = true;
        if (authority?.canPublish()) yield* call(hydrateAgentQueue, agentId, workspaceId);
      }
    } finally {
      if (!settled) {
        if (yield* cancelled())
          result = sent ? { status: 'failed', removalOutcome: 'unknown' } : { status: 'cancelled' };
        yield* put(queuedMessageMutationFinished(requestId, result));
      }
    }
  }
  return { capture, handleRemove };
}
