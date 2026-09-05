<!--
  MessageActions.svelte

  Action buttons for chat messages (copy, edit, regenerate, fork, vote).
  Appears on hover for both user and assistant messages.
-->
<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte';
  import { Tooltip, TooltipShortcut } from '$lib/components/ui/tooltip';
  import { formatFullDateTime, formatTime, type DateInput } from '$lib/i18n/format';
  import Fa from 'svelte-fa';
  import {
    faCopy,
    faCheck,
    faPencil,
    faRotateRight,
    faThumbsUp,
    faThumbsDown,
    faCodeBranch,
    faArrowUp,
  } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import {
    MESSAGE_ACTION_REVEAL_CLASS,
    MESSAGE_ACTION_SURFACE_CLASS,
    MESSAGE_ACTION_TIME_CLASS,
    resolveMessageActionDate,
  } from './message-action-surface';

  type MessageRole = 'user' | 'assistant';

  interface Props {
    role: MessageRole;
    onCopy?: () => void;
    onEdit?: () => void;
    onRegenerate?: () => void;
    /** Fork the conversation from this message */
    onFork?: () => void;
    onVote?: (vote: 'up' | 'down') => void;
    currentVote?: 'up' | 'down' | null;
    showOnHover?: boolean;
    class?: string;
    /** Session ID for this message (used for debugging) */
    requestId?: string;
    /** Called when user wants to scroll to previous user message */
    onScrollToPrevious?: () => void;
    /** Canonical message time. */
    timestamp?: DateInput | null;
    /** Legacy fallback when the canonical timestamp is absent or invalid. */
    createdAt?: DateInput | null;
  }

  let {
    role,
    onCopy,
    onEdit,
    onRegenerate,
    onFork,
    onVote,
    currentVote = null,
    showOnHover = true,
    class: className = '',
    requestId,
    onScrollToPrevious,
    timestamp,
    createdAt,
  }: Props = $props();

  let copied = $state(false);
  let copiedSessionId = $state(false);
  let actionDate = $derived(resolveMessageActionDate(timestamp, createdAt));
  let compactTime = $derived(actionDate ? formatTime(actionDate) : '');
  let fullTime = $derived(actionDate ? formatFullDateTime(actionDate) : '');

  async function handleCopy(event: MouseEvent) {
    if (event.shiftKey && requestId) {
      // Shift+click: copy session ID
      await navigator.clipboard.writeText(requestId);
      copiedSessionId = true;
      setTimeout(() => (copiedSessionId = false), 2000);
    } else {
      // Normal click: copy message content
      onCopy?.();
      copied = true;
      setTimeout(() => (copied = false), 2000);
    }
  }

  function handleVote(vote: 'up' | 'down') {
    onVote?.(vote);
  }
</script>

<div
  data-testid="message-actions"
  data-message-actions-role={role}
  class="{MESSAGE_ACTION_SURFACE_CLASS} {showOnHover
    ? MESSAGE_ACTION_REVEAL_CLASS
    : ''} {className}"
>
  {#if actionDate && compactTime && fullTime}
    <time
      class={MESSAGE_ACTION_TIME_CLASS}
      datetime={actionDate.toISOString()}
      title={fullTime}
      aria-label={fullTime}>{compactTime}</time
    >
  {/if}

  {#if role === 'user'}
    <!-- User message actions: Edit, Copy -->
    {#if onEdit}
      <TooltipShortcut
        label={m.chat_messageActions_edit_label()}
        shortcut="e"
        side="top"
        delayDuration={300}
      >
        <Button
          variant="ghost-light"
          size="icon-xs"
          onclick={onEdit}
          aria-label={m.chat_messageActions_editMessage_ariaLabel()}
        >
          <Fa icon={faPencil} class="w-2.5! h-2.5!" />
        </Button>
      </TooltipShortcut>
    {/if}
  {:else}
    <!-- Assistant message actions: Regenerate, Fork, Vote, Copy -->
    {#if onRegenerate}
      <TooltipShortcut
        label={m.chat_messageActions_regenerate_label()}
        side="top"
        delayDuration={300}
      >
        <Button
          variant="ghost-light"
          size="icon-xs"
          onclick={onRegenerate}
          aria-label={m.chat_messageActions_regenerate_ariaLabel()}
        >
          <Fa icon={faRotateRight} class="w-2.5! h-2.5!" />
        </Button>
      </TooltipShortcut>
    {/if}

    {#if onFork}
      <TooltipShortcut label={m.chat_messageActions_fork_label()} side="top" delayDuration={300}>
        <Button
          variant="ghost-light"
          size="icon-xs"
          onclick={onFork}
          aria-label={m.chat_messageActions_fork_ariaLabel()}
        >
          <Fa icon={faCodeBranch} class="w-2.5! h-2.5!" />
        </Button>
      </TooltipShortcut>
    {/if}

    {#if onVote}
      <TooltipShortcut
        label={m.chat_messageActions_goodResponse_label()}
        side="top"
        delayDuration={300}
      >
        <Button
          variant="ghost-light"
          size="icon-xs"
          onclick={() => handleVote('up')}
          aria-label={m.chat_messageActions_goodResponse_label()}
          class={currentVote === 'up' ? 'text-green-500' : ''}
        >
          <Fa icon={faThumbsUp} class="w-2.5! h-2.5!" />
        </Button>
      </TooltipShortcut>

      <TooltipShortcut
        label={m.chat_messageActions_badResponse_label()}
        side="top"
        delayDuration={300}
      >
        <Button
          variant="ghost-light"
          size="icon-xs"
          onclick={() => handleVote('down')}
          aria-label={m.chat_messageActions_badResponse_label()}
          class={currentVote === 'down' ? 'text-red-500' : ''}
        >
          <Fa icon={faThumbsDown} class="w-2.5! h-2.5!" />
        </Button>
      </TooltipShortcut>
    {/if}
  {/if}

  <!-- Copy button for all messages -->
  {#if onCopy}
    <Tooltip side="top" delayDuration={300} contentClass="whitespace-nowrap">
      {#snippet trigger()}
        <Button
          variant="ghost-light"
          size="icon-xs"
          onclick={handleCopy}
          aria-label={m.chat_messageActions_copyMessage_ariaLabel()}
          data-copy-state={copied || copiedSessionId ? 'success' : 'idle'}
        >
          {#if copied || copiedSessionId}
            <Fa icon={faCheck} class="w-2.5! h-2.5! text-green-500" />
          {:else}
            <Fa icon={faCopy} class="w-2.5! h-2.5!" />
          {/if}
        </Button>
      {/snippet}
      {#snippet content()}
        <div class="w-full flex flex-col">
          <div class="flex items-center gap-3">
            <span class="text-sm">{m.chat_messageActions_copyMessage_label()}</span>
          </div>
          {#if requestId}
            <div class="text-subtle text-sm">
              {m.chat_messageActions_copySessionIdHint_label()}
            </div>
          {/if}
        </div>
      {/snippet}
    </Tooltip>
  {/if}

  <!-- Scroll to previous button for user messages -->
  {#if role === 'user' && onScrollToPrevious}
    <TooltipShortcut
      label={m.chat_messageActions_scrollToPrevious_label()}
      side="top"
      delayDuration={300}
    >
      <Button
        variant="ghost-light"
        size="icon-xs"
        onclick={() => onScrollToPrevious?.()}
        aria-label={m.chat_messageActions_scrollToPrevious_label()}
      >
        <Fa icon={faArrowUp} class="w-2.5! h-2.5!" />
      </Button>
    </TooltipShortcut>
  {/if}
</div>
