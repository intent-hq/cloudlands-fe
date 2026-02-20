<script lang="ts">
  import { getContext } from 'svelte';

  let { placeholder = 'Select an option' }: { placeholder?: string } = $props();

  const selectContext = getContext<{
    value: string;
    isOpen: boolean;
  }>('select');
</script>

<span class="flex-1 text-left truncate">
  {selectContext.value || placeholder}
</span>
