<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import {
    AgentStatus,
    WorkspaceStatus,
    type AgentSession,
    type AgentMessage,
    type Workspace,
  } from '$shared/types';
  import { AgentId, CHIEF_WORKSPACE_ID, WorkspaceId } from '$shared/types/branded-ids';
  import { CHIEF_PROMPT_VERSION, CHIEF_SPECIALIST_ID } from '$shared/chief-agent-config';

  declare global {
    interface Window {
      __homeAssistantPreview?: { removeSelectedThread: () => void };
    }
  }

  interface Props {
    scenario?:
      | 'populated'
      | 'status-icons'
      | 'board'
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
      'status-icons': { props: { scenario: 'status-icons' } },
      board: { props: { scenario: 'board' } },
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
      displayStatus: 'blocked',
      attention: undefined,
      statusMessage: 'Waiting for a missing dependency.',
    },
    {
      ...fixtures[0],
      id: WorkspaceId('home-failed'),
      title: 'Retry a failed workspace',
      displayStatus: 'failed',
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
            Date.now() -
              [
                37_000, 3_600_000, 86_400_000, 172_800_000, 518_400_000, 2_419_200_000,
                5_184_000_000, 31_536_000_000,
              ][index],
          ).toISOString(),
  }));
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
  import { onDestroy } from 'svelte';
  import HomePage from './HomePage.svelte';
  import { homeIntegrationsFixtures } from './home-integrations-fixtures';
  import { store } from '$store/renderer/store';
  import { startHomePreviewFixtures } from './home-preview-lifecycle';
  import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
  import {
    replaceWorkspaceList,
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
  import { resetHomeWorkspaceView, updateHomeWorkspaceView } from './home-workspaces-slice';
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
  const showCreateModal$ = selectShowCreateModal();
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
  $effect.pre(() => {
    admitLegacyPrincipal(scenario === 'collaborator' ? 'guest' : 'owner');
    store.dispatch(closePanel());
    store.dispatch(resetHomeWorkspaceView());
    store.dispatch(
      hydrateSidebarNav({
        pinnedWorkspaceIds: scenario === 'status-icons' ? ['home-complete'] : previousPinnedIds,
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
          : (scenario === 'status-icons' ? statusFixtures : fixtures).map((workspace) => ({
              ...workspace,
              myRole: scenario === 'collaborator' ? 'collaborator' : 'owner',
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
    if (scenario === 'board') store.dispatch(updateHomeWorkspaceView({ view: scenario }));
    if (scenario === 'status-icons') store.dispatch(updateHomeWorkspaceView({ groupBy: 'none' }));
    if (scenario === 'prs') store.dispatch(updateHomeWorkspaceView({ tab: 'prs' }));
    if (['linear', 'integration-error', 'disconnected'].includes(scenario))
      store.dispatch(updateHomeWorkspaceView({ tab: 'linear' }));
  });
  onDestroy(() => {
    store.dispatch(hydrateSidebarNav({ pinnedWorkspaceIds: previousPinnedIds }));
    assistantFixtures.forEach((thread) => store.dispatch(removeSession(thread.id)));
    delete window.__homeAssistantPreview;
    dispose();
  });
</script>

<div
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
