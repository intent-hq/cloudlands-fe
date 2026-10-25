<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { faHardDrive, faRotateLeft } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { store } from '$store/renderer/store';
  import { requestUnarchiveWorkspace } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';

  /**
   * Read-only notice for a retired workspace (PROTOCOL §5.1 Retired
   * workspaces): the folder on disk is gone, the rows stay readable, and
   * restoring revives it through `workspace.unarchive` as a fresh blank checkout.
   */
  let { workspaceId, canRestore }: { workspaceId: string; canRestore: boolean } = $props();
</script>

<div
  role="status"
  class="flex shrink-0 items-start gap-3 border-b border-border bg-muted/60 px-4 py-3"
  data-retired-workspace-banner
>
  <Fa icon={faHardDrive} class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
  <div class="min-w-0 flex-1">
    <p class="type-body font-medium text-foreground">{m.workspace_retiredBanner_title()}</p>
    <p class="type-caption text-muted-foreground">{m.workspace_retiredBanner_description()}</p>
  </div>
  {#if canRestore}
    <Button
      variant="outline"
      size="sm"
      class="shrink-0"
      onclick={() => store.dispatch(requestUnarchiveWorkspace(workspaceId))}
    >
      <Fa icon={faRotateLeft} class="size-3.5" />
      {m.workspace_retire_restore_label()}
    </Button>
  {/if}
</div>
