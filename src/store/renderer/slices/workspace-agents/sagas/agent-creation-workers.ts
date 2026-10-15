import { AgentStatus } from '$shared/types';
import { bulkUpsertSessions, upsertSession } from '../../agent-session/agent-session-slice';
import { markAgentRecentlyCreated } from '../workspace-agents-slice';
import { call, cancelled, put, type SagaGenerator } from 'typed-redux-saga';
import type { AgentSession, Workspace } from '$shared/types';
import type { UnifiedAgentConfig, CreateAgentResult } from '$shared/types/agent.types';
import { CHIEF_WORKSPACE_ID, WorkspaceId } from '$shared/types/branded-ids';
import { m } from '$shared/paraglide/messages.js';
import { setChiefActiveAgentId } from '../../sidebar-nav/sidebar-nav-slice';
import {
  agentCreationFinished,
  createAgentFromConfigRequested,
  setActiveAgentId,
  type AgentCreationRequestOptions,
} from '../workspace-agents-slice';
import type { AgentCreationOutcome } from '../workspace-agents-types';
import { creationError, factoryFailure } from '../agent-creation-errors';
type EffectReader<Args extends unknown[], R> = { effect(...args: Args): SagaGenerator<R> };

/** One creation workflow, bound to the owning application's selectors and presentation. */
export function createAgentCreationWorkers(runtime: {
  agentFactory: {
    createAgent(
      workspace: Workspace,
      config: UnifiedAgentConfig,
      key?: string,
    ): Promise<CreateAgentResult>;
  };
  selectWorkspaceActionContext: EffectReader<[string], string | null>;
  selectAllWorkspaceAgents: EffectReader<[string], AgentSession[]>;
  selectAgentCreationOutcome: EffectReader<
    [string, string, string],
    AgentCreationOutcome | undefined
  >;
  refusedForCollaborator(wsId: string, notify?: boolean): SagaGenerator<boolean>;
  validateWorkspace(wsId: string): SagaGenerator<Workspace | null>;
  openCreatedAgent(
    wsId: string,
    session: AgentSession,
    options?: AgentCreationRequestOptions,
  ): SagaGenerator<void>;
  showConsumerCreationError(error: Error, source?: string): Promise<void>;
  prepareConfig?(wsId: string, config: UnifiedAgentConfig): SagaGenerator<UnifiedAgentConfig>;
  onCreated?(source?: string): Promise<void>;
}) {
  const {
    agentFactory,
    selectWorkspaceActionContext,
    selectAllWorkspaceAgents,
    selectAgentCreationOutcome,
    refusedForCollaborator,
    validateWorkspace,
    openCreatedAgent,
    showConsumerCreationError,
  } = runtime;
  function hasUsableSession(session: AgentSession | undefined): boolean {
    return !!session?.backendSessionId && session.status !== AgentStatus.Pending;
  }

  function* registerCreatedAgent(
    wsId: string,
    session: AgentSession,
    existingAgents: AgentSession[],
  ): SagaGenerator<void> {
    const existing = existingAgents.find((agent) => agent.id === session.id);
    if (!existing || (!hasUsableSession(existing) && hasUsableSession(session))) {
      const scoped = { ...session, workspaceId: wsId as AgentSession['workspaceId'] };
      yield* put(bulkUpsertSessions([scoped]));
      yield* put(upsertSession(scoped));
    }
    yield* put(markAgentRecentlyCreated(wsId, session.id));
  }

  function* isCreationConsumerCurrent(
    action: ReturnType<typeof createAgentFromConfigRequested>,
  ): SagaGenerator<boolean> {
    const [wsId, , options] = action.payload;
    if (!options?.consumer) return true;
    const current = yield* selectAgentCreationOutcome.effect(
      options.consumer.id,
      wsId,
      options.consumer.resourceId,
    );
    return current?.seq === action.seq && current.status === 'pending';
  }

  function* finishCreation(
    action: ReturnType<typeof createAgentFromConfigRequested>,
    status: AgentCreationOutcome['status'],
    session?: AgentSession,
    error?: Error,
  ): SagaGenerator<void> {
    const [workspaceId, , options] = action.payload;
    if (!options?.consumer) return;
    yield* put(
      agentCreationFinished({
        ...options.consumer,
        workspaceId,
        seq: action.seq,
        status,
        agentId: session?.id,
        error: error?.message,
        completedAt: new Date().toISOString(),
      }),
    );
  }

  function* activateCreatedAgent(
    action: ReturnType<typeof createAgentFromConfigRequested>,
    session: AgentSession,
  ): SagaGenerator<void> {
    if (!(yield* call(isCreationConsumerCurrent, action))) return;
    const [wsId, config, options] = action.payload;
    if (options?.activateAgent !== false) yield* put(setActiveAgentId(wsId, session.id));
    if (wsId === CHIEF_WORKSPACE_ID && config.source === 'chief-card') {
      yield* put(setChiefActiveAgentId(session.id));
    }
    yield* call(openCreatedAgent, wsId, session, options);
  }

  function* createFromConfig(
    pending: Map<string, ReturnType<typeof createAgentFromConfigRequested>>,
    action: ReturnType<typeof createAgentFromConfigRequested>,
  ): SagaGenerator<void> {
    const [wsId, config, options] = action.payload;
    const context = yield* selectWorkspaceActionContext.effect(wsId);
    const errorFallback =
      config.source === 'agent-action-block'
        ? m.notes_agentActionBlock_unknown_error()
        : m.agent_creation_createFailed_error();
    const key = options?.consumer
      ? JSON.stringify([context, wsId, options.consumer.resourceId])
      : undefined;
    const existing = key ? pending.get(key) : undefined;
    if (key && !existing) pending.set(key, action);
    let settled = false;
    let creationUncertain = false;
    // Canceling the worker cannot undo a factory operation already in flight.
    let factoryInFlight = false;
    try {
      if (!wsId && config.source === 'agent-action-block') {
        const failure = new Error(m.notes_agentActionBlock_noWorkspace_error());
        yield* call(showConsumerCreationError, failure, config.source);
        yield* finishCreation(action, 'failure', undefined, failure);
        yield* put(action.failure(failure));
        settled = true;
        return;
      }
      if (yield* call(refusedForCollaborator, wsId, options?.notifyOnError !== false)) {
        const failure = new Error(m.agent_creation_notPermitted_error());
        yield* finishCreation(action, 'failure', undefined, failure);
        yield* put(action.failure(failure));
        settled = true;
        return;
      }
      if (existing) {
        const session = yield* call(() => existing.promise);
        if ((yield* selectWorkspaceActionContext.effect(wsId)) === context) {
          yield* call(activateCreatedAgent, action, session);
          yield* finishCreation(action, 'success', session);
        } else {
          yield* finishCreation(action, 'cancelled');
          yield* put(action.failure(new Error(m.agent_creation_createFailed_error())));
          settled = true;
          return;
        }
        yield* put(action.success(session));
        settled = true;
        return;
      }
      if (options?.protectUncertainCreation && !(yield* call(isCreationConsumerCurrent, action))) {
        throw new Error(m.agent_creation_createFailed_error());
      }
      const workspace = yield* call(validateWorkspace, wsId);
      if (!workspace) throw new Error(m.agent_creation_workspaceUnavailable_error());
      const agents = yield* selectAllWorkspaceAgents.effect(wsId);
      const prepared = runtime.prepareConfig
        ? yield* call(runtime.prepareConfig, wsId, config)
        : config;
      if ((yield* selectWorkspaceActionContext.effect(wsId)) !== context)
        throw new Error(m.agent_creation_workspaceUnavailable_error());
      const scopedConfig = { ...prepared, workspaceId: WorkspaceId(wsId) };
      factoryInFlight = true;
      const result = key
        ? yield* call([agentFactory, agentFactory.createAgent], workspace, scopedConfig, key)
        : yield* call([agentFactory, agentFactory.createAgent], workspace, scopedConfig);
      factoryInFlight = false;
      creationUncertain = result.creationUncertain === true;
      if (!result.success || !result.agent)
        throw creationError(factoryFailure(result), errorFallback);
      if ((yield* selectWorkspaceActionContext.effect(wsId)) !== context) {
        yield* finishCreation(
          action,
          options?.protectUncertainCreation ? 'uncertain' : 'cancelled',
        );
        yield* put(action.failure(new Error(m.agent_creation_createFailed_error())));
        settled = true;
        return;
      }
      yield* call(registerCreatedAgent, wsId, result.agent, agents);
      yield* call(activateCreatedAgent, action, result.agent);
      if (runtime.onCreated && (yield* call(isCreationConsumerCurrent, action))) {
        yield* call(runtime.onCreated, config.source);
      }
      yield* finishCreation(action, 'success', result.agent);
      yield* put(action.success(result.agent));
      settled = true;
    } catch (error) {
      const failure = creationError(error, errorFallback);
      const contextCurrent = (yield* selectWorkspaceActionContext.effect(wsId)) === context;
      if (
        contextCurrent &&
        !existing &&
        options?.notifyOnError !== false &&
        (yield* call(isCreationConsumerCurrent, action))
      ) {
        yield* call(showConsumerCreationError, failure, config.source);
      }
      yield* finishCreation(
        action,
        (creationUncertain || factoryInFlight) && options?.protectUncertainCreation
          ? 'uncertain'
          : contextCurrent
            ? 'failure'
            : 'cancelled',
        undefined,
        failure,
      );
      yield* put(action.failure(failure));
      settled = true;
    } finally {
      if (!settled && (yield* cancelled())) {
        const failure = new Error(m.agent_creation_createFailed_error());
        yield* finishCreation(
          action,
          factoryInFlight && options?.protectUncertainCreation ? 'uncertain' : 'cancelled',
          undefined,
          failure,
        );
        yield* put(action.failure(failure));
      }
      if (key && pending.get(key) === action) pending.delete(key);
    }
  }

  return { createFromConfig, registerCreatedAgent };
}
