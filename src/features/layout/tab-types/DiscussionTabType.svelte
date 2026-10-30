<script lang="ts">
  import * as Menu from '$lib/components/ui/menu';
  import { untrack } from 'svelte';
  import { prompt, confirm } from '$lib/components/patterns/confirm';
  import { notify } from '$lib/components/patterns/notify';
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
    selectDiscussionCanCreate,
    selectDiscussionCanRename,
    selectDiscussionCanDelete,
    selectDiscussionManagementPending,
    selectDiscussionContext,
  } from '$store/renderer/slices/workspace-discussion/workspace-discussion-selectors';
  import {
    discussionDirectoryRequested,
    discussionRenameRequested,
    discussionDeleteRequested,
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
  const conversationId$ = writable('default');
  const resolvedWorkspaceId = $derived(tab.workspaceId ?? workspaceId);
  const conversationId = $derived(
    typeof tab.data?.conversationId === 'string' ? tab.data.conversationId : 'default',
  );
  $effect(() => workspaceId$.set(resolvedWorkspaceId));
  $effect(() => conversationId$.set(conversationId));
  const conversations$ = selectDiscussionConversations(workspaceId$);
  const context$ = selectDiscussionContext();
  const canCreate$ = selectDiscussionCanCreate(workspaceId$);
  const canRename$ = selectDiscussionCanRename(workspaceId$, conversationId$);
  const canDelete$ = selectDiscussionCanDelete(workspaceId$, conversationId$);
  const managementPending$ = selectDiscussionManagementPending(workspaceId$, conversationId$);
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
  function renameDiscussion() {
    const id = conversationId;
    const wsId = resolvedWorkspaceId;
    if (!selectDiscussionCanRename.select(store.state, wsId, id)) return;
    const conversation = selectDiscussionConversations
      .select(store.state, wsId)
      .find((item) => item.id === id);
    void prompt({
      title: m.workspace_discussion_rename_label(),
      field: {
        label: m.workspace_discussion_name_label(),
        initialValue: conversation ? discussionTitle(conversation) : tab.title,
        required: true,
      },
      confirmLabel: m.workspace_discussion_renameConfirm_label(),
      onConfirm: (name) =>
        store
          .dispatch(discussionRenameRequested(wsId, id, name))
          .then(() => undefined)
          .catch((error: unknown) => {
            notify.error(m.workspace_discussion_rename_error());
            throw error;
          }),
    });
  }
  function deleteDiscussion() {
    const id = conversationId;
    const wsId = resolvedWorkspaceId;
    if (!selectDiscussionCanDelete.select(store.state, wsId, id)) return;
    void confirm({
      title: m.workspace_discussion_delete_label(),
      description: m.workspace_discussion_delete_description({ name: tab.title }),
      confirmLabel: m.workspace_discussion_deleteConfirm_label(),
      destructive: true,
      onConfirm: () =>
        store
          .dispatch(discussionDeleteRequested(wsId, id))
          .then(() => undefined)
          .catch((error: unknown) => {
            notify.error(m.workspace_discussion_delete_error());
            throw error;
          }),
    });
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
  {#if $canCreate$}
    <Menu.Item onclick={() => selectConversation('new')}
      >{m.workspace_discussion_new_title()}</Menu.Item
    >
  {/if}
  {#if $canRename$}
    <Menu.Item disabled={$managementPending$} onclick={renameDiscussion}
      >{m.workspace_discussion_rename_label()}</Menu.Item
    >
  {/if}
  {#if $canDelete$}
    <Menu.Item destructive disabled={$managementPending$} onclick={deleteDiscussion}
      >{m.workspace_discussion_delete_label()}</Menu.Item
    >
  {/if}
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
