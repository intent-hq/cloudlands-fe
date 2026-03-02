<!--
  MessageActions.svelte

  Action buttons for chat messages (copy, edit, regenerate, fork, vote).
  Appears on hover for both user and assistant messages.
-->
<script lang="ts">
  import { slide } from 'svelte/transition';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Tooltip, TooltipShortcut } from '$lib/components/ui/tooltip';
  import Fa from 'svelte-fa';
  import {
    faCopy,
    faCheck,
    faPencil,
    faRotateRight,
    faThumbsUp,
    faThumbsDown,
    faCodeBranch,
  } from '@fortawesome/free-solid-svg-icons';
  import { isMacPlatform } from '$lib/utils/shortcuts';

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
    /** Request ID for this message (used for debugging) */
    requestId?: string;
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
  }: Props = $props();

  let copied = $state(false);
  let copiedRequestId = $state(false);

  const isMac = isMacPlatform();
  const shiftSymbol = isMac ? '⇧' : 'Shift';

  async function handleCopy(event: MouseEvent) {
    if (event.shiftKey && requestId) {
      // Shift+click: copy request ID
      await navigator.clipboard.writeText(requestId);
      copiedRequestId = true;
      setTimeout(() => (copiedRequestId = false), 2000);
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
      <TooltipShortcut label="Edit" shortcut="e" side="top" delayDuration={300}>
        <Button variant="ghost-light" size="icon-xs" onclick={onEdit} aria-label="Edit message">
          <Fa icon={faPencil} class="w-2.5! h-2.5!" />
        </Button>
      </TooltipShortcut>
    {/if}
  {:else}
    <!-- Assistant message actions: Regenerate, Fork, Vote, Copy -->
    {#if onRegenerate}
      <TooltipShortcut label="Regenerate" side="top" delayDuration={300}>
        <Button
          variant="ghost-light"
          size="icon-xs"
          onclick={onRegenerate}
          aria-label="Regenerate response"
        >
          <Fa icon={faRotateRight} class="w-2.5! h-2.5!" />
        </Button>
      </TooltipShortcut>
    {/if}

    {#if onFork}
      <TooltipShortcut label="Fork conversation" side="top" delayDuration={300}>
        <Button
          variant="ghost-light"
          size="icon-xs"
          onclick={onFork}
          aria-label="Fork conversation from this message"
        >
          <Fa icon={faCodeBranch} class="w-2.5! h-2.5!" />
        </Button>
      </TooltipShortcut>
    {/if}

    {#if onVote}
      <TooltipShortcut label="Good response" side="top" delayDuration={300}>
        <Button
          variant="ghost-light"
          size="icon-xs"
          onclick={() => handleVote('up')}
          aria-label="Good response"
          class={currentVote === 'up' ? 'text-green-500' : ''}
        >
          <Fa icon={faThumbsUp} class="w-2.5! h-2.5!" />
        </Button>
      </TooltipShortcut>

      <TooltipShortcut label="Bad response" side="top" delayDuration={300}>
        <Button
          variant="ghost-light"
          size="icon-xs"
          onclick={() => handleVote('down')}
          aria-label="Bad response"
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
          aria-label="Copy message (Shift+click to copy request ID)"
        >
          {#if copied || copiedRequestId}
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
          <span class="text-sm">Copy message</span>
        </div>
        {#if requestId}
          <div class="text-subtle text-sm">
            Hold Shift to copy request ID
          </div>
        {/if}
        </div>
      {/snippet}
    </Tooltip>
  {/if}
</div>
