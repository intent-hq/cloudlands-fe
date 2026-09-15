<!--
  MessageActions.svelte

  Action buttons for chat messages (copy, edit, regenerate, fork, vote).
  Appears on hover for both user and assistant messages.
-->
<script lang="ts">
  import { ActionBar, defineActions } from '$lib/components/patterns/action-menu';
  import { formatFullDateTime, formatTime, type DateInput } from '$lib/i18n/format';
  import {
    faArrowRotateRight,
    faArrowUp,
    faCodeBranch,
    faCopy,
    faPencil,
    faThumbsDown,
    faThumbsUp,
  } from '$lib/icons/phosphor-icons';
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

  let actionDate = $derived(resolveMessageActionDate(timestamp, createdAt));
  let compactTime = $derived(actionDate ? formatTime(actionDate) : '');
  let fullTime = $derived(actionDate ? formatFullDateTime(actionDate) : '');
  const actions = $derived(
    defineActions([
      {
        id: 'edit',
        label: m.chat_messageActions_editMessage_ariaLabel(),
        icon: faPencil,
        shortcut: 'e',
        when: role === 'user' && Boolean(onEdit),
      },
      {
        id: 'regenerate',
        label: m.chat_messageActions_regenerate_ariaLabel(),
        icon: faArrowRotateRight,
        when: role === 'assistant' && Boolean(onRegenerate),
      },
      {
        id: 'fork',
        label: m.chat_messageActions_fork_ariaLabel(),
        icon: faCodeBranch,
        when: role === 'assistant' && Boolean(onFork),
      },
      {
        id: 'vote-up',
        label: m.chat_messageActions_goodResponse_label(),
        icon: faThumbsUp,
        checked: currentVote === 'up',
        when: role === 'assistant' && Boolean(onVote),
      },
      {
        id: 'vote-down',
        label: m.chat_messageActions_badResponse_label(),
        icon: faThumbsDown,
        checked: currentVote === 'down',
        when: role === 'assistant' && Boolean(onVote),
      },
      {
        id: 'copy',
        label: m.chat_messageActions_copyMessage_ariaLabel(),
        icon: faCopy,
        when: Boolean(onCopy),
      },
      {
        id: 'scroll-previous',
        label: m.chat_messageActions_scrollToPrevious_label(),
        icon: faArrowUp,
        when: role === 'user' && Boolean(onScrollToPrevious),
      },
    ]),
  );

  async function handleCopy(event: Event) {
    if ('shiftKey' in event && event.shiftKey && requestId) {
      // Shift+click: copy session ID
      await navigator.clipboard.writeText(requestId);
    } else {
      // Normal click: copy message content
      onCopy?.();
    }
  }

  function handleAction(id: string, event: Event) {
    switch (id) {
      case 'edit':
        onEdit?.();
        break;
      case 'regenerate':
        onRegenerate?.();
        break;
      case 'fork':
        onFork?.();
        break;
      case 'vote-up':
        onVote?.('up');
        break;
      case 'vote-down':
        onVote?.('down');
        break;
      case 'copy':
        void handleCopy(event);
        break;
      case 'scroll-previous':
        onScrollToPrevious?.();
        break;
    }
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

  <ActionBar
    {actions}
    overflowLabel={m.lib_commandPalette_quickActions_ariaLabel()}
    onAction={handleAction}
  />
</div>
