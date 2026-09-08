<script lang="ts">
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import { getAvatarStateForSession } from '$features/agent/components/agent-avatar/avatar-state';
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';

  interface Props {
    agentId: string;
  }

  let { agentId }: Props = $props();

  // svelte-ignore state_referenced_locally -- mention rows are keyed by agentId; selectors initialize once.
  const session$ = selectAgentSession(agentId);

  const state = $derived(getAvatarStateForSession($session$));
</script>

<AgentAvatarWithState {agentId} variant="compact" {state} />
