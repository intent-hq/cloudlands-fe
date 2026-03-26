<script lang="ts">
  import { useWorkspaceLoader } from '../use-workspace-loader.svelte';

  let {
    workspaceId,
    workspaceState,
    state = null,
    previousWorkspaceId = null,
  }: {
    workspaceId: string;
    workspaceState: any;
    state?: any;
    previousWorkspaceId?: string | null;
  } = $props();

  const loader = useWorkspaceLoader({ workspaceId, workspaceState, state, previousWorkspaceId });
</script>

<div data-testid="loading-workspace-id">{loader.loadingWorkspaceId ?? ''}</div>
