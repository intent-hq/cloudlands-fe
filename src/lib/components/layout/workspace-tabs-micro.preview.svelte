<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  interface Props {
    scenario?: 'list' | 'board' | 'disconnected';
  }
  export const preview = definePreview<Props>({
    id: 'workspace-tabs-micro',
    title: 'Workspace tabs with Micro assignments',
    defaultState: 'list',
    states: {
      list: { props: { scenario: 'list' } },
      board: { props: { scenario: 'board' } },
      disconnected: { props: { scenario: 'disconnected' } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import HomeMicroPreview from '$features/home/home-micro.preview.svelte';
  import { startHomePreview } from '$features/home/home-preview-lifecycle';
  import { store } from '$store/renderer/store';
  import {
    loadWorkspaceTabsState,
    serializeWorkspaceTabsState,
  } from '$store/renderer/slices/tab-state/tab-state-slice';
  import WorkspaceTabStrip from './WorkspaceTabStrip.svelte';

  let { scenario = 'list' }: Props = $props();
  const stop = startHomePreview(() => []);
  const previous = serializeWorkspaceTabsState(store.state.tabState);
  const ids = ['home-review', 'home-running', 'home-unread'];
  store.dispatch(
    loadWorkspaceTabsState({
      openTabs: ids,
      currentTabId: ids[0],
      pinnedTabs: [ids[0]],
      unsavedTabs: [],
      optimisticTabs: [],
      tabOrder: ids,
    }),
  );
  onDestroy(() => {
    store.dispatch(loadWorkspaceTabsState(previous));
    stop();
  });
</script>

<div class="w-full" data-micro-tabs-preview>
  <div class="flex h-10 w-full items-end bg-sidebar" data-micro-tab-strip>
    <WorkspaceTabStrip />
  </div>
  <HomeMicroPreview {scenario} />
</div>
