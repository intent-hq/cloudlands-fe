<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Select as SelectPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils';
  import { menuItem } from '../menu/menu-recipes';
  import { Indicator } from '$lib/components/ui/menu';

  let {
    value,
    label,
    disabled = false,
    children: itemContent,
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
  aria-disabled={disabled || undefined}
  data-menu-item
  class={cn(menuItem(), className)}
>
  {#snippet children({ selected })}
    <div class="min-w-0 flex-1 truncate">{@render itemContent?.()}</div>
    <Indicator state={selected ? 'checked' : 'empty'} data-slot="select-item-check" />
  {/snippet}
</SelectPrimitive.Item>
