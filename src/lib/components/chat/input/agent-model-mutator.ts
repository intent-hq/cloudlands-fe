/** Compatibility binding for Svelte ModelPicker callers; remove when they dispatch intents directly. */
import { store } from '$store/renderer/store';
import { selectPrincipalConnectionContext } from '$store/renderer/slices/principal/principal-selectors';
import * as reasoning from '$features/agent/reasoning-effort';
import { bindAgentModelMutator } from '$features/agent/agent-model-mutator-factory';
export { isSkippedMutation, SKIPPED_MUTATION } from '$features/agent/agent-model-mutator-factory';
export type {
  AgentModelMutatorOptions,
  AgentModelMutator,
  SkippedMutation,
} from '$features/agent/agent-model-mutator-factory';
export const createAgentModelMutator = bindAgentModelMutator({
  dispatch: (action) => store.dispatch(action),
  context: () => selectPrincipalConnectionContext.select(store.state),
  sessionWorkspace: (agentId) => store.state.agentSessions.byAgentId[agentId]?.workspaceId,
  reasoning,
});
