<script lang="ts">
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import { getAvatarState } from '$features/agent/components/agent-avatar/avatar-state';
  import {
    selectAgentIsBlockedWaiting,
    selectAgentIsResponding,
    selectAgentSession,
  } from '$store/renderer/slices/agent-session/agent-session-selectors';

  interface Props {
    agentId: string;
  }

  let { agentId }: Props = $props();

  // svelte-ignore state_referenced_locally -- mention rows are keyed by agentId; selectors initialize once.
  const session$ = selectAgentSession(agentId);
  // svelte-ignore state_referenced_locally -- mention rows are keyed by agentId; selectors initialize once.
  const isResponding$ = selectAgentIsResponding(agentId);
  // svelte-ignore state_referenced_locally -- mention rows are keyed by agentId; selectors initialize once.
  const isWaiting$ = selectAgentIsBlockedWaiting(agentId);

  const state = $derived(
    getAvatarState({
      isStreaming: $isResponding$ && !$isWaiting$,
      status: $isWaiting$ ? 'waiting' : $session$?.status,
    }),
  );
</script>

<AgentAvatarWithState {agentId} size={16} {state} />
