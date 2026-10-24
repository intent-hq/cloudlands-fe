<script lang="ts">
  import * as Menu from '$lib/components/ui/menu';
  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import WorkspaceDiscussion from '$features/discussions/components/WorkspaceDiscussion.svelte';
  import { openWorkspaceDiscussion } from '$features/discussions/discussion-navigation';
  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { discussionTitle } from '$features/discussions/discussion-title';
  import { store } from '$store/renderer/store';
  import { selectLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import {
    selectDiscussionConversations,
    selectDiscussionContext,
  } from '$store/renderer/slices/workspace-discussion/workspace-discussion-selectors';
  import {
    discussionDirectoryRequested,
    discussionRequested,
  } from '$store/renderer/slices/workspace-discussion/workspace-discussion-slice';
  import {
    selectPanelIds,
    selectPanel,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { selectPrincipalSnapshot } from '$store/renderer/slices/principal/principal-selectors';
  import { updateTabTitle } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import type { TabTypeComponentProps } from './registry';
  let { tab, workspaceId, layoutId, isActive, isPanelFocused }: TabTypeComponentProps = $props();
  const workspaceId$ = writable('');
  const resolvedWorkspaceId = $derived(tab.workspaceId ?? workspaceId);
  const conversationId = $derived(
    typeof tab.data?.conversationId === 'string' ? tab.data.conversationId : 'default',
  );
  $effect(() => workspaceId$.set(resolvedWorkspaceId));
  const conversations$ = selectDiscussionConversations(workspaceId$);
  const context$ = selectDiscussionContext();
  const multiplayer$ = selectLabsMultiplayerEnabled();
  const principal$ = selectPrincipalSnapshot();
  const headerContext = getPanelHeaderContext();
  const targetLayout = $derived(layoutId ?? workspaceId);
  function panelId() {
    return selectPanelIds
      .select(store.state, targetLayout)
      .find((id) =>
        selectPanel.select(store.state, targetLayout, id)?.tabs.some((item) => item.id === tab.id),
      );
  }
  function selectConversation(id: string, title?: string) {
    const owner = panelId();
    if (owner) openWorkspaceDiscussion(resolvedWorkspaceId, targetLayout, id, title, owner);
  }
  function refresh() {
    store.dispatch(discussionDirectoryRequested(resolvedWorkspaceId));
    if (conversationId !== 'new')
      store.dispatch(discussionRequested(resolvedWorkspaceId, conversationId));
  }
  $effect(() => {
    const id = resolvedWorkspaceId;
    if (isActive && $context$ && $multiplayer$)
      untrack(() => store.dispatch(discussionDirectoryRequested(id)));
  });
  $effect(() => {
    if (isActive && $multiplayer$)
      return headerContext?.registerActions({ actions: discussionActions });
  });
  $effect(() => {
    if (conversationId === 'new') return;
    const id = conversationId;
    const conversation = $conversations$.find((item) => item.id === id);
    if (!conversation) return;
    const title = discussionTitle(conversation, $principal$?.principal.id);
    const targetLayout = layoutId ?? workspaceId;
    if (tab.title !== title)
      untrack(() => store.dispatch(updateTabTitle(targetLayout, tab.id, title)));
  });
</script>

{#snippet discussionActions()}
  <Menu.Item onclick={() => selectConversation('new')}
    >{m.workspace_discussion_new_title()}</Menu.Item
  >
  <Menu.Item onclick={refresh}>{m.workspace_commitsTimeline_refresh_label()}</Menu.Item>
{/snippet}

{#key `${resolvedWorkspaceId}:${conversationId}`}
  <WorkspaceDiscussion
    workspaceId={resolvedWorkspaceId}
    sourcePanelId={panelId()}
    {conversationId}
    {isActive}
    {isPanelFocused}
  />
{/key}
