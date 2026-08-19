<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { AgentSession } from '$shared/types';
  import MultiSelectTabbedSidebar from '$lib/components/workspace/MultiSelectTabbedSidebar.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { setMultiSelectSidebarSelectedTabs } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { setThemeName } from '$store/renderer/slices/theme/theme-slice';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { setAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { loadWorkspaceNotesSucceeded } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
  import { initializeLayout } from '$store/renderer/slices/panel-layout/panel-layout-slice';

  let {
    width,
    zoom,
    theme,
    selectedTab = 'overview',
    agentCount = 8,
    noteCount = 8,
    description,
    hasPullRequest = false,
  }: {
    width: number;
    zoom: number;
    theme: 'light' | 'dark';
    selectedTab?: string;
    agentCount?: number;
    noteCount?: number;
    description?: string;
    hasPullRequest?: boolean;
  } = $props();
  // svelte-ignore state_referenced_locally - each test host applies its initial data once
  const initialAgentCount = agentCount;
  // svelte-ignore state_referenced_locally - each test host applies its initial data once
  const initialNoteCount = noteCount;
  // svelte-ignore state_referenced_locally - each test host applies its initial data once
  const initialDescription = description;
  // svelte-ignore state_referenced_locally - each test host applies its initial data once
  const initiallyHasPullRequest = hasPullRequest;
  const workspaceId = 'launcher-paint-test';
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  const timestamp = '2026-08-13T16:51:00.000Z';
  const agents = Array.from({ length: initialAgentCount }, (_, index) => ({
    id: index === 0 ? 'agent-running' : `agent-${index}`,
    workspaceId,
    name: index === 0 ? 'Running agent' : `Agent ${index}`,
    status: index === 0 ? 'active' : 'idle',
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
      title: 'Launcher paint test',
      path: '/tmp/launcher-paint-test',
      status: 'active',
      statusMessage: initialDescription,
      activePullRequest: initiallyHasPullRequest
        ? {
            id: 'pr-42',
            number: 42,
            url: 'https://github.com/intent-hq/monorepo/pull/42',
            title: 'Sidebar geometry review',
            status: 'open',
            createdAt: timestamp,
            updatedAt: timestamp,
          }
        : undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    } as never),
  );
  store.dispatch(bulkUpsertSessions(agents, { preserveExplicitRuntimeFlags: false }));
  store.dispatch(setAgents(workspaceId, agents));
  store.dispatch(
    loadWorkspaceNotesSucceeded([workspaceId], {
      [workspaceId]: Array.from({ length: initialNoteCount }, (_, index) => ({
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
  const openTabs = [
    initialAgentCount > 0
      ? {
          id: 'agent-tab',
          type: 'agent' as const,
          title: 'Running agent',
          agentId: 'agent-running',
          workspaceId,
          closable: true,
        }
      : null,
    initialNoteCount > 0
      ? {
          id: 'note-tab',
          type: 'note' as const,
          title: 'Context note 1',
          noteId: 'note-0',
          workspaceId,
          closable: true,
        }
      : null,
  ].filter((tab) => tab !== null);
  if (openTabs.length > 0) {
    store.dispatch(
      initializeLayout(workspaceId, {
        root: { type: 'panel', panelId: 'launcher-panel' },
        panels: {
          'launcher-panel': {
            id: 'launcher-panel',
            tabs: openTabs,
            activeTabId: openTabs[0].id,
          },
        },
        focusedPanelId: 'launcher-panel',
      }),
    );
  }
  // svelte-ignore state_referenced_locally - each test host applies its initial mode once
  store.dispatch(setMultiSelectSidebarSelectedTabs(workspaceId, [selectedTab]));
  $effect(() => store.dispatch(setThemeName(theme)));
  onDestroy(disposeStore);
</script>

<div data-sidebar-launcher-host style="width: {width}px; height: 520px; zoom: {zoom};">
  <MultiSelectTabbedSidebar {workspaceId} />
</div>
