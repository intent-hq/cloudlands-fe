<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  const uid = $props.id();

  let {
    id = `${uid}-sub-content`,
    ref = $bindable(null),
    class: className,
    portal = true,
    portalProps,
    sideOffset = 4,
    ...restProps
  }: MenuPrimitive.SubContentProps & {
    portal?: boolean;
    portalProps?: MenuPrimitive.PortalProps;
  } = $props();

  const contentClass = $derived(
    cn(
      'type-body z-(--layer-popover) min-w-40 overflow-y-auto overscroll-contain rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-(--elevation-overlay) outline-none focus-visible:border-input focus-visible:ring-3 focus-visible:ring-ring/50',
      'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
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
    <MenuPrimitive.SubContent
      bind:ref
      {id}
      data-slot="menu-sub-content"
      class={contentClass}
      {sideOffset}
      style="max-height: min(24rem, calc(100dvh - 1rem))"
      {...restProps}
    />
  </MenuPrimitive.Portal>
{:else}
  <MenuPrimitive.SubContent
    bind:ref
    {id}
    data-slot="menu-sub-content"
    class={contentClass}
    {sideOffset}
    style="max-height: min(24rem, calc(100dvh - 1rem))"
    {...restProps}
  />
{/if}
