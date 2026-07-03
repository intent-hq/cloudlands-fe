<script lang="ts">
  import HoverCard from '$lib/components/ui/HoverCard.svelte';
  import WorkspaceHoverCard from '$lib/components/workspace/WorkspaceHoverCard.svelte';
  import type {
  PullRequestInfo,
  Workspace,
  WorkspaceDiffSummary,
  WorkspaceGitSummary,
  WorkspaceTask,
} from '$shared/types';
  import {
  PullRequestStatus,
  WorkspaceStatusEnum,
} from '$shared/types';
  import { store as appStore } from '$store/renderer/store';
  import { loadWorkspaceTasksSucceeded } from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
  import { loadWorkspaceSummariesSucceeded } from '$store/renderer/slices/workspace-summaries/workspace-summaries-slice';

  type HoverVariation = {
    label: string;
    description: string;
    workspace: Workspace;
    lineStats?: { additions: number; deletions: number };
    activeAgentIds?: string[];
    frameClass?: string;
  };

  type HoverSection = {
    title: string;
    description: string;
    variations: HoverVariation[];
  };

  const now = '2026-05-05T22:00:00.000Z';
  const recent = '2026-05-05T21:42:00.000Z';

  let bottomTriggerElement: HTMLDivElement | null = $state(null);
  let rightEdgeTriggerElement: HTMLDivElement | null = $state(null);
  let showPlacedCard = $state(true);

  function agents(agentIds: string[]) {
    return { agentIds };
  }

  // Task/summary data now lives in Redux slices rather than on the Workspace
  // entity; seed the slices per mock workspace ID so the cards render data
  // without on-demand loading (loadWorkspaceData is false on this page).
  function makeTasks(
    wsId: string,
    total: number,
    completed: number,
    inProgress: number,
  ): WorkspaceTask[] {
    return Array.from({ length: total }, (_, i) => ({
      id: `${wsId}-task-${i + 1}`,
      title: `Task ${i + 1}`,
      status: i < completed ? 'complete' : i < completed + inProgress ? 'in_progress' : 'not_started',
    }));
  }

  // Mock seed: builds the workspace-wide `WorkspaceTaskStats` rollup from the
  // seeded tasks so the demo page mirrors what `task.list` (PROTOCOL §5.4) would
  // emit — this isn't production code, just a deterministic fixture for visual
  // tests of WorkspaceProgressCard / hover surfaces.
  function seedTasks(wsId: string, tasks: WorkspaceTask[]) {
    let total = 0;
    let completed = 0;
    let inProgress = 0;
    for (const t of tasks) {
      if (t.status === 'cancelled') continue;
      total++;
      if (t.status === 'complete') completed++;
      else if (t.status === 'in_progress' || t.status === 'review_required') inProgress++;
    }
    appStore.dispatch(
      loadWorkspaceTasksSucceeded(wsId, tasks, { total, completed, inProgress }),
    );
  }

  function seedSummaries(
    wsId: string,
    diffSummary: WorkspaceDiffSummary | null,
    gitSummary: WorkspaceGitSummary | null,
  ) {
    appStore.dispatch(loadWorkspaceSummariesSucceeded(wsId, diffSummary, gitSummary));
  }

  function pr(overrides: Partial<PullRequestInfo>): PullRequestInfo {
    return {
      id: `pr-${overrides.number ?? 'mock'}`,
      number: overrides.number ?? 1,
      url: `https://github.com/augment/intent/pull/${overrides.number ?? 1}`,
      title: overrides.title ?? 'Mock hover-card pull request',
      status: overrides.status ?? PullRequestStatus.Open,
      createdAt: now,
      updatedAt: recent,
      ...overrides,
    };
  }

  function workspace(id: string, title: string, overrides: Partial<Workspace> = {}): Workspace {
    return {
      id,
      title,
      branch: `feature/${id}`,
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: WorkspaceStatusEnum.Active,
      createdAt: now,
      updatedAt: recent,
      lastActivity: recent,
      repositoryOwner: 'augment',
      repositoryName: 'intent',
      ...overrides,
    } as Workspace;
  }

  const statusSections: HoverSection[] = [
    {
      title: 'Status message states',
      description: 'Empty status stays quiet; non-empty status wraps under progress/repo metadata.',
      variations: [
        {
          label: 'No status message',
          description: 'Whitespace-only statusMessage should not render placeholder text.',
          workspace: workspace('empty-status', 'No status workspace', { statusMessage: '   ' }),
        },
        {
          label: 'Short status message',
          description: 'Typical one-sentence high-level progress update.',
          workspace: workspace('short-status', 'Sidebar status polish', {
            statusMessage: 'Verifying the final sidebar hover-card presentation before review.',
          }),
        },
      ],
    },
    {
      title: 'Running agent density',
      description: 'Covers no agents, one running/background agent, multiple agents, and overflow.',
      variations: [
        {
          label: 'No agents',
          description: 'No agent summary and no active IDs.',
          workspace: workspace('no-agents', 'Quiet workspace'),
        },
        {
          label: 'One background agent',
          description: 'Background agents render as running agent rows.',
          activeAgentIds: ['agent-bg'],
          workspace: workspace('one-background-agent', 'Background verification', {
            agentSummary: agents(['agent-bg']),
          }),
        },
        {
          label: 'Multiple active agents',
          description: 'Three running statuses render directly before overflow begins.',
          activeAgentIds: ['agent-plan', 'agent-build'],
          workspace: workspace('multiple-agents', 'Parallel implementation', {
            agentSummary: agents(['agent-plan', 'agent-build', 'agent-review']),
          }),
        },
        {
          label: 'Overflow agents',
          description: 'Five active agents should show three rows plus “+2 more”.',
          activeAgentIds: ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5'],
          workspace: workspace('overflow-agents', 'Agent overflow review', {
            agentSummary: agents(['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5']),
            statusMessage: 'Several agents are active so designers can inspect list density and overflow spacing.',
          }),
        },
      ],
    },
    {
      title: 'Task progress states',
      description: 'Progress bar absence, zero progress, partial work, and complete work.',
      variations: [
        {
          label: 'No tasks',
          description: 'No seeded tasks means the progress section is omitted.',
          workspace: workspace('no-tasks', 'Exploratory workspace'),
        },
        {
          label: '0 / 6 tasks',
          description: 'Shows all not-started progress.',
          workspace: workspace('zero-progress', 'Spec ready for implementation'),
        },
        {
          label: 'Partial with task statuses',
          description: 'Uses task-level segments for complete, in-progress, waiting, and review-required.',
          activeAgentIds: ['agent-active'],
          workspace: workspace('partial-progress', 'Hover-card component polish', {
            agentSummary: agents(['agent-active']),
          }),
        },
        {
          label: 'Complete',
          description: 'All tasks complete with no active agents.',
          workspace: workspace('complete-progress', 'Final verification complete'),
        },
      ],
    },
    {
      title: 'Git, changes, and PR states',
      description: 'Metadata rows for git divergence, visible diff summaries, and PR statuses.',
      variations: [
        {
          label: 'No git changes',
          description: 'No gitSummary or diffSummary rows are rendered.',
          workspace: workspace('no-git-summary', 'Clean repository'),
        },
        {
          label: 'Ahead / behind / unpushed',
          description: 'Concise git divergence summary.',
          workspace: workspace('git-diverged', 'Sync workspace branch'),
        },
        {
          label: 'Changed files plus git summary',
          description: 'Diff summary and git divergence combine into one comma-separated line.',
          lineStats: { additions: 42, deletions: 7 },
          workspace: workspace('changed-files', 'Implement hover-card route'),
        },
        {
          label: 'Open PR with pending CI',
          description: 'Open PR row includes number and CI state.',
          workspace: workspace('open-pr', 'Review hover card', {
            activePullRequest: pr({
              number: 42,
              status: PullRequestStatus.Open,
              ciStatus: { total: 5, passed: 4, failed: 0, pending: 1 },
            }),
          }),
        },
        {
          label: 'Draft PR',
          description: 'Draft state overrides the base PR status.',
          workspace: workspace('draft-pr', 'Draft workspace update', {
            activePullRequest: pr({ number: 43, status: PullRequestStatus.Open, isDraft: true }),
          }),
        },
        {
          label: 'Merged PR approved',
          description: 'Merged PR row with approval text.',
          workspace: workspace('merged-pr', 'Shipped workspace card', {
            activePullRequest: pr({
              number: 44,
              status: PullRequestStatus.Merged,
              reviewDecision: 'APPROVED',
            }),
          }),
        },
        {
          label: 'Closed PR with conflicts',
          description: 'Closed status plus conflict and failed CI details.',
          workspace: workspace('closed-pr-conflicts', 'Conflicted PR review', {
            activePullRequest: pr({
              number: 45,
              status: PullRequestStatus.Closed,
              mergeConflicts: true,
              ciStatus: { total: 3, passed: 1, failed: 2, pending: 0 },
              reviewDecision: 'CHANGES_REQUESTED',
            }),
          }),
        },
      ],
    },
    {
      title: 'Long content and lifecycle',
      description: 'Stress cases for truncation, wrapping, local repos, and archived metadata.',
      variations: [
        {
          label: 'Long title / repo / status',
          description: 'Title and repo truncate while status wraps inside max card width.',
          frameClass: 'md:col-span-2',
          workspace: workspace(
            'long-content',
            'This is an intentionally long workspace title that should truncate in the header without pushing metadata out of the card',
            {
              repositoryOwner: 'very-long-organization-name-for-layout-testing',
              repositoryName:
                'extremely-long-repository-name-that-should-truncate-cleanly-in-the-hover-card',
              statusMessage:
                'This mocked status is deliberately long enough to wrap across several lines. It should remain readable, avoid clipping, and preserve the compact metadata rows below it while designers tune spacing.',
            },
          ),
        },
        {
          label: 'Local repository fallback',
          description: 'Missing repository fields render the local repository label.',
          workspace: workspace('local-repo', 'Local-only workspace', {
            repositoryOwner: undefined,
            repositoryName: undefined,
            statusMessage: 'Mock workspace without repository metadata.',
          }),
        },
        {
          label: 'Archived workspace',
          description: 'Lifecycle chip appears for archived workspaces.',
          workspace: workspace('archived-workspace', 'Archived status work', {
            status: WorkspaceStatusEnum.Archived,
            archived: true,
            archivedAt: '2026-05-04T20:00:00.000Z',
          }),
        },
      ],
    },
  ];

  const bottomPlacementWorkspace = workspace('bottom-edge', 'Bottom-edge placement preview', {
    statusMessage:
      'This card is rendered through the shared HoverCard wrapper near the viewport bottom so side placement and vertical clamping can be smoke-tested visually.',
    agentSummary: agents(['agent-bottom-1', 'agent-bottom-2']),
  });

  const rightEdgePlacementWorkspace = workspace('right-edge', 'Right-edge flip preview', {
    statusMessage:
      'This trigger sits near the right viewport edge so the side placement should flip the card to the left instead of clipping.',
    activePullRequest: pr({ number: 51, status: PullRequestStatus.Open }),
  });

  // Seed Redux task/summary state for the mock workspace IDs above.
  seedTasks('short-status', makeTasks('short-status', 5, 3, 1));
  seedTasks('zero-progress', makeTasks('zero-progress', 6, 0, 0));
  seedTasks('partial-progress', [
    { id: 'pp-1', title: 'Design states', status: 'complete' },
    { id: 'pp-2', title: 'Attach surfaces', status: 'complete' },
    { id: 'pp-3', title: 'Implement route', status: 'in_progress' },
    { id: 'pp-4', title: 'Visual QA', status: 'review_required' },
    { id: 'pp-5', title: 'Coordinator approval', status: 'waiting' },
    { id: 'pp-6', title: 'Ship', status: 'not_started' },
  ]);
  seedTasks('complete-progress', makeTasks('complete-progress', 4, 4, 0));
  seedTasks('long-content', makeTasks('long-content', 12, 5, 3));
  seedTasks('bottom-edge', makeTasks('bottom-edge', 5, 3, 1));

  seedSummaries('git-diverged', null, { ahead: 3, behind: 1, hasUnpushed: true });
  seedSummaries(
    'changed-files',
    {
      schemaVersion: 1,
      updatedAt: recent,
      totalFiles: 3,
      totalAdditions: 42,
      totalDeletions: 7,
      files: [],
    },
    { ahead: 2, behind: 0, hasUnpushed: true },
  );
  seedSummaries('merged-pr', null, { ahead: 0, behind: 0, hasUnpushed: false });
  seedSummaries('long-content', null, { ahead: 12, behind: 4, hasUnpushed: true });
  seedSummaries(
    'bottom-edge',
    {
      schemaVersion: 1,
      updatedAt: recent,
      totalFiles: 2,
      totalAdditions: 40,
      totalDeletions: 8,
      files: [],
    },
    null,
  );
  seedSummaries('right-edge', null, { ahead: 1, behind: 0, hasUnpushed: true });

  const sections = statusSections;
</script>

<div class="min-h-screen bg-background px-8 py-10 text-foreground">
  <header class="mx-auto mb-10 max-w-6xl">
    <p class="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-subtle">
      Mock-only sandbox
    </p>
    <h1 class="text-3xl font-bold tracking-tight">Workspace hover-card gallery</h1>
    <p class="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
      Visual test route for <code>WorkspaceHoverCard</code> using local mock data only. Cards use a
      consistent 320px intended width across content variants, with viewport clamping for narrow
      edges. Agent rows are rendered with session loading disabled, so this page does not request
      live workspace or agent details for the card content.
    </p>
  </header>

  <main class="mx-auto flex max-w-6xl flex-col gap-12">
    {#each sections as section (section.title)}
      <section>
        <div class="mb-4">
          <h2 class="text-xl font-semibold">{section.title}</h2>
          <p class="mt-1 text-sm text-muted-foreground">{section.description}</p>
        </div>

        <div class="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {#each section.variations as variation (variation.label)}
            <article class="flex flex-col gap-3 {variation.frameClass ?? ''}">
              <div>
                <h3 class="text-sm font-semibold">{variation.label}</h3>
                <p class="mt-1 text-xs leading-5 text-subtle">{variation.description}</p>
              </div>
              <div class="flex min-h-[220px] items-start justify-center bg-muted/20 p-4 shadow-inner">
                <WorkspaceHoverCard
                  workspace={variation.workspace}
                  lineStats={variation.lineStats}
                  activeAgentIds={variation.activeAgentIds ?? []}
                  loadAgentSessions={false}
                  loadWorkspaceData={false}
                />
              </div>
            </article>
          {/each}
        </div>
      </section>
    {/each}

    <section>
      <div class="mb-4">
        <h2 class="text-xl font-semibold">Side placement and viewport edges</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Uses the production <code>HoverCard</code> wrapper with <code>WorkspaceHoverCard</code>
          content. The lower trigger should prefer the right side and clamp vertically near the
          viewport bottom; the right-edge trigger should flip the card to the left.
        </p>
      </div>

      <div class="relative min-h-[420px] border border-dashed border-border bg-card/40 p-4">
        <div class="text-xs text-subtle">Spacer area for manual side-placement smoke testing.</div>
        <div
          bind:this={rightEdgeTriggerElement}
          class="absolute right-4 top-4 flex w-72 items-center justify-between bg-card px-3 py-2 text-left shadow"
          style:anchor-name="--workspace-hover-card-right-edge"
        >
          <div class="min-w-0">
            <div class="truncate text-sm font-semibold">Right-edge trigger row</div>
            <div class="truncate text-xs text-subtle">Should flip card to the left</div>
          </div>
        </div>
        <div
          bind:this={bottomTriggerElement}
          class="absolute bottom-4 left-4 flex w-72 items-center justify-between bg-card px-3 py-2 text-left shadow"
          style:anchor-name="--workspace-hover-card-bottom-edge"
        >
          <div class="min-w-0">
            <div class="truncate text-sm font-semibold">Bottom-edge trigger row</div>
            <div class="truncate text-xs text-subtle">augment/intent · mock workspace</div>
          </div>
          <button
            type="button"
            class="ml-3 shrink-0 bg-muted px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            onclick={() => (showPlacedCard = !showPlacedCard)}
          >
            {showPlacedCard ? 'Hide' : 'Show'}
          </button>
        </div>

        {#if showPlacedCard}
          <HoverCard
            anchor="--workspace-hover-card-right-edge"
            position="right"
            anchorElement={rightEdgeTriggerElement}
            class="w-auto border-0 bg-transparent shadow-xl"
          >
            <WorkspaceHoverCard
              workspace={rightEdgePlacementWorkspace}
              loadAgentSessions={false}
              loadWorkspaceData={false}
            />
          </HoverCard>
          <HoverCard
            anchor="--workspace-hover-card-bottom-edge"
            position="right"
            anchorElement={bottomTriggerElement}
            class="w-auto border-0 bg-transparent shadow-xl"
          >
            <WorkspaceHoverCard
              workspace={bottomPlacementWorkspace}
              activeAgentIds={['agent-bottom-1']}
              loadAgentSessions={false}
              loadWorkspaceData={false}
            />
          </HoverCard>
        {/if}
      </div>
    </section>
  </main>
</div>
