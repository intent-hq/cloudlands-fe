<script lang="ts">
  import { DiffMap, type DiffMapDocument, type DiffMapFile } from '$features/diff-map';
  import type { DiffMapLayers } from '$features/diff-map/components/DiffMapRow.svelte';
  import ReviewSliceAction from '$features/diff-map/components/ReviewSliceAction.svelte';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    workspaceId: string;
    document: DiffMapDocument;
    layers: DiffMapLayers;
    activePath?: string;
    selection?: Set<string>;
    untrackedCount?: number;
    testId?: string;
    onOpen: (file: DiffMapFile, event: MouseEvent | KeyboardEvent) => void;
  }

  let {
    workspaceId,
    document,
    layers,
    activePath,
    selection = $bindable(new Set<string>()),
    untrackedCount = 0,
    testId,
    onOpen,
  }: Props = $props();
</script>

<div
  class="flex h-52 min-w-0 flex-col overflow-hidden rounded border border-border"
  data-testid={testId}
>
  {#if document.files.length > 0}
    <div
      class="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1"
    >
      <div class="min-w-0">
        <div class="text-xs font-medium text-foreground">
          {document.files.length === 1
            ? m.workspace_fileChanges_trackedChanges_one()
            : m.workspace_fileChanges_trackedChanges_many({
                count: formatInteger(document.files.length),
              })}
        </div>
        {#if untrackedCount > 0}
          <div class="truncate text-xs text-subtle">
            {untrackedCount === 1
              ? m.workspace_fileChanges_untrackedNotShown_one()
              : m.workspace_fileChanges_untrackedNotShown_many({
                  count: formatInteger(untrackedCount),
                })}
          </div>
        {/if}
      </div>
      <ReviewSliceAction {workspaceId} {document} {selection} />
    </div>
    <div class="min-h-0 flex-1">
      <DiffMap
        {document}
        bind:selection
        {layers}
        {activePath}
        rungOverride={2}
        filterable={false}
        {onOpen}
      />
    </div>
  {:else}
    <div class="flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center">
      <p class="text-xs font-medium text-foreground">
        {m.workspace_fileChanges_noTrackedChanges_label()}
      </p>
      {#if untrackedCount > 0}
        <p class="text-xs text-subtle">
          {untrackedCount === 1
            ? m.workspace_fileChanges_untrackedNotShown_one()
            : m.workspace_fileChanges_untrackedNotShown_many({
                count: formatInteger(untrackedCount),
              })}
        </p>
      {/if}
    </div>
  {/if}
</div>
