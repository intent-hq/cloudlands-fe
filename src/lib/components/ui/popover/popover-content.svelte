<script lang="ts">
  import { Popover as PopoverPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils';
  import { menuOverlay } from '../menu/menu-recipes';
  import { clampSurface, setSurface, useSurface } from '../surface-context';
  import { useStaticOverlay } from '../static-overlay-context.svelte';
  import { OVERLAY_VIEWPORT_GUTTER } from '$lib/components/ui/overlay-positioning';

  let {
    class: className,
    portal = true,
    portalProps,
    staticPosition,
    sideOffset = 4,
    collisionPadding = OVERLAY_VIEWPORT_GUTTER,
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
  const contentClass = $derived(cn(menuOverlay(), className));
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
      {collisionPadding}
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
    {collisionPadding}
    {...restProps}
  >
    {@render children?.()}
  </PopoverPrimitive.Content>
{/if}
