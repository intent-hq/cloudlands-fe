<script lang="ts" module>
  import { catalogNow } from '$lib/component-catalog/catalog-clock';
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import {
    AgentStatus,
    WorkspaceStatus,
    WORKSPACE_DISPLAY_STATUS_VALUES,
    type WorkspaceDisplayStatus,
    type AgentSession,
    type AgentMessage,
    type Workspace,
    type PullRequestInfo,
  } from '$shared/types';
  import { AgentId, CHIEF_WORKSPACE_ID, WorkspaceId } from '$shared/types/branded-ids';
  import { CHIEF_PROMPT_VERSION, CHIEF_SPECIALIST_ID } from '$shared/chief-agent-config';

  declare global {
    interface Window {
      __homeAssistantPreview?: { removeSelectedThread: () => void };
      __homeWorkspacePreview?: {
        navigation: () => { currentTabId: string | null; tabOrder: string[] };
        setTitle: (id: string, title: string) => void;
        setPullRequests: (id: string, pulls: PullRequestInfo[], total?: number) => void;
        setPullRequest: (id: string, pullRequest: PullRequestInfo) => void;
        setStatus: (id: string, status: WorkspaceDisplayStatus) => void;
        setFlags: (id: string, flags: { waiting?: boolean; scriptsRunning?: boolean }) => void;
        roundTripSettings: () => void;
      };
      __homePrStatusPreview?: { setWaiting: (waiting?: boolean) => void };
    }
  }

  interface Props {
    scenario?:
      | 'populated'
      | 'untitled'
      | 'status-icons'
      | 'status-grouping'
      | 'retired'
      | 'pr-status-list'
      | 'board-pr-status'
      | 'board'
      | 'board-pinned'
      | 'board-long-content'
      | 'board-repositories'
      | 'repository-labels'
      | 'board-repository-labels'
      | 'empty'
      | 'assistant'
      | 'assistant-streaming'
      | 'assistant-activity'
      | 'assistant-activity-many'
      | 'assistant-many'
      | 'assistant-empty'
      | 'error'
      | 'collaborator'
      | 'prs'
      | 'linear'
      | 'integration-error'
      | 'disconnected'
      | 'assistant-long';
    height?: number;
  }
  export const preview = definePreview<Props>({
    id: 'home',
    title: 'Home',
    defaultState: 'populated',
    states: {
      populated: { props: { scenario: 'populated' } },
      untitled: { props: { scenario: 'untitled' } },
      'status-icons': { props: { scenario: 'status-icons' } },
      'status-grouping': { props: { scenario: 'status-grouping' } },
      retired: { props: { scenario: 'retired' } },
      'pr-status-list': { props: { scenario: 'pr-status-list', height: 1120 } },
      'board-pr-status': { props: { scenario: 'board-pr-status', height: 1120 } },
      board: { props: { scenario: 'board' } },
      'board-pinned': { props: { scenario: 'board-pinned' } },
      'board-long-content': { props: { scenario: 'board-long-content' } },
      'board-repositories': { props: { scenario: 'board-repositories' } },
      'repository-labels': { props: { scenario: 'repository-labels' } },
      'board-repository-labels': { props: { scenario: 'board-repository-labels' } },
      empty: { props: { scenario: 'empty' } },
      assistant: { props: { scenario: 'assistant' } },
      'assistant-streaming': { props: { scenario: 'assistant-streaming' } },
      'assistant-activity': { props: { scenario: 'assistant-activity' } },
      'assistant-activity-many': { props: { scenario: 'assistant-activity-many' } },
      'assistant-many': { props: { scenario: 'assistant-many' } },
      'assistant-empty': { props: { scenario: 'assistant-empty' } },
      error: { props: { scenario: 'error' } },
      collaborator: { props: { scenario: 'collaborator' } },
      prs: { props: { scenario: 'prs' } },
      linear: { props: { scenario: 'linear' } },
      'integration-error': { props: { scenario: 'integration-error' } },
      disconnected: { props: { scenario: 'disconnected' } },
      'assistant-long': { props: { scenario: 'assistant-long' } },
    },
  });
  const fixtures: Workspace[] = [
    {
      id: 'home-review',
      title: 'Review the new onboarding flow',
      displayStatus: 'needs_attention',
      attention: 'review_required',
      statusMessage:
        'The new flow is ready. Please review the keyboard navigation and empty states.',
    },
    {
      id: 'home-running',
      title: 'Improve search across workspaces',
      displayStatus: 'in_progress',
      activity: 'agent_running',
      statusMessage: 'Implementing ranked search results and repository filters.',
    },
    {
      id: 'home-unread',
      title: 'Document the release process',
      displayStatus: 'idle',
      attention: 'unread',
      statusMessage: 'The draft is ready for your next pass.',
    },
    {
      id: 'home-ready',
      title: 'Keep the selected workspace visible when repository names and branch names are long',
      displayStatus: 'pr_ready',
      statusMessage: 'Pull request is ready for review.',
    },
    {
      id: 'home-waiting',
      title: 'Ship the sidebar improvements',
      displayStatus: 'pr_queued',
      waiting: true,
      statusMessage: 'Waiting for the merge queue.',
    },
    {
      id: 'home-complete',
      title: 'Polish settings accessibility',
      displayStatus: 'complete',
      statusMessage: 'Keyboard and screen reader improvements are complete.',
    },
    {
      id: 'home-archived',
      title: 'Explore alternative layouts',
      displayStatus: 'complete',
      status: WorkspaceStatus.Archived,
      statusMessage: 'Archived after the design review.',
    },
  ].map(
    (item, index) =>
      ({
        branch: `feat/${item.id}`,
        baseRef: 'main',
        changesets: [],
        timeline: [],
        conversationInfo: [],
        status: WorkspaceStatus.Active,
        repositoryOwner: 'acme',
        repositoryName: index < 4 ? 'studio' : 'platform',
        repositoryPath: index < 4 ? '/repos/studio' : '/repos/platform',
        path: `/workspaces/${item.id}`,
        createdAt: '2026-09-28T09:00:00Z',
        updatedAt: '2026-09-29T00:00:00Z',
        lastActivity: '2026-09-29T00:00:00Z',
        initialPrompt:
          'Make the workflow easier to follow, with clear feedback and full keyboard support.',
        taskStats: {
          total: 4,
          completed: 2,
          inProgress: 1,
          tasks: [
            { title: 'Implement the interaction', status: 'complete' },
            { title: 'Check keyboard access', status: 'in_progress' },
          ],
        },
        ...item,
        id: WorkspaceId(item.id),
      }) as Workspace,
  );
  const statusFixtures: Workspace[] = [
    ...fixtures.filter((workspace) => workspace.status === WorkspaceStatus.Active),
    {
      ...fixtures[0],
      id: WorkspaceId('home-blocked'),
      title: 'Resolve a blocked workspace',
      displayStatus: 'blocked' as const,
      attention: undefined,
      statusMessage: 'Waiting for a missing dependency.',
    },
    {
      ...fixtures[0],
      id: WorkspaceId('home-failed'),
      title: 'Retry a failed workspace',
      displayStatus: 'failed' as const,
      attention: undefined,
      statusMessage: 'The last run failed and needs attention.',
    },
    {
      ...fixtures[2],
      id: WorkspaceId('home-unknown-time'),
      title: 'Idle workspace with no recorded activity',
      attention: undefined,
      createdAt: '',
      updatedAt: '',
      lastActivity: '',
      statusMessage: 'No activity timestamp is available.',
    },
  ].map((workspace, index) => ({
    ...workspace,
    lastContentActivity:
      index === 8
        ? undefined
        : new Date(
            catalogNow() -
              [
                37_000, 3_600_000, 86_400_000, 172_800_000, 518_400_000, 2_419_200_000,
                5_184_000_000, 31_536_000_000,
              ][index],
          ).toISOString(),
  }));
  const statusGroupingTitles: Record<WorkspaceDisplayStatus, string> = {
    failed: 'Failed: retry the release build',
    blocked: 'Blocked: restore the repository connection',
    needs_attention: 'Needs attention: review the onboarding flow',
    not_started: 'Not started: plan keyboard shortcuts',
    in_progress: 'In progress: improve workspace search',
    idle: 'Idle: explore navigation alternatives',
    complete: 'Complete: polish settings accessibility',
    pr_open:
      'PR open: keep workspace titles readable across narrow layouts and long repository names',
    pr_ready: 'PR mergeable: ship the sidebar improvements',
    pr_queued: 'PR queued: publish the release documentation',
    pr_merged: 'PR merged: simplify platform configuration',
  };
  const statusGroupingFixtures: Workspace[] = [
    ...WORKSPACE_DISPLAY_STATUS_VALUES.map((status) => ({
      ...fixtures[0],
      id: WorkspaceId(`home-status-${status}`),
      title: statusGroupingTitles[status],
      displayStatus: status,
      attention: status === 'pr_ready' ? ('review_required' as const) : undefined,
      statusMessage: `Working on ${statusGroupingTitles[status].split(': ')[1]}.`,
      repositoryName: status === 'pr_merged' ? 'platform' : 'studio',
      repositoryPath: status === 'pr_merged' ? '/repos/platform' : '/repos/studio',
      branch: `feat/home-status-${status}`,
    })),
    {
      ...fixtures[0],
      id: WorkspaceId('home-status-missing'),
      title: 'Not started: workspace with no reported status',
      displayStatus: undefined,
      attention: undefined,
      statusMessage: 'Waiting for the first workspace status update.',
    },
    {
      ...fixtures[0],
      id: WorkspaceId('home-status-unknown'),
      title: 'Not started: workspace with a future status',
      displayStatus: 'future_status' as WorkspaceDisplayStatus,
      attention: undefined,
      statusMessage: 'The daemon reported a status this client does not recognize yet.',
    },
    {
      ...fixtures[6],
      id: WorkspaceId('home-status-archived'),
      title: 'Archived: explore alternative layouts',
    },
    {
      ...fixtures[0],
      id: WorkspaceId('home-status-deleted'),
      title: 'Deleted: retired release experiment',
      status: WorkspaceStatus.Deleted,
    },
    {
      ...fixtures[0],
      id: WorkspaceId('home-status-pending-delete'),
      title: 'Pending deletion: retired navigation experiment',
      pendingDeleteAt: '2026-09-29T00:00:00Z',
    },
  ];
  const prStatusFixtures: Workspace[] = [
    ...(['pr_open', 'pr_ready', 'pr_queued'] as const).flatMap((displayStatus) => [
      {
        ...fixtures[0],
        id: WorkspaceId(`home-${displayStatus}`),
        title: `${displayStatus} workspace`,
        displayStatus,
        attention: undefined,
        statusMessage: 'Pull request state reported by the daemon.',
      },
      {
        ...fixtures[0],
        id: WorkspaceId(`home-${displayStatus}-running`),
        title: `${displayStatus} with an active agent`,
        displayStatus,
        activity: 'agent_running' as const,
        attention: undefined,
        statusMessage: 'An agent is still working.',
      },
    ]),
    ...(
      [
        ['review', 'pr_ready', 'review_required'],
        ['question', 'needs_attention', undefined],
        ['failed', 'failed', 'review_required'],
        ['blocked', 'blocked', 'review_required'],
        ['merged', 'pr_merged', undefined],
        ['complete', 'complete', undefined],
        ['idle', 'idle', undefined],
        ['unread', 'idle', 'unread'],
      ] as const
    ).map(([id, displayStatus, attention]) => ({
      ...fixtures[0],
      id: WorkspaceId(`home-pr-${id}`),
      title: `${id} workspace`,
      displayStatus,
      attention,
      statusMessage: 'Existing attention and completion signals keep their meaning.',
    })),
  ].map((workspace) => ({ ...workspace, waiting: true }));
  const repositoryFixtures: Pick<
    Workspace,
    'repositoryOwner' | 'repositoryName' | 'repositoryPath'
  >[] = [
    { repositoryOwner: 'acme', repositoryName: 'studio', repositoryPath: '/repos/studio' },
    { repositoryOwner: 'orbit', repositoryName: 'studio', repositoryPath: '/repos/orbit/studio' },
    {
      repositoryOwner: 'an-organization-with-a-long-name',
      repositoryName: 'a-repository-with-a-long-name',
      repositoryPath: '/repos/long-name',
    },
    {
      repositoryOwner: undefined,
      repositoryName: 'local-tools',
      repositoryPath: '/repos/local-tools',
    },
    { repositoryOwner: undefined, repositoryName: undefined, repositoryPath: '/repos/path-only' },
    { repositoryOwner: undefined, repositoryName: undefined, repositoryPath: undefined },
  ];
  const assistantFixtures: AgentSession[] = Array.from({ length: 240 }, (_, index) => {
    const name =
      [
        'Plan the next release',
        'Review open pull requests',
        'Find the workspaces that need my attention before the next release and summarize what is blocking them',
      ][index] ?? `Assistant conversation ${index + 1}`;
    const timestamp = new Date(Date.UTC(2026, 8, 29, 12, 0, 0) - index * 60_000).toISOString();
    return {
      id: AgentId(`home-assistant-${index}`),
      backendSessionId: null,
      workspaceId: CHIEF_WORKSPACE_ID,
      name,
      status: AgentStatus.Active,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActivity: timestamp,
      messages: [
        {
          id: `home-assistant-prompt-${index}`,
          role: 'user',
          timestamp,
          contentBlocks: [{ type: 'text', text: name }],
        },
        {
          id: `home-assistant-reply-${index}`,
          role: 'assistant',
          timestamp,
          contentBlocks: [
            {
              type: 'text',
              text: 'Your workspaces are ready to review. The onboarding flow needs your feedback, and search improvements are in progress.',
            },
          ],
        },
      ],
      metadata: { specialist: CHIEF_SPECIALIST_ID, chiefPromptVersion: CHIEF_PROMPT_VERSION },
    };
  });
</script>

<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import HomePage from './HomePage.svelte';
  import { homeIntegrationsFixtures } from './home-integrations-fixtures';
  import { store } from '$store/renderer/store';
  import { startHomePreviewFixtures } from './home-preview-lifecycle';
  import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
  import {
    replaceWorkspaceList,
    updateWorkspaceEntity,
    bulkUpdateWorkspaceEntities,
    setWorkspaceHasLoaded,
    setWorkspaceError,
  } from '$store/renderer/slices/workspace/workspace-slice';
  import { setRepos } from '$store/renderer/slices/known-repos/known-repos-slice';
  import {
    closePanel,
    hydrateSidebarNav,
    openPanel,
    setChiefActiveAgentId,
    setShowCreateModal,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { guestSessionsListUnavailable } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
  import {
    hydrateHomeWorkspaceSettings,
    resetHomeWorkspaceView,
    updateHomeWorkspaceView,
  } from './home-workspaces-slice';
  import { persistedHomeState, readHomePersistence } from './home-workspaces-persistence';
  import { selectShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { hydrateDefaultProvider } from '$store/renderer/slices/model/model-slice';
  import {
    removeAgent,
    setAgents,
    setAgentsLoaded,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import {
    bulkUpsertSessions,
    removeSession,
  } from '$store/renderer/slices/agent-session/agent-session-slice';

  import {
    chatTranscriptSnapshotApplied,
    transcriptHydrationSettled,
  } from '$store/renderer/slices/chat-state/chat-state-slice';

  let { scenario = 'populated', height = 720 }: Props = $props();
  const assistant = $derived(scenario === 'assistant-long');
  const dispose = startHomePreviewFixtures();
  const previousPinnedIds = store.state.sidebarNav.pinnedWorkspaceIds;
  let previewRoot = $state<HTMLDivElement | null>(null);
  window.__homePrStatusPreview = {
    setWaiting: (waiting) => {
      store.dispatch(
        bulkUpdateWorkspaceEntities(
          prStatusFixtures.map((workspace) => updateWorkspaceEntity(workspace.id, { waiting })),
        ),
      );
    },
  };
  onMount(() => {
    if (scenario !== 'pr-status-list' && scenario !== 'board-pr-status') return;
    const root = previewRoot;
    if (!root) return;
    // Offscreen board avatars must load for the sandbox capture's stable marker.
    const loadImages = () => {
      root.querySelectorAll('img').forEach((image) => (image.loading = 'eager'));
    };
    const observer = new MutationObserver(loadImages);
    observer.observe(root, { childList: true, subtree: true });
    loadImages();
    return () => observer.disconnect();
  });
  const showCreateModal$ = selectShowCreateModal();
  window.__homeWorkspacePreview = {
    setPullRequests: (id, pulls, total) =>
      store.dispatch(
        bulkUpdateWorkspaceEntities([
          updateWorkspaceEntity(id, { pullRequests: pulls, pullRequestsTotal: total }),
        ]),
      ),
    setTitle: (id, title) =>
      store.dispatch(bulkUpdateWorkspaceEntities([updateWorkspaceEntity(id, { title })])),
    setPullRequest: (id, pullRequest) =>
      store.dispatch(
        bulkUpdateWorkspaceEntities([
          updateWorkspaceEntity(id, {
            pullRequests: [pullRequest],
            activePullRequest: pullRequest,
          }),
        ]),
      ),
    setStatus: (id, status) =>
      store.dispatch(
        bulkUpdateWorkspaceEntities([updateWorkspaceEntity(id, { displayStatus: status })]),
      ),
    setFlags: (id, flags) =>
      store.dispatch(bulkUpdateWorkspaceEntities([updateWorkspaceEntity(id, flags)])),
    navigation: () => ({
      currentTabId: store.state.tabState.currentTabId,
      tabOrder: store.state.tabState.workspaceStacks.flat(),
    }),
    roundTripSettings: () => {
      const view = store.state.homeWorkspaces;
      const persisted = JSON.stringify(persistedHomeState(view));
      store.dispatch(
        hydrateHomeWorkspaceSettings(
          view.persistenceScope,
          readHomePersistence(JSON.parse(persisted)),
        ),
      );
    },
  };
  store.dispatch(guestSessionsListUnavailable());
  store.dispatch(hydrateDefaultProvider(''));
  store.dispatch(setAgentsLoaded(CHIEF_WORKSPACE_ID, true));
  store.dispatch(setShowCreateModal(false));
  window.__homeAssistantPreview = {
    removeSelectedThread() {
      const id = store.state.sidebarNav.chiefActiveAgentId;
      if (!id) return;
      store.dispatch(removeAgent(CHIEF_WORKSPACE_ID, id));
      store.dispatch(removeSession(id));
    },
  };
  // A retired workspace (PROTOCOL §5.1) as the Retired chip's opt-in fetch
  // leaves it in the store; every other chip must still hide it.
  const retiredFixture: Workspace = {
    ...fixtures[0],
    id: WorkspaceId('home-retired'),
    title: 'Prototype the old importer',
    branch: 'feat/home-retired',
    displayStatus: 'complete',
    attention: undefined,
    status: WorkspaceStatus.Retired,
    archived: true,
    archivedAt: '2026-09-10T00:00:00Z',
    retiredAt: '2026-09-20T00:00:00Z',
    statusMessage: 'Retired after the importer rewrite shipped.',
  };
  $effect.pre(() => {
    admitLegacyPrincipal(scenario === 'collaborator' ? 'guest' : 'owner');
    store.dispatch(closePanel());
    store.dispatch(resetHomeWorkspaceView());
    store.dispatch(
      hydrateSidebarNav({
        pinnedWorkspaceIds:
          scenario === 'status-icons' || scenario === 'board-pinned'
            ? ['home-complete']
            : scenario === 'status-grouping'
              ? []
              : previousPinnedIds,
      }),
    );
    assistantFixtures.forEach((thread) => store.dispatch(removeSession(thread.id)));
    const threads =
      scenario === 'assistant-many' || scenario === 'assistant-activity-many'
        ? assistantFixtures
        : scenario === 'assistant-activity'
          ? assistantFixtures.slice(0, 9)
          : scenario === 'assistant' || scenario === 'assistant-streaming'
            ? assistantFixtures.slice(0, 3)
            : [];
    store.dispatch(setAgents(CHIEF_WORKSPACE_ID, threads));
    store.dispatch(
      bulkUpsertSessions(
        scenario === 'assistant-streaming'
          ? threads.map((thread) => ({ ...thread, isStreaming: true, isProcessing: true }))
          : threads,
      ),
    );
    if (scenario === 'assistant-activity' || scenario === 'assistant-activity-many') {
      window.__homeAssistantActivity?.seed(threads);
    }
    store.dispatch(setChiefActiveAgentId(threads[0]?.id ?? null));
    store.dispatch(
      scenario === 'assistant-empty' ||
        scenario === 'assistant-streaming' ||
        scenario === 'assistant-activity' ||
        scenario === 'assistant-activity-many'
        ? openPanel('chief')
        : closePanel(),
    );
    store.dispatch(
      replaceWorkspaceList(
        scenario === 'empty'
          ? []
          : (scenario === 'pr-status-list' || scenario === 'board-pr-status'
              ? prStatusFixtures
              : scenario === 'status-icons' || scenario === 'board-pinned'
                ? statusFixtures
                : scenario === 'status-grouping'
                  ? statusGroupingFixtures
                  : scenario === 'retired'
                    ? [...fixtures, retiredFixture]
                    : fixtures
            ).map((workspace) => ({
              ...workspace,
              myRole: scenario === 'collaborator' ? 'collaborator' : 'owner',
              ...(scenario === 'untitled' && workspace.id === 'home-running'
                ? { title: '' }
                : scenario === 'untitled' && workspace.id === 'home-review'
                  ? { title: ' \t ' }
                  : {}),
              ...(scenario === 'board-long-content'
                ? {
                    title: `${workspace.title} ${'workspace'.repeat(12)}`,
                    statusMessage: 'InvestigatingAnUnbrokenStatusMessage'.repeat(4),
                    repositoryName: 'repository'.repeat(10),
                  }
                : scenario === 'board-repositories'
                  ? {
                      repositoryName: `${workspace.id}-${'repository'.repeat(10)}`,
                      repositoryPath: `/repos/${workspace.id}`,
                    }
                  : scenario.endsWith('repository-labels')
                    ? repositoryFixtures[fixtures.indexOf(workspace) % repositoryFixtures.length]
                    : {}),
            })),
      ),
    );
    store.dispatch(setWorkspaceHasLoaded(true));
    store.dispatch(
      setWorkspaceError(scenario === 'error' ? 'The daemon connection was interrupted.' : null),
    );
    store.dispatch(
      setRepos(
        scenario === 'empty'
          ? []
          : [
              {
                path: '/repos/studio',
                name: 'studio',
                owner: 'acme',
                addedAt: '2026-09-01',
                lastUsedAt: '2026-09-29',
              },
              {
                path: '/repos/local-tools',
                name: 'local-tools',
                addedAt: '2026-09-01',
                lastUsedAt: '2026-09-29',
              },
              {
                path: '/repos/platform',
                name: 'platform',
                owner: 'acme',
                addedAt: '2026-09-01',
                lastUsedAt: '2026-09-29',
              },
              ...(assistant
                ? Array.from({ length: 48 }, (_, index) => ({
                    path: `/repos/project-${index + 1}`,
                    name: `project-${index + 1}`,
                    owner: index < 24 ? 'acme' : 'studio',
                    addedAt: '2026-09-01',
                    lastUsedAt: '2026-09-29',
                  }))
                : []),
            ],
      ),
    );
    if (assistant) {
      const timestamp = '2026-09-29T12:00:00.000Z';
      const id = AgentId('home-assistant-fixture');
      const messages: AgentMessage[] =
        scenario === 'assistant-long'
          ? Array.from({ length: 12 }, (_, index) => [
              {
                id: `home-assistant-user-${index}`,
                role: 'user' as const,
                timestamp: new Date(Date.parse(timestamp) + index * 2000).toISOString(),
                contentBlocks: [{ type: 'text' as const, text: `Review project ${index + 1}.` }],
              },
              {
                id: `home-assistant-response-${index}`,
                role: 'assistant' as const,
                timestamp: new Date(Date.parse(timestamp) + index * 2000 + 1000).toISOString(),
                contentBlocks: [
                  {
                    type: 'text' as const,
                    text: 'The project is ready for review.\n\nCheck the latest changes and choose the next step.',
                  },
                ],
              },
            ]).flat()
          : [];
      const session = {
        id,
        backendSessionId: null,
        workspaceId: CHIEF_WORKSPACE_ID,
        name: 'Home assistant',
        status: AgentStatus.RuntimeIdle,
        messages,
        createdAt: timestamp,
        updatedAt: timestamp,
        metadata: { specialist: CHIEF_SPECIALIST_ID, chiefPromptVersion: CHIEF_PROMPT_VERSION },
      };
      store.dispatch(bulkUpsertSessions([session], { preserveExplicitRuntimeFlags: false }));
      store.dispatch(setAgents(CHIEF_WORKSPACE_ID, [session]));
      store.dispatch(
        chatTranscriptSnapshotApplied(id, {
          truncated: false,
          totalMessages: messages.length,
          nextToken: null,
          resumed: false,
        }),
      );
      store.dispatch(transcriptHydrationSettled(id));
      store.dispatch(setChiefActiveAgentId(id));
      store.dispatch(openPanel('chief'));
    }
    if (scenario.startsWith('board')) {
      store.dispatch(
        updateHomeWorkspaceView({
          view: 'board',
          ...(scenario === 'board-repositories' ? { groupBy: 'repository' } : {}),
        }),
      );
    }
    if (scenario === 'status-icons') store.dispatch(updateHomeWorkspaceView({ groupBy: 'none' }));
    if (scenario === 'prs') store.dispatch(updateHomeWorkspaceView({ tab: 'prs' }));
    if (['linear', 'integration-error', 'disconnected'].includes(scenario))
      store.dispatch(updateHomeWorkspaceView({ tab: 'linear' }));
  });
  onDestroy(() => {
    store.dispatch(hydrateSidebarNav({ pinnedWorkspaceIds: previousPinnedIds }));
    assistantFixtures.forEach((thread) => store.dispatch(removeSession(thread.id)));
    delete window.__homeAssistantPreview;
    delete window.__homeWorkspacePreview;
    delete window.__homePrStatusPreview;
    dispose();
  });
</script>

<div
  bind:this={previewRoot}
  class="w-full overflow-hidden bg-sidebar text-foreground"
  style:height="{height}px"
  data-home-preview
>
  <HomePage
    preview
    integrationPreview={scenario === 'integration-error'
      ? { linear: homeIntegrationsFixtures.error }
      : scenario === 'disconnected'
        ? { linear: homeIntegrationsFixtures.disconnected }
        : undefined}
  />
  <output class="sr-only" data-create-workspace-requested>{$showCreateModal$}</output>
</div>
