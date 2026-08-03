<script lang="ts">
  /** Test mock: renders both the trigger children and the content snippet inline. */
  let { children, content }: any = $props();
</script>

{#if children}{@render children()}{/if}
{#if typeof content === 'function'}<div data-testid="tooltip-content">{@render content()}</div>{/if}
