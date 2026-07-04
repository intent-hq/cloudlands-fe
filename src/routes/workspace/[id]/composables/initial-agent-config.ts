/**
 * Initial Agent Config Hydration Utility
 *
 * Checks whether a workspace has a pending initial agent config — either
 * already in Redux or stashed in sessionStorage (for page-reload recovery) —
 * and ensures Redux is hydrated accordingly, and turns a pending config into
 * the `activateInitialAgentRequested` dispatch that spawns the agent.
 */

import type { UnifiedAgentConfig } from '$shared/types/agent.types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { store as appStore } from '$store/renderer/store';
import { selectInitialAgentConfig } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
import {
  activateInitialAgentRequested,
  setInitialAgentConfig,
  type InitialAgentConfig,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

/** Pending config as stored by the workspace initializer (extra fields beyond the typed slice shape). */
type PendingInitialAgentConfig = InitialAgentConfig['config'] & Record<string, any>;

/**
 * Map a stored pending initial-agent config to the `UnifiedAgentConfig` the
 * agent-creation flow expects. Mirrors the reference app's
 * `buildInitialActivationConfig` (agent-loading-saga): `prompt` becomes
 * `initialMessage`, and the initial-agent metadata flags are always set.
 */
export function buildInitialAgentActivationConfig(
  wsId: string,
  agentId: string,
  config: PendingInitialAgentConfig,
): UnifiedAgentConfig {
  return {
    workspaceId: WorkspaceId(wsId),
    id: agentId,
    name: config.name || 'Agent',
    model: config.model,
    provider: config.provider,
    agentType: config.agentType,
    initialMessage: config.prompt,
    contextReferences: config.contextReferences,
    imageBlocks: config.imageBlocks,
    behaviorPrompt: config.behaviorPrompt,
    source: 'workspace-initializer',
    metadata: {
      ...config.metadata,
      isInitialAgent: true,
      isFirstWorkspaceAgent: config.isFirstWorkspaceAgent ?? true,
      specialist: config.specialist ?? undefined,
    },
  };
}

/**
 * Dispatch `activateInitialAgentRequested` for a pending initial agent so the
 * agent-creation middleware creates it in the backend and sends the initial
 * prompt. Replaces the removed agent-loading-saga `restoreInitialAgent` step
 * for freshly created workspaces (the agent does not exist backend-side yet —
 * the daemon ignores `initialAgent` on `workspace.create`).
 *
 * No-ops (returns `false`) when there is no agent id or nothing to send —
 * a workspace created with an empty prompt must not spawn an agent.
 */
export function activatePendingInitialAgent(
  wsId: string,
  agentId: string | undefined,
  config: PendingInitialAgentConfig,
  dispatch: (action: any) => void,
): boolean {
  if (!agentId) return false;
  const hasPrompt = typeof config.prompt === 'string' && !!config.prompt.trim();
  const hasContextReferences = (config.contextReferences?.length ?? 0) > 0;
  const hasImageBlocks = (config.imageBlocks?.length ?? 0) > 0;
  if (!hasPrompt && !hasContextReferences && !hasImageBlocks) return false;

  dispatch(
    activateInitialAgentRequested(
      wsId,
      agentId,
      buildInitialAgentActivationConfig(wsId, agentId, config),
    ),
  );
  return true;
}

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

