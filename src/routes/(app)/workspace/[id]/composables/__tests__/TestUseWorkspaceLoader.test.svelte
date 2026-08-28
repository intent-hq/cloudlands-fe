<script lang="ts">
  import { useWorkspaceLoader } from '../use-workspace-loader.svelte';

  let {
    workspaceId,
  }: {
    workspaceId: string;
  } = $props();

  useWorkspaceLoader({
    get workspaceId() {
      return workspaceId;
    },
  });
</script>

<div data-testid="workspace-loader">{workspaceId}</div>
