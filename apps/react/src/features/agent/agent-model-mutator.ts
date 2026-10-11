/** Compatibility binding for Svelte ModelPicker callers; remove when they dispatch intents directly. */
import { store } from '@/store';
import { selectPrincipalConnectionContext } from '@/store/principal/principal-selectors';
import * as reasoning from './reasoning-effort';
import { bindAgentModelMutator } from '../../../../../src/features/agent/agent-model-mutator-factory';
export {
  isSkippedMutation,
  SKIPPED_MUTATION,
} from '../../../../../src/features/agent/agent-model-mutator-factory';
export type {
  AgentModelMutatorOptions,
  AgentModelMutator,
  SkippedMutation,
} from '../../../../../src/features/agent/agent-model-mutator-factory';
export const createAgentModelMutator = bindAgentModelMutator({
  dispatch: (action) => store.dispatch(action),
  context: () => selectPrincipalConnectionContext.select(store.state),
  sessionWorkspace: (agentId) => store.state.agentSessions.byAgentId[agentId]?.workspaceId,
  reasoning,
});
