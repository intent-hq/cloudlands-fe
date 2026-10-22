<script lang="ts">
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import type { DiscussionAgentMention } from '../discussion-agent-mentions';
  import { discussionReplyFirstLine } from '../discussion-message-content';
  import { openDiscussionReference } from '../discussion-reference-navigation';
  import DiscussionCollapsibleBody from './DiscussionCollapsibleBody.svelte';
  import type { Snippet } from 'svelte';
  import Fa from 'svelte-fa';
  import { faReply, faEllipsisVertical, faCopy } from '@fortawesome/free-solid-svg-icons';
  import SmileyIcon from 'phosphor-svelte/lib/SmileyIcon';
  import { Button } from '$lib/components/ui/button';
  import { ActionMenu, defineActions } from '$lib/components/patterns/action-menu';
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
  import { formatTime, formatFullDateTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { DiscussionMessage } from '$shared/types/workspace-discussion';
  import type { DiscussionPendingDisplay, DiscussionReactionDisplay } from './discussion-display';
  import DiscussionMessageBody from './DiscussionMessageBody.svelte';
  import DiscussionReactionPicker from './DiscussionReactionPicker.svelte';
  import DiscussionReactionChips from './DiscussionReactionChips.svelte';
  import { discussionActionOverlay } from './discussion-action-overlay';

  let {
    message,
    workspaceId,
    sourcePanelId,
    continuation = false,
    replySelected = false,
    onReplyNavigate,
    agentMentions = [],
    mentionNames = [],
    status,
    error,
    reactions = [],
    expandedReactions = false,
    references,
    onRetry,
    onReply,
    onReaction,
    onCopy,
    disabled = false,
  }: {
    message: DiscussionMessage | DiscussionPendingDisplay;
    workspaceId?: string;
    sourcePanelId?: string;
    continuation?: boolean;
    replySelected?: boolean;
    onReplyNavigate?: (messageId: string) => void;
    agentMentions?: readonly DiscussionAgentMention[];
    mentionNames?: readonly string[];
    status?: 'sending' | 'failed';
    error?: string;
    reactions?: readonly DiscussionReactionDisplay[];
    expandedReactions?: boolean;
    references?: Snippet;
    onRetry?: () => void;
    onReply?: () => void;
    onReaction?: (emoji: string) => void;
    onCopy?: () => void;
    disabled?: boolean;
  } = $props();
  const name = $derived(
    message.author.displayName ||
      message.author.login ||
      m.workspace_discussion_unknownAuthor_label(),
  );
  const reply = $derived('replyTo' in message ? message.replyTo : undefined);
  const isAgent = $derived(!!message.author.agentId);
  function openAuthor(event: MouseEvent) {
    if (!workspaceId || !message.author.agentId) return;
    void openDiscussionReference(
      {
        kind: 'agent',
        label: name,
        url: `intent://local/${workspaceId}/agent/${message.author.agentId}`,
      },
      workspaceId,
      sourcePanelId,
      event,
    );
  }
  const hasActions = $derived(!status && !!(onReply || onReaction || onCopy));
  let reactionMenuOpen = $state(false);
  let moreMenuOpen = $state(false);
  let chipPickerOpen = $state(false);
  const replyName = $derived(
    reply?.author.displayName ||
      reply?.author.login ||
      m.workspace_discussion_unknownAuthor_label(),
  );
  const reactionActions = $derived(
    defineActions(['👍', '🙂'].map((emoji) => ({ id: emoji, label: emoji }))),
  );
  const moreActions = $derived(
    defineActions([
      {
        id: 'copy',
        label: m.workspace_discussion_copyMessage_label(),
        icon: faCopy,
        when: !!onCopy,
      },
    ]),
  );
</script>

<article
  class={'group/message relative min-w-0 rounded-[10px] px-2 ' +
    (continuation ? 'py-1' : 'py-[7px]') +
    (replySelected ? ' bg-primary/10' : '')}
  class:opacity-60={status === 'sending'}
  class:actions-open={reactionMenuOpen || moreMenuOpen || chipPickerOpen}
  data-discussion-message={message.id}
  data-discussion-failed={status === 'failed' ? message.id : undefined}
  data-discussion-continuation={continuation || undefined}
  data-discussion-reply-selected={replySelected || undefined}
  tabindex="-1"
>
  {#if reply}
    <div
      class="mb-0.5 flex h-[18px] min-w-0 items-end gap-1.5 pl-[15px]"
      data-discussion-reply-to={reply.id}
    >
      <span
        class="h-[9px] w-[22px] shrink-0 rounded-tl-md border-l border-t border-border"
        aria-hidden="true"
      ></span>
      <Button
        variant="plain"
        size="compact"
        wrapContent={false}
        class="h-[18px] min-w-0 flex-1 justify-start gap-1.5 text-muted-foreground"
        disabled={!onReplyNavigate}
        onclick={() => onReplyNavigate?.(reply.id)}
        aria-label={m.workspace_discussion_jumpToReply_label({ name: replyName })}
      >
        {#if reply.author.agentId}<AgentAvatar
            agentId={reply.author.agentId}
            variant="compact"
          />{:else}<PrincipalAvatar
            label={replyName}
            avatarUrl={reply.author.avatarUrl}
            size={13}
          />{/if}
        <span class="max-w-[40%] shrink-0 truncate font-medium">{replyName}</span>
        <span class="min-w-0 truncate">{discussionReplyFirstLine(reply.body)}</span>
      </Button>
    </div>
  {/if}
  <div class="flex min-w-0 items-start gap-3">
    {#if continuation}
      <div class={isAgent ? 'w-8 shrink-0' : 'w-[30px] shrink-0'} aria-hidden="true"></div>
    {:else if isAgent}
      <Button
        variant="ghost"
        size="icon"
        class="size-8 rounded-[10px] border border-border bg-muted"
        data-discussion-agent-avatar
        disabled={!workspaceId}
        aria-label={m.chat_msgAttribution_openAgent_title({ name })}
        onclick={openAuthor}
      >
        <AgentAvatar
          agentId={message.author.agentId}
          variant="emphasized"
          ariaLabel={m.workspace_fileChanges_agent_label()}
        />
      </Button>
    {:else}
      <PrincipalAvatar label={name} avatarUrl={message.author.avatarUrl} size={30} />
    {/if}
    <div class="relative flex min-w-0 flex-1 flex-col gap-1.5" data-discussion-message-content>
      {#if !continuation}
        <div class="flex min-w-0 flex-wrap items-center gap-1 type-caption">
          {#if isAgent}
            <Button
              variant="plain"
              size="compact"
              class="h-auto min-w-0 shrink font-medium text-foreground hover:underline"
              disabled={!workspaceId}
              aria-label={m.chat_msgAttribution_openAgent_title({ name })}
              onclick={openAuthor}>{name}</Button
            >
          {:else}
            <span class="truncate font-medium text-foreground">{name}</span>
          {/if}
          {#if message.author.agentId}<Badge
              size="compact"
              class="h-4 rounded-[5px] px-[5px] leading-[14px] text-muted-foreground"
              data-discussion-agent-author>{m.workspace_fileChanges_agent_label()}</Badge
            >{/if}
          <span class="text-muted-foreground" aria-hidden="true">·</span>
          <time
            class="text-muted-foreground"
            datetime={message.createdAt}
            title={formatFullDateTime(message.createdAt)}>{formatTime(message.createdAt)}</time
          >
          {#if status}
            <span class="text-muted-foreground" aria-hidden="true">·</span>
            {#if status === 'sending'}
              <span class="text-muted-foreground" role="status"
                >{m.workspace_discussion_sending_label()}</span
              >
            {:else}
              <span class="text-danger" role="alert" title={error}
                >{m.workspace_discussion_notSent_label()}</span
              >
              <span class="text-danger" aria-hidden="true">·</span>
              <Button
                variant="plain"
                size="compact"
                class="h-auto text-danger"
                {disabled}
                onclick={onRetry}>{m.ui_errorToast_retry_label()}</Button
              >
            {/if}
          {/if}
        </div>
      {:else}
        <span class="sr-only">{name} · {formatTime(message.createdAt)}</span>
      {/if}

      <div>
        <div
          class={isAgent
            ? 'flex min-w-0 flex-col rounded-[15px] border border-border bg-background px-[15px] py-2.5'
            : 'flex min-w-0 flex-col rounded-[15px] bg-muted/30 px-[15px] py-2.5 dark:bg-muted'}
          class:border-danger={status === 'failed'}
          class:border={isAgent || status === 'failed'}
          data-discussion-bubble={isAgent ? 'agent' : 'human'}
        >
          {#if isAgent}
            {#key message.id + ':' + message.body}
              <DiscussionCollapsibleBody>
                <div class="type-caption leading-5 text-foreground [overflow-wrap:anywhere]">
                  <DiscussionMessageBody
                    body={message.body}
                    workspaceId={workspaceId ?? ''}
                    {sourcePanelId}
                    {agentMentions}
                    {mentionNames}
                    mode="markdown"
                  />
                </div>
                {#snippet footer()}{@render messageReferences()}{/snippet}
              </DiscussionCollapsibleBody>
            {/key}
          {:else}
            <p
              class="discussion-text m-0 flow-root whitespace-pre-wrap type-caption leading-5 text-foreground [overflow-wrap:anywhere]"
            >
              <DiscussionMessageBody
                body={message.body}
                workspaceId={workspaceId ?? ''}
                {sourcePanelId}
                {agentMentions}
                {mentionNames}
                mode="text"
              />
            </p>
            {@render messageReferences()}
          {/if}
        </div>
        {#if hasActions}
          <div class="discussion-actions-reveal" use:discussionActionOverlay>
            <div
              class="discussion-actions flex gap-0.5 rounded-lg border border-border bg-popover p-0.5 shadow-sm"
              data-discussion-message-actions
            >
              {#if onReaction && expandedReactions}
                <DiscussionReactionPicker
                  bind:open={reactionMenuOpen}
                  {disabled}
                  {onReaction}
                  {reactions}
                />
              {:else if onReaction}
                <ActionMenu
                  bind:open={reactionMenuOpen}
                  actions={reactionActions}
                  ariaLabel={m.workspace_discussion_react_label()}
                  onAction={(emoji) => onReaction?.(emoji)}
                >
                  {#snippet trigger({ props })}<Button
                      {...props}
                      variant="ghost"
                      size="icon-compact"
                      class="size-6"
                      {disabled}
                      aria-label={m.workspace_discussion_react_label()}
                      ><SmileyIcon size={15} /></Button
                    >{/snippet}
                </ActionMenu>
              {/if}
              {#if onReply}<Button
                  variant="ghost"
                  size="icon-compact"
                  class="size-6"
                  {disabled}
                  aria-label={m.workspace_discussion_reply_label()}
                  onclick={onReply}><Fa icon={faReply} /></Button
                >{/if}
              {#if onCopy}
                <ActionMenu
                  bind:open={moreMenuOpen}
                  actions={moreActions}
                  ariaLabel={m.workspace_discussion_messageActions_label()}
                  onAction={() => onCopy?.()}
                >
                  {#snippet trigger({ props })}<Button
                      {...props}
                      variant="ghost"
                      size="icon-compact"
                      class="size-6"
                      aria-label={m.workspace_discussion_messageActions_label()}
                      ><Fa icon={faEllipsisVertical} /></Button
                    >{/snippet}
                </ActionMenu>
              {/if}
            </div>
          </div>
        {/if}
      </div>
      <DiscussionReactionChips
        {reactions}
        {expandedReactions}
        {disabled}
        {onReaction}
        bind:open={chipPickerOpen}
      />
    </div>
  </div>
</article>

{#snippet messageReferences()}
  <div class="hidden has-[>_*]:mt-2 has-[>_*]:block" data-discussion-message-references>
    {#if references}{@render references()}{/if}
    {#if workspaceId}<DiscussionMessageBody
        body={message.body}
        {workspaceId}
        {sourcePanelId}
        mode="references"
      />{/if}
  </div>
{/snippet}

<style>
  .discussion-actions-reveal {
    position: absolute;
    top: 100%;
    right: 0;
    padding-top: 4px;
    pointer-events: none;
  }

  .discussion-actions {
    opacity: 0;
    transform: translateY(-4px);
    pointer-events: none;
    transition:
      opacity var(--spring-fast-exit) var(--spring-fast-ease),
      transform var(--spring-fast-exit) var(--spring-fast-ease);
  }

  article:is(:hover, :focus-within, .actions-open) {
    z-index: 20;
  }

  article:is(:hover, :focus-within, .actions-open) .discussion-actions-reveal {
    pointer-events: auto;
  }

  article:is(:hover, :focus-within, .actions-open) .discussion-actions {
    opacity: 1;
    transform: none;
    pointer-events: auto;
    transition-duration: var(--spring-fast);
  }

  @media (hover: none) {
    .discussion-actions-reveal {
      pointer-events: auto;
    }

    .discussion-actions {
      opacity: 1;
      transform: none;
      pointer-events: auto;
    }
  }

  @container style(--motion-reduced: 1) {
    .discussion-actions {
      transition: none;
      transform: none;
    }
  }
</style>
