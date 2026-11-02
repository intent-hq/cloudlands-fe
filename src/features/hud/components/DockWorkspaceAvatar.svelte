<script lang="ts">
  import { toStore } from 'svelte/store';
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import type { AgentAvatarVariant } from '$features/agent/components/agent-avatar/avatar-size';
  import {
    getWorkspaceStatusPresentation,
    resolveWorkspaceStatusState,
  } from '$lib/components/workspace/utils/workspace-status-presentation';
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import {
    dockWorkspaceAvatarState,
    type DockAvatarItem,
  } from '$features/hud/utils/dock-avatar-state';

  /**
   * The workspace's agent avatar as the app shows it: the state tints the avatar itself
   * (e.g. responding fills it), instead of a separate status dot.
   */
  let {
    item,
    variant = 'standard',
    descriptionId,
  }: {
    /** The workspace, with the HUD row flags when the surface has them. */
    item: DockAvatarItem;
    variant?: AgentAvatarVariant;
    descriptionId?: string;
  } = $props();
  const agentId = $derived(item.workspace.agentSummary?.agentIds?.[0] ?? String(item.workspace.id));
  // Selector readable at init; the agent id stays reactive through the store.
  const session$ = selectAgentSession(toStore(() => agentId));
  const state = $derived(dockWorkspaceAvatarState(item, $session$));
  // The workspace status stays available to assistive tech and to callers' tests.
  const status = $derived(resolveWorkspaceStatusState(item.workspace));
  const presentation = $derived(getWorkspaceStatusPresentation(status));
</script>

<span class="workspace-avatar" data-dock-workspace-avatar data-workspace-status={status}>
  <AgentAvatarWithState {agentId} {variant} {state} />
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
</style>
