<script lang="ts">
  let { onSelectAgent }: { onSelectAgent?: (agentId: string) => void } = $props();

  export async function expandAll() {}
  export function collapseAll() {}
  export function getHasExpandedDirectories() {
    return false;
  }
</script>

<div data-testid="files-panel">
  <button data-files-agent-callback onclick={() => onSelectAgent?.('agent-b')}>Agent</button>
</div>
