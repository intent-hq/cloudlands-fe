<script lang="ts">
  import { Tooltip as TooltipPrimitive } from 'bits-ui';
  import SidebarNav from '$lib/components/layout/sidebar-nav/SidebarNav.svelte';
  import WorkspaceRepoLauncher from '$lib/components/layout/WorkspaceRepoLauncher.svelte';

  const TooltipProvider = TooltipPrimitive.Provider;
</script>

<TooltipProvider>
  <div
    class="app-drag-region flex h-12 items-center gap-1 bg-background px-3 text-foreground"
    data-titlebar-workspace-controls-fixture
  >
    <SidebarNav />
    <div data-fixture-control="launcher"><WorkspaceRepoLauncher /></div>
  </div>
</TooltipProvider>
