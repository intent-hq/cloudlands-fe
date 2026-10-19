import type { WorkspaceInitializerAgentSettings } from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';

export interface RepoAgentSettingsChange {
  /** Repo key the form last applied settings for; `undefined` before the first one. */
  previousRepoKey: string | undefined;
  /** Repo key now selected (`agentSettingsRepoKey`); `null` while no repo is identifiable. */
  repoKey: string | null;
  /** Setup last used to create a workspace in `repoKey`. */
  remembered: WorkspaceInitializerAgentSettings | null;
  /** The global last-used setup (what the form opens with when no repo memory applies). */
  fallback: WorkspaceInitializerAgentSettings | null;
}

/**
 * Agent setup the New Workspace form should switch to when its repository
 * selection settles on `repoKey`, or `null` to keep the current setup.
 *
 * A repository with remembered settings always gets them. A repository
 * without any falls back to the global last-used setup, except for the first
 * repository of the form session, which already opened with that setup.
 */
export function repoAgentSettingsToApply({
  previousRepoKey,
  repoKey,
  remembered,
  fallback,
}: RepoAgentSettingsChange): WorkspaceInitializerAgentSettings | null {
  if (repoKey === null || repoKey === previousRepoKey) return null;
  if (remembered) return remembered;
  return previousRepoKey === undefined ? null : fallback;
}
