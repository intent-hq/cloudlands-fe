<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import SidebarActionIcon, { type SidebarActionIconName } from './SidebarActionIcon.svelte';
  import { sidebarHeaderActionClass } from './sidebar-header-action';
  import { cn } from '$lib/utils';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';

  interface Props extends Pick<
    HTMLButtonAttributes,
    | 'id'
    | 'disabled'
    | 'title'
    | 'role'
    | 'tabindex'
    | 'aria-expanded'
    | 'aria-controls'
    | 'aria-haspopup'
  > {
    [attribute: `data-${string}`]: string | number | boolean | undefined;
    icon: SidebarActionIconName;
    label: string;
    onclick?: (event: MouseEvent) => void;
    onkeydown?: (event: KeyboardEvent) => void;
    onpointerdown?: (event: PointerEvent) => void;
    onpointerup?: (event: PointerEvent) => void;
    onfocus?: (event: FocusEvent) => void;
    onblur?: (event: FocusEvent) => void;
    ref?: HTMLButtonElement | null;
    class?: string;
    iconClass?: string;
    busy?: boolean;
    pressed?: boolean;
    children?: Snippet;
  }

  let {
    icon,
    label,
    onclick,
    ref = $bindable(null),
    class: className = '',
    iconClass,
    busy = false,
    pressed,
    children,
    ...restProps
  }: Props = $props();
</script>

<Button
  {...restProps}
  bind:ref
  iconOnly
  variant="ghost"
  size="icon-compact"
  class={cn(sidebarHeaderActionClass, className)}
  active={pressed || restProps['aria-expanded'] === true || restProps['aria-expanded'] === 'true'}
  tooltip={label}
  tooltipSide="top"
  tooltipDelayDuration={300}
  aria-label={label}
  aria-busy={busy || undefined}
  aria-pressed={pressed}
  {onclick}
  data-sidebar-action={icon}
  data-sidebar-close={icon === 'close' ? '' : undefined}
>
  <SidebarActionIcon {icon} class={iconClass} />
  {#if children}
    {@render children()}
  {/if}
</Button>
