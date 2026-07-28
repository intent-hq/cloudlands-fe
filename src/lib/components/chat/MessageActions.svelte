<!--
  MessageActions.svelte

  Action buttons for chat messages (copy, edit, regenerate, fork, vote).
  Appears on hover for both user and assistant messages.
-->
<script lang="ts">
  import { slide } from 'svelte/transition';
  import Button from '$lib/components/ui/button/button.svelte';
  import {
  Tooltip,
  TooltipShortcut,
} from '$lib/components/ui/tooltip';
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
  }: Props = $props();

  let copied = $state(false);
  let copiedSessionId = $state(false);


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
  class="message-actions flex items-center gap-0.5 {showOnHover
    ? 'opacity-0 group-hover:opacity-100'
    : ''} transition-opacity {className}"
>
  {#if role === 'user'}
    <!-- User message actions: Edit, Copy -->
    {#if onEdit}
      <TooltipShortcut label={m.chat_messageActions_edit_label()} shortcut="e" side="top" delayDuration={300}>
        <Button variant="ghost-light" size="icon-xs" onclick={onEdit} aria-label={m.chat_messageActions_editMessage_ariaLabel()}>
          <Fa icon={faPencil} class="w-2.5! h-2.5!" />
        </Button>
      </TooltipShortcut>
    {/if}
  {:else}
    <!-- Assistant message actions: Regenerate, Fork, Vote, Copy -->
    {#if onRegenerate}
      <TooltipShortcut label={m.chat_messageActions_regenerate_label()} side="top" delayDuration={300}>
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
      <TooltipShortcut label={m.chat_messageActions_goodResponse_label()} side="top" delayDuration={300}>
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

      <TooltipShortcut label={m.chat_messageActions_badResponse_label()} side="top" delayDuration={300}>
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
        >
          {#if copied || copiedSessionId}
            <div in:slide={{ axis: 'x', duration: 150 }}>
              <Fa icon={faCheck} class="w-2.5! h-2.5! text-green-500" />
            </div>
          {:else}
            <div in:slide={{ axis: 'x', duration: 150 }}>
              <Fa icon={faCopy} class="w-2.5! h-2.5!" />
            </div>
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
    <TooltipShortcut label={m.chat_messageActions_scrollToPrevious_label()} side="top" delayDuration={300}>
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
