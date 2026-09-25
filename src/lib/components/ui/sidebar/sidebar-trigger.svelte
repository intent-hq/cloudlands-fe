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
    onpointerenter,
    ...restProps
  }: ComponentProps<typeof Button> & {
    onclick?: (e: MouseEvent) => void;
    onpointerenter?: (e: PointerEvent) => void;
  } = $props();

  const sidebar = useSidebar();
</script>

<Button
  data-sidebar="trigger"
  data-slot="sidebar-trigger"
  variant="ghost"
  size="icon"
  aria-label={m.ui_sidebar_toggle_label()}
  class={cn('size-6 [&_svg]:size-4', className)}
  type="button"
  onpointerenter={(e) => {
    onpointerenter?.(e);
    sidebar.requestPeek('hover');
  }}
  onclick={(e) => {
    onclick?.(e);
    sidebar.toggle();
  }}
  {...restProps}
>
  <Fa icon={faBars} />
  <span class="sr-only">{m.ui_sidebar_toggle_label()}</span>
</Button>
