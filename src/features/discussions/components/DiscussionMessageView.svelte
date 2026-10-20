<script lang="ts">
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import type { DiscussionAgentMention } from '../discussion-agent-mentions';
  import { discussionReplyFirstLine } from '../discussion-message-content';
  import DiscussionCollapsibleBody from './DiscussionCollapsibleBody.svelte';
  import type { Snippet } from 'svelte';
  import Fa from 'svelte-fa';
  import { faReply, faEllipsisVertical, faCopy } from '@fortawesome/free-solid-svg-icons';
  import ThumbsUpIcon from 'phosphor-svelte/lib/ThumbsUpIcon';
  import SmileyIcon from 'phosphor-svelte/lib/SmileyIcon';
  import { Button } from '$lib/components/ui/button';
  import { ActionMenu, defineActions } from '$lib/components/patterns/action-menu';
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
  import { formatTime, formatFullDateTime, formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { DiscussionMessage } from '$shared/types/workspace-discussion';
  import type { DiscussionPendingDisplay, DiscussionReactionDisplay } from './discussion-display';
  import DiscussionMessageBody from './DiscussionMessageBody.svelte';

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
  const hasActions = $derived(!status && !!(onReply || onReaction || onCopy));
  let actionWidth = $state(0);
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
  class:continuation-actions={continuation && hasActions}
  style:--discussion-actions-width={`${actionWidth}px`}
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
      <div
        class="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-border bg-muted"
        data-discussion-agent-avatar
      >
        <AgentAvatar
          agentId={message.author.agentId}
          variant="emphasized"
          ariaLabel={m.workspace_fileChanges_agent_label()}
        />
      </div>
    {:else}
      <PrincipalAvatar label={name} avatarUrl={message.author.avatarUrl} size={30} />
    {/if}
    <div class="flex min-w-0 flex-1 flex-col gap-1.5">
      {#if !continuation}
        <div class="flex min-w-0 flex-wrap items-center gap-1 type-caption">
          <span class="truncate font-medium text-foreground">{name}</span>
          {#if message.author.agentId}<Badge
              size="compact"
              class="h-4 rounded-[5px] px-[5px] text-[10px] leading-[14px] text-muted-foreground"
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
      {#if reactions.length}
        <div class="flex flex-wrap gap-1.5" data-discussion-reactions>
          {#each reactions as reaction (reaction.emoji)}
            <Button
              variant={reaction.reacted ? 'primary' : 'outline'}
              size="compact"
              class="h-[26px] rounded-full px-2"
              aria-pressed={reaction.reacted}
              aria-label={m.workspace_discussion_reaction_label({
                emoji: reaction.emoji,
                count: formatInteger(reaction.count),
              })}
              disabled={disabled || !onReaction}
              onclick={() => onReaction?.(reaction.emoji)}
              ><span aria-hidden="true"
                >{#if reaction.emoji === '👍'}<ThumbsUpIcon size={14} />{:else}<SmileyIcon
                    size={14}
                  />{/if}</span
              ><span>{formatInteger(reaction.count)}</span></Button
            >
          {/each}
        </div>
      {/if}
    </div>
  </div>
  {#if hasActions}
    <div
      class="absolute top-0.5 right-2 z-10 flex gap-0.5 rounded-lg border border-border bg-popover p-0.5 shadow-md pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100 group-hover/message:pointer-events-auto group-hover/message:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
      data-discussion-message-actions
      bind:clientWidth={actionWidth}
    >
      {#if onReaction}
        <ActionMenu
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
              aria-label={m.workspace_discussion_react_label()}><SmileyIcon size={15} /></Button
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
  {/if}
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
  .continuation-actions:is(:hover, :has([data-discussion-message-actions]:focus-within))
    .discussion-text::before,
  .continuation-actions:is(:hover, :has([data-discussion-message-actions]:focus-within))
    :global(.markdown-viewer)::before {
    content: '';
    float: right;
    width: calc(var(--discussion-actions-width) + 8px);
    height: 20px;
  }

  @media (hover: none) {
    .continuation-actions .discussion-text::before,
    .continuation-actions :global(.markdown-viewer)::before {
      content: '';
      float: right;
      width: calc(var(--discussion-actions-width) + 8px);
      height: 20px;
    }
  }
</style>
