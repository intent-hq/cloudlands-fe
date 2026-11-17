/**
 * Where onboarding's first agent can run.
 *
 * - `backend`: a Full daemon runs agents itself.
 * - `machines`: an orchestrator with at least one row in its ordered machine
 *   list (an exposed machine or a cloud entry).
 * - `none`: an orchestrator with an empty list. `workspace.create` would fail
 *   `placement-unavailable` reason `no-agent-machine` (PROTOCOL
 *   `methods/nodes.md` → "Orchestrator mode"), so onboarding asks for one.
 * - `unknown`: an orchestrator whose list this client has not read (Labs
 *   "Remote agents" off, or an older daemon). Onboarding does not block on it.
 */
import type { MachineOrderRow } from '$shared/types/remote-machines';
import { store } from '$store/renderer/store';
import { selectIsOrchestratorBackend } from '$store/renderer/slices/principal/principal-selectors';
import {
  selectMachineOrder,
  selectMachineOrderVisible,
} from '$features/remote-machines/remote-machines-selectors';

export type OnboardingAgentMachines = 'backend' | 'machines' | 'none' | 'unknown';

/** @internal Pure core of `selectOnboardingAgentMachines`, exported for tests. */
export function onboardingAgentMachines(input: {
  orchestrator: boolean;
  /** The ordered machine list; null when it was not read. */
  order: readonly MachineOrderRow[] | null;
}): OnboardingAgentMachines {
  if (!input.orchestrator) return 'backend';
  if (input.order === null) return 'unknown';
  // An orchestrator's list has no "This computer" row; never count one.
  return input.order.some((row) => row.kind !== 'local') ? 'machines' : 'none';
}

export const selectOnboardingAgentMachines = store.createSelector((state) =>
  onboardingAgentMachines({
    orchestrator: selectIsOrchestratorBackend.select(state),
    order: selectMachineOrderVisible.select(state) ? selectMachineOrder.select(state) : null,
  }),
);
