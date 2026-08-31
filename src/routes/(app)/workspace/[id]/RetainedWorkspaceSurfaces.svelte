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
  let surfacesRef = $state.raw<HTMLDivElement | null>(null);

  $effect(() => {
    const current = untrack(() => retention);
    const next = reconcileWorkspaceSurfaces(current, {
      activeWorkspaceId,
      openWorkspaceIds,
      workspaceEntityIds,
    });
    if (next !== current) retention = next;
  });

  // Release focus before a workspace switch flips `inert` on the deactivating
  // surface. Flipping `inert` while a descendant holds focus makes the browser
  // blur it synchronously inside the template effect, where widgets that write
  // $state on blur (e.g. TipTap) throw state_unsafe_mutation. `$effect.pre`
  // runs before the DOM attributes update, so the blur lands first.
  $effect.pre(() => {
    const activeId = activeWorkspaceId;
    if (typeof document === 'undefined' || !surfacesRef) return;
    const focusedElement = document.activeElement;
    if (!(focusedElement instanceof HTMLElement) || !surfacesRef.contains(focusedElement)) return;
    const focusedSurface = focusedElement.closest<HTMLElement>('[data-retained-workspace-surface]');
    if (focusedSurface && focusedSurface.dataset.retainedWorkspaceSurface !== activeId) {
      focusedElement.blur();
    }
  });
</script>

<div
  class="relative h-full min-h-0 w-full"
  data-retained-workspace-surfaces
  bind:this={surfacesRef}
>
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
    >
      {@render children(surface.workspaceId, isActive)}
    </div>
  {/each}
</div>
