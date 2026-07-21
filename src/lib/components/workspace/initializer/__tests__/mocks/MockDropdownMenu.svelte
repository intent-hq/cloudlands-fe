<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    open = $bindable(false),
    trigger,
    content,
  }: {
    open?: boolean;
    trigger?: Snippet<[{ toggle: () => void }]>;
    content?: Snippet;
  } = $props();
</script>

{#if trigger}
  {@render trigger({ toggle: () => (open = !open) })}
{/if}
{#if open && content}
  {@render content()}
{/if}
