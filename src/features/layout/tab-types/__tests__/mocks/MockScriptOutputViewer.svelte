<script lang="ts">
  let { scriptId, runDisabled = false }: { scriptId?: string; runDisabled?: boolean } = $props();
</script>

<div
  data-testid="mock-terminal"
  data-script-id={scriptId}
  data-run-disabled={String(runDisabled)}
></div>
