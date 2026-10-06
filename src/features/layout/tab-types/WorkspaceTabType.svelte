<script lang="ts">
  import { writable } from 'svelte/store';
  import HomeWorkspaceDetail from '$features/home/HomeWorkspaceDetail.svelte';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { closeTab } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { store } from '$store/renderer/store';
  import type { TabTypeComponentProps } from './registry';

  let { tab, workspaceId, layoutId, isActive }: TabTypeComponentProps = $props();
  const workspaceIdStore = writable(workspaceId);
  $effect(() => workspaceIdStore.set(workspaceId));
  const workspace$ = selectWorkspaceById(workspaceIdStore);
</script>

{#if isActive && $workspace$}
  {#key workspaceId}
    <HomeWorkspaceDetail
      workspace={$workspace$}
      showBackToList={false}
      onclose={() => store.dispatch(closeTab(layoutId ?? workspaceId, tab.id))}
    />
  {/key}
{/if}
