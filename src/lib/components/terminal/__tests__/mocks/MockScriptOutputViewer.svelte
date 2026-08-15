<script lang="ts">
  import { onMount } from 'svelte';

  let { workspaceId, scriptId }: { workspaceId?: string; scriptId?: string } = $props();

  onMount(() => {
    const mounts = (globalThis as Record<string, unknown>).__quakeScriptViewerMounts as Array<{
      workspaceId?: string;
      scriptId?: string;
    }>;
    mounts.push({ workspaceId, scriptId });
  });
</script>

<div
  data-testid="mock-script-output-viewer"
  data-workspace-id={workspaceId}
  data-script-id={scriptId}
></div>
