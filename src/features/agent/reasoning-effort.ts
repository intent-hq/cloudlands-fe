/**
 * Session-level reasoning-effort writer for the chat-input effort control.
 *
 * Keeps the versioned wire mutation out of the component: protocol 5.2+ uses
 * the first-class `agent.update` field, while older daemons use their cataloged
 * `{model}/{effort}` variants through `agent.setModel`. A rejection reverts the
 * optimistic field and surfaces a toast.
 */
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { agentClient } from './agent.client';
import { buildLegacyReasoningEffortModelId } from './utils/legacy-reasoning-effort';
import { supportsReasoningEffortProtocol } from './utils/reasoning-effort-protocol';
import { store as appStore } from '$store/renderer/store';
import { selectAgentProvider } from '$store/renderer/slices/agent-session/agent-session-selectors';
import { updateSession } from '$store/renderer/slices/agent-session/agent-session-slice';
import { selectAgentModelEffortLevels } from '$store/renderer/slices/model/model-selectors';
import { reconcileReasoningEffort } from './utils/reconcile-reasoning-effort';

const logger = createLogger('ReasoningEffort');

/**
 * Apply a reasoning-effort level to a session. `effort` is the level string,
 * or `null` to clear back to the provider default. Resolves `true` when the
 * daemon accepted the change.
 */
export async function applyReasoningEffort(
  agentId: string,
  workspaceId: string,
  effort: string | null,
  previousEffort: string | null,
): Promise<boolean> {
  appStore.dispatch(updateSession(agentId, { reasoningEffort: effort }));

  const session = appStore.state?.agentSessions?.byAgentId?.[agentId];
  const providerId = selectAgentProvider.select(appStore.state, agentId);
  const effortLevels = selectAgentModelEffortLevels.select(appStore.state, agentId);
  const protocolVersion = appStore.state?.daemonHealth?.stats?.protocolVersion;
  let result: { success: boolean; error?: string };

  if (protocolVersion && !supportsReasoningEffortProtocol(protocolVersion)) {
    const legacyModelId = buildLegacyReasoningEffortModelId(session?.model, effort, effortLevels);
    if (!legacyModelId) {
      result = { success: false, error: m.chat_effortPicker_updateFailed_error() };
    } else {
      const legacyResult = await agentClient.setModel(
        agentId,
        legacyModelId,
        workspaceId,
        providerId,
      );
      result = legacyResult.ok
        ? { success: legacyResult.data.success, error: legacyResult.data.error }
        : { success: false, error: legacyResult.error };
    }
  } else {
    result = await appClient.agents.setReasoningEffort({
      agentId,
      workspaceId,
      reasoningEffort: effort,
    });
  }

  if (result.success) return true;

  logger.error('Failed to set reasoning effort', { agentId, error: result.error });
  // Only roll back if nothing else moved the field meanwhile — a later change
  // (or a daemon `agent:updated`) that landed during the call is authoritative.
  const current = appStore.state?.agentSessions?.byAgentId?.[agentId]?.reasoningEffort ?? null;
  if (current === effort) {
    appStore.dispatch(updateSession(agentId, { reasoningEffort: previousEffort }));
  }
  const { toast } = await import('svelte-sonner');
  toast.error(result.error ?? m.chat_effortPicker_updateFailed_error());
  return false;
}

/** Reconcile and persist a session effort after its model changes. */
export async function reconcileAgentReasoningEffort(
  agentId: string,
  workspaceId: string,
  currentEffort: string | null | undefined,
  supportedEfforts: readonly string[] | null | undefined,
): Promise<boolean> {
  const previousEffort = currentEffort ?? null;
  const nextEffort = reconcileReasoningEffort(previousEffort, supportedEfforts);

  if (nextEffort === previousEffort) return true;
  return applyReasoningEffort(agentId, workspaceId, nextEffort, previousEffort);
}
