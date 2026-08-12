<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Select as SelectPrimitive } from 'bits-ui';

  let {
    value,
    label,
    disabled = false,
    children,
    class: className = '',
  }: {
    value: string;
    label?: string;
    disabled?: boolean;
    children?: Snippet;
    class?: string;
  } = $props();
</script>

<SelectPrimitive.Item
  {value}
  label={label ?? value}
  {disabled}
  class="group type-body flex min-h-(--control-height-compact) w-full min-w-0 cursor-pointer items-center gap-2 rounded-(--radius-small) border-none bg-transparent px-2 py-1 text-left outline-none transition-colors duration-(--motion-fast) data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[selected]:bg-accent/60 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 motion-reduce:transition-none {className}"
>
  <div class="min-w-0 flex-1 truncate">{@render children?.()}</div>
  <span
    data-slot="select-item-check"
    class="text-primary shrink-0 font-medium opacity-0 group-data-[selected]:opacity-100"
    aria-hidden="true">✓</span
  >
</SelectPrimitive.Item>
