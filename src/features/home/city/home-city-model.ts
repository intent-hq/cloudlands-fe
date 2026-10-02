import type { PullRequestInfo, Workspace } from '$shared/types';
import type { RepositoryGroup } from '$lib/components/workspace/utils/workspace-grouping';
import type { WorkspaceSummariesState } from '$store/renderer/slices/workspace-summaries/workspace-summaries-types';
import { getHomeTriageGroup } from '../home-model';

interface CityRepository {
  id: string;
  name: string;
  owner?: string;
}

export interface CityBuilding {
  id: string;
  title: string;
  repositoryId: string;
  workspace: Workspace;
  files: number | null;
  additions: number | null;
  deletions: number | null;
  floors: number;
  status: 'running' | 'attention' | 'blocked' | 'complete' | 'idle';
  agents: number | null;
  metricSource?: 'pull-request' | 'working-tree' | null;
  metricBase?: string | null;
}

export interface CityModel {
  repositories: CityRepository[];
  buildings: CityBuilding[];
}

/** Unknown volume has a minimum-height plot, but remains null in the inspector. */
export function cityFloors(files: number | null): number {
  return 2 + Math.min(6, Math.round(Math.log2(1 + (knownCount(files) ?? 0))));
}

function knownCount(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

/** One matching PR owns all volume fields; never sum changesets or PRs. */
function getCityPullRequest(workspace: Workspace): PullRequestInfo | undefined {
  if (!workspace.branch) return undefined;
  if (workspace.activePullRequest?.headRef === workspace.branch) return workspace.activePullRequest;
  return workspace.pullRequests?.find((pr) => pr.headRef === workspace.branch);
}

/**
 * Consume Home's canonical groups before search/status/date filtering. IDs and
 * ordering never depend on titles, activity, status, metrics or filter matches.
 * Repository-free work uses a constant identity rather than a translated key.
 *
 * A matching PR supplies base-relative volume. Cached diff summaries only describe
 * HEAD-to-workdir changes, so that fallback is explicitly labelled working-tree.
 * Missing totals stay unknown; bounded summary.files arrays are never counted.
 * This builder starts no requests and never sums overlapping changesets or PRs.
 */
export function buildCityModel(
  workspaces: readonly Workspace[],
  groups: readonly RepositoryGroup[],
  inboxLabel: string,
  summaries: WorkspaceSummariesState['byWorkspaceId'] = {},
): CityModel {
  const eligible = new Set(workspaces.map((workspace) => workspace.id));
  const repositories: CityRepository[] = [];
  const buildings: CityBuilding[] = [];
  for (const group of groups) {
    const members = group.workspaces.filter((workspace) => eligible.has(workspace.id));
    if (!members.length) continue;
    const inbox = group.workspaces.every(
      (workspace) => !workspace.repositoryPath && !workspace.repositoryName,
    );
    const repositoryId = inbox ? 'inbox' : `repository:${group.key}`;
    repositories.push({
      id: repositoryId,
      name: inbox ? inboxLabel : (group.name ?? group.label),
      owner: group.owner,
    });
    for (const workspace of members) {
      const triage = getHomeTriageGroup(workspace);
      const pr = getCityPullRequest(workspace);
      // Prefer the live Redux cache, including an explicit unavailable result.
      const cached = summaries[workspace.id];
      const summary = cached?.initialized ? cached.diffSummary : workspace.diffSummary;
      const prHasVolume =
        pr &&
        [pr.changedFiles, pr.additions, pr.deletions].some((value) => knownCount(value) !== null);
      const metricSource = prHasVolume ? 'pull-request' : summary ? 'working-tree' : null;
      const files = knownCount(prHasVolume ? pr.changedFiles : summary?.totalFiles);
      buildings.push({
        id: workspace.id,
        title: workspace.title,
        repositoryId,
        workspace,
        files,
        // Cached working-tree line totals use zero for both failure and no changes.
        additions: prHasVolume ? knownCount(pr.additions) : null,
        deletions: prHasVolume ? knownCount(pr.deletions) : null,
        floors: cityFloors(files),
        status: triage === 'needs-you' ? 'attention' : triage === 'done' ? 'complete' : triage,
        agents: workspace.agentSummary ? new Set(workspace.agentSummary.agentIds).size : null,
        metricSource,
        metricBase:
          metricSource === 'pull-request' ? (pr?.baseRef ?? null) : summary ? 'HEAD' : null,
      });
    }
  }
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { repositories: repositories.sort(byId), buildings: buildings.sort(byId) };
}
