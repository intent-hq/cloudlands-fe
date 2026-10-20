import type { WorkspaceInitializerAgentSettings } from '../workspace-initializer-types';

/** Repositories whose last agent setup is remembered; the least recently created drop first. */
export const MAX_REMEMBERED_AGENT_REPOS = 100;

type AgentByRepo = Record<string, WorkspaceInitializerAgentSettings>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function capOldest(entries: Array<[string, WorkspaceInitializerAgentSettings]>): AgentByRepo {
  return Object.fromEntries(entries.slice(-MAX_REMEMBERED_AGENT_REPOS));
}

/**
 * Record `settings` as the most recent setup for `repoKey`. Entries are kept
 * oldest first (keys are prefixed, so insertion order is stable), and the map
 * is capped at `MAX_REMEMBERED_AGENT_REPOS`.
 */
export function rememberAgentForRepo(
  agentByRepo: AgentByRepo,
  repoKey: string,
  settings: WorkspaceInitializerAgentSettings,
): AgentByRepo {
  const entries = Object.entries(agentByRepo).filter(([key]) => key !== repoKey);
  entries.push([repoKey, settings]);
  return capOldest(entries);
}

/** Merge a persisted map under in-session writes (which are newer), keeping the cap. */
export function mergeAgentByRepo(persisted: AgentByRepo, session: AgentByRepo): AgentByRepo {
  let merged = capOldest(Object.entries(persisted));
  for (const [key, settings] of Object.entries(session)) {
    merged = rememberAgentForRepo(merged, key, settings);
  }
  return merged;
}

/** Read a persisted map, dropping malformed entries. */
export function readAgentByRepo(value: unknown): AgentByRepo | undefined {
  if (!isRecord(value)) return undefined;
  return capOldest(
    Object.entries(value).filter(
      (entry): entry is [string, WorkspaceInitializerAgentSettings] =>
        entry[0].length > 0 && isRecord(entry[1]),
    ),
  );
}
