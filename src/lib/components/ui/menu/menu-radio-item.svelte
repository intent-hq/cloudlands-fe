<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';
  import type { WithoutChildrenOrChild } from '$lib/utils.js';
  import { menuItem } from './menu-recipes';
  import Indicator from './menu-indicator.svelte';
  import { useMenuIconColumn } from './menu-layout-context.svelte';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';

  let {
    ref = $bindable(null),
    class: className,
    closeOnSelect = false,
    swatch,
    leading,
    children,
    ...restProps
  }: WithoutChildrenOrChild<MenuPrimitive.RadioItemProps> & {
    children?: Snippet;
    leading?: Snippet;
    /** Semantic HSL channels; supply an accessible name with aria-label. */
    swatch?: string;
  } = $props();
  const reserveIcon = useMenuIconColumn(() => !swatch && !!leading);
</script>

{#snippet radioContent({ checked }: { checked: boolean })}
  {#if swatch}
    <span
      class="flex size-5.5 items-center justify-center rounded-full"
      style:background={`hsl(${swatch})`}
      style:color="hsl(var(--swatch-foreground))"
      aria-hidden="true"
    >
      {#if checked}<Fa icon={faCheck} size={12} />{/if}
    </span>
  {:else}
    {#if leading || reserveIcon()}
      <span
        data-slot="menu-item-leading"
        class="first-line-icon w-(--menu-icon-size)"
        aria-hidden="true"
      >
        {@render leading?.()}
      </span>
    {/if}
    {@render children?.()}
    <Indicator state={checked ? 'checked' : 'empty'} />
  {/if}
{/snippet}

<MenuPrimitive.RadioItem
  bind:ref
  children={radioContent}
  data-slot="menu-radio-item"
  data-menu-item
  data-selection-appearance={swatch ? 'indicator' : undefined}
  {closeOnSelect}
  class={cn(menuItem(), swatch && 'size-7 w-7 shrink-0 items-center justify-center p-0', className)}
  {...restProps}
/>
