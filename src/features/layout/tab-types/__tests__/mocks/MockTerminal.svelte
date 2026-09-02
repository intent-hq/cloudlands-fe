<script lang="ts">
  let { terminalId }: { terminalId?: string } = $props();
</script>

<div data-testid="mock-terminal" data-terminal-id={terminalId}></div>
