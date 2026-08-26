<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';

  let {
    trigger,
    children,
    class: className = '',
  }: { trigger?: Snippet; content?: Snippet; children?: Snippet; class?: string } = $props();
</script>

<!-- Mirrors the real TooltipRich trigger's class merge (cn('inline-flex', className))
     on a wrapper span. data-mock-tooltip-trigger is a test-only selector: in
     production DOM, rows with an interactive child get data-tooltip-trigger
     forwarded to the child instead of the wrapper span. -->
{#if trigger}
  <span data-mock-tooltip-trigger class={cn('inline-flex', className)}>{@render trigger()}</span>
{/if}
{#if children}
  {@render children()}
{/if}
