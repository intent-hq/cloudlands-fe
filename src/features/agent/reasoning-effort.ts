/**
 * Session-level reasoning-effort writer for the chat-input effort control.
 *
 * Keeps the `agent.update` (§5.5) call out of the component: the optimistic
 * session-field update is dispatched first so the indicator reacts
 * immediately, then the wire call is forwarded. A daemon rejection reverts the
 * field to its previous value and surfaces a toast. The daemon applies the
 * effort on the next prompt send and emits `agent:updated`, which converges
 * other windows.
 */
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { store as appStore } from '$store/renderer/store';
import { updateSession } from '$store/renderer/slices/agent-session/agent-session-slice';

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

  const result = await appClient.agents.setReasoningEffort({
    agentId,
    workspaceId,
    reasoningEffort: effort,
  });

  if (result.success) return true;

  logger.error('Failed to set reasoning effort', { agentId, error: result.error });
  appStore.dispatch(updateSession(agentId, { reasoningEffort: previousEffort }));
  const { toast } = await import('svelte-sonner');
  toast.error(result.error ?? m.chat_effortPicker_updateFailed_error());
  return false;
}
