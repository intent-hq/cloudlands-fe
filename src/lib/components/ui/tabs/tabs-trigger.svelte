<script lang="ts">
  import { getContext } from 'svelte';

  let {
    value,
    class: className = '',
    children,
  }: { value: string; class?: string; children?: import('svelte').Snippet } = $props();

  const tabs = getContext<{ activeTab: string }>('tabs');

  function handleClick() {
    tabs.activeTab = value;
  }
</script>

<button
  class={`inline-flex items-center justify-center whitespace-nowrap px-3 py-1.5 text-sm font-medium rounded-md transition-colors border border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${className}`}
  class:bg-background={tabs.activeTab === value}
  class:text-foreground={tabs.activeTab === value}
  class:shadow-sm={tabs.activeTab === value}
  onclick={handleClick}
  type="button"
>
  {@render children?.()}
</button>
