<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import {
    createWorkspaceSurfaceRetentionState,
    reconcileWorkspaceSurfaces,
  } from './workspace-surface-retention';

  let {
    activeWorkspaceId,
    openWorkspaceIds,
    workspaceEntityIds,
    children,
  }: {
    activeWorkspaceId: string;
    openWorkspaceIds: readonly string[];
    workspaceEntityIds: readonly string[];
    children: Snippet<[workspaceId: string, active: boolean]>;
  } = $props();

  let retention = $state(createWorkspaceSurfaceRetentionState());

  $effect(() => {
    const current = untrack(() => retention);
    const next = reconcileWorkspaceSurfaces(current, {
      activeWorkspaceId,
      openWorkspaceIds,
      workspaceEntityIds,
    });
    if (next !== current) retention = next;
  });

  function releaseFocusOnDeactivate(node: HTMLElement, isActive: boolean) {
    let wasActive = isActive;
    return {
      update(nextActive: boolean) {
        if (
          wasActive &&
          !nextActive &&
          document.activeElement instanceof HTMLElement &&
          node.contains(document.activeElement)
        ) {
          document.activeElement.blur();
        }
        wasActive = nextActive;
      },
    };
  }
</script>

<div class="relative h-full min-h-0 w-full" data-retained-workspace-surfaces>
  {#each retention.surfaces as surface (surface.generation)}
    {@const isActive = surface.workspaceId === activeWorkspaceId}
    <div
      class="absolute inset-0"
      hidden={!isActive}
      inert={!isActive}
      aria-hidden={!isActive}
      data-retained-workspace-surface={surface.workspaceId}
      data-retained-workspace-active={isActive}
      data-retained-workspace-generation={surface.generation}
      use:releaseFocusOnDeactivate={isActive}
    >
      {@render children(surface.workspaceId, isActive)}
    </div>
  {/each}
</div>
