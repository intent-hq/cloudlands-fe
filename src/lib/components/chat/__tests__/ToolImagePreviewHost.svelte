<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ToolUseBlock, Workspace } from '$shared/types';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import ToolCall from '../ToolCall.svelte';

  let { width = 640 }: { width?: number } = $props();

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  onDestroy(disposeStore);
  const workspaceId = 'image-read-preview';
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
  <ToolCall {toolUse} {workspaceId} toolState="completed" result="Image displayed." />
</section>
