import {
  all,
  call,
  put,
  takeLeading,
  actionChannel,
  take,
  fork,
  type SagaGenerator,
} from 'typed-redux-saga';
import { NodeExecutionClient } from '$features/agent/services/node-execution';
import { backendRequest } from '$lib/client/live/backend-transport';
import { appClient } from '$lib/client';
import { store } from '$store/renderer/store';
import { notify } from '$lib/components/patterns/notify';
import { confirm } from '$lib/components/patterns/confirm';
import { m } from '$shared/paraglide/messages.js';
import { WorkspaceId } from '$shared/types/branded-ids';
import { selectLabsRemoteAgentsEnabled } from '../../user-preferences/user-preferences-selectors';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';
import { updateWorkspaceEntity } from '../../workspace/workspace-slice';
import {
  localPlacementRequested,
  placementChoiceShown,
  placementChoiceAnswered,
  nodeCapabilitiesRequested,
  nodeCapabilitiesReceived,
  agentPlacementSaveRequested,
  agentHubActionRequested,
  nodeOperationBusyChanged,
} from '../workspace-agents-slice';

const client = new NodeExecutionClient(backendRequest, () =>
  selectLabsRemoteAgentsEnabled.select(store.state),
);
function* loadCapabilities(): SagaGenerator<void> {
  const generation = store.state.daemonHealth.connectionGeneration;
  try {
    const capabilities = yield* call([client, client.capabilities]);
    yield* put(nodeCapabilitiesReceived(generation, capabilities));
  } catch {
    yield* put(
      nodeCapabilitiesReceived(generation, { agentNodes: false, localNodeIsolation: false }),
    );
  }
}
function* savePlacement({
  payload: [workspaceId, placement],
}: ReturnType<typeof agentPlacementSaveRequested>): SagaGenerator<void> {
  yield* put(nodeOperationBusyChanged(true));
  try {
    const checked = yield* call([client, client.preparePlacement], placement);
    const result = yield* call([appClient.workspaces, appClient.workspaces.update], {
      id: WorkspaceId(workspaceId),
      defaultAgentPlacement: checked,
    });
    if (!result.success) throw new Error(result.error ?? m.agent_placement_unavailable());
    if (result.workspace)
      yield* put(
        updateWorkspaceEntity(workspaceId, {
          defaultAgentPlacement: result.workspace.defaultAgentPlacement,
        }),
      );
  } catch (error) {
    yield* call(
      notify.error,
      error instanceof Error ? error.message : m.agent_placement_unavailable(),
    );
  } finally {
    yield* put(nodeOperationBusyChanged(false));
  }
}
function* manageHub({
  payload: [workspaceId, agentId, operation],
}: ReturnType<typeof agentHubActionRequested>): SagaGenerator<void> {
  const agent = yield* selectAgentSession.effect(agentId);
  if (String(agent?.workspaceId) !== workspaceId || agent?.effectiveIsolation !== 'isolated')
    return;
  yield* put(nodeOperationBusyChanged(true));
  try {
    const params = { workspaceId, agentId, requestId: crypto.randomUUID() };
    if (operation === 'discard') {
      const accepted = yield* call(confirm, {
        title: m.agent_hub_discard(),
        description: m.agent_hub_discardDescription(),
        destructive: true,
      });
      if (!accepted) return;
      yield* call([client, client.discard], params);
      yield* call(notify.success, m.agent_hub_discarded());
    } else {
      if (!agent.checkpoint?.id) throw new Error(m.agent_hub_checkpointRequired());
      const result = yield* call([client, client.merge], {
        ...params,
        checkpointId: agent.checkpoint.id,
      });
      if (result.status === 'merged') yield* call(notify.success, m.agent_hub_merged());
      else
        yield* call(
          notify.error,
          m.agent_hub_blocked({
            detail: [
              result.reason,
              ...(result.conflictingPaths ?? []),
              ...(result.overlappingPaths ?? []),
            ]
              .filter(Boolean)
              .join(', '),
          }),
        );
    }
  } catch (error) {
    yield* call(
      notify.error,
      error instanceof Error ? error.message : m.agent_placement_unavailable(),
    );
  } finally {
    yield* put(nodeOperationBusyChanged(false));
  }
}
/** Queue launch prompts so concurrent creations cannot steal each other's answer. */
function* chooseLocalPlacements(): SagaGenerator<void> {
  const channel = yield* actionChannel(localPlacementRequested);
  try {
    while (true) {
      const action = yield* take(channel);
      const id = crypto.randomUUID();
      try {
        yield* put(placementChoiceShown({ id, capabilities: action.payload[0] }));
        let answer = yield* take(placementChoiceAnswered);
        while (answer.payload[0] !== id) answer = yield* take(placementChoiceAnswered);
        const [, placement] = answer.payload;
        if (!placement) throw new Error(m.agent_placement_cancelled());
        yield* put(action.success(placement));
      } catch (error) {
        yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
      } finally {
        yield* put(placementChoiceShown(undefined));
      }
    }
  } finally {
    channel.close();
  }
}
export function* nodeExecutionSaga(): SagaGenerator<void> {
  yield* all([
    fork(chooseLocalPlacements),
    takeLeading(nodeCapabilitiesRequested, loadCapabilities),
    takeLeading(agentPlacementSaveRequested, savePlacement),
    takeLeading(agentHubActionRequested, manageHub),
  ]);
}
