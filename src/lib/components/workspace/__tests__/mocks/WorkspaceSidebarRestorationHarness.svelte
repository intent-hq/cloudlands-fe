<script lang="ts">
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { setBootRoutePathnameForTesting } from '$lib/utils/boot-route-gate';
  import { store } from '$store/renderer/store';
  import { bootRouteGateResolved } from '$store/renderer/slices/setup-prompt/setup-prompt-slice';
  import { selectIsCollapsed } from '$store/renderer/slices/ui-layout/ui-layout-selectors';
  import {
    hydrateResizablePanelSize,
    setCollapsed,
    setSidebarSide,
    toggleSidebar,
    type SidebarSide,
  } from '$store/renderer/slices/ui-layout/ui-layout-slice';
  import RetainedWorkspaceSurfaces from '../../../../../routes/(app)/workspace/[id]/RetainedWorkspaceSurfaces.svelte';
  import WorkspaceSurface from '../../../../../routes/(app)/workspace/[id]/WorkspaceSurface.svelte';

  let {
    collapsed = true,
    sidebarSide = 'left',
    gatedBoot = false,
    initialWorkspaceId = 'workspace-a',
    delayedWidth = false,
  }: {
    collapsed?: boolean;
    sidebarSide?: SidebarSide;
    gatedBoot?: boolean;
    initialWorkspaceId?: string;
    delayedWidth?: boolean;
  } = $props();

  let activeWorkspaceId = $state(
    untrack(() => {
      store.dispatch(setCollapsed(collapsed));
      store.dispatch(setSidebarSide(sidebarSide));
      if (!delayedWidth) {
        store.dispatch(hydrateResizablePanelSize('workspace-left-panel-width:workspace-a', 410));
      }
      store.dispatch(hydrateResizablePanelSize('workspace-left-panel-width:workspace-b', 460));
      setBootRoutePathnameForTesting(gatedBoot ? '/workspace/new' : null);
      if (!gatedBoot) store.dispatch(bootRouteGateResolved());
      return initialWorkspaceId;
    }),
  );
  let generation = $state(0);
  const collapsedChoice = selectIsCollapsed();
  const openWorkspaceIds = $derived([
    ...new Set(['workspace-a', 'workspace-b', activeWorkspaceId]),
  ]);
</script>

<div class="flex h-screen flex-col bg-sidebar" data-sidebar-collapse-choice={$collapsedChoice}>
  <div class="flex flex-wrap gap-2 p-2">
    <Button
      variant="ghost"
      data-testid="switch-a"
      onclick={() => (activeWorkspaceId = 'workspace-a')}>Workspace A</Button
    >
    <Button
      variant="ghost"
      data-testid="switch-b"
      onclick={() => (activeWorkspaceId = 'workspace-b')}>Workspace B</Button
    >
    <Button
      variant="ghost"
      data-testid="toggle-sidebar"
      onclick={() => store.dispatch(toggleSidebar())}>Toggle sidebar</Button
    >
    <Button variant="ghost" data-testid="remount" onclick={() => generation++}>Reopen app</Button>
    <Button
      variant="ghost"
      data-testid="start-onboarding"
      onclick={() => (activeWorkspaceId = 'new')}>Start onboarding</Button
    >
    <Button
      variant="ghost"
      data-testid="finish-onboarding"
      onclick={() => (activeWorkspaceId = 'workspace-created')}>Finish onboarding</Button
    >
    <Button
      variant="ghost"
      data-testid="resolve-boot"
      onclick={() => store.dispatch(bootRouteGateResolved())}>Resolve boot</Button
    >
    <Button
      variant="ghost"
      data-testid="hydrate-width"
      onclick={() =>
        store.dispatch(hydrateResizablePanelSize('workspace-left-panel-width:workspace-a', 530))}
      >Restore saved width</Button
    >
  </div>
  <div class="min-h-0 flex-1" data-testid="workspace-stage">
    {#key generation}
      <RetainedWorkspaceSurfaces
        {activeWorkspaceId}
        {openWorkspaceIds}
        workspaceEntityIds={['workspace-a', 'workspace-b', 'workspace-created']}
      >
        {#snippet children(workspaceId: string, active: boolean)}
          <WorkspaceSurface {workspaceId} {active} />
        {/snippet}
      </RetainedWorkspaceSurfaces>
    {/key}
  </div>
</div>
