<script lang="ts">
  let { onOpenAgent }: { onOpenAgent?: (agentId: string) => void } = $props();
</script>

<button data-context-agent-callback onclick={() => onOpenAgent?.('agent-b')}>Agent</button>
