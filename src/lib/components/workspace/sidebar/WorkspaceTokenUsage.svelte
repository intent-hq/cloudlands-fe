<script lang="ts">
  /**
   * WorkspaceTokenUsage
   *
   * Compact token usage row for the workspace sidebar. Shows aggregated
   * input/output/cached token totals with a breakdown tooltip: per-model
   * totals first, then per-agent totals. Renders nothing until token data
   * is available (no layout shift).
   */
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import { TooltipRich } from '$lib/components/ui/tooltip';
  import { selectWorkspaceTokenUsage } from '$store/renderer/slices/token-usage/token-usage-selectors';
  import { fetchWorkspaceTokenUsage } from '$store/renderer/slices/token-usage/token-usage-slice';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { formatCompactNumber } from '$lib/utils/format-compact-number';
  import { formatModelLabel } from '$features/token-usage/utils/format-model-label';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    workspaceId: string;
  }

  let { workspaceId }: Props = $props();

  const workspaceIdStore = writable('');
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  // ✅ At component init — selectors use getContext(); dispatch uses the configured app store
  const usage$ = selectWorkspaceTokenUsage(workspaceIdStore);
  const workspaceAgents$ = selectAllWorkspaceAgents(workspaceIdStore);

  onMount(() => {
    appStore.dispatch(fetchWorkspaceTokenUsage(workspaceId));
  });

  const totals = $derived($usage$.totals);
  const cachedTokens = $derived(totals.cacheReadTokens + totals.cacheCreationTokens);
  const hasData = $derived(totals.inputTokens + totals.outputTokens + cachedTokens > 0);
  const isUpdating = $derived($usage$.isStale);

  const modelRows = $derived(
    Object.entries($usage$.byModel)
      .map(([model, modelTotals]) => ({
        model,
        label: formatModelLabel(model),
        inputTokens: modelTotals.inputTokens,
        outputTokens: modelTotals.outputTokens,
        cachedTokens: modelTotals.cacheReadTokens + modelTotals.cacheCreationTokens,
      }))
      .sort((a, b) => b.outputTokens - a.outputTokens),
  );

  const agentNameById = $derived(
    new Map($workspaceAgents$.map((agent) => [String(agent.id), agent.name])),
  );
  const agentRows = $derived(
    Object.values($usage$.byAgentId)
      .slice()
      .map((entry) => ({
        agentId: entry.agentId,
        name: agentNameById.get(entry.agentId) || `Agent ${entry.agentId.substring(0, 8)}`,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        cachedTokens: entry.cacheReadTokens + entry.cacheCreationTokens,
      }))
      .sort((a, b) => b.outputTokens - a.outputTokens),
  );

  const summaryText = $derived(
    `↑ ${formatCompactNumber(totals.inputTokens)} in · ${formatCompactNumber(totals.outputTokens)} out · ${formatCompactNumber(cachedTokens)} cached`,
  );
</script>

{#if hasData}
  <TooltipRich title="Token usage" side="bottom" align="start" delayDuration={300} class="w-full">
    {#snippet content()}
      <div class="flex flex-col gap-2">
        {#if modelRows.length > 0}
          <div
            class="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-0.5 text-sm"
            data-testid="token-usage-by-model"
          >
            <span class="text-subtle">Model</span>
            <span class="text-subtle text-right">In</span>
            <span class="text-subtle text-right">Out</span>
            <span class="text-subtle text-right">Cached</span>
            {#each modelRows as row (row.model)}
              <span class="truncate max-w-40" title={row.model}>{row.label}</span>
              <span class="text-right font-medium">{formatCompactNumber(row.inputTokens)}</span>
              <span class="text-right font-medium">{formatCompactNumber(row.outputTokens)}</span>
              <span class="text-right text-subtle">{formatCompactNumber(row.cachedTokens)}</span>
            {/each}
          </div>
        {/if}
        <div
          class="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-0.5 text-sm"
          data-testid="token-usage-by-agent"
        >
          <span class="text-subtle">Agent</span>
          <span class="text-subtle text-right">In</span>
          <span class="text-subtle text-right">Out</span>
          <span class="text-subtle text-right">Cached</span>
          {#each agentRows as row (row.agentId)}
            <span class="truncate max-w-40">{row.name}</span>
            <span class="text-right font-medium">{formatCompactNumber(row.inputTokens)}</span>
            <span class="text-right font-medium">{formatCompactNumber(row.outputTokens)}</span>
            <span class="text-right text-subtle">{formatCompactNumber(row.cachedTokens)}</span>
          {/each}
        </div>
      </div>
    {/snippet}
    <div
      class="w-full text-xs text-subtle pl-0.5 truncate text-left"
      data-testid="workspace-token-usage"
    >
      {summaryText}
      {#if isUpdating}
        <span class="italic opacity-60" aria-label="Token usage is updating"> · updating…</span>
      {/if}
    </div>
  </TooltipRich>
{/if}

