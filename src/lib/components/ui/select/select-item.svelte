<script lang="ts">
  import { getContext } from 'svelte';
  import type { Snippet } from 'svelte';

  let { value, children, class: className = '', disabled = false }: { value: string; children?: Snippet; class?: string; disabled?: boolean; } = $props();

  const selectContext = getContext<{
    value: string;
    isOpen: boolean;
  }>('select');

  function handleSelect() {
    if (disabled) return;
    selectContext.value = value;
    selectContext.isOpen = false;
  }
</script>

<button
  type="button"
  class="w-full px-2 py-2 text-sm text-left border-none bg-transparent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded {disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-muted/40'} {className}"
  class:selected={selectContext.value === value}
  onclick={handleSelect}
  {disabled}
>
  {@render children?.()}
</button>
