import { all, call, cancelled, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { agentFactory } from '$features/agent/services/agent-factory';
import { buildTaskAgentInitialMessage } from '$features/notes/utils/task-agent-message-builder';
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
import { splitCompoundModelId } from '$shared/utils/compound-model-id';
import { openAgentTabRequested } from '../../app-layout/app-layout-slice';
import {
  agentSessionLaunchAgentRequested,
  bulkUpsertSessions,
  upsertSession,
} from '../../agent-session/agent-session-slice';
import { selectSelectedModel } from '../../model/model-selectors';
import { openTab, openTabInNewRootColumn } from '../../panel-layout/panel-layout-slice';
import {
  selectPanelOpenMode,
  selectPanelStackDirection,
} from '../../user-preferences/user-preferences-selectors';
import { selectEffectiveDefaultProviderId } from '../../provider-catalog/provider-catalog-selectors';
import { selectActiveProviderId } from '../../provider-settings/provider-settings-selectors';
import {
  selectEffectiveBehaviorPrompt,
  selectEffectiveCodingAgent,
  selectEffectiveModel,
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
    yield* put(
      openTabInNewRootColumn(wsId, tab, {
        panelOpenMode: yield* selectPanelOpenMode.effect(),
        panelStackDirection: yield* selectPanelStackDirection.effect(),
      }),
    );
  } else if (options.panelId) {
    yield* put(openTab(wsId, tab, options.panelId));
  } else {
    yield* put(openAgentTabRequested(wsId, { agentId: session.id }));
  }
}

function providerForModel(model: string, fallback: string): string {
  return model.includes(':') ? splitCompoundModelId(model).providerId || fallback : fallback;
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
      model,
      provider: providerForModel(model, activeProvider),
      agentType: (agentType && parseAgentTypeId(agentType)) || createAgentTypeId('chat'),
      source: 'keyboard-shortcut',
    });
    if (!result.success || !result.agent) {
      logger.error('Failed to create agent', { workspaceId: wsId, error: result.error });
      return;
    }
    yield* call(registerCreatedAgent, wsId, result.agent, agents);
    yield* put(
      openAgentTabRequested(wsId, {
        agentId: result.agent.id,
        panelLayoutId: options?.panelLayoutId,
        sourcePanelId: options?.panelId,
      }),
    );
  } catch (error) {
    logger.error('Failed to create agent', { workspaceId: wsId, error });
  }
}

function* createSpecialistAgent(
  action: ReturnType<typeof createAgentWithSpecialistRequested>,
): SagaGenerator<void> {
  const [wsId, specialistId, options] = action.payload;
  const workspace = yield* call(validateWorkspace, wsId);
  if (!workspace) return;
  const agents = yield* selectAllWorkspaceAgents.effect(wsId);
  let model = yield* selectSelectedModel.effect();
  const activeProvider = yield* selectActiveProviderId.effect();
  let provider = providerForModel(model, activeProvider);
  let behaviorPrompt: string | undefined;
  let baseName = 'Agent';
  if (specialistId) {
    const specialists = yield* selectSpecialists.effect();
    const specialist = specialists.find((candidate) => candidate.id === specialistId);
    if (specialist) {
      baseName = specialist.name;
      provider = yield* selectEffectiveCodingAgent.effect(specialistId);
      model = yield* selectEffectiveModel.effect(specialistId);
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
      return;
    }
    yield* call(registerCreatedAgent, wsId, result.agent, agents);
    yield* put(
      openAgentTabRequested(wsId, {
        agentId: result.agent.id,
        panelLayoutId: options?.panelLayoutId,
        sourcePanelId: options?.panelId,
      }),
    );
  } catch (error) {
    logger.error('Failed to create specialist agent', { workspaceId: wsId, error });
  }
}

function* runAgentForNote(
  action: ReturnType<typeof runAgentForNoteRequested>,
): SagaGenerator<void> {
  const [wsId, noteId, noteTitle] = action.payload;
  const workspace = yield* call(validateWorkspace, wsId);
  if (!workspace) return;
  const note = yield* selectNoteById.effect(wsId, noteId);
  if (!note) return;
  let model = yield* selectEffectiveModel.effect('implementor');
  let behaviorPrompt = yield* selectEffectiveBehaviorPrompt.effect('implementor');
  if (!behaviorPrompt) {
    const specialist = SPECIALISTS.find((candidate) => candidate.id === 'implementor');
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
  const provider = initial ? getAgentProvider(initial, defaultProvider) : undefined;
  const fallbackModel = yield* selectSelectedModel.effect();
  try {
    const result = yield* call([agentFactory, agentFactory.createAgent], workspace, {
      name: noteTitle || m.agent_creation_taskAgent_name(),
      nameExplicitlySet: false,
      workspaceId: WorkspaceId(wsId),
      model: model || fallbackModel,
      provider,
      agentType: createAgentTypeId('task-loop'),
      behaviorPrompt,
      source: 'task-metadata-bar-run',
      metadata: { taskNoteId: noteId, source: 'task-run', specialist: 'implementor' },
      initialMessage: buildTaskAgentInitialMessage(note),
    });
    if (!result.success || !result.agentId) return;
    yield* put(openAgentTabRequested(wsId, { agentId: result.agentId }));
  } catch (error) {
    logger.error('Failed to run agent for note', { workspaceId: wsId, noteId, error });
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
    yield* put(action.failure(creationError(error)));
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
    const model = config.model ?? (yield* selectSelectedModel.effect());
    const activeProvider = yield* selectActiveProviderId.effect();
    const request = createAgentFromConfigRequested(
      wsId,
      {
        ...config,
        workspaceId: WorkspaceId(wsId),
        model,
        provider: config.provider ?? providerForModel(model, activeProvider),
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
    takeEvery(createAgentFromConfigRequested, createFromConfig),
    takeEvery(agentSessionLaunchAgentRequested, launchAgent),
  ]);
}
