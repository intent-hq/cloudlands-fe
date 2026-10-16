<script lang="ts">
  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import WorkspaceDiscussion from '$features/discussions/components/WorkspaceDiscussion.svelte';
  import { discussionTitle } from '$features/discussions/discussion-title';
  import { store } from '$store/renderer/store';
  import { selectDiscussionConversations } from '$store/renderer/slices/workspace-discussion/workspace-discussion-selectors';
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
  const principal$ = selectPrincipalSnapshot();
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

{#key `${resolvedWorkspaceId}:${conversationId}`}
  <WorkspaceDiscussion
    workspaceId={resolvedWorkspaceId}
    {conversationId}
    {isActive}
    {isPanelFocused}
  />
{/key}
