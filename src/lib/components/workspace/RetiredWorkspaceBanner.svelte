<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { faBoxArchive, faBoxOpen } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { store } from '$store/renderer/store';
  import { requestUnarchiveWorkspace } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';

  /**
   * Read-only notice for an archived workspace whose folder was purged
   * (`Retired`, PROTOCOL §5.1). It is presented like any archived workspace:
   * the rows stay readable, and unarchiving revives it through
   * `workspace.unarchive` (the daemon tells the agents the folder was purged).
   */
  let { workspaceId, canRestore }: { workspaceId: string; canRestore: boolean } = $props();
</script>

<div
  role="status"
  class="flex shrink-0 items-start gap-3 border-b border-border bg-muted/60 px-4 py-3"
  data-retired-workspace-banner
>
  <Fa icon={faBoxArchive} class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
  <div class="min-w-0 flex-1">
    <p class="type-body font-medium text-foreground">{m.workspace_archivedBanner_title()}</p>
    <p class="type-caption text-muted-foreground">{m.workspace_archivedBanner_description()}</p>
  </div>
  {#if canRestore}
    <Button
      variant="outline"
      size="sm"
      class="shrink-0"
      onclick={() => store.dispatch(requestUnarchiveWorkspace(workspaceId))}
    >
      <Fa icon={faBoxOpen} class="size-3.5" />
      {m.ui_workspaceActions_unarchiveSpace_label()}
    </Button>
  {/if}
</div>
