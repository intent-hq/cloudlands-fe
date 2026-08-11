<script lang="ts">
  let { children, content, title, delayDuration }: any = $props();
</script>

<div data-tooltip-title={title} data-tooltip-delay={delayDuration}>
  {@render children?.()}
</div>
{#if content}
  <div data-testid="workspace-tab-preview">{@render content()}</div>
{/if}
