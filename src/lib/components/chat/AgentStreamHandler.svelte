<script lang="ts">
  import { onDestroy } from 'svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import { agentService, type AgentMessage } from '$features/agent/agent-ipc-bridge';
  import type { ContentBlock } from '$shared/types';

  const logger = createLogger('AgentStreamHandler');

  // Props
  let {
    agentId,
    sessionId = null,
    workspaceId,
  } = $props<{
    agentId: string;
    sessionId?: string | null;
    workspaceId: string;
  }>();

  // State exposed to parent
  let streamingError = $state<string | null>(null);
  let messages = $state<AgentMessage[]>([]);

  // Internal state
  let isStreaming = $state(false);
  let streamingContent = $state<ContentBlock[] | null>(null);
  let unsubscribe: (() => void) | null = null;
  let streamStartTime: number | null = null;
  let messageAccumulator: Map<string, ContentBlock[]> = new Map();
  let lastMessageId: string | null = null;

  // Statistics
  let streamStats = $state({
    totalBlocks: 0,
    textBlocks: 0,
    toolBlocks: 0,
    duration: 0,
    bytesReceived: 0,
  });

  // Methods
  export function startStreaming() {
    isStreaming = true;
    streamingError = null;
    streamStartTime = Date.now();
    streamStats = {
      totalBlocks: 0,
      textBlocks: 0,
      toolBlocks: 0,
      duration: 0,
      bytesReceived: 0,
    };
  }

  export function stopStreaming() {
    isStreaming = false;
    if (streamStartTime) {
      streamStats.duration = Date.now() - streamStartTime;
      streamStartTime = null;
    }
    streamingContent = null;
    messageAccumulator.clear();
  }

  export function handleStreamError(error: string) {
    logger.error('Stream error', { error, agentId });
    streamingError = error;
    stopStreaming();
  }

  // Subscribe to agent service events
  function subscribeToAgent() {
    if (!agentId) return;

    logger.info('Subscribing to agent stream', { agentId, sessionId, workspaceId });

    // Clean up previous subscription
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    // Subscribe to agent service events
    const handleStreamStart = (data: any) => {
      if (data.agentId === agentId) {
        logger.info('Stream started', { agentId });
        startStreaming();
      }
    };

    const handleStreamContent = (data: any) => {
      if (data.agentId !== agentId) return;

      try {
        // Handle content blocks
        if (data.content) {
          const blocks = Array.isArray(data.content) ? data.content : [data.content];

          // Update accumulator
          const messageId = data.messageId || 'current';
          if (!messageAccumulator.has(messageId)) {
            messageAccumulator.set(messageId, []);
          }

          const accumulated = messageAccumulator.get(messageId)!;

          // Process each block
          blocks.forEach((block: ContentBlock) => {
            // Update statistics
            streamStats.totalBlocks++;
            if (block.type === 'text') {
              streamStats.textBlocks++;
              streamStats.bytesReceived += block.text?.length || 0;
            } else if (block.type === 'tool_use') {
              streamStats.toolBlocks++;
            }

            // Find or create block in accumulator
            const existingIndex = accumulated.findIndex(
              (b) => b.type === block.type && (b.type === 'tool_use' ? b.id === block.id : true),
            );

            if (existingIndex >= 0) {
              // Update existing block
              if (block.type === 'text') {
                accumulated[existingIndex] = {
                  ...accumulated[existingIndex],
                  text: (accumulated[existingIndex].text || '') + (block.text || ''),
                };
              } else {
                accumulated[existingIndex] = { ...accumulated[existingIndex], ...block };
              }
            } else {
              // Add new block
              accumulated.push(block);
            }
          });

          // Update streaming content
          streamingContent = [...accumulated];
          lastMessageId = messageId;
        }

        // Handle complete messages
        if (data.message) {
          const newMessage = data.message as AgentMessage;

          // Update or add message
          const existingIndex = messages.findIndex((m) => m.id === newMessage.id);
          if (existingIndex >= 0) {
            messages[existingIndex] = newMessage;
          } else {
            messages = [...messages, newMessage];
          }

          // Clear accumulator for this message
          if (newMessage.id) {
            messageAccumulator.delete(newMessage.id);
          }
        }
      } catch (error) {
        logger.error('Error processing stream content', { error, data });
      }
    };

    const handleStreamEnd = (data: any) => {
      if (data.agentId === agentId) {
        logger.info('Stream ended', {
          agentId,
          stats: streamStats,
          duration: streamStartTime ? Date.now() - streamStartTime : 0,
        });

        // Finalize any pending content
        if (lastMessageId && messageAccumulator.has(lastMessageId)) {
          const finalContent = messageAccumulator.get(lastMessageId);
          if (finalContent && finalContent.length > 0) {
            // Find and update the message
            const messageIndex = messages.findIndex((m) => m.id === lastMessageId);
            if (messageIndex >= 0) {
              messages[messageIndex] = {
                ...messages[messageIndex],
                contentBlocks: finalContent,
              };
            }
          }
        }

        stopStreaming();
      }
    };

    const handleStreamError = (data: any) => {
      if (data.agentId === agentId) {
        handleStreamError(data.error || 'Stream error occurred');
      }
    };

    const handleMessagesUpdate = (data: any) => {
      if (data.agentId === agentId && data.messages) {
        messages = data.messages;
      }
    };

    // Register event listeners
    agentService.on('stream:start', handleStreamStart);
    agentService.on('stream:content', handleStreamContent);
    agentService.on('stream:end', handleStreamEnd);
    agentService.on('stream:error', handleStreamError);
    agentService.on('messages:update', handleMessagesUpdate);

    // Return unsubscribe function
    unsubscribe = () => {
      agentService.off('stream:start', handleStreamStart);
      agentService.off('stream:content', handleStreamContent);
      agentService.off('stream:end', handleStreamEnd);
      agentService.off('stream:error', handleStreamError);
      agentService.off('messages:update', handleMessagesUpdate);
    };
  }

  // React to agent ID changes
  $effect(() => {
    if (agentId) {
      subscribeToAgent();
    }
  });

  // Cleanup on destroy
  onDestroy(() => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    messageAccumulator.clear();
  });
</script>

<!-- This component has no UI - it's a pure logic component -->
{#if streamingError}
  <div
    class="flex items-center gap-2 px-4 py-3 bg-destructive/10 text-destructive-foreground border border-destructive rounded-lg my-2 text-sm"
  >
    <span class="text-xl">⚠️</span>
    <span class="flex-1">{streamingError}</span>
  </div>
{/if}
