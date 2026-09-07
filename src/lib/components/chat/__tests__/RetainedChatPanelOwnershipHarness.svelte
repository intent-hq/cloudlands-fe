<script lang="ts">
  import { WorkspaceStatus, type Workspace } from '$shared/types';
  import ChatPanel from '../ChatPanel.svelte';
  import RetainedWorkspaceSurfaces from '../../../../routes/(app)/workspace/[id]/RetainedWorkspaceSurfaces.svelte';

  let {
    activeWorkspaceId,
    openWorkspaceIds,
    workspaceEntityIds,
  }: {
    activeWorkspaceId: string;
    openWorkspaceIds: readonly string[];
    workspaceEntityIds: readonly string[];
  } = $props();

  const workspaces = new Map<string, Workspace>();

  function workspaceFor(id: string): Workspace {
    const existing = workspaces.get(id);
    if (existing) return existing;
    const workspace = {
      id: id as Workspace['id'],
      title: id,
      branch: 'main',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: WorkspaceStatus.Active,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    workspaces.set(id, workspace);
    return workspace;
  }
</script>

<RetainedWorkspaceSurfaces {activeWorkspaceId} {openWorkspaceIds} {workspaceEntityIds}>
  {#snippet children(workspaceId: string, active: boolean)}
    <ChatPanel
      workspace={workspaceFor(workspaceId)}
      agentId={`agent-${workspaceId}`}
      isActive={active}
      isPanelFocused={active}
    />
  {/snippet}
</RetainedWorkspaceSurfaces>
