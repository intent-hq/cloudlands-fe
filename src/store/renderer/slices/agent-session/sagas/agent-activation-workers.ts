import { mutationError } from './agent-mutation-error';
import { call, put, cancelled, type SagaGenerator } from 'typed-redux-saga';
import { AgentStatus, type AgentSession } from '$shared/types';
import { AgentActivationState } from '$shared/types/agent-session';
import { m } from '$shared/paraglide/messages.js';
import type { StoredAgentSession, WireAgentSession } from '../agent-session-types';
import { bulkUpsertSessions, upsertSession, updateSession } from '../agent-session-slice';
import {
  activateAgentRequested,
  restoreAgentSessionRequested,
} from '../../workspace-agents/workspace-agents-slice';
import type { createAgentReadOwnership } from '../../../../../features/agent/agent-read-ownership-factory';
/** Canonical restoration/activation bookkeeping shared by renderer bindings. No agent creation or provider RPC. */
export function createAgentActivationWorkers({
  selectAgentSession,
  captureAgentMutationOwnership,
  readAgentSession,
}: {
  selectAgentSession: { effect(agentId: string): SagaGenerator<StoredAgentSession | undefined> };
  captureAgentMutationOwnership: ReturnType<
    typeof createAgentReadOwnership
  >['captureAgentMutationOwnership'];
  readAgentSession: (agentId: string, workspaceId: string) => Promise<AgentSession | null>;
}) {
  function hasUsableSession(session: AgentSession | undefined): session is AgentSession {
    return !!session?.backendSessionId && session.status !== AgentStatus.Pending;
  }

  function preserveMessages(fetched: AgentSession, existing?: AgentSession): AgentSession {
    return fetched.messages?.length || !existing?.messages.length
      ? fetched
      : { ...fetched, messages: existing.messages };
  }

  function* persistSession(session: WireAgentSession): SagaGenerator<void> {
    yield* put(bulkUpsertSessions([session]));
    yield* put(upsertSession(session));
  }

  function* patchStoredSession(
    agentId: string,
    patch: Partial<AgentSession>,
  ): SagaGenerator<StoredAgentSession | undefined> {
    yield* put(updateSession(agentId, patch));
    return yield* selectAgentSession.effect(agentId);
  }

  function* restoreAgent(
    action: ReturnType<typeof restoreAgentSessionRequested>,
  ): SagaGenerator<void> {
    const [wsId, agentId] = action.payload;
    const existing = yield* selectAgentSession.effect(agentId);
    // A cached row from another workspace is not this restoration's session.
    // Do not claim its ownership or hand it back to the send/activation caller.
    if (existing && existing.workspaceId !== wsId) {
      yield* put(action.success(null));
      return;
    }
    const ownership = captureAgentMutationOwnership(agentId, wsId);
    let settled = false;
    try {
      if (hasUsableSession(existing)) {
        yield* put(action.success(existing));
      } else {
        const fetched = yield* call(readAgentSession, agentId, wsId);
        const current = yield* selectAgentSession.effect(agentId);
        // readAgentSession returns metadata; this consumer owns the state write.
        // Recheck before both the persisted projection and fallback resolution.
        if (
          !ownership.isCurrent(current?.workspaceId) ||
          (fetched && fetched.workspaceId !== wsId)
        ) {
          yield* put(action.success(null));
        } else if (!fetched) {
          yield* put(action.success(current ?? null));
        } else {
          const session = {
            ...preserveMessages(fetched, current),
            workspaceId: wsId as AgentSession['workspaceId'],
          };
          yield* call(persistSession, session);
          yield* put(action.success(session));
        }
      }
      settled = true;
    } catch (error) {
      if (ownership.isCurrent((yield* selectAgentSession.effect(agentId))?.workspaceId)) {
        yield* put(action.failure(mutationError(error, m.agent_mutation_restoreFailed_error())));
      } else {
        yield* put(action.success(null));
      }
      settled = true;
    } finally {
      if (!settled && (yield* cancelled())) {
        yield* put(action.failure(new Error(m.agent_mutation_restoreFailed_error())));
      }
    }
  }

  function* activateAgent(action: ReturnType<typeof activateAgentRequested>): SagaGenerator<void> {
    const [wsId, agentId] = action.payload;
    const ownership = captureAgentMutationOwnership(agentId, wsId);
    const existing = yield* selectAgentSession.effect(agentId);
    let settled = false;
    try {
      if (existing?.backendSessionId && existing.status === AgentStatus.Active) {
        yield* put(action.success(existing));
        settled = true;
        return;
      }
      const activationAttempts = (existing?.activationAttempts || 0) + 1;
      if (existing) {
        yield* call(patchStoredSession, agentId, {
          workspaceId: wsId as AgentSession['workspaceId'],
          activationState: AgentActivationState.ACTIVATING,
          activationAttempts,
        });
      }
      const fetched = yield* call(readAgentSession, agentId, wsId);
      if (!ownership.isCurrent((yield* selectAgentSession.effect(agentId))?.workspaceId)) {
        yield* put(action.success(null));
        settled = true;
        return;
      }
      if (fetched) {
        const source = preserveMessages(fetched, existing);
        const activated: WireAgentSession = {
          ...source,
          workspaceId: wsId as AgentSession['workspaceId'],
          status: source.backendSessionId ? AgentStatus.Active : source.status,
          activationState: AgentActivationState.ACTIVE,
          activationAttempts,
        };
        yield* call(persistSession, activated);
        yield* put(action.success(activated));
      } else {
        // Reselect: the row may have changed (or gone) while the read was pending.
        const current = yield* selectAgentSession.effect(agentId);
        const activated = current
          ? yield* call(patchStoredSession, agentId, {
              workspaceId: wsId as AgentSession['workspaceId'],
              status: current.backendSessionId ? AgentStatus.Active : current.status,
              activationState: AgentActivationState.ACTIVE,
              activationAttempts,
            })
          : undefined;
        yield* put(action.success(activated ?? null));
      }
      settled = true;
    } catch (error) {
      if (
        existing &&
        ownership.isCurrent((yield* selectAgentSession.effect(agentId))?.workspaceId)
      ) {
        yield* call(patchStoredSession, agentId, {
          workspaceId: wsId as AgentSession['workspaceId'],
          activationState: AgentActivationState.ERROR,
          lastActivationError: mutationError(error, m.agent_mutation_activateFailed_error())
            .message,
        });
      }
      yield* put(action.failure(mutationError(error, m.agent_mutation_activateFailed_error())));
      settled = true;
    } finally {
      if (!settled && (yield* cancelled())) {
        yield* put(action.failure(new Error(m.agent_mutation_activateFailed_error())));
      }
    }
  }
  return { restoreAgent, activateAgent };
}
