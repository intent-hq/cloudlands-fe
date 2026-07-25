<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    trigger,
    children,
  }: { trigger?: Snippet; content?: Snippet; children?: Snippet } = $props();
</script>

{#if trigger}
  {@render trigger()}
{/if}
{#if children}
  {@render children()}
{/if}
