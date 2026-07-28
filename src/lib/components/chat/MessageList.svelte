<script lang="ts">
  /**
   * Message List Component
   *
   * Displays the list of chat messages with date separators,
   * typing indicators, and scroll management.
   *
   * PERF: Implements windowed rendering for long conversations (50+ messages).
   * Only renders messages within the visible viewport plus a buffer,
   * significantly reducing DOM nodes and improving performance.
   */

  import type { AgentMessage } from '$shared/types';
  import type { SearchResult } from '$lib/utils/messageSearch';
  import {
  groupMessagesByDate,
  shouldShowTimeSeparator,
} from '$lib/utils/timeFormatting';
  import { formatTime as formatClockTime } from '$lib/i18n/format';
  import ChatMessage from './ChatMessage.svelte';
  import DateSeparator from './DateSeparator.svelte';
  import TypingIndicator from './TypingIndicator.svelte';
  import StreamingTypingIndicator from './StreamingTypingIndicator.svelte';
  import {
  onMount,
  onDestroy,
  tick,
} from 'svelte';

  // untrack available if needed for future optimizations

  interface Props {
    messages: AgentMessage[];
    isProcessing: boolean;
    isStreaming: boolean;
    currentSearchResult: SearchResult | null;
    onMessageRef: (node: HTMLDivElement, messageId: string) => void;
    onVisibleMessageChange?: (messageId: string | null) => void;
    scrollToBottom?: () => void;
  }

  let {
    messages,
    isProcessing,
    isStreaming,
    currentSearchResult,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onMessageRef,
    onVisibleMessageChange,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    scrollToBottom,
  }: Props = $props();

  let scrollContainer: HTMLDivElement | null = $state(null);
  let observer: IntersectionObserver | null = null;
  let visibleMessages = new Set<string>();
  // Track which message IDs we've already observed to avoid re-observing
  let observedMessageIds = new Set<string>();

  // PERF: Virtual rendering configuration
  const VIRTUAL_THRESHOLD = 50; // Start virtualizing when messages exceed this count
  const RENDER_BUFFER = 10; // Number of messages to render above/below visible area
  const ESTIMATED_MESSAGE_HEIGHT = 120; // Average height estimate for scroll calculations

  // Virtual scroll state
  let scrollTop = $state(0);
  let containerHeight = $state(600);

  // Determine if we should use virtual rendering
  const shouldVirtualize = $derived(messages.length > VIRTUAL_THRESHOLD);

  // Group messages by date
  let messageGroups = $derived(groupMessagesByDate(messages));

  // Flatten messages for virtual rendering with group info
  const flatMessages = $derived.by(() => {
    const result: Array<{
      type: 'date' | 'time' | 'message';
      message?: AgentMessage;
      label?: string;
      groupIndex: number;
      indexInGroup: number;
    }> = [];

    messageGroups.forEach((group, groupIndex) => {
      // Add date separator
      result.push({ type: 'date', label: group.label, groupIndex, indexInGroup: -1 });

      group.messages.forEach((message, i) => {
        // Add time separator if needed
        if (i > 0 && shouldShowTimeSeparator(group.messages[i - 1].timestamp, message.timestamp)) {
          result.push({ type: 'time', message, groupIndex, indexInGroup: i });
        }
        // Add message
        result.push({ type: 'message', message, groupIndex, indexInGroup: i });
      });
    });

    return result;
  });

  // Compute visible range for virtual rendering
  const visibleRange = $derived.by(() => {
    if (!shouldVirtualize) {
      return { start: 0, end: flatMessages.length };
    }

    const estimatedVisibleCount = Math.ceil(containerHeight / ESTIMATED_MESSAGE_HEIGHT);
    const startIndex = Math.floor(scrollTop / ESTIMATED_MESSAGE_HEIGHT);

    return {
      start: Math.max(0, startIndex - RENDER_BUFFER),
      end: Math.min(flatMessages.length, startIndex + estimatedVisibleCount + RENDER_BUFFER),
    };
  });

  // Get items to render
  const renderedItems = $derived(
    shouldVirtualize ? flatMessages.slice(visibleRange.start, visibleRange.end) : flatMessages,
  );

  // Calculate spacer heights for virtual scrolling
  const topSpacerHeight = $derived(
    shouldVirtualize ? visibleRange.start * ESTIMATED_MESSAGE_HEIGHT : 0,
  );
  const bottomSpacerHeight = $derived(
    shouldVirtualize
      ? Math.max(0, (flatMessages.length - visibleRange.end) * ESTIMATED_MESSAGE_HEIGHT)
      : 0,
  );

  // Create a stable message ID index for efficient lookups
  let messageIdToIndex = $derived.by(() => {
    const map = new Map<string, number>();
    messages.forEach((m, i) => map.set(m.id, i));
    return map;
  });

  // RAF handle for scroll throttling
  let scrollRafId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;

  onMount(() => {
    if (!scrollContainer) return;

    // PERF: Track container dimensions for virtual rendering
    containerHeight = scrollContainer.clientHeight;

    // Use ResizeObserver to track container size changes
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerHeight = entry.contentRect.height;
      }
    });
    resizeObserver.observe(scrollContainer);

    // PERF: Throttled scroll handler for virtual rendering
    const handleScroll = () => {
      if (scrollRafId !== null) return;
      scrollRafId = requestAnimationFrame(() => {
        scrollRafId = null;
        if (scrollContainer) {
          scrollTop = scrollContainer.scrollTop;
        }
      });
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });

    // Set up intersection observer for visible message detection
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const messageId = entry.target.getAttribute('data-message-id');
          if (!messageId) return;

          if (entry.isIntersecting) {
            visibleMessages.add(messageId);
          } else {
            visibleMessages.delete(messageId);
          }
        });

        // Find the topmost visible message using pre-computed index map
        if (onVisibleMessageChange && visibleMessages.size > 0) {
          const indexMap = messageIdToIndex;
          const sortedMessages = Array.from(visibleMessages).sort((a, b) => {
            const indexA = indexMap.get(a) ?? Infinity;
            const indexB = indexMap.get(b) ?? Infinity;
            return indexA - indexB;
          });
          onVisibleMessageChange(sortedMessages[0] || null);
        } else if (onVisibleMessageChange) {
          onVisibleMessageChange(null);
        }
      },
      {
        root: scrollContainer,
        rootMargin: '-10% 0px -80% 0px',
        threshold: 0,
      },
    );

    // Observe initial message elements
    const messageElements = scrollContainer.querySelectorAll('[data-message-id]');
    messageElements.forEach((el) => {
      const messageId = el.getAttribute('data-message-id');
      if (messageId) {
        observedMessageIds.add(messageId);
        observer?.observe(el);
      }
    });

    return () => {
      scrollContainer?.removeEventListener('scroll', handleScroll);
    };
  });

  onDestroy(() => {
    observer?.disconnect();
    observedMessageIds.clear();
    resizeObserver?.disconnect();
    if (scrollRafId !== null) {
      cancelAnimationFrame(scrollRafId);
    }
  });

  // Only observe NEW messages, don't disconnect/reconnect all
  $effect(() => {
    if (!observer || !scrollContainer) return;

    // Get current message IDs
    const currentMessageIds = new Set(messages.map((m) => m.id));

    // Find messages that need to be observed (new ones)
    const newMessageIds = messages.filter((m) => !observedMessageIds.has(m.id)).map((m) => m.id);

    // Clean up observed IDs for messages that no longer exist
    for (const id of observedMessageIds) {
      if (!currentMessageIds.has(id)) {
        observedMessageIds.delete(id);
        visibleMessages.delete(id);
      }
    }

    // Only query DOM if there are new messages to observe
    if (newMessageIds.length > 0) {
      tick().then(() => {
        for (const messageId of newMessageIds) {
          const el = scrollContainer?.querySelector(`[data-message-id="${messageId}"]`);
          if (el) {
            observedMessageIds.add(messageId);
            observer?.observe(el);
          }
        }
      });
    }
  });

  function isHighlighted(message: AgentMessage): boolean {
    return currentSearchResult?.messageId === message.id;
  }

  function formatTime(date: Date): string {
    return formatClockTime(date);
  }
</script>

<div class="message-list" bind:this={scrollContainer}>
  <!-- PERF: Virtual rendering with spacers for long conversations -->
  {#if shouldVirtualize}
    <!-- Top spacer for scrolling past non-rendered messages -->
    {#if topSpacerHeight > 0}
      <div class="virtual-spacer" style="height: {topSpacerHeight}px;" aria-hidden="true"></div>
    {/if}
  {/if}

  <!-- Render visible items (virtualized or all) -->
  {#each renderedItems as item, idx (item.type === 'message' ? item.message?.id : `${item.type}-${item.groupIndex}-${item.indexInGroup}-${idx}`)}
    {#if item.type === 'date'}
      <DateSeparator label={item.label || ''} />
    {:else if item.type === 'time' && item.message}
      <div class="time-separator">
        <span class="time-label">
          {formatTime(new Date(item.message.timestamp))}
        </span>
      </div>
    {:else if item.type === 'message' && item.message}
      <div
        class="message-wrapper"
        class:highlighted={isHighlighted(item.message)}
        data-message-id={item.message.id}
      >
        <!-- Fallback path: MessageList does not receive `agentId` via props/context,
             so we can't use ChatMessage's Redux-backed subscription here. Pass the
             message object directly. -->
        <ChatMessage message={item.message} />
      </div>
    {/if}
  {/each}

  {#if shouldVirtualize}
    <!-- Bottom spacer for scrolling past non-rendered messages -->
    {#if bottomSpacerHeight > 0}
      <div class="virtual-spacer" style="height: {bottomSpacerHeight}px;" aria-hidden="true"></div>
    {/if}
  {/if}

  <!-- Typing indicators -->
  {#if isProcessing && !isStreaming}
    <div class="typing-wrapper">
      <TypingIndicator />
    </div>
  {/if}

  {#if isStreaming}
    <div class="typing-wrapper">
      <StreamingTypingIndicator />
    </div>
  {/if}

  <!-- Scroll anchor -->
  <div class="scroll-anchor"></div>
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
    transition: background-color 0.3s ease;
  }

  .message-wrapper.highlighted {
    background-color: var(--highlight-color, rgba(255, 235, 59, 0.2));
    border-radius: 0.5rem;
    padding: 0.5rem;
    margin: -0.5rem;
  }

  .time-separator {
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0.5rem 0;
    position: relative;
  }

  .time-separator::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--border-color);
    opacity: 0.3;
  }

  .time-label {
    background: var(--background-primary);
    padding: 0.25rem 0.75rem;
    border-radius: 1rem;
    font-size: 0.75rem;
    color: var(--text-secondary);
    position: relative;
    z-index: 1;
  }

  .typing-wrapper {
    padding: 0.5rem 0;
  }

  .scroll-anchor {
    height: 1px;
    visibility: hidden;
  }

  /* PERF: Virtual scrolling spacers */
  .virtual-spacer {
    flex-shrink: 0;
    pointer-events: none;
  }

  /* Scrollbar styling */
  .message-list::-webkit-scrollbar {
    width: 8px;
  }

  .message-list::-webkit-scrollbar-track {
    background: transparent;
  }

  .message-list::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb);
    border-radius: 4px;
  }

  .message-list::-webkit-scrollbar-thumb:hover {
    background: var(--scrollbar-thumb-hover);
  }
</style>
