<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import { getContext, tick } from 'svelte';
  import { cn } from '$lib/utils.js';
  import ListHighlight from './menu-list-highlight.svelte';
  import { menuOverlay } from './menu-recipes';
  import { clampSurface, setSurface, useSurface } from '$lib/components/ui/surface-context';
  import { OPTION_LIST_CONTAINER_CLASS } from '$lib/styles/option-list-row';
  import { useStaticOverlay } from '../static-overlay-context.svelte';
  import { OVERLAY_VIEWPORT_GUTTER } from '../overlay-positioning';
  import { handleMenuPageKey, setMenuTabStop, syncMenuTabStopFromFocus } from './menu-roving-focus';
  import { SUBMENU_CONTEXT, type SubmenuContext } from './submenu-context';
  import { resolveSubmenuSide } from './submenu-placement';

  const uid = $props.id();

  let {
    id = `${uid}-sub-content`,
    ref = $bindable(null),
    class: className,
    portal = true,
    portalProps,
    staticPosition,
    side = 'right',
    sideOffset = 4,
    avoidCollisions = true,
    collisionPadding = OVERLAY_VIEWPORT_GUTTER,
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
  const submenu = getContext<SubmenuContext | undefined>(SUBMENU_CONTEXT);
  let verticalFallback = $state(false);
  const resolvedSide = $derived(verticalFallback ? 'bottom' : side);

  $effect(() => {
    const content = ref;
    const trigger = submenu?.trigger;
    if (!content || !trigger || isStatic || !avoidCollisions) {
      verticalFallback = false;
      return;
    }
    const padding =
      typeof collisionPadding === 'number'
        ? { left: collisionPadding, right: collisionPadding }
        : { left: collisionPadding.left ?? 0, right: collisionPadding.right ?? 0 };
    const preferred = side;
    const gap = sideOffset;
    function updatePlacement() {
      verticalFallback =
        resolveSubmenuSide(
          preferred,
          trigger!.getBoundingClientRect(),
          content!.offsetWidth,
          window.innerWidth,
          gap,
          padding,
        ) !== preferred;
    }
    updatePlacement();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePlacement);
    observer?.observe(content);
    observer?.observe(trigger);
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  });

  const surface = clampSurface(useSurface() + 2);
  setSurface(surface);
  const contentClass = $derived(
    cn(
      menuOverlay(),
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
      side={resolvedSide}
      {sideOffset}
      {avoidCollisions}
      {collisionPadding}
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
    side={resolvedSide}
    {sideOffset}
    {avoidCollisions}
    {collisionPadding}
    style="max-height: {maxHeight}"
    onkeydown={handleKeydown}
    onfocusin={handleFocusin}
    {...restProps}
  >
    <ListHighlight />
    {@render children?.()}
  </MenuPrimitive.SubContent>
{/if}
