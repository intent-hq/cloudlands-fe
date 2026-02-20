<script lang="ts">
  import { logger } from '$shared/logger';

  import { page } from '$app/state';
  import { tick } from 'svelte';
  import { invoke, listenSync } from '$lib/electron-bridge';
  import SimpleRichInput from '$lib/components/chat/input/SimpleRichInput.svelte';
  import MessageContent from '$lib/components/chat/MessageContent.svelte';
  import { agentService } from '$features/agent/agent.service';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { throttle } from '$lib/utils/performance-utils';
  import { followBottom, scrollToBottom } from '$lib/utils/smartScroll';
  import { AuggieTextParser } from '$lib/utils/auggie-text-parser';

  let agentId: string = $state('');
  let agent: any = $state(null);
  let messages: any[] = $state([]);
  let newMessage = $state('');
  let loading = $state(false);
  let loadPromise: Promise<void> | null = null;
  let streamingContent: string = '';
  let isStreaming = $state(false);
  let throttledUpdateMessage: (((content: string) => void) & { cancel: () => void }) | null = null;
  let scrollContainer: HTMLDivElement | null = $state(null);
  let shouldFollowBottom = $state(true);
  let showScrollToBottom = $state(false);

  // Non-reactive streaming state for performance
  let streamingMessageElement: HTMLElement | null = null;
  let streamingMessageIndex: number = -1;

  // Basic markdown renderer for streaming - optimized for performance
  function renderBasicMarkdown(text: string): string {
    // Very basic markdown rendering - just handle code blocks and line breaks
    // Full markdown rendering happens when streaming completes
    return text
      .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  // Watch for page param changes using $effect
  $effect(() => {
    const id = page.params.id;
    if (id && id !== agentId) {
      agentId = id;
      // Wait for any existing load to complete
      if (loadPromise) {
        loadPromise.then(() => {
          loadPromise = loadAgent();
        });
      } else {
        loadPromise = loadAgent();
      }
    }
  });

  // Note: Auto-scroll is handled by the followBottom action on the scroll container

  async function loadAgent() {
    if (!agentId || loading) return;

    logger.info('Loading agent:', agentId);
    loading = true;

    try {
      // First try to get the session from the agent service (in memory)
      let session = agentService.getSession(agentId);

      // If not in memory, try to restore from disk
      if (!session) {
        const workspace = workspaceStore.current;
        if (workspace) {
          logger.info('Session not in memory, restoring from disk', {
            agentId,
            workspaceId: workspace.id,
          });
          session = await agentService.restoreSession(agentId, workspace);
        }
      }

      if (session) {
        logger.info('Loaded session from agent service', {
          agentId,
          turnNumber: session.currentTurnNumber,
          messageCount: session.messages?.length,
        });
        agent = session;
        messages = session.messages || [];
      } else {
        // Fallback to IPC for backward compatibility
        const response: any = await invoke('get_agent_session', { agentId });
        if (response && response.success && response.data) {
          agent = response.data;
          messages = response.data.messages || [];
        } else {
          // Create a minimal agent object if not found
          agent = {
            id: agentId,
            name: 'Agent Session',
            messages: [],
          };
          messages = [];
        }
      }
    } catch (err) {
      logger.error('Failed to load agent:', err);
      // Create a minimal agent object on error
      agent = {
        id: agentId,
        name: 'Agent Session',
        messages: [],
      };
      messages = [];
    } finally {
      loading = false;
      loadPromise = null;
    }
  }

  async function sendMessage(messageContent: string) {
    if (!messageContent.trim()) return;

    const userMessage = {
      role: 'user',
      content: messageContent,
      timestamp: new Date().toISOString(),
    };

    messages.push(userMessage);
    newMessage = '';

    // Add a streaming message placeholder but DON'T update content during streaming
    streamingMessageIndex = messages.length; // Cache the index before pushing
    const streamingMessage = {
      role: 'assistant',
      content: '', // Keep empty during streaming - update DOM directly instead
      timestamp: new Date().toISOString(),
      isStreaming: true,
      id: `streaming-${Date.now()}`, // Add ID for keyed each block
    };
    messages.push(streamingMessage);

    // Reset streaming content
    streamingContent = '';

    // Wait for DOM to update and get the streaming message element
    await tick();
    // Find the streaming content div directly
    streamingMessageElement = scrollContainer?.querySelector('.streaming-content') as HTMLElement;

    try {
      // Set up stream listeners
      const streamEventName = `agent-stream-${agentId}`;
      const completeEventName = `agent-stream-complete-${agentId}`;

      // Direct DOM update function - bypasses Svelte reactivity for performance
      let rafId: number | null = null;
      let updateScheduled = false;

      throttledUpdateMessage = throttle((content: string) => {
        // Update DOM directly during streaming to avoid reactive overhead
        if (streamingMessageElement && !updateScheduled) {
          updateScheduled = true;
          rafId = requestAnimationFrame(() => {
            if (streamingMessageElement) {
              // Direct innerHTML update for streaming content
              // This is safe because we control the content
              streamingMessageElement.innerHTML = renderBasicMarkdown(AuggieTextParser.stripDigestTagsForDisplay(content));
            }
            updateScheduled = false;
            rafId = null;
          });
        }
      }, 150); // Increased throttle to 150ms for even better performance

      const unsubscribeStream = listenSync(streamEventName, (event: any) => {
        const chunk = event.payload.chunk || '';
        streamingContent += chunk;
        isStreaming = true;

        // Use cached index directly - no findIndex needed
        if (throttledUpdateMessage) {
          throttledUpdateMessage(streamingContent);
        }
      });

      const unsubscribeComplete = listenSync(completeEventName, async () => {
        isStreaming = false;

        // Cancel any pending throttled updates
        if (throttledUpdateMessage) {
          throttledUpdateMessage.cancel();
        }

        // Cancel any pending RAF
        if (rafId) {
          cancelAnimationFrame(rafId);
        }

        // Update the reactive state with the final content
        // This triggers a single reactive update at the end
        if (messages[streamingMessageIndex]) {
          // Create a new message object to ensure reactivity triggers properly
          messages[streamingMessageIndex] = {
            ...messages[streamingMessageIndex],
            content: streamingContent,
            isStreaming: false,
          };
        }

        // Clean up
        unsubscribeStream();
        unsubscribeComplete();
        throttledUpdateMessage = null;
        streamingMessageElement = null;
        streamingContent = '';
        streamingMessageIndex = -1;

        // Reload the agent to get the updated session
        await loadAgent();
      });

      // Start streaming
      const response: any = await invoke('universal-agent:streamMessage', {
        agentId,
        message: messageContent,
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to start streaming');
      }
    } catch (err) {
      logger.error('Failed to send message:', err);

      // Clean up throttled function if error occurs
      if (throttledUpdateMessage) {
        throttledUpdateMessage.cancel();
        throttledUpdateMessage = null;
      }

      // Remove the streaming message and add an error message
      const nonStreamingMessages = messages.filter((m: any) => !m.isStreaming);
      messages = nonStreamingMessages;
      messages.push({
        role: 'assistant',
        content: `Error: ${err}`,
        timestamp: new Date().toISOString(),
      });

      // Reset streaming state
      isStreaming = false;
      streamingContent = '';
    }
  }

  function formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="h-screen flex flex-col p-8 max-w-screen-xl mx-auto">
  <div class="flex justify-between items-center mb-8 pb-4 border-b border-border">
    <h1 class="text-2xl font-semibold text-foreground">
      {agent?.agentInfo?.name || 'Agent Thread'}
    </h1>
    <span class="text-sm text-muted-foreground font-mono">ID: {agentId}</span>
  </div>

  <div class="flex-1 flex flex-col bg-card border border-border rounded-lg overflow-hidden">
    {#if loading}
      <div class="flex-1 flex items-center justify-center text-muted-foreground">Loading...</div>
    {:else}
      <div
        bind:this={scrollContainer}
        use:followBottom={{
          follow: shouldFollowBottom,
          threshold: 150,
          onFollowChange: (f) => {
            shouldFollowBottom = f;
            showScrollToBottom = !f;
          },
        }}
        class="flex-1 overflow-y-auto p-6 flex flex-col gap-6 scrollbar-thin scrollbar-thumb-muted scrollbar-track-muted/20 will-change-scroll scroll-container"
      >
        {#each messages as message (message.id || message.timestamp)}
          <div
            class="flex flex-col gap-2 message-container {message.isStreaming
              ? 'streaming-message'
              : ''}"
          >
            <div class="flex justify-between items-center">
              <span
                class="font-semibold text-sm {message.role === 'user'
                  ? 'text-primary'
                  : 'text-success'}"
              >
                {message.role === 'user' ? 'You' : 'Assistant'}
              </span>
              {#if message.timestamp}
                <span class="text-xs text-muted-foreground"
                  >{formatTimestamp(message.timestamp)}</span
                >
              {/if}
            </div>
            <div class="leading-relaxed text-foreground message-content-wrapper">
              {#if message.isStreaming}
                <!-- Streaming message - content will be updated via DOM manipulation -->
                <div class="markdown-viewer streaming-content"></div>
              {:else}
                <MessageContent content={message.contentBlocks || []} />
              {/if}
            </div>
          </div>
        {/each}
      </div>

      <!-- Scroll to bottom button -->
      {#if showScrollToBottom}
        <button
          onclick={() => {
            if (scrollContainer) {
              shouldFollowBottom = true;
              scrollToBottom(scrollContainer);
            }
          }}
          class="absolute bottom-24 right-6 p-2 rounded-full bg-primary/10 hover:bg-primary/20 border border-primary/20 transition-all duration-200 shadow-lg"
          aria-label="Scroll to bottom"
        >
          <svg class="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </svg>
        </button>
      {/if}

      <div class="p-4 border-t border-border bg-muted/30">
        <SimpleRichInput
          bind:value={newMessage}
          placeholder="Type your message... (@ to mention, Ctrl+P to enhance)"
          onsubmit={sendMessage}
          disabled={loading || isStreaming}
          workspace={null}
        />
      </div>
    {/if}
  </div>
</div>

<style>
  /* Custom scrollbar styles for webkit browsers */
  .scrollbar-thin::-webkit-scrollbar {
    width: 6px;
  }

  .scrollbar-track-muted\/20::-webkit-scrollbar-track {
    background: hsl(var(--muted) / 0.2);
  }

  .scrollbar-thumb-muted::-webkit-scrollbar-thumb {
    background: hsl(var(--muted-foreground) / 0.3);
    border-radius: 3px;
  }

  .scrollbar-thumb-muted::-webkit-scrollbar-thumb:hover {
    background: hsl(var(--muted-foreground) / 0.5);
  }

  /* Performance optimizations for smooth scrolling */
  .will-change-scroll {
    will-change: scroll-position;
  }

  /* Optimize message rendering */
  .message-container {
    contain: layout style paint;
    content-visibility: auto;
  }

  /* Reduce repaints during scroll */
  .flex-1.overflow-y-auto {
    -webkit-overflow-scrolling: touch;
    transform: translateZ(0);
    backface-visibility: hidden;
    isolation: isolate; /* Create new stacking context to prevent layout thrashing */
  }

  /* Streaming content styles - use :global for dynamically inserted content */
  .streaming-content {
    min-height: 1em;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .streaming-content :global(pre) {
    background: hsl(var(--muted) / 0.3);
    padding: 0.5rem;
    border-radius: 0.25rem;
    overflow-x: auto;
  }

  .streaming-content :global(code) {
    background: hsl(var(--muted) / 0.3);
    padding: 0.125rem 0.25rem;
    border-radius: 0.125rem;
    font-size: 0.875em;
  }

  /* Optimize scrolling performance */
  .scroll-container {
    contain: strict; /* Aggressive containment for scroll container */
    overflow-anchor: none; /* Disable scroll anchoring during streaming */
  }

  /* Prevent layout shifts during streaming */
  .streaming-message {
    min-height: 2rem; /* Reserve minimum space to prevent jumps */
    contain: layout style;
  }
</style>
