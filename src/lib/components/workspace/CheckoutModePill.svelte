<script lang="ts">
  /**
   * CheckoutModePill - Tiny, quiet metadata pill showing how the workspace
   * checkout was provisioned (PROTOCOL §5.1). Renders nothing when
   * `checkoutMode` is absent (direct / non-daemon-provisioned checkouts).
   *
   * When the workspace has daemon-computed `diskUsage` (PROTOCOL §5.1),
   * hovering the pill shows the disk-usage tooltip: total size + file count,
   * the physical-space/scope notes, the per-directory breakdown, and a
   * "shrink" link that opens a prefilled implementor composer. Without
   * `diskUsage` the pill falls back to its plain checkout-mode title.
   */
  import type { Workspace } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import { formatBytesBinary, formatInteger } from '$lib/i18n/format';
  import Tooltip from '$lib/components/ui/tooltip/Tooltip.svelte';
  import { runShrinkWorkspaceAction } from './shrink-workspace-action';

  interface Props {
    checkoutMode?: 'cow' | 'worktree';
    workspace?: Workspace | null;
    class?: string;
  }

  let { checkoutMode, workspace, class: className = '' }: Props = $props();

  // i18n-ignore (CoW / Worktree are technical terms)
  const label = $derived(
    checkoutMode === 'cow' ? 'CoW' : checkoutMode === 'worktree' ? 'Worktree' : null,
  );

  const diskUsage = $derived(workspace?.diskUsage);
  const formattedSize = $derived(diskUsage ? formatBytesBinary(diskUsage.bytes) : '');

  function handleShrinkClick() {
    if (!workspace) return;
    void runShrinkWorkspaceAction(workspace);
  }
</script>

{#snippet pill(title?: string)}
  <span
    class="inline-flex items-center shrink-0 rounded-full bg-muted/20 px-1 text-ui-sm leading-4 text-subtle {className}"
    {title}
  >
    {label}
  </span>
{/snippet}

{#if label}
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
          <div class="text-xs text-subtle">
            {m.workspace_checkoutModePill_tooltip({ label: label ?? '' })}
          </div>
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
      {@render pill()}
    </Tooltip>
  {:else}
    {@render pill(m.workspace_checkoutModePill_tooltip({ label }))}
  {/if}
{/if}
