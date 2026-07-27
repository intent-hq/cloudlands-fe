<script lang="ts">
  import { extractAllContent, type AgentMessage } from '$shared/types';
  import ChatMessage from './ChatMessage.svelte';
  import StreamingMessageContent from './StreamingMessageContent.svelte';
  import InterruptionNotice from './InterruptionNotice.svelte';
  import ModelChangeNotice from './ModelChangeNotice.svelte';
  import { getModelChangeNotice } from './model-change-notice';
  import { fade } from 'svelte/transition';

  interface Props {
    messages?: AgentMessage[];
    isStreaming?: boolean;
    streamingContent?: any;
    searchQuery?: string;
    currentSearchIndex?: number;
    searchResults?: string[];
    showInitStatus?: boolean;
    initializationStatus?: string | null;
    enableTransitions?: boolean;
    animationDuration?: number;
    onCopy?: (content: string) => void;
    workspaceId?: string;
  }

  let {
    messages = [],
    isStreaming = false,
    streamingContent = null,
    searchQuery = '',
    currentSearchIndex = 0,
    searchResults = [],
    showInitStatus = false,
    initializationStatus = null,
    enableTransitions = true,
    animationDuration = 300,
    onCopy,
    workspaceId,
  }: Props = $props();

  // PERF: Cache for filtered messages to avoid re-filtering on unrelated updates
  // Keyed by message count + search query to invalidate when relevant data changes
  let lastFilterKey = '';
  let cachedFilteredMessages: AgentMessage[] = [];

  // Computed - with memoization for performance
  const filteredMessages = $derived.by(() => {
    // Early return if no search query - avoid filtering entirely
    if (!searchQuery) {
      return messages;
    }

    // Create a cache key based on message count and search query
    const filterKey = `${messages.length}:${searchQuery}`;
    if (filterKey === lastFilterKey) {
      return cachedFilteredMessages;
    }

    const lowerQuery = searchQuery.toLowerCase();
    const result = messages.filter((msg) => {
      const content = extractAllContent(msg);
      return content.toLowerCase().includes(lowerQuery);
    });

    lastFilterKey = filterKey;
    cachedFilteredMessages = result;
    return result;
  });

  const highlightedMessageId = $derived(
    searchResults.length > 0 ? searchResults[currentSearchIndex] : null,
  );

  // Methods - exposed for parent components
  export function scrollToMessage(messageId: string) {
    const element = document.getElementById(`message-${messageId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Flash highlight effect
      element.classList.add('highlight-flash');
      setTimeout(() => {
        element.classList.remove('highlight-flash');
      }, 1000);
    }
  }

  function handleCopy(content: string) {
    navigator.clipboard.writeText(content);
    onCopy?.(content);
  }
</script>

<div class="message-list">
  {#each filteredMessages as message, index (message.id)}
    <div
      id="message-{message.id}"
      class="message-wrapper group/message"
      class:highlighted={message.id === highlightedMessageId}
      class:user-message={message.role === 'user'}
      class:assistant-message={message.role === 'assistant'}
      class:system-message={message.role === 'system'}
      transition:fade={{ duration: enableTransitions ? animationDuration : 0 }}
    >
      <!-- Fallback path: AgentMessageList does not receive `agentId` via props/context,
           so we can't use ChatMessage's Redux-backed subscription here. Pass the
           message object directly. -->
      {#if message.role === 'user'}
        <ChatMessage {message} onCopy={() => handleCopy(extractAllContent(message))} />
      {:else if message.role === 'assistant'}
        <div class="assistant-message-container">
          {#if isStreaming && index === messages.length - 1}
            <!-- Streaming message -->
            <StreamingMessageContent
              content={streamingContent || message.contentBlocks || []}
              isStreaming={true}
              {workspaceId}
            />
          {:else}
            <!-- Completed message -->
            <ChatMessage {message} onCopy={() => handleCopy(extractAllContent(message))} />
          {/if}
        </div>
      {:else if message.role === 'system'}
        {@const modelChangeNotice = getModelChangeNotice(message)}
        {#if modelChangeNotice}
          <!-- Daemon-persisted model-change notice - centered inline divider -->
          <ModelChangeNotice notice={modelChangeNotice} fallbackText={extractAllContent(message)} />
        {:else}
          <!-- System message - render as interruption notice banner -->
          <InterruptionNotice message={extractAllContent(message)} />
        {/if}
      {/if}
    </div>
  {/each}

  {#if showInitStatus && initializationStatus}
    <div class="initialization-status" transition:fade={{ duration: 200 }}>
      <div class="status-content">
        <div class="status-spinner"></div>
        <span>{initializationStatus}</span>
      </div>
    </div>
  {/if}

  {#if messages.length === 0 && !isStreaming}
    <div class="empty-state">
      <p>No messages yet. Start a conversation!</p>
    </div>
  {/if}
</div>

<style>
  .message-list {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .message-wrapper {
    display: flex;
    flex-direction: column;
    animation: slideIn 0.3s ease-out;
  }

  .message-wrapper.highlighted {
    background-color: var(--color-highlight);
    border-radius: 0.5rem;
    padding: 0.5rem;
    transition: background-color 0.3s ease;
  }

  .message-wrapper.user-message {
    align-items: flex-end;
  }

  .message-wrapper.assistant-message {
    align-items: flex-start;
  }

  .message-wrapper.system-message {
    align-items: stretch;
  }

  .assistant-message-container {
    max-width: 80%;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .initialization-status {
    display: flex;
    justify-content: center;
    padding: 1rem;
    background: var(--color-surface-secondary);
    border-radius: 0.5rem;
    margin: 1rem 0;
  }

  .status-content {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--color-text-secondary);
    font-size: 0.875rem;
  }

  .status-spinner {
    width: 1rem;
    height: 1rem;
    border: 2px solid var(--color-border);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .empty-state {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100%;
    color: var(--color-text-secondary);
    font-style: italic;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  :global(.highlight-flash) {
    animation: flash 1s ease-out;
  }

  @keyframes flash {
    0%,
    100% {
      background-color: transparent;
    }
    50% {
      background-color: var(--color-highlight);
    }
  }
</style>
