import { all, call, put, takeLeading, takeLatest, type SagaGenerator } from 'typed-redux-saga';
import { NodeExecutionClient } from '$features/agent/services/node-execution';
import { backendRequest, observeBackendNodeCapabilities } from '$lib/client/live/backend-transport';
import { store } from '$store/renderer/store';
import { notify } from '$lib/components/patterns/notify';
import { confirm } from '$lib/components/patterns/confirm';
import { m } from '$shared/paraglide/messages.js';
import { selectLabsRemoteAgentsEnabled } from '../../user-preferences/user-preferences-selectors';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';
import {
  nodeCapabilitiesRequested,
  nodeCapabilitiesReceived,
  agentHubActionRequested,
  nodeOperationBusyChanged,
} from '../workspace-agents-slice';

const client = new NodeExecutionClient(
  backendRequest,
  () => selectLabsRemoteAgentsEnabled.select(store.state),
  observeBackendNodeCapabilities,
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
export function* nodeExecutionSaga(): SagaGenerator<void> {
  yield* all([
    takeLatest(nodeCapabilitiesRequested, loadCapabilities),
    takeLeading(agentHubActionRequested, manageHub),
  ]);
}
