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

  let {
    width,
    zoom,
    theme,
    selectedTab = 'overview',
  }: {
    width: number;
    zoom: number;
    theme: 'light' | 'dark';
    selectedTab?: string;
  } = $props();
  const workspaceId = 'launcher-paint-test';
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  const timestamp = '2026-08-13T16:51:00.000Z';
  const agents = Array.from({ length: 8 }, (_, index) => ({
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
      createdAt: timestamp,
      updatedAt: timestamp,
    } as never),
  );
  store.dispatch(bulkUpsertSessions(agents, { preserveExplicitRuntimeFlags: false }));
  store.dispatch(setAgents(workspaceId, agents));
  // svelte-ignore state_referenced_locally - each test host applies its initial mode once
  store.dispatch(setMultiSelectSidebarSelectedTabs(workspaceId, [selectedTab]));
  $effect(() => store.dispatch(setThemeName(theme)));
  onDestroy(disposeStore);
</script>

<div data-sidebar-launcher-host style="width: {width}px; height: 520px; zoom: {zoom};">
  <MultiSelectTabbedSidebar {workspaceId} />
</div>
