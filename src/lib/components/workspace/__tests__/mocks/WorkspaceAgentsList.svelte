<script lang="ts">
  import type { AgentSession } from '$shared/types';

  let { agents = [] }: { agents?: AgentSession[] } = $props();
</script>

<div data-testid="workspace-agents-list">
  {#each agents as agent (agent.id)}
    <span data-expanded-agent={agent.id}>{agent.name}</span>
  {/each}
</div>
