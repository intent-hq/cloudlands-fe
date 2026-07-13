<script lang="ts">
  import { setContext } from 'svelte';

  let {
    value = $bindable(''),
    class: className = '',
    children,
  }: { value: string; class?: string; children?: import('svelte').Snippet } = $props();

  setContext('tabs', {
    get activeTab() {
      return value;
    },
    set activeTab(v: string) {
      value = v;
    },
  });
</script>

<div class="w-full h-full {className}">
  {@render children?.()}
</div>
