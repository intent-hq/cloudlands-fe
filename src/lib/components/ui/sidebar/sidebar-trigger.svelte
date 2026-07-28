<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { cn } from '$lib/utils.js';
  import Fa from 'svelte-fa';
  import { faBars } from '@fortawesome/free-solid-svg-icons';
  import type { ComponentProps } from 'svelte';
  import { useSidebar } from './context.svelte.js';
  import { m } from '$shared/paraglide/messages.js';

  let {
    ref = $bindable(null),
    class: className,
    onclick,
    ...restProps
  }: ComponentProps<typeof Button> & {
    onclick?: (e: MouseEvent) => void;
  } = $props();

  const sidebar = useSidebar();
</script>

<Button
  data-sidebar="trigger"
  data-slot="sidebar-trigger"
  variant="ghost"
  size="icon"
  class={cn('size-7', className)}
  type="button"
  onclick={(e) => {
    onclick?.(e);
    sidebar.toggle();
  }}
  {...restProps}
>
  <Fa icon={faBars} />
  <span class="sr-only">{m.ui_sidebar_toggle_label()}</span>
</Button>
