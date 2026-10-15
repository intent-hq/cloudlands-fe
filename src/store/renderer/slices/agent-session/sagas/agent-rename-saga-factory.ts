import { call, cancelled, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { m } from '$shared/paraglide/messages.js';
import type { AgentRenameResult } from '$lib/client/app-client';
import type {
  AgentRenameSagaDependencies,
  AgentRenameSequence,
  AgentRenameAttempt,
  AgentRenameRequest,
} from '../agent-session-types';
import { renameAgentSessionRequested } from '../../workspace-agents/workspace-agents-slice';
import {
  updateSession,
  agentRenameOperationQueued,
  agentRenameOperationStarted,
  agentRenameOperationSettled,
} from '../agent-session-slice';
import { mutationError } from './agent-mutation-error';

/** The sole rename watcher: source optimism or explicit host admission, never both. */
export function createAgentRenameSaga(deps: AgentRenameSagaDependencies) {
  function* renameAgent(
    sequences: Map<string, AgentRenameSequence>,
    action: ReturnType<typeof renameAgentSessionRequested>,
  ): SagaGenerator<void> {
    const [wsId, agentId, name, metadata] = action.payload;
    if (metadata) {
      yield* put(action.failure(new Error(m.ui_reversibleActions_cancelled_message())));
      return;
    }
    const revision = yield* deps.selectRevision(agentId);
    const previous = yield* deps.selectSession(agentId);
    const ownership =
      !previous || previous.workspaceId === wsId
        ? deps.captureOwnership?.(agentId, wsId)
        : undefined;
    const key = `${ownership?.key}:${agentId}`;
    let sequence = sequences.get(key);
    const attempt: AgentRenameAttempt = {
      identity: { name, nameExplicitlySet: true },
      status: 'pending',
    };
    if (previous && ownership) {
      if (
        !sequence ||
        previous.name !== sequence.published.name ||
        previous.nameExplicitlySet !== sequence.published.nameExplicitlySet ||
        revision !== sequence.revision
      ) {
        // A daemon hydration supersedes the earlier optimistic identity. A new
        // rename starts from that authoritative identity, not the stale chain.
        const initial = { name: previous.name, nameExplicitlySet: previous.nameExplicitlySet };
        sequence = { initial, published: initial, revision, attempts: [] };
        sequences.set(key, sequence);
      }
      sequence.attempts.push(attempt);
      sequence.published = attempt.identity;
      yield* put(updateSession(agentId, attempt.identity));
      sequence.revision = yield* deps.selectRevision(agentId);
    }
    let settled = false;
    try {
      const result = yield* call(deps.rename, agentId, name, wsId);
      if (!result.success) throw new Error(result.error || m.agent_mutation_renameFailed_error());
      attempt.status = 'succeeded';
      yield* put(action.success(undefined as never));
      settled = true;
    } catch (error) {
      attempt.status = 'failed';
      yield* put(
        action.failure(mutationError(error, m.agent_mutation_renameSessionFailed_error())),
      );
      settled = true;
    } finally {
      if (!settled && (yield* cancelled())) {
        attempt.status = 'failed';
        yield* put(action.failure(new Error(m.agent_mutation_renameSessionFailed_error())));
      }
      if (sequence && sequences.get(key) === sequence) {
        if (attempt.status === 'failed') {
          const current = yield* deps.selectSession(agentId);
          // Compare ownership AND the write sequence, not just the name: two
          // requests can use the same name and the newer one may have succeeded.
          const identity =
            sequence.attempts.findLast((item) => item.status !== 'failed')?.identity ??
            sequence.initial;
          if (
            current &&
            ownership?.isCurrent(current.workspaceId) &&
            current.name === sequence.published.name &&
            current.nameExplicitlySet === sequence.published.nameExplicitlySet &&
            (yield* deps.selectRevision(agentId)) === sequence.revision
          ) {
            yield* put(updateSession(agentId, identity));
            sequence.published = identity;
            sequence.revision = yield* deps.selectRevision(agentId);
          }
        }
        if (sequence.attempts.every((item) => item.status !== 'pending')) sequences.delete(key);
      }
    }
  }

  function* renameAdmitted(
    action: ReturnType<typeof renameAgentSessionRequested>,
    admission: NonNullable<AgentRenameSagaDependencies['admission']>,
  ): SagaGenerator<void> {
    const [workspaceId, agentId, rawName, metadata] = action.payload;
    let active = true;
    let dispatched = false;
    let queued = false;
    let settled = false;
    let observedRevision: number | undefined;
    const request: AgentRenameRequest | undefined = metadata && {
      ...metadata,
      workspaceId,
      agentId,
      name: rawName.trim(),
    };
    const isCurrent = () =>
      active &&
      !!request &&
      admission.isCurrent(request) &&
      (observedRevision === undefined || admission.readRevision(agentId) === observedRevision);
    const denied = () => new Error(m.ui_reversibleActions_cancelled_message());
    try {
      if (
        !request ||
        !request.requestId ||
        !request.authority ||
        !request.context ||
        !request.viewId ||
        !Number.isSafeInteger(request.expectedRevision) ||
        !isCurrent()
      )
        throw denied();
      const session = yield* deps.selectSession(agentId);
      if (!session || session.workspaceId !== workspaceId || !isCurrent()) throw denied();
      if (
        !request.name ||
        request.name === session.name ||
        request.name === request.previousName.trim()
      ) {
        yield* put(action.success(undefined as never));
        return;
      }
      const operations = yield* admission.selectOperations(agentId);
      if (
        operations.some(
          (op) =>
            op.requestId === request.requestId ||
            (op.workspaceId === workspaceId &&
              op.authority === request.authority &&
              ['queued', 'running', 'unknown'].includes(op.status)),
        )
      )
        throw denied();
      observedRevision = yield* deps.selectRevision(agentId);
      if (!isCurrent()) throw denied();
      admission.dispatch(
        agentRenameOperationQueued({ ...request, observedRevision, status: 'queued' }),
      );
      queued = true;
      if (
        !isCurrent() ||
        request.previousName !== session.name ||
        request.expectedRevision !== observedRevision
      )
        throw denied();
      // The promise owns the receipt after cancellation. The onDispatch guard runs
      // after transport placement preflight, immediately before the wire write.
      const execute = async (): Promise<AgentRenameResult> => {
        let receipt: AgentRenameResult;
        try {
          if (!isCurrent()) throw denied();
          receipt = await deps.rename(agentId, request.name, workspaceId, {
            requireRenameReceipt: true,
            onDispatch: () => {
              if (!isCurrent() || dispatched) throw denied();
              admission.dispatch(agentRenameOperationStarted(request.requestId));
              if (!isCurrent()) throw denied();
              dispatched = true;
            },
          });
        } catch (error) {
          receipt = {
            success: false,
            error: mutationError(error, m.agent_mutation_renameFailed_error()).message,
            renameOutcome: dispatched ? 'unknown' : 'failed',
          };
        }
        const confirmed =
          dispatched &&
          receipt.dispatched === true &&
          receipt.success &&
          receipt.renameOutcome === 'confirmed' &&
          typeof receipt.name === 'string' &&
          !!receipt.name.trim();
        const status = confirmed
          ? 'confirmed'
          : !dispatched || receipt.renameOutcome === 'failed'
            ? 'failed'
            : 'unknown';
        admission.dispatch(
          agentRenameOperationSettled(
            request.requestId,
            status,
            receipt.error,
            confirmed ? receipt.name : undefined,
            confirmed && admission.canPublish(request),
          ),
        );
        settled = true;
        return { ...receipt, success: !!confirmed, renameOutcome: status };
      };
      const result = yield* call(execute);
      if (!result.success) throw new Error(result.error || m.agent_mutation_renameFailed_error());
      yield* put(action.success(undefined as never));
    } catch (error) {
      if (queued && request && !settled) {
        admission.dispatch(
          agentRenameOperationSettled(
            request.requestId,
            dispatched ? 'unknown' : 'failed',
            mutationError(error, m.agent_mutation_renameFailed_error()).message,
          ),
        );
        settled = true;
      }
      yield* put(
        action.failure(mutationError(error, m.agent_mutation_renameSessionFailed_error())),
      );
    } finally {
      if (yield* cancelled()) {
        active = false;
        if (queued && request && !settled)
          admission.dispatch(
            agentRenameOperationSettled(request.requestId, dispatched ? 'unknown' : 'failed'),
          );
        yield* put(action.failure(denied()));
      }
    }
  }

  return function* agentRenameSaga(): SagaGenerator<void> {
    const sequences = new Map<string, AgentRenameSequence>();
    yield* takeEvery(renameAgentSessionRequested, function* (action) {
      if (deps.admission) yield* renameAdmitted(action, deps.admission);
      else yield* renameAgent(sequences, action);
    });
  };
}
