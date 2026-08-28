<script lang="ts">
  import type { Snippet } from 'svelte';
  import ResourceNotFound from '$lib/components/common/ResourceNotFound.svelte';
  import type { WorkspaceLoadError } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-types';

  interface Props {
    loadError: WorkspaceLoadError | null;
    resourceLabel: string;
    resourceId: string;
    onNavigateAway: () => void;
    children: Snippet;
  }

  let { loadError, resourceLabel, resourceId, onNavigateAway, children }: Props = $props();
</script>

{#if loadError}
  <div class="h-full min-h-0 w-full overflow-hidden" data-workspace-terminal-state={loadError.kind}>
    <ResourceNotFound
      kind={loadError.kind}
      {resourceLabel}
      {resourceId}
      detail={loadError.kind === 'error' ? loadError.message : undefined}
      {onNavigateAway}
    />
  </div>
{:else}
  {@render children()}
{/if}
