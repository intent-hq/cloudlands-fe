<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';
  import ListHighlight from './menu-list-highlight.svelte';
  import { menuOverlay } from './menu-recipes';
  import {
    clampSurface,
    setSurface,
    SURFACE_BG,
    useSurface,
  } from '$lib/components/ui/surface-context';
  import { OPTION_LIST_CONTAINER_CLASS } from '$lib/styles/option-list-row';
  import { useStaticOverlay } from '../static-overlay-context.svelte';

  const uid = $props.id();

  let {
    id = `${uid}-content`,
    ref = $bindable(null),
    class: className,
    portal = true,
    portalProps,
    staticPosition,
    sideOffset = 4,
    // bits-ui 2.18.1: DropdownMenu.Content sizes via the 'dropdown-menu'-prefixed
    // floating CSS vars, while SubContent (menu-sub-content.svelte) uses the shared
    // 'menu' prefix — the differing var names between the two files are intentional.
    maxHeight = 'var(--bits-dropdown-menu-content-available-height, calc(100dvh - 1rem))',
    children,
    ...restProps
  }: MenuPrimitive.ContentProps & {
    portal?: boolean;
    portalProps?: MenuPrimitive.PortalProps;
    maxHeight?: string;
    staticPosition?: boolean;
  } = $props();

  const rootStaticPosition = useStaticOverlay();
  const isStatic = $derived(staticPosition ?? rootStaticPosition());
  const surface = clampSurface(useSurface() + 2);
  setSurface(surface);
  const contentClass = $derived(
    cn(
      menuOverlay(),
      SURFACE_BG[surface],
      OPTION_LIST_CONTAINER_CLASS,
      'min-w-40 overflow-y-auto overscroll-contain',
      className,
    ),
  );

  $effect(() => {
    if (ref) ref.id = id;
  });
</script>

{#if isStatic}
  <MenuPrimitive.ContentStatic
    bind:ref
    {id}
    data-slot="menu-content"
    data-static-position
    data-surface-level={surface}
    class={contentClass}
    style="max-height: {maxHeight}"
    {...restProps as any}
  >
    <ListHighlight />
    {@render children?.()}
  </MenuPrimitive.ContentStatic>
{:else if portal}
  <MenuPrimitive.Portal {...portalProps}>
    <MenuPrimitive.Content
      bind:ref
      {id}
      data-slot="menu-content"
      data-surface-level={surface}
      class={contentClass}
      {sideOffset}
      style="max-height: {maxHeight}"
      {...restProps}
    >
      <ListHighlight />
      {@render children?.()}
    </MenuPrimitive.Content>
  </MenuPrimitive.Portal>
{:else}
  <MenuPrimitive.Content
    bind:ref
    {id}
    data-slot="menu-content"
    data-surface-level={surface}
    class={contentClass}
    {sideOffset}
    style="max-height: {maxHeight}"
    {...restProps}
  >
    <ListHighlight />
    {@render children?.()}
  </MenuPrimitive.Content>
{/if}
