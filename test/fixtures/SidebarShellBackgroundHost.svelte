<script lang="ts">
  import { onDestroy } from 'svelte';
  import SidebarPanel from '$lib/components/layout/sidebar-nav/SidebarPanel.svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    closePanel,
    openPanel,
    setAllSpacesViewMode,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import {
    resetWorkspaceState,
    setWorkspaceEntity,
    setWorkspaceHasLoaded,
  } from '$store/renderer/slices/workspace/workspace-slice';

  let { theme, width, zoom }: { theme: 'light' | 'dark'; width: number; zoom: number } = $props();

  // svelte-ignore state_referenced_locally - the host applies its startup theme once
  document.documentElement.classList.toggle('dark', theme === 'dark');
  appStore.init();
  appStore.dispatch(resetWorkspaceState());
  appStore.dispatch(setWorkspaceHasLoaded(true));
  appStore.dispatch(setAllSpacesViewMode('recent'));
  for (let index = 0; index < 4; index += 1) {
    const timestamp = `2026-08-1${index}T12:00:00.000Z`;
    appStore.dispatch(
      setWorkspaceEntity({
        id: `sidebar-shell-${index}`,
        title: `Sidebar shell workspace ${index + 1}`,
        status: 'active',
        displayStatus: index === 0 ? 'in_progress' : 'idle',
        branch: 'polish-ui',
        changesets: [],
        timeline: [],
        conversationInfo: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        lastActivity: timestamp,
      } as never),
    );
  }
  appStore.dispatch(openPanel('all-workspaces'));

  onDestroy(() => {
    appStore.dispatch(closePanel());
    appStore.dispatch(resetWorkspaceState());
    document.documentElement.classList.remove('dark');
  });
</script>

<div
  data-sidebar-shell-host
  style="width: {width}px; height: 560px; zoom: {zoom}; background: hsl(var(--background)); overflow: hidden;"
>
  <SidebarPanel />
</div>
