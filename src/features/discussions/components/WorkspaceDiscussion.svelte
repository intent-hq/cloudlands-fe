<script lang="ts">
  import { AgentStatus } from '$shared/types/agent.types';
  import {
    fetchDelegatedAgentsRequested,
    fetchBackgroundAgentsRequested,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import { m } from '$shared/paraglide/messages.js';
  import type { DiscussionError } from '$shared/types/workspace-discussion';
  import { EmptyState, ErrorState } from '$lib/components/patterns/screen';
  import { notify } from '$lib/components/patterns/notify';
  import { writeTextToClipboard } from '$lib/utils/clipboard';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { store } from '$store/renderer/store';
  import { selectLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import {
    selectWorkspaceDiscussion,
    selectDiscussionAgentMessagingSupported,
    selectDiscussionMessages,
    selectDiscussionCanSend,
    selectDiscussionUnread,
    selectDiscussionTarget,
    selectDiscussionReply,
    selectDiscussionCanInteract,
    selectDiscussionSharingOff,
    selectDiscussionCanEnableSharing,
    selectDiscussionContext,
    selectDiscussionPending,
    selectDiscussionRecipientsForComposer,
    selectDiscussionRecipients,
    selectDiscussionCanCreate,
  } from '$store/renderer/slices/workspace-discussion/workspace-discussion-selectors';
  import {
    discussionReadThrough,
    discussionAgentSelected,
    discussionAgentRemoved,
    discussionReplySelected,
    discussionReactionRequested,
    discussionEnableSharingRequested,
    discussionRequested,
    discussionOlderRequested,
    discussionDraftChanged,
    discussionSendRequested,
    discussionRetryRequested,
    discussionRecipientsChanged,
    discussionRecipientsRequested,
  } from '$store/renderer/slices/workspace-discussion/workspace-discussion-slice';
  import {
    presenceDiscussionComposerFocused,
    presenceDiscussionTypingPulse,
    presenceDiscussionTypingStopped,
  } from '$store/renderer/slices/presence/presence-slice';
  import { selectDiscussionTypingPeople } from '$store/renderer/slices/presence/presence-selectors';
  import { presenceTypingLabel } from '$features/presence/components/presence-person';
  import DiscussionThread from './DiscussionThread.svelte';
  import DiscussionRecipients from './DiscussionRecipients.svelte';

  let {
    workspaceId,
    sourcePanelId,
    conversationId = 'default',
    isActive = true,
    isPanelFocused = false,
  }: {
    workspaceId: string;
    sourcePanelId?: string;
    conversationId?: string;
    isActive?: boolean;
    isPanelFocused?: boolean;
  } = $props();
  const workspaceId$ = writable('');
  const conversationId$ = writable('default');
  $effect(() => workspaceId$.set(workspaceId));
  $effect(() => conversationId$.set(conversationId));
  const agents$ = selectAllWorkspaceAgents(workspaceId$);
  const agentMessaging$ = selectDiscussionAgentMessagingSupported();
  const discussion$ = selectWorkspaceDiscussion(workspaceId$, conversationId$);
  const messages$ = selectDiscussionMessages(workspaceId$, conversationId$);
  const pending$ = selectDiscussionPending(workspaceId$, conversationId$);
  const typing$ = selectDiscussionTypingPeople(workspaceId$, conversationId$);
  const recipients$ = selectDiscussionRecipients(workspaceId$);
  const composerRecipients$ = selectDiscussionRecipientsForComposer(workspaceId$, conversationId$);
  const canCreate$ = selectDiscussionCanCreate(workspaceId$);
  const context$ = selectDiscussionContext();
  const ready$ = selectDiscussionCanSend(workspaceId$, conversationId$);
  const unread$ = selectDiscussionUnread(workspaceId$, conversationId$);
  const target$ = selectDiscussionTarget(workspaceId$, conversationId$);
  const reply$ = selectDiscussionReply(workspaceId$, conversationId$);
  const canInteract$ = selectDiscussionCanInteract(workspaceId$, conversationId$);
  const sharingOff$ = selectDiscussionSharingOff();
  const canEnableSharing$ = selectDiscussionCanEnableSharing(workspaceId$);
  const multiplayer$ = selectLabsMultiplayerEnabled();
  const composerNames = $derived(
    $composerRecipients$.map(
      (person) =>
        person.displayName || person.login || m.workspace_discussion_unknownAuthor_label(),
    ),
  );
  const composerPlaceholder = $derived(
    composerNames.length === 1
      ? m.workspace_discussion_composerPerson_placeholder({ name: composerNames[0] })
      : composerNames.length === 2
        ? m.workspace_discussion_composerPair_placeholder({
            first: composerNames[0],
            second: composerNames[1],
          })
        : undefined,
  );
  const isNew = $derived(conversationId === 'new');
  const recipientProfiles = $derived([
    ...$recipients$.members,
    ...$recipients$.selectedMembers.filter(
      (person) => !$recipients$.members.some((member) => member.principalId === person.principalId),
    ),
  ]);

  $effect(() => {
    const id = workspaceId;
    const conversation = conversationId;
    if (isActive && $context$ && $multiplayer$) {
      untrack(() => {
        store.dispatch(discussionRequested(id, conversation));
        if (conversation === 'new') store.dispatch(discussionRecipientsRequested(id));
      });
    }
  });

  function errorText(error: DiscussionError | null, sending = false) {
    if (!error) return null;
    if (sending && isNew && (error === 'invalid' || error === 'forbidden'))
      return m.workspace_discussion_create_error();
    if (error === 'unsupported') return m.workspace_discussion_unsupported_label();
    if (error === 'forbidden') return m.workspace_discussion_forbidden_label();
    if (error === 'invalid') return m.workspace_discussion_invalid_label();
    return sending ? m.workspace_discussion_send_error() : m.workspace_discussion_load_error();
  }
</script>

{#if $multiplayer$}
  <DiscussionThread
    {workspaceId}
    {conversationId}
    {sourcePanelId}
    messages={$messages$}
    agents={$agents$
      .filter((agent) => !agent.retiredAt && agent.status !== AgentStatus.Deleted)
      .map((agent) => ({
        id: agent.id,
        name: agent.name || m.workspace_fileChanges_agent_label(),
      }))}
    agentsSupported={$agentMessaging$ === true && conversationId === 'default'}
    agentsUnsupported={$agentMessaging$ === false}
    onAgentPickerOpen={() => {
      store.dispatch(fetchDelegatedAgentsRequested(workspaceId));
      store.dispatch(fetchBackgroundAgentsRequested(workspaceId));
    }}
    agentMentions={$discussion$.agentMentions}
    onAgentSelect={conversationId === 'default'
      ? (agent, start, end) =>
          store.dispatch(
            discussionAgentSelected(workspaceId, agent.id, agent.name, start, end, conversationId),
          )
      : undefined}
    onAgentRemove={(id) => store.dispatch(discussionAgentRemoved(workspaceId, id, conversationId))}
    pendingMessages={$pending$.flatMap((message) =>
      message.author && message.createdAt
        ? [
            {
              id: message.id,
              body: message.body,
              recipientAgentIds: message.recipientAgentIds,
              agentMentions: message.agentMentions,
              author: message.author,
              createdAt: message.createdAt,
              status: message.status,
              ...(message.replyTo ? { replyTo: message.replyTo } : {}),
              ...(message.error
                ? {
                    error:
                      message.error === 'unsupported' && message.recipientAgentIds?.length
                        ? m.workspace_discussion_agentsUnsupported_label()
                        : (errorText(message.error, true) ?? undefined),
                  }
                : {}),
            },
          ]
        : [],
    )}
    typingAuthors={$typing$}
    reactionsByMessage={Object.fromEntries(
      $messages$.map((message) => [
        message.id,
        (message.reactions ?? []).map((r) => ({
          emoji: r.reaction,
          count: r.count,
          reacted: r.reacted,
        })),
      ]),
    )}
    unreadAfterSequence={$unread$.count > 0 ? $discussion$.readSequence : null}
    unreadCount={$unread$.count}
    firstUnreadSequence={$unread$.firstSequence}
    onReadThrough={(sequence) => {
      if (
        $target$ &&
        isActive &&
        isPanelFocused &&
        document.visibilityState === 'visible' &&
        document.hasFocus()
      )
        store.dispatch(discussionReadThrough($target$, sequence));
    }}
    onReply={$canInteract$
      ? (message) =>
          store.dispatch(discussionReplySelected(workspaceId, message.id, conversationId))
      : undefined}
    onReaction={$canInteract$
      ? (id, emoji) => {
          if (emoji === '👍' || emoji === '🙂')
            store.dispatch(discussionReactionRequested(workspaceId, id, emoji, conversationId));
        }
      : undefined}
    onCopyMessage={(message) =>
      void writeTextToClipboard(message.body).catch(() =>
        notify.error(m.layout_panelTabBar_copyFailed_error()),
      )}
    interactionError={$discussion$.reactionError ? m.workspace_discussion_reaction_error() : null}
    replyTo={$reply$}
    onCancelReply={() => store.dispatch(discussionReplySelected(workspaceId, null, conversationId))}
    sharingOff={$sharingOff$}
    canEnableSharing={$canEnableSharing$}
    onEnableSharing={() => store.dispatch(discussionEnableSharingRequested(workspaceId))}
    showEmptyState={!isNew}
    emptyDescription={conversationId !== 'default'
      ? m.workspace_discussion_selectedEmpty_description()
      : undefined}
    focusComposer={!isNew}
    composerPlaceholder={composerPlaceholder ??
      (isNew || conversationId !== 'default'
        ? m.workspace_discussion_selectedComposer_placeholder()
        : undefined)}
    typingLabel={isNew ? null : presenceTypingLabel($typing$)}
    onComposerFocusChange={(focused) =>
      !isNew &&
      store.dispatch(presenceDiscussionComposerFocused(workspaceId, focused, conversationId))}
    onTypingInput={(typing) =>
      !isNew &&
      store.dispatch(
        typing
          ? presenceDiscussionTypingPulse(workspaceId, conversationId)
          : presenceDiscussionTypingStopped(workspaceId, conversationId),
      )}
    draft={$discussion$.draft}
    initialized={$discussion$.initialized}
    loading={$discussion$.loading}
    loadingOlder={$discussion$.loadingOlder}
    hasMore={$discussion$.hasMore}
    error={isNew && $recipients$.error ? null : errorText($discussion$.error)}
    sendError={$pending$.length === 0 ? errorText($discussion$.sendError, true) : null}
    retryDraft={false}
    sending={$discussion$.sending}
    failedMessages={$pending$
      .filter((message) => message.status === 'failed' && message.body !== $discussion$.draft)
      .map((message) => ({
        id: message.id,
        body: message.body,
        error: errorText(message.error, true) ?? m.workspace_discussion_send_error(),
      }))}
    onRetryMessage={(id) =>
      store.dispatch(discussionRetryRequested(workspaceId, id, conversationId))}
    canCompose={$ready$ && (!isNew || $canCreate$)}
    canSendDraft={!isNew ||
      !$discussion$.recipientsLocked ||
      $pending$.some((message) => message.body === $discussion$.draft)}
    canSend={$ready$ &&
      !$discussion$.unsupported &&
      $discussion$.error !== 'forbidden' &&
      (!isNew || ($canCreate$ && $discussion$.recipientPrincipalIds.length > 0))}
    {isActive}
    {isPanelFocused}
    onDraftChange={(body) =>
      store.dispatch(discussionDraftChanged(workspaceId, body, conversationId))}
    onSend={() => store.dispatch(discussionSendRequested(workspaceId, conversationId))}
    onLoadOlder={() => store.dispatch(discussionOlderRequested(workspaceId, conversationId))}
    onRetry={() =>
      store.dispatch(
        $messages$.length && $discussion$.hasMore && !$discussion$.catchUp
          ? discussionOlderRequested(workspaceId, conversationId)
          : discussionRequested(workspaceId, conversationId),
      )}
  >
    {#snippet header()}
      {#if isNew}
        <DiscussionRecipients
          members={recipientProfiles}
          selectedIds={$discussion$.recipientPrincipalIds}
          onChange={(ids) => store.dispatch(discussionRecipientsChanged(workspaceId, ids))}
          loading={$recipients$.status === 'loading'}
          disabled={$discussion$.recipientsLocked || !$canCreate$}
          autofocus={isActive && isPanelFocused}
          onSearch={(query) => store.dispatch(discussionRecipientsRequested(workspaceId, query))}
          hasMore={$recipients$.hasMore}
          onLoadMore={() =>
            store.dispatch(discussionRecipientsRequested(workspaceId, $recipients$.query, true))}
        />
        {#if $recipients$.error}
          <ErrorState
            density="compact"
            onRetry={() =>
              store.dispatch(discussionRecipientsRequested(workspaceId, $recipients$.query))}
            retryLabel={m.ui_errorToast_retry_label()}
          >
            {#snippet message()}{$recipients$.error === 'unsupported'
                ? m.workspace_discussion_multipleUnsupported_label()
                : $recipients$.error === 'forbidden'
                  ? m.workspace_discussion_forbidden_label()
                  : m.workspace_discussion_members_error()}{/snippet}
          </ErrorState>
        {/if}
        {#if $discussion$.recipientsLocked}<p class="px-4 pt-2 type-caption text-muted-foreground">
            {m.workspace_discussion_recipientsLocked_label()}
          </p>{/if}
      {/if}
    {/snippet}
  </DiscussionThread>
{:else}
  <EmptyState density="compact">
    {#snippet description()}{m.workspace_discussion_unavailable_label()}{/snippet}
  </EmptyState>
{/if}
