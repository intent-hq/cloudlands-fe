<script lang="ts">
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { selectWorkspaceStats } from '$store/renderer/slices/session-stats/session-stats-selectors';
  import type { Readable } from 'svelte/store';

  interface Props {
    workspaceId: string | Readable<string>;
  }

  let { workspaceId }: Props = $props();

  const stats$ = selectWorkspaceStats(workspaceId);

  /** Format a number compactly (e.g. 1234 → "1.2k") */
  function formatCompact(n: number): string {
    if (n >= 1000) {
      return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    }
    return String(n);
  }

  const hasData = $derived($stats$ != null);
  const hasPending = $derived(hasData && $stats$!.hasPendingCredits);
  const isPartial = $derived(hasData && $stats$!.isPartial);
  const creditText = $derived(
    hasData && !hasPending ? formatCompact($stats$!.totalCreditsUsed) : null,
  );
  const messageText = $derived(
    hasData ? formatCompact($stats$!.totalMessageCount) : null,
  );
  const partialSuffix = $derived(
    isPartial ? ` (${$stats$!.failedCount} session${$stats$!.failedCount === 1 ? '' : 's'} unavailable)` : '',
  );
  const tooltipContent = $derived(
    hasData && !hasPending
      ? `${$stats$!.totalCreditsUsed.toFixed(1)} credits used across ${$stats$!.agentCount} agent${$stats$!.agentCount === 1 ? '' : 's'}${partialSuffix}`
      : '',
  );
</script>

{#if hasData}
  {#if hasPending}
    <div class="text-xs text-subtle pl-1.5 truncate">
      Workspace Stats: {messageText} messages
    </div>
  {:else}
    <Tooltip content={tooltipContent} side="bottom" size="sm">
      <div class="text-xs text-subtle pl-1.5 truncate">
        Workspace Stats: {creditText} credits · {messageText} messages
        {#if isPartial}
          <span class="text-warning" title="Some sessions unavailable" aria-label="Some sessions unavailable">⚠</span>
        {/if}
      </div>
    </Tooltip>
  {/if}
{/if}
