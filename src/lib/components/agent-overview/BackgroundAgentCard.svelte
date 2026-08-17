<script lang="ts" module>
  // Fixed size for background agent avatars - exported for layout calculations
  export const BG_CARD_SIZE = 50;
</script>

<script lang="ts">
  /**
   * BackgroundAgentCard Component
   *
   * A simplified avatar-only card for background/permanent crew agents.
   * Shows just the state-colored avatar with a circular muted background.
   */
  import type { AgentNode } from './types';
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import {
    getAvatarState,
    getAvatarStateForSession,
  } from '$features/agent/components/agent-avatar/avatar-state';
  import {
    selectAgentAttentionRequest,
    selectAgentSession,
    selectAgentIsWaitingForOtherAgents,
  } from '$store/renderer/slices/agent-session/agent-session-selectors';

  interface Props {
    agent: AgentNode;
    onclick?: (event: MouseEvent) => void;
    onmouseenter?: (event: MouseEvent) => void;
    onmouseleave?: (event: MouseEvent) => void;
  }

  let { agent, onclick, onmouseenter, onmouseleave }: Props = $props();

  // svelte-ignore state_referenced_locally - selector readables must be created at component init; agentId is stable per card
  const agentIsWaitingForOtherAgents$ = selectAgentIsWaitingForOtherAgents(agent.agentId);
  // svelte-ignore state_referenced_locally - selector readables must be created at component init; agentId is stable per card
  const attentionRequest$ = selectAgentAttentionRequest(agent.agentId);
  // svelte-ignore state_referenced_locally - selector readables must be created at component init; agentId is stable per card
  const agentSession$ = selectAgentSession(agent.agentId);

  const avatarState = $derived.by(() => {
    const options = { attentionKind: $attentionRequest$?.kind ?? null };
    if ($agentSession$) return getAvatarStateForSession($agentSession$, options);
    return getAvatarState(
      {
        status: agent.status,
        isResponding: agent.status === 'responding',
        isWaitingForOtherAgents: $agentIsWaitingForOtherAgents$,
      },
      {
        ...options,
        isCompleted: agent.status === 'completed',
        isFailed: agent.status === 'failed',
      },
    );
  });
</script>

<button
  type="button"
  class="background-agent-card relative flex flex-col items-center justify-center gap-1 rounded-full bg-sidebar hover:bg-muted/70 transition-colors cursor-pointer p-2"
  style="width: {BG_CARD_SIZE}px; min-height: {BG_CARD_SIZE}px; anchor-name: --agent-hierarchy-{agent.agentId};"
  {onclick}
  {onmouseenter}
  {onmouseleave}
>
  <span class="sr-only">{agent.name}</span>
  <AgentAvatarWithState
    agentId={agent.agentId}
    size={32}
    state={avatarState}
    specialist={agent.specialist as 'spec-writer' | 'implementor' | 'verifier' | null}
  />
</button>
