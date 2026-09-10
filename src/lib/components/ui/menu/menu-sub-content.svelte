<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import { tick } from 'svelte';
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
  import { handleMenuPageKey, setMenuTabStop, syncMenuTabStopFromFocus } from './menu-roving-focus';

  const uid = $props.id();

  let {
    id = `${uid}-sub-content`,
    ref = $bindable(null),
    class: className,
    portal = true,
    portalProps,
    staticPosition,
    sideOffset = 4,
    onkeydown,
    onfocusin,
    children,
    ...restProps
  }: MenuPrimitive.SubContentProps & {
    portal?: boolean;
    portalProps?: MenuPrimitive.PortalProps;
    staticPosition?: boolean;
  } = $props();

  // bits-ui 2.18.1: SubContent is the shared menu primitive, so its available-height
  // var uses the 'menu' prefix — unlike DropdownMenu.Content's 'dropdown-menu' prefix
  // in menu-content.svelte. The differing var names are intentional.
  const maxHeight = 'var(--bits-menu-content-available-height, calc(100dvh - 1rem))';
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
    const content = ref;
    if (!content) return;
    content.id = id;
    void tick().then(() => {
      if (ref === content) setMenuTabStop(content);
    });
  });

  function handleKeydown(event: KeyboardEvent & { currentTarget: HTMLDivElement }) {
    onkeydown?.(event);
    if (!event.defaultPrevented) handleMenuPageKey(event.currentTarget, event);
  }

  function handleFocusin(event: FocusEvent & { currentTarget: HTMLDivElement }) {
    onfocusin?.(event);
    syncMenuTabStopFromFocus(event.currentTarget, event.target);
  }
</script>

{#if isStatic}
  <MenuPrimitive.SubContentStatic
    bind:ref
    {id}
    data-slot="menu-sub-content"
    data-static-position
    data-surface-level={surface}
    class={contentClass}
    style="max-height: {maxHeight}"
    onkeydown={handleKeydown}
    onfocusin={handleFocusin}
    {...restProps as any}
  >
    <ListHighlight />
    {@render children?.()}
  </MenuPrimitive.SubContentStatic>
{:else if portal}
  <MenuPrimitive.Portal {...portalProps}>
    <MenuPrimitive.SubContent
      bind:ref
      {id}
      data-slot="menu-sub-content"
      data-surface-level={surface}
      class={contentClass}
      {sideOffset}
      style="max-height: {maxHeight}"
      onkeydown={handleKeydown}
      onfocusin={handleFocusin}
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
    onkeydown={handleKeydown}
    onfocusin={handleFocusin}
    {...restProps}
  >
    <ListHighlight />
    {@render children?.()}
  </MenuPrimitive.SubContent>
{/if}
