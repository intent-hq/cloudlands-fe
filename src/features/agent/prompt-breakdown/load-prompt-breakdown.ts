/**
 * Loads an agent's starting-context breakdown. Only `agent.getSession` serves it,
 * so the result stays out of the store: list and channel rows never carry it.
 * The daemon rewrites it on a respawn or model switch, hence the model in the key.
 */
import { backendRequest } from '$lib/client/live/backend-transport';
import { parsePromptBreakdown, type PromptBreakdownView } from './prompt-breakdown';

const MAX_CACHED = 50;
const cache = new Map<string, Promise<PromptBreakdownView | null>>();

export function loadPromptBreakdown(
  agentId: string,
  workspaceId: string | undefined,
  model: string | null | undefined,
): Promise<PromptBreakdownView | null> {
  const key = `${agentId}\u0000${model ?? ''}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const load = backendRequest<{ session?: { promptBreakdown?: unknown } }>('agent.getSession', {
    agentId,
    ...(workspaceId ? { workspaceId } : {}),
  })
    .then((result) => parsePromptBreakdown(result?.session?.promptBreakdown))
    .catch(() => {
      cache.delete(key);
      return null;
    });
  cache.set(key, load);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  return load;
}
