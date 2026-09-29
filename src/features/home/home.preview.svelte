<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { WorkspaceStatus, type Workspace } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';

  interface Props {
    scenario?:
      | 'populated'
      | 'board'
      | 'empty'
      | 'error'
      | 'collaborator'
      | 'prs'
      | 'linear'
      | 'integration-error'
      | 'disconnected';
  }
  export const preview = definePreview<Props>({
    id: 'home',
    title: 'Home',
    defaultState: 'populated',
    states: {
      populated: { props: { scenario: 'populated' } },
      board: { props: { scenario: 'board' } },
      empty: { props: { scenario: 'empty' } },
      error: { props: { scenario: 'error' } },
      collaborator: { props: { scenario: 'collaborator' } },
      prs: { props: { scenario: 'prs' } },
      linear: { props: { scenario: 'linear' } },
      'integration-error': { props: { scenario: 'integration-error' } },
      disconnected: { props: { scenario: 'disconnected' } },
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
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import HomePage from './HomePage.svelte';
  import { setupHomeIntegrationsFixtures } from './home-integrations-browser-fixtures';
  import { homeIntegrationsFixtures } from './home-integrations-fixtures';
  import { store } from '$store/renderer/store';
  import { startHomePreview } from './home-preview-lifecycle';
  import {
    replaceWorkspaceList,
    setWorkspaceHasLoaded,
    setWorkspaceError,
  } from '$store/renderer/slices/workspace/workspace-slice';
  import { setRepos } from '$store/renderer/slices/known-repos/known-repos-slice';
  import {
    closePanel,
    setShowCreateModal,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { guestSessionsListUnavailable } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
  import { resetHomeWorkspaceView, updateHomeWorkspaceView } from './home-workspaces-slice';
  import { selectShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { hydrateDefaultProvider } from '$store/renderer/slices/model/model-slice';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import { setAgentsLoaded } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

  let { scenario = 'populated' }: Props = $props();
  const dispose = startHomePreview(() => [setupHomeIntegrationsFixtures(store)]);
  const showCreateModal$ = selectShowCreateModal();
  store.dispatch(guestSessionsListUnavailable());
  store.dispatch(hydrateDefaultProvider(''));
  store.dispatch(setAgentsLoaded(CHIEF_WORKSPACE_ID, true));
  store.dispatch(closePanel());
  store.dispatch(setShowCreateModal(false));
  $effect.pre(() => {
    store.dispatch(resetHomeWorkspaceView());
    store.dispatch(
      replaceWorkspaceList(
        scenario === 'empty'
          ? []
          : fixtures.map((workspace) => ({
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
                path: '/repos/platform',
                name: 'platform',
                owner: 'acme',
                addedAt: '2026-09-01',
                lastUsedAt: '2026-09-29',
              },
            ],
      ),
    );
    if (scenario === 'board') store.dispatch(updateHomeWorkspaceView({ view: 'board' }));
    if (scenario === 'prs') store.dispatch(updateHomeWorkspaceView({ tab: 'prs' }));
    if (['linear', 'integration-error', 'disconnected'].includes(scenario))
      store.dispatch(updateHomeWorkspaceView({ tab: 'linear' }));
  });
  onDestroy(dispose);
</script>

<div class="h-[720px] w-full bg-sidebar text-foreground" data-home-preview>
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
