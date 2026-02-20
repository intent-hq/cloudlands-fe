<!--
  MessageList Component

  Renders the list of messages in a chat session.
  Handles message grouping, date separators, and scrolling.
-->
<script lang="ts">
  import type { AgentMessage } from '$shared/types';
  import {
    groupMessagesByDate,
    formatChatTime,
    shouldShowTimeSeparator,
  } from '$lib/utils/timeFormatting';
  import ChatMessage from '../ChatMessage.svelte';
  import DateSeparator from '../DateSeparator.svelte';
  import StreamingTypingIndicator from '../StreamingTypingIndicator.svelte';
  import { createLogger } from '$lib/utils/client-logger';

  const logger = createLogger('MessageList');

  interface Props {
    messages: AgentMessage[];
    isStreaming?: boolean;
    streamingContent?: string;
    selectedMessageId?: string;
    searchQuery?: string;
    onMessageClick?: (messageId: string) => void;
    onMessageCopy?: (content: string) => void;
    onMessageEdit?: (messageId: string, content: string) => void;
    onMessageDelete?: (messageId: string) => void;
    onRetry?: (messageId: string) => void;
    showTimestamps?: boolean;
    compactMode?: boolean;
  }

  let {
    messages = [],
    isStreaming = false,
    streamingContent = '',
    selectedMessageId,
    searchQuery,
    onMessageClick,
    onMessageCopy,
    onMessageEdit,
    onMessageDelete,
    onRetry,
    showTimestamps = true,
    compactMode = false,
  }: Props = $props();

  // Group messages by date
  let messageGroups = $derived(groupMessagesByDate(messages));

  // Check if we should show time separator between messages
  function shouldShowTime(index: number, messages: AgentMessage[]): boolean {
    if (!showTimestamps) return false;
    if (index === 0) return true;
    return shouldShowTimeSeparator(messages[index - 1].timestamp, messages[index].timestamp);
  }

  // Handle message actions
  function handleMessageAction(action: string, messageId: string, data?: any) {
    switch (action) {
      case 'click':
        onMessageClick?.(messageId);
        break;
      case 'copy':
        onMessageCopy?.(data);
        break;
      case 'edit':
        onMessageEdit?.(messageId, data);
        break;
      case 'delete':
        onMessageDelete?.(messageId);
        break;
      case 'retry':
        onRetry?.(messageId);
        break;
      default:
        logger.warn('Unknown message action', { action, messageId });
    }
  }
</script>

<div class="flex flex-col {compactMode ? 'gap-2 p-2' : 'gap-4 p-4'}">
  {#each messageGroups as group (group.label)}
    <!-- Date separator -->
    <DateSeparator label={group.label} />

    <!-- Messages for this date -->
    {#each group.messages as message, index (message.id)}
      <!-- Time separator if needed -->
      {#if shouldShowTime(index, group.messages)}
        <div
          class="flex items-center justify-center my-2 relative before:content-[''] before:absolute before:left-0 before:right-0 before:h-px before:bg-border before:z-0"
        >
          <span
            class="relative px-3 py-1 bg-background text-muted-foreground text-xs rounded-full z-10"
            >{formatChatTime(message.timestamp)}</span
          >
        </div>
      {/if}

      <!-- Message -->
      <div
        class="transition-colors duration-200 rounded-lg p-1 hover:bg-muted/50 {message.id ===
        selectedMessageId
          ? 'bg-primary/10 ring-2 ring-primary'
          : ''} {message.role === 'user' ? 'self-end max-w-[80%]' : 'self-start max-w-[90%]'}"
      >
        <ChatMessage {message} showTimestamp={showTimestamps} />
      </div>
    {/each}
  {/each}

  <!-- Streaming indicator -->
  {#if isStreaming}
    <div class="p-4 bg-muted/50 rounded-lg animate-pulse">
      <StreamingTypingIndicator
        visible={true}
        message={streamingContent || 'Agent is thinking...'}
      />
    </div>
  {/if}
</div>
