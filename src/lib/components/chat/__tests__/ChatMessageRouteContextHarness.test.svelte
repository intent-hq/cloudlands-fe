<script lang="ts">
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import WorkspaceRouteContextProvider from '$lib/components/workspace/WorkspaceRouteContextProvider.svelte';
  import ChatMessage from '../ChatMessage.svelte';

  let { workspaceId, ...chatMessageProps }: { workspaceId: WorkspaceId } = $props();
</script>

<WorkspaceRouteContextProvider {workspaceId}>
  <ChatMessage {...chatMessageProps} />
</WorkspaceRouteContextProvider>
