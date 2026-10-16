<script lang="ts">
  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import { m } from '$shared/paraglide/messages.js';
  import type { DiscussionError } from '$shared/types/workspace-discussion';
  import { EmptyState } from '$lib/components/patterns/screen';
  import { store } from '$store/renderer/store';
  import { selectLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import {
    selectWorkspaceDiscussion,
    selectDiscussionMessages,
    selectDiscussionReady,
    selectDiscussionContext,
    selectDiscussionPending,
  } from '$store/renderer/slices/workspace-discussion/workspace-discussion-selectors';
  import {
    discussionRequested,
    discussionOlderRequested,
    discussionDraftChanged,
    discussionSendRequested,
    discussionRetryRequested,
  } from '$store/renderer/slices/workspace-discussion/workspace-discussion-slice';
  import {
    presenceDiscussionComposerFocused,
    presenceDiscussionTypingPulse,
    presenceDiscussionTypingStopped,
  } from '$store/renderer/slices/presence/presence-slice';
  import { selectDiscussionTypingPeople } from '$store/renderer/slices/presence/presence-selectors';
  import { presenceTypingLabel } from '$features/presence/components/presence-person';
  import DiscussionThread from './DiscussionThread.svelte';

  let {
    workspaceId,
    isActive = true,
    isPanelFocused = false,
  }: { workspaceId: string; isActive?: boolean; isPanelFocused?: boolean } = $props();
  const workspaceId$ = writable('');
  $effect(() => workspaceId$.set(workspaceId));
  const discussion$ = selectWorkspaceDiscussion(workspaceId$);
  const messages$ = selectDiscussionMessages(workspaceId$);
  const pending$ = selectDiscussionPending(workspaceId$);
  const typing$ = selectDiscussionTypingPeople(workspaceId$);
  const context$ = selectDiscussionContext();
  const ready$ = selectDiscussionReady(workspaceId$);
  const multiplayer$ = selectLabsMultiplayerEnabled();

  $effect(() => {
    const id = workspaceId;
    if (isActive && $context$ && $multiplayer$) {
      untrack(() => store.dispatch(discussionRequested(id)));
    }
  });

  function errorText(error: DiscussionError | null, sending = false) {
    if (!error) return null;
    if (error === 'unsupported') return m.workspace_discussion_unsupported_label();
    if (error === 'forbidden') return m.workspace_discussion_forbidden_label();
    if (error === 'invalid') return m.workspace_discussion_invalid_label();
    return sending ? m.workspace_discussion_send_error() : m.workspace_discussion_load_error();
  }
</script>

{#if $multiplayer$}
  <DiscussionThread
    messages={$messages$}
    typingLabel={presenceTypingLabel($typing$)}
    onComposerFocusChange={(focused) =>
      store.dispatch(presenceDiscussionComposerFocused(workspaceId, focused))}
    onTypingInput={(typing) =>
      store.dispatch(
        typing
          ? presenceDiscussionTypingPulse(workspaceId)
          : presenceDiscussionTypingStopped(workspaceId),
      )}
    draft={$discussion$.draft}
    initialized={$discussion$.initialized}
    loading={$discussion$.loading}
    loadingOlder={$discussion$.loadingOlder}
    hasMore={$discussion$.hasMore}
    error={errorText($discussion$.error)}
    sendError={errorText(
      $pending$.find(
        (message) => message.status === 'failed' && message.body === $discussion$.draft,
      )?.error ?? null,
      true,
    )}
    sending={$discussion$.sending}
    failedMessages={$pending$
      .filter((message) => message.status === 'failed' && message.body !== $discussion$.draft)
      .map((message) => ({
        id: message.id,
        body: message.body,
        error: errorText(message.error, true) ?? m.workspace_discussion_send_error(),
      }))}
    onRetryMessage={(id) => store.dispatch(discussionRetryRequested(workspaceId, id))}
    canSend={$ready$ && !$discussion$.unsupported && $discussion$.error !== 'forbidden'}
    {isActive}
    {isPanelFocused}
    onDraftChange={(body) => store.dispatch(discussionDraftChanged(workspaceId, body))}
    onSend={() => store.dispatch(discussionSendRequested(workspaceId))}
    onLoadOlder={() => store.dispatch(discussionOlderRequested(workspaceId))}
    onRetry={() =>
      store.dispatch(
        $messages$.length && $discussion$.hasMore && !$discussion$.catchUp
          ? discussionOlderRequested(workspaceId)
          : discussionRequested(workspaceId),
      )}
  />
{:else}
  <EmptyState density="compact">
    {#snippet description()}{m.workspace_discussion_unavailable_label()}{/snippet}
  </EmptyState>
{/if}
