<script lang="ts">
  import Fa from 'svelte-fa';
  import { faComment } from '@fortawesome/free-regular-svg-icons';
  import { ListView, ListRow } from '$lib/components/patterns/collection';
  import { m } from '$shared/paraglide/messages.js';
  import { store } from '$store/renderer/store';
  import {
    selectFocusedPanelId,
    selectPanel,
    selectPanelIds,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { openTab, setActiveTab } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { panelTabsAreEquivalent } from '$store/renderer/slices/panel-layout/panel-tab-identity';
  import { selectLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';

  let {
    workspaceId,
    panelLayoutId = workspaceId,
  }: { workspaceId: string; panelLayoutId?: string } = $props();
  const multiplayer$ = selectLabsMultiplayerEnabled();
  const rows = $derived([{ id: workspaceId, title: m.workspace_discussion_title() }]);

  function openDiscussion() {
    if (!$multiplayer$) return;
    const panelId =
      selectFocusedPanelId.select(store.state, panelLayoutId) ??
      selectPanelIds.select(store.state, panelLayoutId)[0];
    if (!panelId) return;
    const panel = selectPanel.select(store.state, panelLayoutId, panelId);
    const destination = {
      type: 'discussion' as const,
      title: m.workspace_discussion_title(),
      workspaceId,
      closable: true,
    };
    const existing = panel?.tabs.find((tab) => panelTabsAreEquivalent(tab, destination));
    store.dispatch(
      existing
        ? setActiveTab(panelLayoutId, existing.id, panelId)
        : openTab(panelLayoutId, destination, panelId, undefined, true, undefined, true),
    );
  }
</script>

{#if $multiplayer$}
  <section class="mb-4 min-w-0" aria-label={m.workspace_discussion_list_label()}>
    <h3 class="px-2.5 py-1.5 type-caption text-muted-foreground">
      {m.workspace_discussion_list_label()}
    </h3>
    <ListView
      items={rows}
      getKey={(row) => row.id}
      getText={(row) => row.title}
      onActivate={openDiscussion}
      ariaLabel={m.workspace_discussion_list_label()}
      virtualize={false}
    >
      {#snippet row({ item })}
        <ListRow class="min-h-9 gap-2.5 px-2.5 py-2" data-workspace-discussion-open>
          {#snippet leading()}<Fa icon={faComment} class="text-muted-foreground" />{/snippet}
          {#snippet title()}{item.title}{/snippet}
        </ListRow>
      {/snippet}
    </ListView>
  </section>
{/if}
