<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ToolUseBlock, Workspace } from '$shared/types';
  import type { WireAgentSession } from '$store/renderer/slices/agent-session/agent-session-types';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import ToolCall from '../ToolCall.svelte';
  import { upsertSession } from '$store/renderer/slices/agent-session/agent-session-slice';

  let {
    width = 640,
    remoteAgent = false,
    mountKey = 0,
  }: { width?: number; remoteAgent?: boolean; mountKey?: number } = $props();
  const saved: { expanded?: boolean; showImageTechnicalDetails?: boolean } = {};

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  onDestroy(disposeStore);
  const workspaceId = 'image-read-preview';
  const agentId = 'image-preview-remote-agent';
  store.dispatch(
    upsertSession({
      id: agentId,
      workspaceId,
      name: 'Remote image reader',
      nodePath: '/work/preview',
    } as WireAgentSession),
  );
  store.dispatch(
    setWorkspaceEntity({
      id: workspaceId,
      title: 'Image preview fixture',
      worktreePath: '/work/preview',
    } as Workspace),
  );
  const toolUse: ToolUseBlock = {
    type: 'tool_use',
    id: 'read-desktop-image',
    name: 'view_image',
    input: { path: '/work/preview/desktop.png', _acpTitle: 'View Image /work/preview/desktop.png' },
  };
</script>

<section
  class="bg-background p-6 text-foreground"
  style:width="{width}px"
  style:min-height="300px"
  data-testid="image-read-example"
>
  {#key mountKey}
    <ToolCall
      {saved}
      agentId={remoteAgent ? agentId : undefined}
      {toolUse}
      {workspaceId}
      toolState="completed"
      result="Image displayed."
    />
  {/key}
</section>
