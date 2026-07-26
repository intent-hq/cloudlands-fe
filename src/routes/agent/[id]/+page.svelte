<script lang="ts">
import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { logger } from '$shared/logger';

  import { page } from '$app/state';
  import SimpleRichInput from '$lib/components/chat/input/SimpleRichInput.svelte';
  import MessageContent from '$lib/components/chat/MessageContent.svelte';
  import { sendMessage as sendAgentMessage } from '$features/agent/agent-stream-lifecycle';
  import { subscribeToAgent } from '$features/agent/browser';
  import {
  followBottom,
  scrollToBottom,
} from '$lib/utils/smartScroll';
  import { selectActiveWorkspace } from '$store/renderer/slices/workspace/workspace-selectors';

  import { restoreAgentSessionRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

  import type { AgentSession } from '$shared/types';
  import { store as appStore } from '$store/renderer/store';

  const activeWorkspace = selectActiveWorkspace();

  let agentId: string = $state('');
  let agent: any = $state(null);
  let messages: any[] = $state([]);
  let newMessage = $state('');
  let loading = $state(false);
  let loadPromise: Promise<void> | null = null;
  let isStreaming = $state(false);
  let scrollContainer: HTMLDivElement | null = $state(null);
  let shouldFollowBottom = $state(true);
  let showScrollToBottom = $state(false);

  // Agent Q&A: question cards on assistant messages preceding the last user
  // message render resolved (any later user message supersedes them).
  const lastUserMessageIndex = $derived.by(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return i;
    }
    return -1;
  });

  function applyAgentSession(session: AgentSession) {
    agent = session;
    messages = session.messages || [];
    isStreaming = !!session.isStreaming;
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

  $effect(() => {
    const subscribedAgentId = agentId;
    if (!subscribedAgentId) return;

    const unsubscribe = subscribeToAgent(
      subscribedAgentId,
      (session) => {
        if (agentId !== subscribedAgentId || !session) return;
        applyAgentSession(session);
      },
      $activeWorkspace?.id,
    );

    return () => {
      unsubscribe();
    };
  });

  // Note: Auto-scroll is handled by the followBottom action on the scroll container

  async function loadAgent() {
    const requestedAgentId = agentId;
    if (!requestedAgentId || loading) return;

    logger.info('Loading agent:', requestedAgentId);
    loading = true;

    try {
      // First try to get the session from the Redux store (in memory)
      let session: import('$shared/types').AgentSession | null | undefined =
        selectAgentSession.select(appStore.state, requestedAgentId);

      // If not in memory, try to restore from disk
      if (!session) {
        const workspace = $activeWorkspace;
        if (workspace) {
          logger.info('Session not in memory, restoring from disk', {
            agentId: requestedAgentId,
            workspaceId: workspace.id,
          });
          const restoreAction = restoreAgentSessionRequested(workspace.id, requestedAgentId);
          appStore.dispatch(restoreAction);
          session = await restoreAction.promise;
        }
      }

      if (agentId !== requestedAgentId) return;

      if (session) {
        logger.info('Loaded session from agent service', {
          agentId: requestedAgentId,
          turnNumber: session.currentTurnNumber,
          messageCount: session.messages?.length,
        });
        applyAgentSession(session);
      } else {
        // Create a minimal agent object if not found
        agent = {
          id: requestedAgentId,
          name: 'Agent Session',
          messages: [],
        };
        messages = [];
        isStreaming = false;
      }
    } catch (err) {
      logger.error('Failed to load agent:', err);
      if (agentId !== requestedAgentId) return;
      // Create a minimal agent object on error
      agent = {
        id: requestedAgentId,
        name: 'Agent Session',
        messages: [],
      };
      messages = [];
      isStreaming = false;
    } finally {
      loading = false;
      loadPromise = null;
    }
  }

  async function sendMessage(messageContent: string) {
    const trimmedMessage = messageContent.trim();
    if (!trimmedMessage) return;
    const targetAgentId = agentId;

    newMessage = '';
    isStreaming = true;

    try {
      const workspace = $activeWorkspace;
      if (!workspace) throw new Error('No active workspace');

      await sendAgentMessage(targetAgentId, trimmedMessage, workspace);
    } catch (err) {
      logger.error('Failed to send message:', err);
      if (agentId !== targetAgentId) return;
      const errorContent = `Error: ${err}`;
      messages.push({
        role: 'assistant',
        content: errorContent,
        contentBlocks: [{ type: 'text', text: errorContent }],
        timestamp: new Date().toISOString(),
      });

      // Reset streaming state
      isStreaming = false;
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
    <span class="text-sm text-subtle font-mono">ID: {agentId}</span>
  </div>

  <div class="flex-1 flex flex-col bg-card border border-border rounded-lg overflow-hidden">
    {#if loading}
      <div class="flex-1 flex items-center justify-center text-subtle">Loading...</div>
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
        {#each messages as message, messageIndex (message.id || message.timestamp)}
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
                <span class="text-xs text-subtle"
                  >{formatTimestamp(message.timestamp)}</span
                >
              {/if}
            </div>
            <div class="leading-relaxed text-foreground message-content-wrapper">
              <MessageContent
                content={message.contentBlocks || []}
                isStreaming={!!message.isStreaming}
                workspaceId={agent?.workspaceId
                  ? String(agent.workspaceId)
                  : $activeWorkspace?.id
                    ? String($activeWorkspace.id)
                    : undefined}
                questionsResolved={message.role === 'assistant' &&
                  messageIndex < lastUserMessageIndex}
              />
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
