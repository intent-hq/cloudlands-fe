<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import SidebarActionIcon from './SidebarActionIcon.svelte';

  interface Props {
    [attribute: `data-${string}`]: string | undefined;
    icon: 'plus' | 'search' | 'close';
    label: string;
    onclick?: (event: MouseEvent) => void;
    ref?: HTMLButtonElement | null;
    class?: string;
  }

  let {
    icon,
    label,
    onclick,
    ref = $bindable(null),
    class: className = '',
    ...restProps
  }: Props = $props();
</script>

<Button
  {...restProps}
  bind:ref
  iconOnly
  variant="plain"
  size="icon-compact"
  class="{className} expanded-card-action rounded-md! border-0! bg-transparent! p-0! text-foreground shadow-none! outline-none transition-colors hover:bg-muted/50! focus-visible:border-transparent! focus-visible:bg-muted! motion-reduce:transition-none forced-colors:hover:outline forced-colors:focus-visible:outline"
  tooltip={label}
  tooltipSide="top"
  tooltipDelayDuration={300}
  aria-label={label}
  {onclick}
  data-sidebar-action={icon}
  data-sidebar-close={icon === 'close' ? '' : undefined}
>
  <SidebarActionIcon {icon} />
</Button>
