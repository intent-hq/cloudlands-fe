<script lang="ts">
  import { getContext } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';

  let { placeholder = m.ui_select_value_placeholder() }: { placeholder?: string } = $props();

  const selectContext = getContext<{
    value: string;
    isOpen: boolean;
  }>('select');
</script>

<span class="flex-1 text-left truncate">
  {selectContext.value || placeholder}
</span>
