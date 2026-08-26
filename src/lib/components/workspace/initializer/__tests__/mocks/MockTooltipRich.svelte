<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    trigger,
    children,
    class: className = '',
  }: { trigger?: Snippet; content?: Snippet; children?: Snippet; class?: string } = $props();
</script>

<!-- Mirrors the real TooltipRich trigger: a wrapper span carrying the class prop. -->
{#if trigger}
  <span data-tooltip-trigger class={className}>{@render trigger()}</span>
{/if}
{#if children}
  {@render children()}
{/if}
