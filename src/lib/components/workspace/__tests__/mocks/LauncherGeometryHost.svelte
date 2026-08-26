<script lang="ts">
  import { onDestroy } from 'svelte';
  import { PullRequestStatus, type AgentSession, type PullRequestInfo } from '$shared/types';
  import MultiSelectTabbedSidebar from '../../MultiSelectTabbedSidebar.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { setMultiSelectSidebarSelectedTabs } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { setAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { loadWorkspaceNotesSucceeded } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
  import { initializeLayout } from '$store/renderer/slices/panel-layout/panel-layout-slice';

  let {
    width = 360,
    zoom = 1,
    theme = 'light',
    itemCount = 26,
  }: {
    width?: number;
    zoom?: number;
    theme?: 'light' | 'dark';
    itemCount?: number;
  } = $props();

  // svelte-ignore state_referenced_locally - each CT mount seeds one fixed scenario
  const initialItemCount = itemCount;
  const workspaceId = 'launcher-geometry-ct';
  const timestamp = '2026-08-17T00:00:00.000Z';
  const pullRequests: PullRequestInfo[] = [
    {
      id: 'pr-1373',
      number: 1373,
      url: 'https://github.com/intent-hq/repository-with-a-very-long-name/pull/1373',
      title: 'Polish sidebar pull request state and interaction details',
      status: PullRequestStatus.Open,
      ciStatus: { total: 12, passed: 9, failed: 0, pending: 3 },
      reviewDecision: 'REVIEW_REQUIRED',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'pr-1374',
      number: 1374,
      url: 'https://github.com/intent-hq/repository-with-a-very-long-name/pull/1374',
      title: 'Add a compact multi-PR hover card for the Changes launcher',
      status: PullRequestStatus.Draft,
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:00.000Z',
    },
    {
      id: 'pr-1368',
      number: 1368,
      url: 'https://github.com/intent-hq/repository-with-a-very-long-name/pull/1368',
      title: 'Merge the sidebar layout foundation',
      status: PullRequestStatus.Merged,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
    },
  ];
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  const agents = Array.from({ length: initialItemCount }, (_, index) => ({
    id: index === 0 ? 'agent-running' : `agent-${index}`,
    workspaceId,
    name: index === 0 ? 'Running agent' : `Agent ${index}`,
    status:
      index === 0
        ? 'active'
        : index === 1
          ? 'waiting'
          : index === 2
            ? 'error'
            : index === 3
              ? 'completed'
              : 'idle',
    isActive: index === 0,
    isStreaming: index === 0,
    isProcessing: index === 0,
    isResponding: index === 0,
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  })) as unknown as AgentSession[];

  store.dispatch(
    setWorkspaceEntity({
      id: workspaceId,
      title: 'Launcher geometry',
      path: '/tmp/launcher-geometry',
      status: 'active',
      repositoryOwner: 'intent-hq',
      repositoryName: 'repository-with-a-very-long-name',
      activePullRequest: pullRequests[0],
      pullRequests,
      createdAt: timestamp,
      updatedAt: timestamp,
    } as never),
  );
  store.dispatch(bulkUpsertSessions(agents, { preserveExplicitRuntimeFlags: false }));
  store.dispatch(setAgents(workspaceId, agents));
  store.dispatch(
    loadWorkspaceNotesSucceeded([workspaceId], {
      [workspaceId]: Array.from({ length: initialItemCount }, (_, index) => ({
        id: `note-${index}`,
        workspaceId,
        title: `Context note ${index + 1}`,
        content: `Context preview ${index + 1}`,
        contentType: 'markdown',
        tags: [],
        isPinned: false,
        isArchived: false,
        visibility: 'private',
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
    } as never),
  );
  store.dispatch(
    initializeLayout(workspaceId, {
      root: { type: 'panel', panelId: 'launcher-panel' },
      panels: {
        'launcher-panel': {
          id: 'launcher-panel',
          tabs: [
            {
              id: 'agent-tab',
              type: 'agent',
              title: 'Running agent',
              agentId: 'agent-running',
              workspaceId,
              closable: true,
            },
            {
              id: 'note-tab',
              type: 'note',
              title: 'Context note 1',
              noteId: 'note-0',
              workspaceId,
              closable: true,
            },
          ],
          activeTabId: 'agent-tab',
        },
      },
      focusedPanelId: 'launcher-panel',
    }),
  );
  store.dispatch(setMultiSelectSidebarSelectedTabs(workspaceId, ['overview']));

  $effect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.classList.toggle('light', theme === 'light');
  });

  onDestroy(() => {
    disposeStore();
    document.documentElement.classList.remove('dark', 'light');
  });
</script>

<div
  class={theme}
  data-launcher-geometry-host
  data-theme={theme}
  style:width={`${width}px`}
  style:height="520px"
  style:zoom
>
  <MultiSelectTabbedSidebar {workspaceId} />
</div>
