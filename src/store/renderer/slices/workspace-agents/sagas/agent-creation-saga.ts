import { all, call, cancelled, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { agentFactory } from '$features/agent/services/agent-factory';
import { buildTaskAgentInitialMessage } from '$features/notes/utils/task-agent-message-builder';
import { appClient } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { SPECIALISTS } from '$lib/constants/specialists';
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
import { selectSelectedModel } from '../../model/model-selectors';
import { openTab, openTabInRightmostColumnRequested } from '../../panel-layout/panel-layout-slice';
import { selectEffectiveDefaultProviderId } from '../../provider-catalog/provider-catalog-selectors';
import { selectActiveProviderId } from '../../provider-settings/provider-settings-selectors';
import {
  selectDefaultSpecialistId,
  selectEffectiveBehaviorPrompt,
  selectEffectiveCodingAgent,
  selectExplicitModel,
  selectSpecialists,
} from '../../specialists/specialists-selectors';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { selectNoteById } from '../../workspace-notes/workspace-notes-selectors';
import { createChiefVirtualWorkspace } from '../chief-virtual-workspace';
import { selectAllWorkspaceAgents } from '../workspace-agents-selectors';
import {
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

function creationError(error: unknown, fallback = m.agent_creation_createFailed_error()): Error {
  if (error instanceof Error) return error;
  return new Error(error ? String(error) : fallback);
}

function isProviderModelMismatch(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /\bmodel\b.+\bdoes not belong to provider\b/i.test(message);
}

async function showCreationError(error: unknown): Promise<void> {
  try {
    const { toast } = await import('svelte-sonner');
    toast.error(m.agent_creation_createFailed_error(), {
      description: isProviderModelMismatch(error)
        ? m.agent_creation_providerModelMismatch_description()
        : m.agent_creation_failed_description(),
    });
  } catch (toastError) {
    logger.error('Failed to surface agent creation error', toastError);
  }
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
  const workspace = yield* call(validateWorkspace, wsId);
  if (!workspace) return;
  const agents = yield* selectAllWorkspaceAgents.effect(wsId);
  const model = yield* selectSelectedModel.effect();
  const activeProvider = yield* selectActiveProviderId.effect();
  const name = generateSpecialistAgentName(
    'Agent',
    agents.map((agent) => agent.name).filter((value): value is string => !!value),
  );
  try {
    const result = yield* call([agentFactory, agentFactory.createAgent], workspace, {
      name,
      nameExplicitlySet: false,
      workspaceId: WorkspaceId(wsId),
      // Store selections are bare model ids paired with the active provider —
      // the explicit triple rides the request as-is (no model-string parsing).
      model,
      provider: activeProvider,
      agentType: (agentType && parseAgentTypeId(agentType)) || createAgentTypeId('chat'),
      source: 'keyboard-shortcut',
    });
    if (!result.success || !result.agent) {
      logger.error('Failed to create agent', { workspaceId: wsId, error: result.error });
      yield* call(showCreationError, result.error);
      return;
    }
    yield* call(registerCreatedAgent, wsId, result.agent, agents);
    yield* put(
      openAgentTabRequested(wsId, {
        agentId: result.agent.id,
        panelLayoutId: options?.panelLayoutId,
        targetPanelId: options?.panelId,
      }),
    );
  } catch (error) {
    logger.error('Failed to create agent', { workspaceId: wsId, error });
    yield* call(showCreationError, error);
  }
}

function* createSpecialistAgent(
  action: ReturnType<typeof createAgentWithSpecialistRequested>,
): SagaGenerator<void> {
  const [wsId, specialistId, options] = action.payload;
  const workspace = yield* call(validateWorkspace, wsId);
  if (!workspace) return;
  const agents = yield* selectAllWorkspaceAgents.effect(wsId);
  // General (no specialist): the store's bare model selection paired with the
  // active provider. A specialist swaps in its effective coding agent and its
  // explicit model override (undefined ⇒ the daemon resolves the default in
  // that provider's context).
  let model: string | undefined = yield* selectSelectedModel.effect();
  let provider: string = yield* selectActiveProviderId.effect();
  let behaviorPrompt: string | undefined;
  let baseName = 'Agent';
  if (specialistId) {
    const specialists = yield* selectSpecialists.effect();
    const specialist = specialists.find((candidate) => candidate.id === specialistId);
    if (specialist) {
      baseName = specialist.name;
      provider = yield* selectEffectiveCodingAgent.effect(specialistId);
      // Legacy boundary: an explicit frontmatter model may still be a
      // pre-triple compound id — split so the request carries a bare model,
      // its prefix winning provider attribution over the coding agent.
      const explicit = yield* selectExplicitModel.effect(specialistId);
      const pinned = explicit ? splitLegacyCompoundId(explicit) : undefined;
      model = pinned?.modelId || undefined;
      provider = pinned?.providerId || provider;
      behaviorPrompt = yield* selectEffectiveBehaviorPrompt.effect(specialistId);
    }
  }
  const name = generateSpecialistAgentName(
    baseName,
    agents.map((agent) => agent.name).filter((value): value is string => !!value),
  );
  try {
    const result = yield* call([agentFactory, agentFactory.createAgent], workspace, {
      name,
      nameExplicitlySet: false,
      workspaceId: WorkspaceId(wsId),
      model,
      provider,
      agentType: createAgentTypeId('chat'),
      behaviorPrompt,
      source: 'specialist-picker',
      metadata: specialistId ? { specialist: specialistId } : undefined,
    });
    if (!result.success || !result.agent) {
      logger.error('Failed to create specialist agent', { workspaceId: wsId, error: result.error });
      yield* call(showCreationError, result.error);
      return;
    }
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
  const defaultSpecialistId = yield* selectDefaultSpecialistId.effect();
  const specialists = yield* selectSpecialists.effect();
  const configured = defaultSpecialistId
    ? specialists.find((candidate) => candidate.id === defaultSpecialistId && !candidate.hidden)
    : undefined;
  const specialistId = configured?.id ?? 'implementor';
  let model = yield* selectExplicitModel.effect(specialistId);
  let behaviorPrompt = yield* selectEffectiveBehaviorPrompt.effect(specialistId);
  if (!behaviorPrompt) {
    const specialist = SPECIALISTS.find((candidate) => candidate.id === specialistId);
    if (specialist) {
      behaviorPrompt = specialist.defaultBehaviorPrompt;
      if (!model) {
        model = specialist.defaultModel ?? '';
      }
    }
  }
  const agents = yield* selectAllWorkspaceAgents.effect(wsId);
  const initial = agents.find(
    (agent) => String(agent.workspaceId) === wsId && agent.isInitialAgent,
  );
  const defaultProvider = yield* selectEffectiveDefaultProviderId.effect();
  const activeProvider = yield* selectActiveProviderId.effect();
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
      yield* call(showCreationError, result.error);
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

function* createFromConfig(
  action: ReturnType<typeof createAgentFromConfigRequested>,
): SagaGenerator<void> {
  const [wsId, config, options] = action.payload;
  let settled = false;
  try {
    const workspace = yield* call(validateWorkspace, wsId);
    if (!workspace) throw new Error(m.agent_creation_workspaceUnavailable_error());
    const agents = yield* selectAllWorkspaceAgents.effect(wsId);
    const result = yield* call([agentFactory, agentFactory.createAgent], workspace, {
      ...config,
      workspaceId: WorkspaceId(wsId),
    });
    if (!result.success || !result.agent) throw creationError(result.error);
    yield* call(registerCreatedAgent, wsId, result.agent, agents);
    yield* put(setActiveAgentId(wsId, result.agent.id));
    yield* call(openCreatedAgent, wsId, result.agent, options);
    yield* put(action.success(result.agent));
    settled = true;
  } catch (error) {
    const failure = creationError(error);
    yield* call(showCreationError, failure);
    yield* put(action.failure(failure));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.agent_creation_createFailed_error())));
    }
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
    const model = config.model ?? (yield* selectSelectedModel.effect());
    const provider = config.provider ?? (yield* selectActiveProviderId.effect());
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
  yield* all([
    takeEvery(createAgentRequested, createBasicAgent),
    takeEvery(createAgentWithSpecialistRequested, createSpecialistAgent),
    takeEvery(runAgentForNoteRequested, runAgentForNote),
    takeEvery(delegateExistingTaskRequested, delegateExistingTask),
    takeEvery(createAgentFromConfigRequested, createFromConfig),
    takeEvery(agentSessionLaunchAgentRequested, launchAgent),
  ]);
}
