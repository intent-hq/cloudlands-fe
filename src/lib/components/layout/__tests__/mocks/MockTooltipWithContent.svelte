<script lang="ts">
  /**
   * Passthrough tooltip mock that also renders the `content` snippet inline
   * (as a sibling with role="tooltip"), so tests can assert tooltip text
   * without simulating hover.
   */
  let { children, content }: any = $props();
</script>

{#if children}{@render children()}{/if}
{#if typeof content === 'function'}
  <span role="tooltip">{@render content()}</span>
{:else if content}
  <span role="tooltip">{content}</span>
{/if}
