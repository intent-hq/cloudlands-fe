import { waitFor } from '@themislib/themis/saga';
import {
  ensureWorkspaceCatalogRequested,
  workspaceCatalogReadFailed,
} from '../../../../../../src/store/renderer/slices/provider-catalog/provider-catalog-slice';
import { m } from '$shared/paraglide/messages.js';
import { call, put, race, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { createAgentCreationWorkers } from '../../../../../../src/store/renderer/slices/workspace-agents/sagas/agent-creation-workers';
import { createAgentFromConfigRequested } from '../../../../../../src/store/renderer/slices/workspace-agents/workspace-agents-slice';
import { buildManualAgentConfig } from '../../../../../../src/store/renderer/slices/workspace-agents/manual-agent-config';
import {
  selectAgentCreationOutcome,
  selectAllWorkspaceAgents,
} from '../workspace-agents-selectors';
import {
  selectWorkspaceActionContext,
  selectWorkspaceById,
} from '@/store/workspace/workspace-selectors';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import {
  selectContextSelectedModel,
  selectWorkspaceCatalogFresh,
} from '@/store/provider-catalog/workspace-catalog-selectors';
import { selectEffectiveDefaultProviderId } from '@/store/provider-catalog/provider-catalog-selectors';
import { agentFactory } from '@/features/agent/agent-factory';

const workers = createAgentCreationWorkers({
  agentFactory,
  selectWorkspaceActionContext,
  selectAllWorkspaceAgents,
  selectAgentCreationOutcome,
  *refusedForCollaborator(wsId) {
    return !(yield* selectWorkspaceActionContext.effect(wsId));
  },
  *validateWorkspace(wsId) {
    if (!(yield* selectAdmittedWorkspaceReadContext.effect(wsId))) return null;
    const workspace = yield* selectWorkspaceById.effect(wsId);
    return workspace && (workspace.worktreePath || workspace.repositoryPath || workspace.path)
      ? workspace
      : null;
  },
  *prepareConfig(wsId, config) {
    if (config.source !== 'workspace-general') return config;
    if (!(yield* selectWorkspaceCatalogFresh.effect(wsId))) {
      const owner = yield* selectWorkspaceActionContext.effect(wsId);
      yield* put(ensureWorkspaceCatalogRequested(wsId));
      const { ready } = yield* race({
        ready: call(function* () {
          return yield* waitFor(selectWorkspaceCatalogFresh, [wsId], Boolean, 30_000);
        }),
        failed: take(
          (action: { type: string; payload?: unknown[] }) =>
            action.type === workspaceCatalogReadFailed.type && action.payload?.[0] === wsId,
        ),
        retired: call(function* () {
          return yield* waitFor(selectWorkspaceActionContext, [wsId], (value) => value !== owner);
        }),
      });
      if (!ready) throw new Error(m.agent_creation_workspaceUnavailable_error());
    }
    const agents = yield* selectAllWorkspaceAgents.effect(wsId);
    return buildManualAgentConfig({
      workspaceId: wsId,
      selectedSpecialistId: null,
      existingNames: agents.map((agent) => agent.name).filter((name): name is string => !!name),
      model: yield* selectContextSelectedModel.effect(wsId),
      provider: yield* selectEffectiveDefaultProviderId.effect(wsId),
    });
  },
  // Router navigation and visible errors are rendered from the canonical consumer outcome.
  *openCreatedAgent() {},
  async showConsumerCreationError() {},
});

export function* agentCreationSaga(): SagaGenerator<void> {
  const pending = new Map<string, ReturnType<typeof createAgentFromConfigRequested>>();
  yield* takeEvery(createAgentFromConfigRequested, function* (action) {
    yield* call(workers.createFromConfig, pending, action);
  });
}
