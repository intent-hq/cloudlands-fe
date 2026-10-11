/** Compatibility binding for source controls and encoders; the queue stays saga-owned. */
import { store } from '$store/renderer/store';
import { selectPrincipalConnectionContext } from '$store/renderer/slices/principal/principal-selectors';
import { createReasoningEffortClient } from './reasoning-effort-client';
export type { ReasoningEffortWriteOptions } from './reasoning-effort-client';
export const {
  markReasoningEffortIntent,
  releaseReasoningEffortIntent,
  applyReasoningEffort,
  reconcileAgentReasoningEffort,
} = createReasoningEffortClient({
  dispatch: (action) => store.dispatch(action),
  connection: () => selectPrincipalConnectionContext.select(store.state),
});
