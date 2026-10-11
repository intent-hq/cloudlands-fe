import { agentClient } from '@/features/agent/agent-client';
import { notify } from '@/components/patterns/notify';
import { selectProviderModelsCacheEntry } from '@/store/provider-models/provider-models-selectors';
import { selectAgentModelWriteSnapshot } from '../agent-model-selectors';
import { createAgentModelSaga } from '../../../../../../src/store/renderer/slices/agent-model/sagas/agent-model-saga-factory';
/** Start once with store.runSaga; its returned cancellation settles every queued request. */
export const agentModelSaga = createAgentModelSaga({
  snapshotEffect: selectAgentModelWriteSnapshot.effect,
  catalogEffect: selectProviderModelsCacheEntry.effect,
  setModel: agentClient.setModel,
  setReasoningEffort: agentClient.setReasoningEffort,
  notifyError: (message) => notify.error(message),
});
