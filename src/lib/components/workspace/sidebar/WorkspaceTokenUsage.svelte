<script lang="ts">
  /**
   * WorkspaceTokenUsage
   *
   * Compact token usage row for the workspace sidebar. Shows aggregated
   * input/output/cached token totals with a breakdown tooltip: per-model
   * totals first, then per-agent totals. When the daemon reports provider
   * cost (PROTOCOL §5.23) the grids gain a Cost column and a total row; when
   * it reports reasoning tokens (`thoughtTokens`, omitted when zero) they gain
   * a Thinking column and the summary a thinking figure.
   * Renders nothing until token data is available (no layout shift).
   */
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import { TooltipRich } from '$lib/components/ui/tooltip';
  import { selectWorkspaceTokenUsage } from '$store/renderer/slices/token-usage/token-usage-selectors';
  import { fetchWorkspaceTokenUsage } from '$store/renderer/slices/token-usage/token-usage-slice';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { formatCompactNumber } from '$lib/utils/format-compact-number';
  import { formatCurrency } from '$lib/i18n/format';
  import { formatModelLabel } from '$features/token-usage/utils/format-model-label';
  import type { TokenUsageCost } from '$features/token-usage/token-usage-types';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

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

  /** Formatted cost, or null when the daemon reported none for the entry. */
  function costLabel(cost: TokenUsageCost | null | undefined): string | null {
    if (!cost) return null;
    const label = formatCurrency(cost.amount, cost.currency);
    return label === '' ? null : label;
  }

  const modelRows = $derived(
    Object.entries($usage$.byModel)
      .map(([model, modelTotals]) => ({
        model,
        label: formatModelLabel(model),
        inputTokens: modelTotals.inputTokens,
        outputTokens: modelTotals.outputTokens,
        cachedTokens: modelTotals.cacheReadTokens + modelTotals.cacheCreationTokens,
        thoughtTokens: modelTotals.thoughtTokens ?? 0,
        cost: costLabel(modelTotals.cost),
      }))
      .filter((row) => row.inputTokens + row.outputTokens + row.cachedTokens !== 0)
      .sort((a, b) => b.outputTokens - a.outputTokens),
  );

  const agentNameById = $derived(
    new Map($workspaceAgents$.map((agent) => [String(agent.id), agent.name])),
  );
  const agentRows = $derived(
    Object.entries($usage$.byAgentId)
      .map(([agentId, entry]) => ({
        agentId,
        name:
          agentNameById.get(agentId) ||
          m.workspace_tokenUsage_agentFallback_label({ id: agentId.substring(0, 8) }),
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        cachedTokens: entry.cacheReadTokens + entry.cacheCreationTokens,
        thoughtTokens: entry.thoughtTokens ?? 0,
        cost: costLabel(entry.cost),
      }))
      .filter((row) => row.inputTokens + row.outputTokens + row.cachedTokens !== 0)
      .sort((a, b) => b.outputTokens - a.outputTokens),
  );

  const totalCost = $derived(costLabel(totals.cost));
  // The Cost column only exists once some entry actually reported a cost, so
  // workspaces without provider cost render exactly the 4-column grids.
  const hasCost = $derived(
    totalCost !== null ||
      modelRows.some((row) => row.cost !== null) ||
      agentRows.some((row) => row.cost !== null),
  );
  // Same for Thinking: `thoughtTokens` is omitted when no provider broke
  // reasoning tokens out of the output count (PROTOCOL §5.23).
  const thoughtTokens = $derived(totals.thoughtTokens ?? 0);
  const hasThinking = $derived(
    thoughtTokens > 0 ||
      modelRows.some((row) => row.thoughtTokens > 0) ||
      agentRows.some((row) => row.thoughtTokens > 0),
  );
  // Static class strings so Tailwind emits the arbitrary grid templates.
  const gridClass = $derived.by(() => {
    const columns = hasThinking
      ? hasCost
        ? 'grid-cols-[1fr_auto_auto_auto_auto_auto]'
        : 'grid-cols-[1fr_auto_auto_auto_auto]'
      : hasCost
        ? 'grid-cols-[1fr_auto_auto_auto_auto]'
        : 'grid-cols-[1fr_auto_auto_auto]';
    return `grid ${columns} gap-x-3 gap-y-0.5 text-sm`;
  });

  const summaryText = $derived(
    hasThinking
      ? m.workspace_tokenUsage_summaryWithThinking_label({
          input: formatCompactNumber(totals.inputTokens),
          output: formatCompactNumber(totals.outputTokens),
          cached: formatCompactNumber(cachedTokens),
          thinking: formatCompactNumber(thoughtTokens),
        })
      : m.workspace_tokenUsage_summary_label({
          input: formatCompactNumber(totals.inputTokens),
          output: formatCompactNumber(totals.outputTokens),
          cached: formatCompactNumber(cachedTokens),
        }),
  );
</script>

{#if hasData}
  <TooltipRich
    title={m.workspace_tokenUsage_title()}
    side="bottom"
    align="start"
    delayDuration={300}
    class="w-full"
  >
    {#snippet content()}
      <div class="flex flex-col gap-2">
        {#if modelRows.length > 0}
          <div class={gridClass} data-testid="token-usage-by-model">
            <span class="text-subtle">{m.workspace_tokenUsage_model_label()}</span>
            <span class="text-subtle text-right">{m.workspace_tokenUsage_in_label()}</span>
            <span class="text-subtle text-right">{m.workspace_tokenUsage_out_label()}</span>
            <span class="text-subtle text-right">{m.workspace_tokenUsage_cached_label()}</span>
            {#if hasThinking}
              <span class="text-subtle text-right">{m.workspace_tokenUsage_thinking_label()}</span>
            {/if}
            {#if hasCost}
              <span class="text-subtle text-right">{m.workspace_tokenUsage_cost_label()}</span>
            {/if}
            {#each modelRows as row (row.model)}
              <span class="truncate max-w-40" title={row.model}>{row.label}</span>
              <span class="text-right font-medium">{formatCompactNumber(row.inputTokens)}</span>
              <span class="text-right font-medium">{formatCompactNumber(row.outputTokens)}</span>
              <span class="text-right text-subtle">{formatCompactNumber(row.cachedTokens)}</span>
              {#if hasThinking}
                <span class="text-right text-subtle">{formatCompactNumber(row.thoughtTokens)}</span>
              {/if}
              {#if hasCost}
                <span class="text-right font-medium"
                  >{row.cost ?? m.workspace_tokenUsage_costEmpty_label()}</span
                >
              {/if}
            {/each}
          </div>
        {/if}
        <div class={gridClass} data-testid="token-usage-by-agent">
          <span class="text-subtle">{m.workspace_tokenUsage_agent_label()}</span>
          <span class="text-subtle text-right">{m.workspace_tokenUsage_in_label()}</span>
          <span class="text-subtle text-right">{m.workspace_tokenUsage_out_label()}</span>
          <span class="text-subtle text-right">{m.workspace_tokenUsage_cached_label()}</span>
          {#if hasThinking}
            <span class="text-subtle text-right">{m.workspace_tokenUsage_thinking_label()}</span>
          {/if}
          {#if hasCost}
            <span class="text-subtle text-right">{m.workspace_tokenUsage_cost_label()}</span>
          {/if}
          {#each agentRows as row (row.agentId)}
            <span class="truncate max-w-40">{row.name}</span>
            <span class="text-right font-medium">{formatCompactNumber(row.inputTokens)}</span>
            <span class="text-right font-medium">{formatCompactNumber(row.outputTokens)}</span>
            <span class="text-right text-subtle">{formatCompactNumber(row.cachedTokens)}</span>
            {#if hasThinking}
              <span class="text-right text-subtle">{formatCompactNumber(row.thoughtTokens)}</span>
            {/if}
            {#if hasCost}
              <span class="text-right font-medium"
                >{row.cost ?? m.workspace_tokenUsage_costEmpty_label()}</span
              >
            {/if}
          {/each}
        </div>
        {#if totalCost !== null}
          <div
            class="flex justify-between gap-3 text-sm border-t border-border/50 pt-1"
            data-testid="token-usage-total-cost"
          >
            <span class="text-subtle">{m.workspace_tokenUsage_totalCost_label()}</span>
            <span class="font-medium">{totalCost}</span>
          </div>
        {/if}
      </div>
    {/snippet}
    <div
      class="w-full text-xs text-subtle pl-0.5 truncate text-left"
      data-testid="workspace-token-usage"
    >
      {summaryText}
      {#if isUpdating}
        <span class="italic opacity-60" aria-label={m.workspace_tokenUsage_updating_ariaLabel()}>
          {m.workspace_tokenUsage_updating_label()}</span
        >
      {/if}
    </div>
  </TooltipRich>
{/if}
