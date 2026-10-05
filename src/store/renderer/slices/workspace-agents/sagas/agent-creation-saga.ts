import { nodeExecutionSaga } from './node-execution-saga';
import { all, call, cancelled, fork, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { agentFactory } from '$features/agent/services/agent-factory';
import { buildTaskAgentInitialMessage } from '$features/notes/utils/task-agent-message-builder';
import { appClient } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { isForbiddenErrorResponse } from '$lib/client/live/backend-transport-types';
import { createLogger } from '$lib/utils/client-logger';
import { generateSpecialistAgentName } from '$lib/utils/agent-name-generator';
import { cleanErrorMessage } from '$shared/errors/messages';
import { m } from '$shared/paraglide/messages.js';
import type { AgentSession, Workspace } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { getAgentProvider } from '$shared/types/agent-session';
import { createAgentTypeId, parseAgentTypeId } from '$shared/types/agent.types';
import { CHIEF_WORKSPACE_ID, WorkspaceId } from '$shared/types/branded-ids';
import { isNoteContentStale } from '$shared/utils/note-content';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import { openAgentTabRequested } from '../../app-layout/app-layout-slice';
import {
  agentSessionLaunchAgentRequested,
  bulkUpsertSessions,
  upsertSession,
} from '../../agent-session/agent-session-slice';
import { selectContextSelectedModel } from '../../provider-catalog/workspace-catalog-selectors';
import { openTab, openTabInRightmostColumnRequested } from '../../panel-layout/panel-layout-slice';
import { selectEffectiveDefaultProviderId } from '../../provider-catalog/provider-catalog-selectors';
import {
  filterPickableSpecialists,
  selectDefaultSpecialistId,
  selectEffectiveBehaviorPrompt,
  selectEffectiveCodingAgent,
  selectExplicitModel,
  selectExplicitReasoningEffort,
  selectSpecialists,
} from '../../specialists/specialists-selectors';
import {
  selectHidesAgentLifecycleActions,
  selectWorkspaceActionContext,
  selectWorkspaceById,
} from '../../workspace/workspace-selectors';
import { selectGitHubAuthIsAuthenticated } from '../../github-auth/github-auth-selectors';
import { selectNoteById } from '../../workspace-notes/workspace-notes-selectors';
import { setChiefActiveAgentId } from '../../sidebar-nav/sidebar-nav-slice';
import { createChiefVirtualWorkspace } from '../chief-virtual-workspace';
import {
  selectAgentCreationOutcome,
  selectAllWorkspaceAgents,
} from '../workspace-agents-selectors';
import type { AgentCreationOutcome } from '../workspace-agents-types';
import {
  agentCreationFinished,
  createAgentFromConfigRequested,
  createAgentRequested,
  createAgentWithSpecialistRequested,
  delegateExistingTaskRequested,
  markAgentRecentlyCreated,
  runAgentForNoteRequested,
  setActiveAgentId,
  type AgentCreationRequestOptions,
} from '../workspace-agents-slice';

const logger = createLogger('AgentCreationSaga');

function hasUsableSession(session: AgentSession | undefined): boolean {
  return !!session?.backendSessionId && session.status !== AgentStatus.Pending;
}

/**
 * Normalises a creation failure into the `Error` handed to `action.failure`.
 * A daemon `-32003` refusal keeps its `rpcCode` (so `showCreationError` still
 * routes it to the refusal toast) but carries the localized not-permitted
 * sentence instead of the raw daemon text, so promise-bearing callers render
 * the same message the toast does.
 */
function creationError(error: unknown, fallback = m.agent_creation_createFailed_error()): Error {
  if (isForbiddenErrorResponse(error)) {
    return Object.assign(new Error(m.agent_creation_notPermitted_error()), {
      rpcCode: (error as { rpcCode: number }).rpcCode,
      cause: error,
    });
  }
  if (error instanceof Error) return error;
  return new Error(error ? String(error) : fallback);
}

/** The typed transport error when the factory captured one, else its flattened text. */
function factoryFailure(result: { error?: string; cause?: unknown }): unknown {
  return result.cause ?? result.error;
}

function isProviderModelMismatch(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /\bmodel\b.+\bdoes not belong to provider\b/i.test(message);
}

async function showCreationRefused(): Promise<void> {
  try {
    const { notify } = await import('$lib/components/patterns/notify');
    notify.error(m.agent_creation_notPermitted_error(), {
      description: m.agent_creation_notPermitted_description(),
    });
  } catch (toastError) {
    logger.error('Failed to surface agent creation refusal', toastError);
  }
}

async function showCreationError(error: unknown): Promise<void> {
  if (isForbiddenErrorResponse(error)) return showCreationRefused();
  try {
    const { notify } = await import('$lib/components/patterns/notify');
    notify.error(m.agent_creation_createFailed_error(), {
      description:
        error instanceof Error &&
        (error as Error & { rpcCode?: number }).rpcCode === -32602 &&
        /^Claude agent .+ (?:uses settings Intent cannot apply:|requires skills that are unavailable:)/.test(
          error.message,
        )
          ? error.message
          : isProviderModelMismatch(error)
            ? m.agent_creation_providerModelMismatch_description()
            : m.agent_creation_failed_description(),
    });
  } catch (toastError) {
    logger.error('Failed to surface agent creation error', toastError);
  }
}

async function showConsumerCreationError(error: Error, source?: string): Promise<void> {
  if (
    (source !== 'chief-card' && source !== 'agent-action-block') ||
    isForbiddenErrorResponse(error) ||
    isProviderModelMismatch(error)
  ) {
    return showCreationError(error);
  }
  try {
    const { notify } = await import('$lib/components/patterns/notify');
    const message = cleanErrorMessage(error.message);
    notify.error(
      source === 'chief-card' ? m.layout_chiefCard_startFailed_error({ message }) : message,
      { description: m.agent_creation_failed_description() },
    );
  } catch (toastError) {
    logger.error('Failed to surface agent creation error', toastError);
  }
}

/**
 * Agent creation (`agent.create` / `agent.delegate` / `agent.wakeOrCreate`) is
 * refused with -32003 for a collaborator connection. The gated affordances are
 * already withheld; a request that still arrives (shortcut, palette, stale
 * surface) is refused here before anything is sent, with the same localized
 * sentence the daemon's refusal would render.
 */
function* refusedForCollaborator(wsId: string, notify = true): SagaGenerator<boolean> {
  const hidden = yield* selectHidesAgentLifecycleActions.effect(wsId);
  if (!hidden) return false;
  logger.warn('Agent creation refused for a collaborator connection', { workspaceId: wsId });
  if (notify) yield* call(showCreationRefused);
  return true;
}

function* validateWorkspace(wsId: string): SagaGenerator<Workspace | null> {
  if (wsId === CHIEF_WORKSPACE_ID) return createChiefVirtualWorkspace();
  const workspace = yield* selectWorkspaceById.effect(wsId);
  if (!workspace) return null;
  return workspace.worktreePath || workspace.repositoryPath || workspace.path ? workspace : null;
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

function* openCreatedAgent(
  wsId: string,
  session: AgentSession,
  options?: AgentCreationRequestOptions,
): SagaGenerator<void> {
  if (!options?.openAgent) return;
  const tab = {
    type: 'agent' as const,
    title: session.name || 'Agent',
    agentId: session.id,
    workspaceId: wsId,
    closable: true,
  };
  if (options.openInAdjacentPanel) {
    yield* put(openTabInRightmostColumnRequested(wsId, tab));
  } else if (options.panelId) {
    yield* put(openTab(wsId, tab, options.panelId));
  } else {
    yield* put(openAgentTabRequested(wsId, { agentId: session.id }));
  }
}

function* createBasicAgent(action: ReturnType<typeof createAgentRequested>): SagaGenerator<void> {
  const [wsId, agentType, options] = action.payload;
  yield* call(createManualAgent, wsId, undefined, options, agentType);
}

function* createSpecialistAgent(
  action: ReturnType<typeof createAgentWithSpecialistRequested>,
): SagaGenerator<void> {
  const [wsId, specialistId, options] = action.payload;
  yield* call(createManualAgent, wsId, specialistId, options);
}

function* createManualAgent(
  wsId: string,
  selectedSpecialistId: string | null | undefined,
  options?: { panelLayoutId?: string; panelId?: string },
  agentType?: string,
): SagaGenerator<void> {
  if (yield* call(refusedForCollaborator, wsId)) return;
  const workspace = yield* call(validateWorkspace, wsId);
  if (!workspace) return;
  const context = yield* selectWorkspaceActionContext.effect(wsId);
  try {
    let preferred = selectedSpecialistId;
    if (preferred === undefined && wsId !== CHIEF_WORKSPACE_ID) {
      // Read the daemon on every manual creation: reloads, other clients and
      // workspace navigation must not reuse a stale local preference.
      try {
        const preference = yield* call(
          backendRequest<{ specialistId?: string | null }>,
          'agent.getCreationPreferences',
          { workspaceId: wsId },
        );
        preferred = preference?.specialistId;
      } catch (error) {
        // Older daemons have no memory endpoint. Other errors must surface,
        // rather than silently creating a different specialist.
        if ((error as { rpcCode?: number })?.rpcCode !== -32601) throw error;
      }
    }
    if ((yield* selectWorkspaceActionContext.effect(wsId)) !== context) return;
    const available = yield* selectSpecialists.effect(wsId);
    const authenticated = yield* selectGitHubAuthIsAuthenticated.effect();
    const specialists = filterPickableSpecialists(available, authenticated);
    const defaultId = yield* selectDefaultSpecialistId.effect(wsId);
    const specialist =
      preferred === null
        ? undefined
        : (specialists.find((candidate) => candidate.id === preferred) ??
          specialists.find((candidate) => candidate.id === defaultId));
    const specialistId = specialist?.id;
    const agents = yield* selectAllWorkspaceAgents.effect(wsId);
    // General (no specialist): the store's bare model selection paired with the
    // active provider. A specialist swaps in its effective coding agent and its
    // explicit model override (undefined ⇒ the daemon resolves the default in
    // that provider's context).
    let model: string | undefined = yield* selectContextSelectedModel.effect(wsId);
    let provider: string = yield* selectEffectiveDefaultProviderId.effect(wsId);
    let behaviorPrompt: string | undefined;
    let reasoningEffort: string | undefined;
    let baseName = 'Agent';
    if (specialistId && specialist) {
      baseName = specialist.name;
      provider = yield* selectEffectiveCodingAgent.effect(specialistId, wsId);
      // Legacy boundary: an explicit frontmatter model may still be a
      // pre-triple compound id — split so the request carries a bare model,
      // its prefix winning provider attribution over the coding agent.
      const explicit = yield* selectExplicitModel.effect(specialistId, wsId);
      const pinned = explicit ? splitLegacyCompoundId(explicit) : undefined;
      model = pinned?.modelId || undefined;
      provider = pinned?.providerId || provider;
      behaviorPrompt = yield* selectEffectiveBehaviorPrompt.effect(specialistId, wsId);
      reasoningEffort = yield* selectExplicitReasoningEffort.effect(specialistId, wsId);
    }
    const name = generateSpecialistAgentName(
      baseName,
      agents.map((agent) => agent.name).filter((value): value is string => !!value),
    );
    const result = yield* call([agentFactory, agentFactory.createAgent], workspace, {
      name,
      nameExplicitlySet: false,
      workspaceId: WorkspaceId(wsId),
      model,
      provider,
      agentType: (agentType && parseAgentTypeId(agentType)) || createAgentTypeId('chat'),
      behaviorPrompt,
      reasoningEffort,
      source: selectedSpecialistId === undefined ? 'keyboard-shortcut' : 'specialist-picker',
      rememberSpecialist: selectedSpecialistId !== undefined ? true : undefined,
      metadata: specialistId ? { specialist: specialistId } : undefined,
    });
    if (!result.success || !result.agent) {
      logger.error('Failed to create specialist agent', { workspaceId: wsId, error: result.error });
      yield* call(showCreationError, factoryFailure(result));
      return;
    }
    if ((yield* selectWorkspaceActionContext.effect(wsId)) !== context) return;
    yield* call(registerCreatedAgent, wsId, result.agent, agents);
    yield* put(
      openAgentTabRequested(wsId, {
        agentId: result.agent.id,
        panelLayoutId: options?.panelLayoutId,
        targetPanelId: options?.panelId,
      }),
    );
  } catch (error) {
    logger.error('Failed to create specialist agent', { workspaceId: wsId, error });
    yield* call(showCreationError, error);
  }
}

function* runAgentForNote(
  action: ReturnType<typeof runAgentForNoteRequested>,
): SagaGenerator<void> {
  const [wsId, noteId, noteTitle] = action.payload;
  if (yield* call(refusedForCollaborator, wsId)) return;
  const workspace = yield* call(validateWorkspace, wsId);
  if (!workspace) return;
  let note = yield* selectNoteById.effect(wsId, noteId);
  if (!note) return;
  // Slim note.list rows carry no content (§5.2) — the initial message embeds
  // the task body, so fetch the full note before building it. Fail-soft: on a
  // fetch failure keep the cached row (the agent can still ws.note.read it).
  if (isNoteContentStale(note)) {
    const full = yield* call([appClient.notes, appClient.notes.get], noteId, wsId);
    if (full && String(full.workspaceId) === wsId) note = full;
  }
  // Daemon `specialists.default` setting wins when it resolves to a pickable
  // specialist — visibility-gated by selectSpecialists (e.g. GitHub-dependent
  // specialists without auth) and not `hidden` (picker surfaces exclude
  // hidden specialists via filterPickableSpecialists, so Run does too); fall
  // back to implementor for backward compatibility when unset or unavailable.
  const defaultSpecialistId = yield* selectDefaultSpecialistId.effect(wsId);
  const specialists = yield* selectSpecialists.effect(wsId);
  const configured = defaultSpecialistId
    ? specialists.find((candidate) => candidate.id === defaultSpecialistId && !candidate.hidden)
    : undefined;
  const specialistId = configured?.id ?? 'implementor';
  let model = yield* selectExplicitModel.effect(specialistId, wsId);
  let behaviorPrompt = yield* selectEffectiveBehaviorPrompt.effect(specialistId, wsId);
  let reasoningEffort = yield* selectExplicitReasoningEffort.effect(specialistId, wsId);
  const agents = yield* selectAllWorkspaceAgents.effect(wsId);
  const initial = agents.find(
    (agent) => String(agent.workspaceId) === wsId && agent.isInitialAgent,
  );
  const defaultProvider = yield* selectEffectiveDefaultProviderId.effect(wsId);
  const activeProvider = yield* selectEffectiveDefaultProviderId.effect(wsId);
  // Legacy boundary: an explicit frontmatter model may still be a pre-triple
  // compound id — split so the request carries a bare model, its prefix
  // winning provider attribution.
  const pinned = model ? splitLegacyCompoundId(model) : undefined;
  // A specialist explicitly pinned to a coding agent runs on it; otherwise
  // inherit the workspace's initial-agent provider, then the active provider.
  const provider =
    pinned?.providerId ||
    configured?.codingAgent ||
    (initial ? getAgentProvider(initial, defaultProvider) : undefined) ||
    activeProvider;
  try {
    const result = yield* call([agentFactory, agentFactory.createAgent], workspace, {
      name: noteTitle || m.agent_creation_taskAgent_name(),
      nameExplicitlySet: false,
      workspaceId: WorkspaceId(wsId),
      // Resolved-model catalog values are previews only. When the specialist
      // has no explicit model, omit it so the daemon resolves in this provider.
      model: pinned?.modelId || undefined,
      provider,
      agentType: createAgentTypeId('task-loop'),
      behaviorPrompt,
      reasoningEffort,
      source: 'task-metadata-bar-run',
      metadata: { taskNoteId: noteId, source: 'task-run', specialist: specialistId },
      initialMessage: buildTaskAgentInitialMessage(note),
    });
    if (!result.success || !result.agentId) {
      logger.error('Failed to run agent for note', {
        workspaceId: wsId,
        noteId,
        error: result.error,
      });
      yield* call(showCreationError, factoryFailure(result));
      return;
    }
    yield* put(openAgentTabRequested(wsId, { agentId: result.agentId }));
  } catch (error) {
    logger.error('Failed to run agent for note', { workspaceId: wsId, noteId, error });
    yield* call(showCreationError, error);
  }
}

function* delegateExistingTask(
  action: ReturnType<typeof delegateExistingTaskRequested>,
): SagaGenerator<void> {
  const [wsId, noteId, , openAgent] = action.payload;
  if (yield* call(refusedForCollaborator, wsId)) return;
  const workspace = yield* call(validateWorkspace, wsId);
  if (!workspace) return;
  try {
    // The daemon owns delegation: `agent.delegate` resolves the specialist,
    // model, and initial message from the task note, creates the child agent,
    // and assigns it to the task — the FE only names the task.
    const result = yield* call(
      backendRequest<{ ok: boolean; agentId: string; name?: string }>,
      'agent.delegate',
      { workspaceId: wsId, taskNoteId: noteId },
    );
    if (!result?.ok || !result.agentId) {
      logger.error('Failed to delegate existing task', { workspaceId: wsId, noteId });
      yield* call(showCreationError, undefined);
      return;
    }
    if (openAgent) {
      yield* put(openAgentTabRequested(wsId, { agentId: result.agentId }));
    }
  } catch (error) {
    logger.error('Failed to delegate existing task', { workspaceId: wsId, noteId, error });
    yield* call(showCreationError, error);
  }
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
    const workspace = yield* call(validateWorkspace, wsId);
    if (!workspace) throw new Error(m.agent_creation_workspaceUnavailable_error());
    const agents = yield* selectAllWorkspaceAgents.effect(wsId);
    const scopedConfig = { ...config, workspaceId: WorkspaceId(wsId) };
    const result = key
      ? yield* call([agentFactory, agentFactory.createAgent], workspace, scopedConfig, key)
      : yield* call([agentFactory, agentFactory.createAgent], workspace, scopedConfig);
    if (!result.success || !result.agent)
      throw creationError(factoryFailure(result), errorFallback);
    if ((yield* selectWorkspaceActionContext.effect(wsId)) !== context) {
      yield* finishCreation(action, 'cancelled');
      yield* put(action.failure(new Error(m.agent_creation_createFailed_error())));
      settled = true;
      return;
    }
    yield* call(registerCreatedAgent, wsId, result.agent, agents);
    yield* call(activateCreatedAgent, action, result.agent);
    if (
      config.source === 'agent-action-block' &&
      (yield* call(isCreationConsumerCurrent, action))
    ) {
      const { notify } = yield* call(() => import('$lib/components/patterns/notify'));
      yield* call(notify.success, m.notes_agentActionBlock_started_label());
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
    yield* finishCreation(action, contextCurrent ? 'failure' : 'cancelled', undefined, failure);
    yield* put(action.failure(failure));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      const failure = new Error(m.agent_creation_createFailed_error());
      yield* finishCreation(action, 'cancelled', undefined, failure);
      yield* put(action.failure(failure));
    }
    if (key && pending.get(key) === action) pending.delete(key);
  }
}

function* launchAgent(
  action: ReturnType<typeof agentSessionLaunchAgentRequested>,
): SagaGenerator<void> {
  const [wsId, config, options] = action.payload;
  let settled = false;
  try {
    // Fill the triple legs the caller left implicit from the store: the bare
    // selected model and the active provider (they are paired by the model
    // slice). Provider/model consistency is daemon-validated on `agent.create`
    // (the mismatch error surfaces through showCreationError's guidance toast).
    const model = config.model ?? (yield* selectContextSelectedModel.effect(wsId));
    const provider = config.provider ?? (yield* selectEffectiveDefaultProviderId.effect(wsId));
    const request = createAgentFromConfigRequested(
      wsId,
      {
        ...config,
        workspaceId: WorkspaceId(wsId),
        model,
        provider,
      },
      options,
    );
    yield* put(request);
    const session: AgentSession = yield* call(() => request.promise);
    yield* put(action.success(session));
    settled = true;
  } catch (error) {
    const message = cleanErrorMessage(
      creationError(error, m.agent_creation_launchFailed_error()).message,
    );
    yield* put(action.failure(new Error(message)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.agent_creation_launchFailed_error())));
    }
  }
}

export function* agentCreationSaga(): SagaGenerator<void> {
  yield* fork(nodeExecutionSaga);
  const pending = new Map<string, ReturnType<typeof createAgentFromConfigRequested>>();
  yield* all([
    takeEvery(createAgentRequested, createBasicAgent),
    takeEvery(createAgentWithSpecialistRequested, createSpecialistAgent),
    takeEvery(runAgentForNoteRequested, runAgentForNote),
    takeEvery(delegateExistingTaskRequested, delegateExistingTask),
    takeEvery(createAgentFromConfigRequested, createFromConfig, pending),
    takeEvery(agentSessionLaunchAgentRequested, launchAgent),
  ]);
}
