<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import SidebarIcon from '$lib/components/icons/SidebarIcon.svelte';
  import SidebarSectionTabs from './SidebarSectionTabs.svelte';
  import { m } from '$shared/paraglide/messages.js';

  let {
    workspaceId,
    side = 'left',
    onExpand,
    tooltipDisabled = false,
  }: {
    workspaceId?: string;
    side?: 'left' | 'right';
    onExpand: () => void;
    tooltipDisabled?: boolean;
  } = $props();
</script>

<div class="flex h-full w-12 min-h-0 flex-col items-center gap-3 pt-5" data-workspace-sidebar-rail>
  <div class="shrink-0" data-sidebar-rail-header>
    <Button
      variant="ghost"
      size="icon"
      iconOnly
      aria-label={m.layout_titleBar_toggleSidebar_ariaLabel()}
      tooltip={m.layout_titleBar_toggleSidebar_ariaLabel()}
      {tooltipDisabled}
      data-sidebar-rail-expand
      onclick={onExpand}
    >
      <SidebarIcon size={18} {side} />
    </Button>
  </div>
  {#if workspaceId}
    <div
      class="flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto pb-3"
      data-sidebar-rail-scroll
    >
      <SidebarSectionTabs {workspaceId} orientation="vertical" />
    </div>
  {/if}
</div>
