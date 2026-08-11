<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  const uid = $props.id();

  let {
    id = `${uid}-content`,
    ref = $bindable(null),
    class: className,
    portal = true,
    portalProps,
    sideOffset = 4,
    ...restProps
  }: MenuPrimitive.ContentProps & {
    portal?: boolean;
    portalProps?: MenuPrimitive.PortalProps;
  } = $props();

  const contentClass = $derived(
    cn(
      'type-body z-(--layer-popover) min-w-40 overflow-y-auto overscroll-contain rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-(--elevation-overlay) outline-none focus-visible:border-input focus-visible:ring-3 focus-visible:ring-ring/50',
      'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
      'duration-[var(--motion-fast)] motion-reduce:animate-none motion-reduce:transition-none',
      className,
    ),
  );

  $effect(() => {
    if (ref) ref.id = id;
  });
</script>

{#if portal}
  <MenuPrimitive.Portal {...portalProps}>
    <MenuPrimitive.Content
      bind:ref
      {id}
      data-slot="menu-content"
      class={contentClass}
      {sideOffset}
      style="max-height: min(24rem, calc(100dvh - 1rem))"
      {...restProps}
    />
  </MenuPrimitive.Portal>
{:else}
  <MenuPrimitive.Content
    bind:ref
    {id}
    data-slot="menu-content"
    class={contentClass}
    {sideOffset}
    style="max-height: min(24rem, calc(100dvh - 1rem))"
    {...restProps}
  />
{/if}
