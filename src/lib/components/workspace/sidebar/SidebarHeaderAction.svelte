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
  variant="ghost"
  size="icon-compact"
  class="shrink-0 text-muted-foreground hover:text-foreground {className}"
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
