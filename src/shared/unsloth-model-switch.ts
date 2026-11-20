/**
 * `unsloth-model-switch-confirmation-required` (PROTOCOL §5.5): the daemon
 * refused a user send because its turn would make the managed Unsloth server
 * load another model and unload it for the listed agents. A resend with
 * `messageMetadata.confirmUnslothModelSwitch: true` proceeds.
 */
export const UNSLOTH_SWITCH_CONFIRM_KEY = 'confirmUnslothModelSwitch';

interface UnslothSwitchAgent {
  agentId: string;
  agentName: string;
  workspaceId: string;
  workspaceTitle: string | null;
}

export interface UnslothModelSwitchRefusal {
  currentModel: string;
  requestedModel: string;
  agents: UnslothSwitchAgent[];
}

function isSwitchAgent(value: unknown): value is UnslothSwitchAgent {
  if (!value || typeof value !== 'object') return false;
  const { agentId, agentName, workspaceId, workspaceTitle } = value as Record<string, unknown>;
  return (
    typeof agentId === 'string' &&
    typeof agentName === 'string' &&
    typeof workspaceId === 'string' &&
    (workspaceTitle === null || typeof workspaceTitle === 'string')
  );
}

export function unslothModelSwitchFromError(error: unknown): UnslothModelSwitchRefusal | undefined {
  for (let current = error, depth = 0; current && depth < 4; depth++) {
    const data = (current as { data?: unknown }).data;
    if (data && typeof data === 'object') {
      const { code, currentModel, requestedModel, agents } = data as Record<string, unknown>;
      if (
        code === 'unsloth-model-switch-confirmation-required' &&
        typeof currentModel === 'string' &&
        typeof requestedModel === 'string' &&
        Array.isArray(agents) &&
        agents.every(isSwitchAgent)
      )
        return { currentModel, requestedModel, agents };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Drop the one-send confirmation so a later retry asks again. */
export function withoutUnslothSwitchConfirmation<T extends Record<string, unknown>>(
  metadata: T | undefined,
): T | undefined {
  if (!metadata || !(UNSLOTH_SWITCH_CONFIRM_KEY in metadata)) return metadata;
  const { [UNSLOTH_SWITCH_CONFIRM_KEY]: _confirmed, ...rest } = metadata;
  return Object.keys(rest).length > 0 ? (rest as T) : undefined;
}
