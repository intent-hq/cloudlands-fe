<script lang="ts">
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
  class="group/message relative flex min-w-0 items-start gap-3"
  class:opacity-60={status === 'sending'}
  data-discussion-message={message.id}
  data-discussion-failed={status === 'failed' ? message.id : undefined}
  data-discussion-continuation={continuation || undefined}
>
  {#if continuation}
    <div class="w-8 shrink-0" aria-hidden="true"></div>
  {:else}
    <PrincipalAvatar label={name} avatarUrl={message.author.avatarUrl} size={32} />
  {/if}
  <div class="flex min-w-0 flex-1 flex-col gap-1.5">
    {#if !continuation}
      <div class="flex min-w-0 flex-wrap items-center gap-1 type-caption leading-[18px]">
        <span class="truncate font-medium text-foreground text-[12px]">{name}</span>
        <span class="text-muted-foreground text-[11px]" aria-hidden="true">·</span>
        <time
          class="text-muted-foreground text-[11px]"
          datetime={message.createdAt}
          title={formatFullDateTime(message.createdAt)}>{formatTime(message.createdAt)}</time
        >
        {#if status}
          <span class="text-muted-foreground text-[11px]" aria-hidden="true">·</span>
          {#if status === 'sending'}
            <span class="text-muted-foreground text-[11px]" role="status"
              >{m.workspace_discussion_sending_label()}</span
            >
          {:else}
            <span class="text-danger text-[11px]" role="alert" title={error}
              >{m.workspace_discussion_notSent_label()}</span
            >
            <span class="text-danger text-[11px]" aria-hidden="true">·</span>
            <Button
              variant="plain"
              size="compact"
              class="h-auto text-danger text-[11px]"
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
      class="relative rounded-lg bg-muted/30 px-3 py-2 dark:bg-muted group-hover/message:bg-hover"
      class:border-danger={status === 'failed'}
      class:border={status === 'failed'}
    >
      {#if reply}
        <blockquote
          class="mb-2 border-l-2 border-muted-foreground pl-2 type-caption text-muted-foreground"
          data-discussion-reply-to={reply.id}
        >
          <span class="font-medium"
            >{reply.author.displayName ||
              reply.author.login ||
              m.workspace_discussion_unknownAuthor_label()}</span
          >
          <p class="m-0 line-clamp-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{reply.body}</p>
        </blockquote>
      {/if}
      <p
        class="m-0 whitespace-pre-wrap type-caption leading-5 text-foreground [overflow-wrap:anywhere]"
      >
        {#if workspaceId}<DiscussionMessageBody
            body={message.body}
            {workspaceId}
            {sourcePanelId}
            mode="text"
          />{:else}{message.body}{/if}
      </p>
      {#if !status && (onReply || onReaction || onCopy)}
        <div
          class="absolute -top-9 right-1 z-10 flex gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-md opacity-0 focus-within:opacity-100 group-hover/message:opacity-100 [@media(hover:none)]:opacity-100"
          data-discussion-message-actions
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
                  class="size-[26px]"
                  {disabled}
                  aria-label={m.workspace_discussion_react_label()}><SmileyIcon size={15} /></Button
                >{/snippet}
            </ActionMenu>
          {/if}
          {#if onReply}<Button
              variant="ghost"
              size="icon-compact"
              class="size-[26px]"
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
                  class="size-[26px]"
                  aria-label={m.workspace_discussion_messageActions_label()}
                  ><Fa icon={faEllipsisVertical} /></Button
                >{/snippet}
            </ActionMenu>
          {/if}
        </div>
      {/if}
    </div>
    {#if references}{@render references()}{/if}
    {#if workspaceId}<DiscussionMessageBody
        body={message.body}
        {workspaceId}
        {sourcePanelId}
        mode="references"
      />{/if}
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
</article>
