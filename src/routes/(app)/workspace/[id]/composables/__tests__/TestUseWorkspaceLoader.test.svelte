<script lang="ts">
  import { useWorkspaceLoader } from '../use-workspace-loader.svelte';

  let {
    workspaceId,
    workspaceState,
    state = null,
    previousWorkspaceId = null,
    activateWorkspace = true,
  }: {
    workspaceId: string;
    workspaceState: any;
    state?: any;
    previousWorkspaceId?: string | null;
    activateWorkspace?: boolean;
  } = $props();

  const loader = useWorkspaceLoader({
    get workspaceId() {
      return workspaceId;
    },
    get workspaceState() {
      return workspaceState;
    },
    get state() {
      return state;
    },
    get previousWorkspaceId() {
      return previousWorkspaceId;
    },
    get activateWorkspace() {
      return activateWorkspace;
    },
  });
</script>

<div data-testid="loading-workspace-id">{loader.loadingWorkspaceId ?? ''}</div>
<div data-testid="load-error-kind">{loader.loadError?.kind ?? ''}</div>
<div data-testid="load-error-message">{loader.loadError?.message ?? ''}</div>
