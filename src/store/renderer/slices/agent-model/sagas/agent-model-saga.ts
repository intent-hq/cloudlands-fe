import { appClient } from '$lib/client';
import { agentClient } from '$features/agent/agent.client';
import { notify } from '$lib/components/patterns/notify';
import { selectProviderModelsCacheEntry } from '../../provider-models/provider-models-selectors';
import { selectAgentModelWriteSnapshot } from '../agent-model-selectors';
import { createAgentModelSaga } from './agent-model-saga-factory';
/** Svelte runtime binding; queue behavior lives in the shared factory. */
export const agentModelSaga = createAgentModelSaga({
  snapshotEffect: selectAgentModelWriteSnapshot.effect,
  catalogEffect: selectProviderModelsCacheEntry.effect,
  setModel: (...args) => agentClient.setModel(...args),
  setReasoningEffort: (...args) => appClient.agents.setReasoningEffort(...args),
  notifyError: (message) => notify.error(message),
});
