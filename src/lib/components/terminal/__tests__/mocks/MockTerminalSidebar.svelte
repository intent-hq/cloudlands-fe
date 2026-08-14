<script lang="ts">
  let {
    workspaceId,
    onSelectScript,
  }: {
    workspaceId: string;
    onSelectScript?: (scriptId: string | null) => void;
  } = $props();
</script>

<input aria-label="Sidebar state" value="retained" />
<button type="button" onclick={() => onSelectScript?.(`direct-${workspaceId}`)}>
  Direct select {workspaceId}
</button>
