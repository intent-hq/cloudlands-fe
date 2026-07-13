<script lang="ts">
  let { children, content }: any = $props();
</script>

{#if children}{@render children()}{/if}
{#if content}
  <div data-testid="mock-tooltip-content">{@render content()}</div>
{/if}

