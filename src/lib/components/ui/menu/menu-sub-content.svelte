<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';
  import ListHighlight from './menu-list-highlight.svelte';
  import { menuOverlay } from './menu-recipes';
  import {
    clampSurface,
    setSurface,
    surfaceClasses,
    useSurface,
  } from '$lib/components/ui/surface-context';

  const uid = $props.id();

  let {
    id = `${uid}-sub-content`,
    ref = $bindable(null),
    class: className,
    portal = true,
    portalProps,
    sideOffset = 4,
    children,
    ...restProps
  }: MenuPrimitive.SubContentProps & {
    portal?: boolean;
    portalProps?: MenuPrimitive.PortalProps;
  } = $props();

  // bits-ui 2.18.1: SubContent is the shared menu primitive, so its available-height
  // var uses the 'menu' prefix — unlike DropdownMenu.Content's 'dropdown-menu' prefix
  // in menu-content.svelte. The differing var names are intentional.
  const maxHeight = 'var(--bits-menu-content-available-height, calc(100dvh - 1rem))';

  const surface = clampSurface(useSurface() + 2);
  setSurface(surface);
  const contentClass = $derived(
    cn(
      menuOverlay(),
      surfaceClasses(surface),
      'min-w-40 overflow-y-auto overscroll-contain p-1',
      className,
    ),
  );

  $effect(() => {
    if (ref) ref.id = id;
  });
</script>

{#if portal}
  <MenuPrimitive.Portal {...portalProps}>
    <MenuPrimitive.SubContent
      bind:ref
      {id}
      data-slot="menu-sub-content"
      data-surface-level={surface}
      class={contentClass}
      {sideOffset}
      style="max-height: {maxHeight}"
      {...restProps}
    >
      <ListHighlight />
      {@render children?.()}
    </MenuPrimitive.SubContent>
  </MenuPrimitive.Portal>
{:else}
  <MenuPrimitive.SubContent
    bind:ref
    {id}
    data-slot="menu-sub-content"
    data-surface-level={surface}
    class={contentClass}
    {sideOffset}
    style="max-height: {maxHeight}"
    {...restProps}
  >
    <ListHighlight />
    {@render children?.()}
  </MenuPrimitive.SubContent>
{/if}
