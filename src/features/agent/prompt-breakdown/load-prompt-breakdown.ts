/**
 * Reads an agent's starting-context breakdown. Only `agent.getSession` serves it, and the
 * daemon replaces it on every respawn, so each dialog open reads it fresh.
 */
import { backendRequest } from '$lib/client/live/backend-transport';
import { parsePromptBreakdown, type PromptBreakdownView } from './prompt-breakdown';

export async function loadPromptBreakdown(
  agentId: string,
  workspaceId: string | undefined,
): Promise<PromptBreakdownView | null> {
  try {
    const result = await backendRequest<{ session?: { promptBreakdown?: unknown } }>(
      'agent.getSession',
      { agentId, ...(workspaceId ? { workspaceId } : {}) },
    );
    return parsePromptBreakdown(result?.session?.promptBreakdown);
  } catch {
    return null;
  }
}
