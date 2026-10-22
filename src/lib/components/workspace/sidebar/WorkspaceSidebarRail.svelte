<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import ArrowLineRightIcon from 'phosphor-svelte/lib/ArrowLineRightIcon';
  import { m } from '$shared/paraglide/messages.js';

  let { onExpand }: { onExpand: () => void } = $props();
</script>

<nav
  class="flex h-full flex-col items-center pt-[23px] pb-3"
  aria-label={m.workspace_layout_ariaLabel()}
  data-workspace-sidebar-rail
>
  <Button
    variant="ghost"
    size="icon"
    iconOnly
    aria-label={m.layout_titleBar_toggleSidebar_ariaLabel()}
    title={m.layout_titleBar_toggleSidebar_ariaLabel()}
    data-sidebar-rail-expand
    onclick={onExpand}
  >
    <ArrowLineRightIcon size={16} weight="regular" />
  </Button>
</nav>
