<script lang="ts">
  import { getContext } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';

  let { placeholder = m.ui_select_value_placeholder() }: { placeholder?: string } = $props();
  const selectContext = getContext<{ value: string; displayValue: string }>('canonical-select');
</script>

<span
  class="min-w-0 flex-1 truncate text-left {selectContext.value
    ? 'text-foreground'
    : 'text-muted-foreground/70'}"
>
  {selectContext.displayValue || placeholder}
</span>
