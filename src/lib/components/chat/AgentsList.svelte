<script lang="ts">
  /**
   * AgentsList Component
   *
   * @component
   * @description Displays a list of agent sessions with avatars and metadata.
   * Supports both expanded and collapsed views for sidebar integration.
   *
   * @example
   * ```svelte
   * <AgentsList
   *   agents={agentSessions}
   *   collapsed={false}
   *   maxVisible={10}
   * />
   * ```
   *
   * @props
   * - agents: Array of agent sessions to display
   * - collapsed: Whether to show collapsed view (avatars only)
   * - maxVisible: Maximum number of agents to show (default: 9)
   */
  import type { AgentSession } from '$shared/types';

  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { Button } from '$lib/components/ui/button';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import { isGenericAgentName } from '$lib/utils/agent-name-generator';

  import { openAgentTabRequested } from '$lib/store/slices/app-layout/app-layout-slice';
  import { store as appStore } from '$lib/store/store';

  interface Props {
    agents?: AgentSession[];
    collapsed?: boolean;
    maxVisible?: number;
  }

  let { agents = [], collapsed = false, maxVisible = 9 }: Props = $props();

  function getAgentDisplayName(agent: AgentSession): string {
    // Use agent name if available and not generic
    if (!isGenericAgentName(agent.name)) {
      return agent.name!;
    }

    // Try agentInfo.name as a fallback
    if (!isGenericAgentName(agent.agentInfo?.name)) {
      return agent.agentInfo!.name!;
    }

    // Fallback to agent ID (shortened)
    return `Agent ${agent.id.substring(0, 8)}`;
  }

  function getAgentTimestamp(agent: AgentSession): Date | null {
    // Try to get timestamp from last message first
    if (agent.messages && agent.messages.length > 0) {
      const lastMessage = agent.messages[agent.messages.length - 1];
      if (lastMessage && lastMessage.timestamp) {
        const timestamp = new Date(lastMessage.timestamp);
        if (!isNaN(timestamp.getTime())) {
          return timestamp;
        }
      }
    }

    // Fall back to agent creation time
    if (agent.startedAt) {
      const startedAt = new Date(agent.startedAt);
      if (!isNaN(startedAt.getTime())) {
        return startedAt;
      }
    }

    // Fall back to updated_at if available
    if ((agent as any).updated_at) {
      const updatedAt = new Date((agent as any).updated_at);
      if (!isNaN(updatedAt.getTime())) {
        return updatedAt;
      }
    }

    return null;
  }

  function handleAgentClick(event: MouseEvent, agent: AgentSession) {
    if (agent && agent.id) {
      const panelElement = (event.target as HTMLElement)?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
      const openInAdjacentPanel = event.metaKey || event.ctrlKey;
      appStore.dispatch(
        openAgentTabRequested(agent.workspaceId, {
          agentId: agent.id,
          sourcePanelId,
          openInAdjacentPanel,
        }),
      );
    }
  }

  // Svelte 5: Use $derived for computed values
  // Ensure agents is an array before using array methods, and dedupe by ID
  let visibleAgents = $derived.by(() => {
    const arr = Array.isArray(agents) ? agents : [];
    const seen = new Set<string>();
    const deduped: AgentSession[] = [];
    for (const a of arr) {
      if (a && a.id && !seen.has(a.id)) {
        seen.add(a.id);
        deduped.push(a);
      }
    }
    return deduped.slice(0, collapsed ? 5 : maxVisible);
  });
</script>

{#if !collapsed}
  <div class="py-7 overflow-hidden">
    <div class="px-5 mb-1.5 flex justify-between items-center">
      <h4 class="text-xs font-medium text-subtle">Threads</h4>
    </div>

    {#if visibleAgents.length > 0}
      {#each visibleAgents as agent (agent.id)}

        {@const timestamp = getAgentTimestamp(agent)}
        {@const specialistId = agent.metadata?.specialist || agent.agentMetadata?.specialist}
        <div class="pl-3">
          <Button
            variant="ghost"
            size="sm"
            class="w-full justify-start text-left p-2"
            onclick={(e) => handleAgentClick(e, agent)}
            title="Agent thread"
          >
            <div class="flex items-start gap-2 w-full">
              <AuggieAvatar
                agentId={agent.id}
                size={18}
                specialist={specialistId === 'spec-writer' ||
                specialistId === 'implementor' ||
                specialistId === 'verifier'
                  ? specialistId
                  : null}
              />
              <div class="flex-1 min-w-0 pt-1">
                <div class="truncate text-xs font-medium">
                  {getAgentDisplayName(agent)}
                </div>
                <!-- {#if lastMessage}
										<div class="truncate text-xs text-subtle mt-0.5">
											{lastMessage}
										</div>
									{/if} -->
              </div>
              {#if timestamp}
                <span class="text-xs text-subtle shrink-0">
                  <RelativeTime date={timestamp} compact={true} />
                </span>
              {/if}
            </div>
          </Button>
        </div>
      {/each}
    {:else}
      <div class="px-4 py-2 text-sm text-subtle">No threads yet</div>
    {/if}
  </div>
{:else}
  <!-- Collapsed view - show agent avatars -->
  <div class="py-7">
    {#if visibleAgents.length > 0}
      {#each visibleAgents as agent (agent.id)}
        {@const collapsedSpecialistId =
          agent.metadata?.specialist || agent.agentMetadata?.specialist}
        <div class="px-2 py-1">
          <button
            class="w-full h-8 flex items-center justify-center rounded-md hover:bg-accent transition-colors"
            onclick={(e) => handleAgentClick(e, agent)}
            title={getAgentDisplayName(agent)}
          >
            <AuggieAvatar
              agentId={agent.id}
              size={18}
              specialist={collapsedSpecialistId === 'spec-writer' ||
              collapsedSpecialistId === 'implementor' ||
              collapsedSpecialistId === 'verifier'
                ? collapsedSpecialistId
                : null}
            />
          </button>
        </div>
      {/each}
    {/if}
  </div>
{/if}
