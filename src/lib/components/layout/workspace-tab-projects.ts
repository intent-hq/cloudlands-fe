import type { Workspace } from '$shared/types';
import type { WorkspaceTabProject } from '$store/renderer/slices/tab-state/tab-groups';
import {
  buildRepoPathLookup,
  getGroupKey,
} from '$lib/components/workspace/utils/workspace-grouping';

/**
 * The project of each workspace with a repository, keyed by workspace id, with
 * the same identity the sidebar groups by. Groups use the repository name, or
 * the full label when two projects share a name.
 */
export function resolveWorkspaceTabProjects(
  workspaces: readonly Workspace[],
): Record<string, WorkspaceTabProject> {
  const lookup = buildRepoPathLookup([...workspaces]);
  const identities = workspaces.flatMap((workspace) => {
    const identity = getGroupKey(workspace, lookup, '');
    if (!identity.key) return [];
    const name = identity.isGithub
      ? identity.label.split('/').pop() || identity.label
      : identity.label;
    return [{ workspaceId: String(workspace.id), key: identity.key, label: identity.label, name }];
  });
  const keysByName = new Map<string, Set<string>>();
  for (const { key, name } of identities) {
    keysByName.set(name, (keysByName.get(name) ?? new Set()).add(key));
  }
  return Object.fromEntries(
    identities.map(({ workspaceId, key, label, name }) => [
      workspaceId,
      { key, name: (keysByName.get(name)?.size ?? 0) > 1 ? label : name },
    ]),
  );
}
