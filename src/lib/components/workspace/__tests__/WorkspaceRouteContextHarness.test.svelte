<script lang="ts">
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import WorkspaceRouteContextProvider from '../WorkspaceRouteContextProvider.svelte';
  import WorkspaceRouteContextConsumer from './WorkspaceRouteContextConsumer.test.svelte';

  let { workspaceId }: { workspaceId: WorkspaceId | null } = $props();
</script>

{#key workspaceId}
  <WorkspaceRouteContextProvider {workspaceId}>
    <WorkspaceRouteContextConsumer />
  </WorkspaceRouteContextProvider>
{/key}
