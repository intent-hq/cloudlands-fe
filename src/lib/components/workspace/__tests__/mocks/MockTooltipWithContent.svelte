<script lang="ts">
  /**
   * Test mock: renders both the trigger children and the content snippet
   * inline, and reports an immediate "open" via `onOpenChange` so on-demand
   * fetch-on-open components trigger their fetch during render.
   */
  let { children, content, onOpenChange }: any = $props();

  $effect(() => {
    onOpenChange?.(true);
  });
</script>

{#if children}{@render children()}{/if}
{#if typeof content === 'function'}<div data-testid="tooltip-content">{@render content()}</div>{/if}
