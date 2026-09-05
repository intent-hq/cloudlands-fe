<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Select as SelectPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils';
  import { menuItem } from '../menu/menu-recipes';

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
  data-menu-item
  class={cn(menuItem(), 'min-h-(--control-height-compact) px-2 py-1.5 text-xs', className)}
>
  <div class="min-w-0 flex-1 truncate">{@render children?.()}</div>
  <span
    data-slot="select-item-check"
    class="text-primary-ink shrink-0 font-medium opacity-0 group-data-[selected]:opacity-100"
    aria-hidden="true">✓</span
  >
</SelectPrimitive.Item>
