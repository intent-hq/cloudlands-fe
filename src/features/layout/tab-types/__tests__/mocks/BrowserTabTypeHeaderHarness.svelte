<script lang="ts">
  import { takeEvery, type SagaGenerator } from 'typed-redux-saga';
  import { store } from '$store/renderer/store';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { createPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import PanelTabBar from '$lib/components/layout/panel-system/PanelTabBar.svelte';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import BrowserTabType from '../../BrowserTabType.svelte';

  let {
    tabs,
    activeTabId,
    width = 640,
    renderPanelHeader = false,
    captureOwnerRequests = false,
  }: {
    tabs: PanelTab[];
    activeTabId: string;
    width?: number;
    renderPanelHeader?: boolean;
    captureOwnerRequests?: boolean;
  } = $props();
  const header = createPanelHeaderContext();
  let ownerRequest = $state('');
  $effect(() => {
    if (!captureOwnerRequests) return;
    return store.runSaga(function* (): SagaGenerator<void> {
      yield* takeEvery(
        openAgentTabRequested.type,
        function* (action: ReturnType<typeof openAgentTabRequested>): SagaGenerator<void> {
          ownerRequest = JSON.stringify(action.payload);
        },
      );
    });
  });
</script>

<div
  class="flex h-90 flex-col overflow-hidden bg-card"
  style:width={`${width}px`}
  data-owner-request={ownerRequest}
>
  {#if renderPanelHeader}
    <PanelTabBar
      {tabs}
      {activeTabId}
      panelId="browser-panel"
      workspaceId="workspace-1"
      isFocused
      contentActions={header.actions.current}
      onTabClick={() => {}}
      onTabClose={() => {}}
    />
  {:else}
    <div data-testid="panel-header">
      {#if header.actions.current}
        <Menu.Root>
          <Menu.Trigger aria-label="Panel actions">Panel actions</Menu.Trigger>
          <Menu.Content portal={false}>
            {@render header.actions.current.actions?.()}
          </Menu.Content>
        </Menu.Root>
      {/if}
    </div>
  {/if}
  {#each tabs as tab (tab.id)}
    <div class="min-h-0 flex-1" hidden={activeTabId !== tab.id}>
      <BrowserTabType
        {tab}
        workspaceId="workspace-1"
        isActive={activeTabId === tab.id}
        isPanelFocused={false}
      />
    </div>
  {/each}
</div>
