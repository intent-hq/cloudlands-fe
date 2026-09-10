<script lang="ts">
  import { Popover as PopoverPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils';
  import { menuOverlay } from '../menu/menu-recipes';
  import { clampSurface, setSurface, SURFACE_BG, useSurface } from '../surface-context';
  import { useStaticOverlay } from '../static-overlay-context.svelte';

  let {
    class: className,
    portal = true,
    portalProps,
    staticPosition,
    sideOffset = 4,
    children,
    ...restProps
  }: PopoverPrimitive.ContentProps & {
    portal?: boolean;
    portalProps?: PopoverPrimitive.PortalProps;
    staticPosition?: boolean;
  } = $props();

  const rootStaticPosition = useStaticOverlay();
  const isStatic = $derived(staticPosition ?? rootStaticPosition());
  const surface = clampSurface(useSurface() + 2);
  setSurface(surface);
  const contentClass = $derived(cn(menuOverlay(), SURFACE_BG[surface], className));
</script>

{#if isStatic}
  <PopoverPrimitive.ContentStatic
    preventScroll={false}
    trapFocus={false}
    data-slot="popover-content"
    data-static-position
    data-surface-level={surface}
    class={contentClass}
    {...restProps as any}
  >
    {@render children?.()}
  </PopoverPrimitive.ContentStatic>
{:else if portal}
  <PopoverPrimitive.Portal {...portalProps}>
    <PopoverPrimitive.Content
      data-slot="popover-content"
      data-surface-level={surface}
      class={contentClass}
      {sideOffset}
      {...restProps}
    >
      {@render children?.()}
    </PopoverPrimitive.Content>
  </PopoverPrimitive.Portal>
{:else}
  <PopoverPrimitive.Content
    data-slot="popover-content"
    data-surface-level={surface}
    class={contentClass}
    {sideOffset}
    {...restProps}
  >
    {@render children?.()}
  </PopoverPrimitive.Content>
{/if}
