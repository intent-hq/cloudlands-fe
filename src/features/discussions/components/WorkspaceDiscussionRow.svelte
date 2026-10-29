<script lang="ts">
  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import { m } from '$shared/paraglide/messages.js';
  import { store } from '$store/renderer/store';
  import { selectLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { selectPrincipalSnapshot } from '$store/renderer/slices/principal/principal-selectors';
  import {
    selectDiscussionContext,
    selectDiscussionDirectory,
    selectDiscussionConversations,
    selectDiscussionDefaultVisible,
  } from '$store/renderer/slices/workspace-discussion/workspace-discussion-selectors';
  import { discussionDirectoryRequested } from '$store/renderer/slices/workspace-discussion/workspace-discussion-slice';
  import { openWorkspaceDiscussion } from '../discussion-navigation';
  import { discussionTitle } from '../discussion-title';
  import DiscussionList from './DiscussionList.svelte';
  let {
    workspaceId,
    panelLayoutId = workspaceId,
  }: { workspaceId: string; panelLayoutId?: string } = $props();
  const workspaceId$ = writable('');
  $effect(() => workspaceId$.set(workspaceId));
  const multiplayer$ = selectLabsMultiplayerEnabled();
  const context$ = selectDiscussionContext();
  const directory$ = selectDiscussionDirectory(workspaceId$);
  const conversations$ = selectDiscussionConversations(workspaceId$);
  const principal$ = selectPrincipalSnapshot();
  const defaultVisible$ = selectDiscussionDefaultVisible(workspaceId$);
  const defaultConversation = $derived($conversations$.find((item) => item.id === 'default'));
  const rows = $derived([
    ...($defaultVisible$
      ? [
          {
            id: 'default',
            title: defaultConversation
              ? discussionTitle(defaultConversation)
              : m.workspace_discussion_title(),
          },
        ]
      : []),
    ...$conversations$
      .filter((item) => item.id !== 'default')
      .map((item) => ({
        id: item.id,
        title: discussionTitle(item, $principal$?.principal.id),
      })),
  ]);
  $effect(() => {
    const id = workspaceId;
    if ($multiplayer$ && $context$) untrack(() => store.dispatch(discussionDirectoryRequested(id)));
  });
</script>

{#if $multiplayer$}
  <DiscussionList
    {workspaceId}
    {rows}
    onOpen={(id, title) => openWorkspaceDiscussion(workspaceId, panelLayoutId, id, title)}
    loading={$directory$.status === 'loading'}
    error={$directory$.error && $directory$.error !== 'unsupported'
      ? m.workspace_discussion_list_error()
      : null}
    hasMore={$directory$.hasMore}
    onLoadMore={() => store.dispatch(discussionDirectoryRequested(workspaceId, true))}
    onRetry={() => store.dispatch(discussionDirectoryRequested(workspaceId))}
  />
{/if}
