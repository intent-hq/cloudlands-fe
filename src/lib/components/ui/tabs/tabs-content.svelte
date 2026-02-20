<script lang="ts">
  import { getContext } from 'svelte';

  let {
    value,
    class: className = '',
    children,
  }: { value: string; class?: string; children?: import('svelte').Snippet } = $props();

  const tabs = getContext<{ activeTab: string }>('tabs');
</script>

{#if tabs.activeTab === value}
  <div class="w-full h-full {className}">
    {@render children?.()}
  </div>
{/if}
