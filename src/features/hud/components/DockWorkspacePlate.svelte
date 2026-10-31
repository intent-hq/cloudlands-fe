<script lang="ts">
  import WorkspaceStatusIcon from '$lib/components/workspace/WorkspaceStatusIcon.svelte';
  import {
    getWorkspaceStatusPresentation,
    resolveWorkspaceStatusState,
  } from '$lib/components/workspace/utils/workspace-status-presentation';
  import type { DockWorkspaceView } from '$store/renderer/slices/hud/hud-selectors';

  interface Props {
    item: DockWorkspaceView;
  }

  let { item }: Props = $props();

  const workspaceStatusState = $derived(resolveWorkspaceStatusState(item.workspace));
  const workspaceStatusPresentation = $derived(
    getWorkspaceStatusPresentation(workspaceStatusState),
  );
</script>

<span class="workspace-plate" data-testid="dock-workspace-plate">
  <WorkspaceStatusIcon status={workspaceStatusState} size={12} decorative />
  <span id="dock-workspace-status-{item.workspace.id}" class="sr-only">
    {workspaceStatusPresentation.accessibleName}
  </span>
</span>

<style>
  .workspace-plate {
    position: relative;
    display: grid;
    width: 16px;
    height: 16px;
    place-items: center;
    border: 0;
    border-radius: 9999px;
    background: hsl(var(--background));
    color: var(--dock-plate-fg);
  }
  @media (forced-colors: active) {
    .workspace-plate {
      background: Canvas;
      color: CanvasText;
    }
  }
</style>
