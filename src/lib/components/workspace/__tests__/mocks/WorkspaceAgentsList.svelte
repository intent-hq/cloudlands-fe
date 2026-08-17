<script lang="ts">
  import type { AgentSession } from '$shared/types';

  let { agents = [] }: { agents?: AgentSession[] } = $props();
</script>

<div data-testid="workspace-agents-list">
  {#each agents as agent (agent.id)}
    <span
      data-expanded-agent={agent.id}
      data-expanded-agent-specialist={agent.metadata?.specialist ||
        agent.agentMetadata?.specialist ||
        undefined}>{agent.name}</span
    >
  {/each}
</div>
