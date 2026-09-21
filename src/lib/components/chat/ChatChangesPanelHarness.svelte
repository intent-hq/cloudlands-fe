<script lang="ts">
  import { setContext, type ComponentProps } from 'svelte';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import {
    WORKSPACE_ROUTE_CONTEXT,
    type WorkspaceRouteContext,
  } from '$lib/utils/workspace-route-context';
  import ChatChangesPanel from './ChatChangesPanel.svelte';

  let props: ComponentProps<typeof ChatChangesPanel> = $props();
  setContext<WorkspaceRouteContext>(WORKSPACE_ROUTE_CONTEXT, {
    workspaceId: WorkspaceId('preview-chat-changes'),
  });
</script>

<div class="h-[28rem] w-full min-w-0">
  <ChatChangesPanel {...props} />
</div>
