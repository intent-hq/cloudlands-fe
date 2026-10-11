/** Compatibility binding for source controls and encoders; the queue stays saga-owned. */
import { store } from '@/store';
import { selectPrincipalConnectionContext } from '@/store/principal/principal-selectors';
import { createReasoningEffortClient } from '../../../../../src/features/agent/reasoning-effort-client';
export type { ReasoningEffortWriteOptions } from '../../../../../src/features/agent/reasoning-effort-client';
export const {
  markReasoningEffortIntent,
  releaseReasoningEffortIntent,
  applyReasoningEffort,
  reconcileAgentReasoningEffort,
} = createReasoningEffortClient({
  dispatch: (action) => store.dispatch(action),
  connection: () => selectPrincipalConnectionContext.select(store.state),
});
