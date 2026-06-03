/**
 * Initial Agent Config Hydration Utility
 *
 * Checks whether a workspace has a pending initial agent config — either
 * already in Redux or stashed in sessionStorage (for page-reload recovery) —
 * and ensures Redux is hydrated accordingly.
 */

import { store as appStore } from '$store/renderer/store';
import { selectInitialAgentConfig } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
import { setInitialAgentConfig } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

/**
 * Hydrate the initial agent config for a workspace.
 *
 * Reads from Redux first, then falls back to sessionStorage for
 * page-reload scenarios. If sessionStorage has data but Redux does not,
 * the Redux state is updated via the provided `dispatch` function.
 *
 * @returns `true` when an initial agent config is present (from either source).
 */
export function hydrateInitialAgentConfig(
  wsId: string,
  dispatch: (action: any) => void,
): boolean {
  const pendingConfig = selectInitialAgentConfig.select(appStore.state, wsId);
  const pendingAgentKey = `workspace:${wsId}:initial-agent-pending`;
  const sessionData = sessionStorage.getItem(pendingAgentKey);
  const hasInitialAgent = !!pendingConfig || !!sessionData;

  // Hydrate Redux from sessionStorage on reload if needed
  if (!pendingConfig && sessionData) {
    try {
      const parsed = JSON.parse(sessionData);
      dispatch(setInitialAgentConfig(wsId, parsed));
    } catch {
      /* ignore parse errors */
    }
  }

  return hasInitialAgent;
}

