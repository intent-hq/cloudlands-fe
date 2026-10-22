<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import PanelTabBar from '$lib/components/layout/panel-system/PanelTabBar.svelte';
  import { registerAllTabTypes } from '$features/layout/tab-types/register-all';
  import { createPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import PeoplePreview from '$features/presence/components/workspace-people-tile.preview.svelte';
  import DiscussionTabType from '$features/layout/tab-types/DiscussionTabType.svelte';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import {
    initializeLayout,
    clearPanelLayout,
    closeTab,
    setActiveTab,
    reopenClosedTab,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import {
    selectActiveTabInPanel,
    selectPanel,
    selectRecentlyClosed,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { installDiscussionTestBackend, startDiscussionTestSaga } from './discussion-test-backend';
  registerAllTabTypes();
  let {
    failSend = false,
    deferSend = false,
    rejectSend,
  }: { failSend?: boolean; deferSend?: boolean; rejectSend?: 'invalid' | 'forbidden' } = $props();
  const workspaceId = 'people-tile-preview';
  const { actions } = createPanelHeaderContext();
  let requests = $state<Array<{ method: string; params: unknown }>>([]);
  const backend = installDiscussionTestBackend(
    workspaceId,
    () => failSend,
    (calls) => (requests = calls),
    { deferSend, rejectSend },
  );
  const dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
  store.dispatch(
    initializeLayout(workspaceId, {
      root: { type: 'panel', panelId: 'current' },
      focusedPanelId: 'current',
      panels: { current: { id: 'current', activeTabId: null, tabs: [] } },
    }),
  );
  const tab$ = selectActiveTabInPanel(workspaceId, 'current');
  const panel$ = selectPanel(workspaceId, 'current');
  const closed$ = selectRecentlyClosed(workspaceId);
  let stop: (() => void) | undefined;
  onMount(() => {
    stop = startDiscussionTestSaga();
  });
  onDestroy(() => {
    stop?.();
    store.dispatch(clearPanelLayout(workspaceId));
    dispose();
    backend.restore();
  });
</script>

<div
  class="flex h-[720px] w-full max-w-[1000px] border border-border"
  data-multiple-discussion-host
>
  <aside class="w-[320px] shrink-0 overflow-hidden border-r border-border">
    <PeoplePreview sidebar expanded />
  </aside>
  <section class="flex min-w-0 flex-1 flex-col" data-discussion-pane>
    {#if $tab$}
      <PanelTabBar
        tabs={$panel$?.tabs ?? []}
        activeTabId={$tab$.id}
        panelId="current"
        {workspaceId}
        contentActions={actions.current ?? undefined}
        onTabClick={(id) => store.dispatch(setActiveTab(workspaceId, id, 'current'))}
        onTabClose={(id) =>
          store.dispatch(closeTab(workspaceId, id, 'current', undefined, { preservePanel: true }))}
      />
      <div class="min-h-0 flex-1">
        <DiscussionTabType
          tab={$tab$}
          {workspaceId}
          layoutId={workspaceId}
          isActive
          isPanelFocused
        />
      </div>
    {/if}
  </section>
</div>
<output data-discussion-requests>{JSON.stringify(requests)}</output>
<output data-discussion-panel>{JSON.stringify($panel$)}</output>

<Button onclick={() => backend.finishSend()}>Finish sending</Button>
<Button
  onclick={() => store.dispatch(reopenClosedTab(workspaceId, undefined, undefined, 'current'))}
  >Reopen closed discussion</Button
>
<output data-discussion-closed>{JSON.stringify($closed$)}</output>
