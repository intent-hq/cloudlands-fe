<script lang="ts">
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import type { AgentAvatarVariant } from '$features/agent/components/agent-avatar/avatar-size';
  import WorkspaceStatusIcon from '$lib/components/workspace/WorkspaceStatusIcon.svelte';
  import {
    getWorkspaceStatusPresentation,
    resolveWorkspaceStatusState,
  } from '$lib/components/workspace/utils/workspace-status-presentation';
  import type { DockWorkspaceView } from '$store/renderer/slices/hud/hud-selectors';

  let {
    item,
    variant = 'standard',
    descriptionId,
  }: {
    item: DockWorkspaceView;
    variant?: AgentAvatarVariant;
    descriptionId?: string;
  } = $props();
  const status = $derived(resolveWorkspaceStatusState(item.workspace));
  const presentation = $derived(getWorkspaceStatusPresentation(status));
</script>

<span class="workspace-avatar" data-dock-workspace-avatar>
  <AgentAvatar
    agentId={item.workspace.agentSummary?.agentIds?.[0] ?? String(item.workspace.id)}
    {variant}
  />
  <span class="status-badge" title={presentation.accessibleName} data-dock-status-badge>
    <WorkspaceStatusIcon {status} size={10} decorative />
  </span>
</span>
{#if descriptionId}
  <span id={descriptionId} class="sr-only">{presentation.accessibleName}</span>
{/if}

<style>
  .workspace-avatar {
    position: relative;
    display: inline-flex;
    flex: none;
    pointer-events: none;
  }
  .status-badge {
    position: absolute;
    right: -3px;
    bottom: -3px;
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: hsl(var(--background));
  }
  @media (forced-colors: active) {
    .status-badge {
      background: Canvas;
    }
  }
</style>
