<script lang="ts" module>
  // Fixed size for background agent avatars - exported for layout calculations
  export const BG_CARD_SIZE = 50; // Increased to accommodate status indicator
</script>

<script lang="ts">
  /**
   * BackgroundAgentCard Component
   *
   * A simplified avatar-only card for background/permanent crew agents.
   * Shows just the avatar with a circular muted background.
   * When running, shows thinking/tool call indicator below.
   */
  import type { AgentNode } from './types';
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import type { AvatarState } from '$lib/components/ui/auggie-avatar/avatar-state';
  import { Spinner } from '$lib/components/ui/indicators';
  import Fa from 'svelte-fa';
  import { classifyTool } from '$lib/components/chat/tool-classifier';
  import { selectAgentIsWaitingForOtherAgents } from '$lib/store/slices/agent-session/agent-session-selectors';

  interface Props {
    agent: AgentNode;
    onclick?: (event: MouseEvent) => void;
    onmouseenter?: (event: MouseEvent) => void;
    onmouseleave?: (event: MouseEvent) => void;
  }

  let { agent, onclick, onmouseenter, onmouseleave }: Props = $props();

  const isActive = $derived(agent.status === 'responding');
  const agentIsWaitingForOtherAgents$ = selectAgentIsWaitingForOtherAgents(agent.agentId);
  const isWaitingForOtherAgents = $derived($agentIsWaitingForOtherAgents$);

  // Map agent status to avatar state
  function getAvatarState(status: AgentNode['status'], waitingForOtherAgents: boolean): AvatarState {
    if (waitingForOtherAgents) return 'waiting';
    if (status === 'responding') return 'running';
    if (status === 'completed') return 'completed';
    if (status === 'failed') return 'failed';
    return 'idle';
  }

  const avatarState = $derived(getAvatarState(agent.status, isWaitingForOtherAgents));
</script>

<button
  type="button"
  class="background-agent-card relative flex flex-col items-center justify-center gap-1 rounded-full bg-sidebar hover:bg-muted/70 transition-colors cursor-pointer p-2"
  style="width: {BG_CARD_SIZE}px; min-height: {BG_CARD_SIZE}px; anchor-name: --agent-hierarchy-{agent.agentId};"
  {onclick}
  {onmouseenter}
  {onmouseleave}
>
  <AugieAvatarWithState
    agentId={agent.agentId}
    size={32}
    state={avatarState}
    specialist={agent.specialist as 'spec-writer' | 'implementor' | 'verifier' | null}
  />

  <!-- Status indicator for running agents -->
  {#if isActive}
    <div
      class="status-indicator absolute bottom-0 transform translate-y-1/2 flex items-center justify-center"
    >
      {#if agent.activeToolName}
        {@const toolDisplay = classifyTool(agent.activeToolName, {})}
        <Fa icon={toolDisplay.icon} class="w-3 h-3 text-ghost" />
      {:else}
        <Spinner seed={agent.agentId} size={4} />
      {/if}
    </div>
  {/if}
</button>
