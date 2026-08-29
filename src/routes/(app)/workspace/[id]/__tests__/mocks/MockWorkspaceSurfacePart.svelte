<script lang="ts">
  let { marker, active }: { marker?: string; active?: boolean } = $props();
</script>

<div data-workspace-surface-part={marker} data-active={active}></div>
