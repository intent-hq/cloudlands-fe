<script lang="ts">
  /**
   * WorkspaceDiskUsagePill - Quiet subtitle element showing the workspace's
   * physical disk footprint (PROTOCOL §5.1 `diskUsage`). Renders nothing when
   * the daemon hasn't computed usage yet. Hovering shows the breakdown and a
   * "shrink" link that opens a prefilled implementor composer.
   */
  import type { Workspace } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import { formatBytesBinary, formatInteger } from '$lib/i18n/format';
  import Tooltip from '$lib/components/ui/tooltip/Tooltip.svelte';
  import { runShrinkWorkspaceAction } from './shrink-workspace-action';

  interface Props {
    workspace?: Workspace | null;
    class?: string;
  }

  let { workspace, class: className = '' }: Props = $props();

  const diskUsage = $derived(workspace?.diskUsage);
  const formattedSize = $derived(diskUsage ? formatBytesBinary(diskUsage.bytes) : '');

  function handleShrinkClick() {
    if (!workspace) return;
    void runShrinkWorkspaceAction(workspace);
  }
</script>

{#if diskUsage && formattedSize}
  <Tooltip
    side="bottom"
    align="start"
    sideOffset={4}
    contentClass="max-w-xs"
    disableHoverableContent={false}
    class="min-w-0"
  >
    {#snippet content()}
      <div class="flex flex-col gap-1.5 text-left whitespace-normal">
        <div class="font-medium">
          {m.workspace_diskUsagePill_totalSize_label({ size: formattedSize })}
          <span class="text-subtle">
            · {diskUsage.fileCount === 1
              ? m.workspace_diskUsagePill_fileCount_one()
              : m.workspace_diskUsagePill_fileCount_many({
                  count: formatInteger(diskUsage.fileCount),
                })}
          </span>
        </div>
        <div class="flex flex-col gap-0.5 text-xs text-subtle">
          <p class="m-0">{m.workspace_diskUsagePill_physicalNote_label()}</p>
          <p class="m-0">{m.workspace_diskUsagePill_scopeNote_label()}</p>
        </div>
        {#if diskUsage.breakdown.length > 0}
          <ul class="flex flex-col gap-0.5 text-xs">
            {#each diskUsage.breakdown as entry (entry.name)}
              <li class="flex items-baseline justify-between gap-3">
                <span class="truncate font-mono">{entry.name}</span>
                <span class="shrink-0 tabular-nums">{formatBytesBinary(entry.bytes)}</span>
              </li>
            {/each}
          </ul>
        {/if}
        <button
          type="button"
          class="self-start text-xs underline decoration-dotted underline-offset-2 cursor-pointer bg-transparent border-none p-0 text-accent-foreground hover:opacity-80"
          onclick={handleShrinkClick}
        >
          {m.workspace_diskUsagePill_shrink_label()}
        </button>
      </div>
    {/snippet}
    <span class="inline-flex items-baseline shrink-0 text-sm text-subtle {className}">
      <span class="mx-1">·</span>{formattedSize}
    </span>
  </Tooltip>
{/if}
