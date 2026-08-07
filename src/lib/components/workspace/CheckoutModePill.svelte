<script lang="ts">
  /**
   * CheckoutModePill - Tiny, quiet metadata pill showing how the workspace
   * checkout was provisioned (PROTOCOL §5.1). Renders nothing when
   * `checkoutMode` is absent (non-daemon-provisioned checkouts).
   *
   * When a workspace is provided, hovering the pill opens the disk-usage
   * tooltip and fetches the footprint on demand via the `workspace.diskUsage`
   * method (PROTOCOL §5.1) — list/get rows no longer carry it
   * (monorepo#1396). While a walk is in flight with no value yet a spinner
   * shows; once a value exists the tooltip renders total size + file count,
   * the physical-space/scope notes, the per-directory breakdown, and a
   * "shrink" link (a stale value shows immediately with a subtle refreshing
   * indicator). While the tooltip stays open and the daemon reports
   * `refreshing: true`, the value is re-polled every ~1s. Older daemons
   * without the method fall back to the legacy row field when present, else
   * the tooltip shows just the checkout-mode line.
   */
  import type { Workspace, WorkspaceDiskUsage } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import { formatBytesBinary, formatInteger } from '$lib/i18n/format';
  import Tooltip from '$lib/components/ui/tooltip/Tooltip.svelte';
  import { runShrinkWorkspaceAction } from './shrink-workspace-action';
  import { pollWorkspaceDiskUsage } from './disk-usage-poll';

  interface Props {
    checkoutMode?: 'cow' | 'worktree' | 'direct';
    workspace?: Workspace | null;
    class?: string;
  }

  let { checkoutMode, workspace, class: className = '' }: Props = $props();

  // When a workspace is provided, its checkoutMode is authoritative so the
  // label always matches the workspace whose diskUsage the tooltip shows.
  const mode = $derived(workspace ? workspace.checkoutMode : checkoutMode);

  // i18n-ignore (CoW / Worktree / Direct are technical terms)
  const label = $derived(
    mode === 'cow' ? 'CoW' : mode === 'worktree' ? 'Worktree' : mode === 'direct' ? 'Direct' : null,
  );

  /** Poll cadence while the tooltip is open and a daemon walk is in flight. */
  const POLL_INTERVAL_MS = 1000;

  let fetched = $state<WorkspaceDiskUsage | undefined>(undefined);
  let refreshing = $state(false);
  let pending = $state(false);
  let unsupported = $state(false);
  let tooltipOpen = false;
  let inFlight = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  // Bumped when the workspace id changes and on unmount so a late-resolving
  // poll never applies state or schedules another timer.
  let generation = 0;

  // Older daemons (no workspace.diskUsage method): fall back to the legacy
  // list/get row field when present.
  const diskUsage = $derived(fetched ?? (unsupported ? workspace?.diskUsage : undefined));
  const formattedSize = $derived(diskUsage ? formatBytesBinary(diskUsage.bytes) : '');
  const loading = $derived(!diskUsage && !unsupported && (pending || refreshing));

  function clearPollTimer() {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function scheduleNextPoll() {
    if (!tooltipOpen || !refreshing || unsupported) return;
    clearPollTimer();
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void pollDiskUsage();
    }, POLL_INTERVAL_MS);
  }

  // Single-flight per workspace: rapid re-hover never stacks calls. A poll
  // that settles after the workspace changed or the component unmounted
  // (generation mismatch) is discarded and never reschedules.
  async function pollDiskUsage() {
    const id = workspace?.id;
    if (!id || inFlight || unsupported) return;
    const gen = generation;
    inFlight = true;
    pending = true;
    try {
      const result = await pollWorkspaceDiskUsage(String(id));
      if (gen !== generation) return;
      if (result === null) {
        // Older daemon: the method is missing (-32601); never poll again.
        unsupported = true;
        refreshing = false;
      } else {
        if (result.diskUsage) fetched = result.diskUsage;
        refreshing = result.refreshing;
      }
    } catch {
      if (gen !== generation) return;
      // Transient daemon failure: stop polling; the next open retries.
      refreshing = false;
    } finally {
      if (gen === generation) {
        pending = false;
        inFlight = false;
      }
    }
    if (gen !== generation) return;
    scheduleNextPoll();
  }

  function handleOpenChange(open: boolean) {
    tooltipOpen = open;
    if (open) {
      void pollDiskUsage();
    } else {
      clearPollTimer();
    }
  }

  // Scope the fetched state to the hovered workspace: when this component
  // instance receives a different workspace, drop the previous workspace's
  // value instead of briefly rendering it.
  const UNSET = Symbol();
  let lastWorkspaceId: unknown = UNSET;
  $effect(() => {
    const id = workspace?.id;
    if (lastWorkspaceId === UNSET) {
      lastWorkspaceId = id;
      return;
    }
    if (id === lastWorkspaceId) return;
    lastWorkspaceId = id;
    generation += 1;
    clearPollTimer();
    inFlight = false;
    fetched = undefined;
    refreshing = false;
    pending = false;
    if (tooltipOpen) void pollDiskUsage();
  });

  $effect(() => {
    return () => {
      generation += 1;
      clearPollTimer();
    };
  });

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
  {#if workspace}
    <Tooltip
      side="bottom"
      align="start"
      sideOffset={4}
      contentClass="max-w-xs"
      disableHoverableContent={false}
      class="min-w-0"
      onOpenChange={handleOpenChange}
    >
      {#snippet content()}
        <div class="flex flex-col gap-1.5 text-left whitespace-normal">
          <div class="text-xs text-subtle">
            {m.workspace_checkoutModePill_tooltip({ label: label ?? '' })}
          </div>
          {#if diskUsage && formattedSize}
            <div class="font-medium">
              {m.workspace_diskUsagePill_totalSize_label({ size: formattedSize })}
              <span class="text-subtle">
                · {diskUsage.fileCount === 1
                  ? m.workspace_diskUsagePill_fileCount_one()
                  : m.workspace_diskUsagePill_fileCount_many({
                      count: formatInteger(diskUsage.fileCount),
                    })}
              </span>
              {#if refreshing}
                <span
                  role="status"
                  aria-label={m.workspace_diskUsagePill_refreshing_ariaLabel()}
                  class="ml-1 inline-block size-3 animate-spin rounded-full border border-current border-t-transparent align-middle text-subtle"
                ></span>
              {/if}
            </div>
            <!-- text-pretty overrides the tooltip shell's text-balance so the
                 notes fill the available width instead of wrapping short. -->
            <div class="flex flex-col gap-0.5 text-xs text-subtle text-pretty">
              <p class="m-0">
                {mode === 'cow'
                  ? m.workspace_diskUsagePill_physicalNote_label()
                  : m.workspace_diskUsagePill_physicalNotePlain_label()}
              </p>
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
          {:else if loading}
            <div class="flex items-center justify-center py-1">
              <span
                role="status"
                aria-label={m.workspace_diskUsagePill_loading_ariaLabel()}
                class="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent text-subtle"
              ></span>
            </div>
          {/if}
        </div>
      {/snippet}
      {@render pill()}
    </Tooltip>
  {:else}
    {@render pill(m.workspace_checkoutModePill_tooltip({ label }))}
  {/if}
{/if}
