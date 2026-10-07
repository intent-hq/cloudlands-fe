import { PullRequestStatus, WorkspaceStatus, type Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { cityFloors, type CityModel } from './home-city-model';

export const cityScenarios = [
  'showcase',
  'zones-and-states',
  'empty',
  'one',
  'two',
  'three',
  'twelve',
  'thirteen',
  'fifty',
  'hundred',
  'two-hundred',
  'many-repositories',
  'skewed',
  'metrics',
  'long-titles',
  'no-repository',
  'empty-populate',
  'reserved-layout',
] as const;
export type CityScenario = (typeof cityScenarios)[number];

const titles = [
  'Design system',
  'API migration',
  'Homepage',
  'Research',
  'Search experience',
  'Release pipeline',
  'Mobile companion',
  'Documentation',
  'Accessibility',
  'Onboarding',
];
const counts: Partial<Record<CityScenario, number>> = {
  'zones-and-states': 9,
  empty: 0,
  one: 1,
  two: 2,
  three: 3,
  twelve: 12,
  thirteen: 13,
  fifty: 50,
  hundred: 100,
  'two-hundred': 200,
  'many-repositories': 200,
  skewed: 200,
  metrics: 3,
  'no-repository': 3,
  'empty-populate': 0,
  'reserved-layout': 1,
};
const statuses = ['running', 'attention', 'idle', 'complete', 'blocked'] as const;

/** Deterministic browser data: no clock, network, or random placement inputs. */
export function createCityFixture(scenario: CityScenario = 'showcase'): CityModel {
  const count = counts[scenario] ?? 10;
  const repositoryCount =
    scenario === 'many-repositories' || scenario === 'skewed'
      ? 25
      : scenario === 'no-repository'
        ? 1
        : Math.min(3, count);
  const repositories = Array.from({ length: repositoryCount }, (_, index) => ({
    id: `city-repo-${index}`,
    name:
      scenario === 'no-repository'
        ? 'No repository'
        : (['studio', 'platform', 'explorations'][index] ?? `repository-${index + 1}`),
    owner: scenario === 'no-repository' ? undefined : 'acme',
  }));
  const buildings = Array.from({ length: count }, (_, index) => {
    const repository =
      repositories[
        scenario === 'skewed' ? (index < 176 ? 0 : index - 175) : index % repositoryCount
      ];
    const id = `city-workspace-${String(index + 1).padStart(3, '0')}`;
    const title =
      scenario === 'long-titles'
        ? index < 2
          ? 'Design system'
          : `Make every workspace accessible across all repositories, including exceptionally long project and branch names — ${index + 1}`
        : `${titles[index % titles.length]}${index >= titles.length ? ` ${index + 1}` : ''}`;
    const files =
      scenario === 'zones-and-states'
        ? 40
        : scenario === 'metrics'
          ? [null, 0, 1_000_000][index]
          : index === 3
            ? null
            : [24, 81, 7, 0, 12, 3, 140, 2, 40, 16][index % 10];
    const additions = files === null ? null : files * 18;
    const deletions = files === null ? null : files * 3;
    const status =
      scenario === 'zones-and-states'
        ? (['running', 'complete', 'blocked'] as const)[Math.floor(index / 3)]
        : statuses[index % statuses.length];
    const workspace: Workspace = {
      id: WorkspaceId(id),
      title,
      branch: `feat/${id}`,
      baseRef: 'main',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: WorkspaceStatus.Active,
      createdAt: '2026-09-28T09:00:00Z',
      updatedAt: '2026-09-29T09:00:00Z',
      lastActivity: '2026-09-29T09:00:00Z',
      path: `/workspaces/${id}`,
      repositoryName: scenario === 'no-repository' ? undefined : repository.name,
      repositoryOwner: repository.owner,
      repositoryPath: scenario === 'no-repository' ? undefined : `/repos/${repository.name}`,
      activity: status === 'running' ? 'agent_running' : 'idle',
      attention: status === 'attention' ? 'review_required' : 'none',
      displayStatus:
        status === 'complete' ? 'complete' : status === 'blocked' ? 'blocked' : 'in_progress',
      statusMessage:
        status === 'running'
          ? 'Building the next iteration.'
          : status === 'attention'
            ? 'Ready for your review.'
            : 'A place for focused work.',
      ...(files === null
        ? {}
        : {
            diffSummary: {
              schemaVersion: 1,
              updatedAt: '2026-09-29T09:00:00Z',
              totalFiles: files,
              totalAdditions: additions ?? 0,
              totalDeletions: deletions ?? 0,
              files: [],
            },
          }),
    };
    return {
      id,
      title,
      repositoryId: repository.id,
      workspace,
      files,
      additions,
      deletions,
      floors: cityFloors(files),
      status,
      agents: files === null ? null : index % 4,
      metricSource: files === null ? null : ('working-tree' as const),
      metricBase: files === null ? null : 'HEAD',
    };
  });
  return { repositories, buildings };
}

/** Only the last plot is live; the rest represent work hidden by Home filters. */
export function createReservedCityLayout() {
  return {
    version: 1 as const,
    islands: Array.from({ length: 167 }, (_, index) => ({
      id: `reserved-island-${index}`,
      repositoryId: 'city-repo-0',
      x: (index % 20) * 30,
      z: Math.floor(index / 20) * 30,
      radius: 9.5,
      capacity: 12,
    })),
    plots: Array.from({ length: 2002 }, (_, index) => ({
      id: index === 2001 ? 'city-workspace-001' : `reserved-${index}`,
      repositoryId: 'city-repo-0',
      islandId: `reserved-island-${Math.floor(index / 12)}`,
      slot: index % 12,
    })),
  };
}

/** Real Home/model inputs, including a nonmatching PR that must not be summed. */
export function createCityProvenanceWorkspaces(): Workspace[] {
  const workspaces = createCityFixture('three').buildings.map((building) => building.workspace);
  workspaces[0].activePullRequest = {
    id: 'city-pr',
    number: 42,
    url: 'https://github.com/acme/studio/pull/42',
    title: 'Design system',
    status: PullRequestStatus.Open,
    createdAt: '2026-09-28T09:00:00Z',
    updatedAt: '2026-09-29T09:00:00Z',
    headRef: workspaces[0].branch,
    changedFiles: 17,
    additions: 101,
    deletions: 9,
  };
  workspaces[0].pullRequests = [
    {
      ...workspaces[0].activePullRequest,
      id: 'unrelated',
      headRef: 'other-branch',
      changedFiles: 900,
      additions: 9000,
      baseRef: 'unrelated-base',
    },
  ];
  workspaces[2].diffSummary = undefined;
  return workspaces;
}
