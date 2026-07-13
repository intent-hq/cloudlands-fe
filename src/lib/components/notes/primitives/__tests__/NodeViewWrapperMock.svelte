<script lang="ts">
  let { children } = $props();
</script>

<div data-testid="node-view-wrapper">
  {@render children?.()}
</div>