<script lang="ts">
  import { getContext } from 'svelte';
  import type { Snippet } from 'svelte';

  let { value, children, class: className = '' }: { value: string; children?: Snippet; class?: string; } = $props();

  const selectContext = getContext<{
    value: string;
    isOpen: boolean;
  }>('select');

  function handleSelect() {
    selectContext.value = value;
    selectContext.isOpen = false;
  }
</script>

<button
  type="button"
  class="w-full px-2 py-2 text-sm text-left cursor-pointer border-none bg-transparent transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded {className}"
  class:selected={selectContext.value === value}
  onclick={handleSelect}
>
  {@render children?.()}
</button>
