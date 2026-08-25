<script lang="ts">
  import type { AgentSession } from '$shared/types';

  let {
    agents = [],
    onSelect,
  }: {
    agents?: AgentSession[];
    onSelect?: (detail: { agentId: string; event?: MouseEvent | KeyboardEvent }) => void;
  } = $props();
</script>

<div data-testid="workspace-agents-list">
  {#each agents as agent (agent.id)}
    <button
      data-expanded-agent={agent.id}
      data-expanded-agent-specialist={agent.metadata?.specialist ||
        agent.agentMetadata?.specialist ||
        undefined}
      onclick={(event) => onSelect?.({ agentId: agent.id, event })}>{agent.name}</button
    >
  {/each}
</div>
