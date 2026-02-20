<script lang="ts">
  import { unifiedStateStore } from '$features/agent/services/unified-state-store';
  import { createLogger } from '$lib/utils/client-logger';
  import Fa from 'svelte-fa-original';
  import { faRobot } from '@fortawesome/free-solid-svg-icons';

  const logger = createLogger('TaskAgentCard');

  let {
    agentId,
    onViewConversation,
  }: {
    agentId: string;
    onViewConversation?: () => void;
  } = $props();

  // Get agent state from the unified store
  const workspace = $derived(unifiedStateStore.getCurrentWorkspace());
  const agent = $derived(workspace?.agents.get(agentId));

  // Get the last message or streaming content
  const lastMessage = $derived.by(() => {
    if (!agent) return null;

    if (agent.streaming?.buffer) {
      return agent.streaming.buffer;
    }

    if (agent.session?.messages && agent.session.messages.length > 0) {
      const lastMsg = agent.session.messages[agent.session.messages.length - 1];
      // Extract text from contentBlocks
      if (lastMsg.contentBlocks && lastMsg.contentBlocks.length > 0) {
        const textBlocks = lastMsg.contentBlocks
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text || '')
          .join(' ');
        return textBlocks || null;
      }
    }

    return null;
  });

  const handleViewConversation = () => {
    logger.info('View conversation clicked', { agentId });
    onViewConversation?.();
  };
</script>

{#if agent}
  <div
    class="agent-card ml-6 mt-2 p-3 rounded-lg border border-blue-200 bg-blue-50 animate-slideDown"
  >
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2">
        <Fa icon={faRobot} class="w-4 h-4 text-blue-600" />
        <span class="text-sm font-medium text-blue-900">
          {agent?.session?.name || 'Agent'}
        </span>
        {#if agent?.streaming?.active}
          <span class="flex items-center gap-1 text-xs text-blue-600">
            <span class="w-2 h-2 bg-blue-600 rounded-full animate-pulse"></span>
            Streaming
          </span>
        {:else if agent?.session?.status === 'active'}
          <span class="flex items-center gap-1 text-xs text-green-600">
            <span class="w-2 h-2 bg-green-600 rounded-full"></span>
            Active
          </span>
        {:else}
          <span class="flex items-center gap-1 text-xs text-gray-500">
            <span class="w-2 h-2 bg-gray-400 rounded-full"></span>
            Idle
          </span>
        {/if}
      </div>
      <button
        onclick={handleViewConversation}
        class="text-xs text-blue-600 hover:text-blue-700 hover:underline"
      >
        View conversation →
      </button>
    </div>

    {#if lastMessage}
      <div class="text-sm text-gray-700 line-clamp-3">
        <span class="streaming-content">
          {lastMessage}
          {#if agent?.streaming?.active}
            <span class="inline-block w-2 h-4 bg-gray-600 animate-pulse ml-0.5"></span>
          {/if}
        </span>
      </div>
    {:else}
      <div class="text-sm text-gray-500 italic">Waiting for agent response...</div>
    {/if}
  </div>
{/if}

<style>
  .agent-card {
    animation: slideDown 0.2s ease-out;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .streaming-content {
    display: inline;
  }
</style>
