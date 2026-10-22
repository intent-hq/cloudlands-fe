<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import SidebarIcon from '$lib/components/icons/SidebarIcon.svelte';
  import SidebarSectionTabs from './SidebarSectionTabs.svelte';
  import { m } from '$shared/paraglide/messages.js';

  let {
    workspaceId,
    side = 'left',
    onExpand,
    onReveal,
  }: {
    workspaceId?: string;
    side?: 'left' | 'right';
    onExpand: () => void;
    onReveal?: () => void;
  } = $props();
</script>

<div
  class="flex h-full w-12 min-h-0 flex-col items-center gap-3 overflow-y-auto pt-5 pb-3"
  data-workspace-sidebar-rail
>
  <Button
    variant="ghost"
    size="icon"
    iconOnly
    aria-label={m.layout_titleBar_toggleSidebar_ariaLabel()}
    tooltip={m.layout_titleBar_toggleSidebar_ariaLabel()}
    data-sidebar-rail-expand
    onclick={onExpand}
  >
    <SidebarIcon size={16} {side} />
  </Button>
  {#if workspaceId}
    <SidebarSectionTabs {workspaceId} orientation="vertical" onActivate={() => onReveal?.()} />
  {/if}
</div>
