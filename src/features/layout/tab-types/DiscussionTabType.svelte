<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Menu from '$lib/components/ui/menu';
  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import WorkspaceDiscussion from '$features/discussions/components/WorkspaceDiscussion.svelte';
  import DiscussionHeader from '$features/discussions/components/DiscussionHeader.svelte';
  import { openWorkspaceDiscussion } from '$features/discussions/discussion-navigation';
  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { discussionTitle } from '$features/discussions/discussion-title';
  import { store } from '$store/renderer/store';
  import { selectLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import {
    selectDiscussionConversations,
    selectDiscussionDirectory,
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
  import { updateTabTitle, closeTab } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import type { TabTypeComponentProps } from './registry';
  let { tab, workspaceId, layoutId, isActive, isPanelFocused }: TabTypeComponentProps = $props();
  const workspaceId$ = writable('');
  const resolvedWorkspaceId = $derived(tab.workspaceId ?? workspaceId);
  const conversationId = $derived(
    typeof tab.data?.conversationId === 'string' ? tab.data.conversationId : 'default',
  );
  $effect(() => workspaceId$.set(resolvedWorkspaceId));
  const conversations$ = selectDiscussionConversations(workspaceId$);
  const directory$ = selectDiscussionDirectory(workspaceId$);
  const context$ = selectDiscussionContext();
  const multiplayer$ = selectLabsMultiplayerEnabled();
  const principal$ = selectPrincipalSnapshot();
  const headerContext = getPanelHeaderContext();
  const targetLayout = $derived(layoutId ?? workspaceId);
  const rows = $derived([
    { id: 'default', title: m.workspace_discussion_title() },
    ...$conversations$
      .filter((item) => item.id !== 'default')
      .map((item) => ({ id: item.id, title: discussionTitle(item, $principal$?.principal.id) })),
  ]);
  const title = $derived(
    conversationId === 'new'
      ? m.workspace_discussion_new_title()
      : (rows.find((row) => row.id === conversationId)?.title ?? tab.title),
  );
  const directParticipant = $derived(
    $conversations$
      .find((item) => item.id === conversationId && item.kind === 'direct')
      ?.participants.find((person) => person.principalId !== $principal$?.principal.id),
  );
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
      return headerContext?.registerActions({ discussionHeader, actions: discussionActions });
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

{#snippet discussionHeader(paneItems: Snippet | undefined, paneActions: Snippet)}
  <DiscussionHeader
    {title}
    avatar={directParticipant?.avatarUrl}
    avatarName={directParticipant ? title : undefined}
    {paneItems}
    {paneActions}
    {conversationId}
    {rows}
    onSelect={selectConversation}
    onNew={() => selectConversation('new')}
    onClose={() => store.dispatch(closeTab(targetLayout, tab.id, panelId()))}
    onRefresh={refresh}
    loading={$directory$.status === 'loading'}
    hasMore={$directory$.hasMore}
    error={$directory$.error}
    onLoadMore={() => store.dispatch(discussionDirectoryRequested(resolvedWorkspaceId, true))}
  />
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
