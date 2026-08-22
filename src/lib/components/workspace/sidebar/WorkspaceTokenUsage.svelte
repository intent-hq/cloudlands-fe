<script lang="ts">
  /**
   * WorkspaceTokenUsage
   *
   * Compact token usage disclosure for the workspace sidebar. Shows the
   * processed total and cache efficiency at a glance, with composition and
   * ranked agent/model details on demand. Provider-reported cost and reasoning
   * tokens remain display-only additions to the daemon-owned accounting.
   * Renders nothing until token data is available (no layout shift).
   */
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { writable } from 'svelte/store';
  import { selectWorkspaceTokenUsage } from '$store/renderer/slices/token-usage/token-usage-selectors';
  import { fetchWorkspaceTokenUsage } from '$store/renderer/slices/token-usage/token-usage-slice';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { formatCompactNumber } from '$lib/utils/format-compact-number';
  import { formatCurrency, formatNumber } from '$lib/i18n/format';
  import { formatModelLabel } from '$features/token-usage/utils/format-model-label';
  import type { TokenUsageCost, TokenUsageTotals } from '$features/token-usage/token-usage-types';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    workspaceId: string;
  }

  let { workspaceId }: Props = $props();
  let expanded = $state(false);

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
  const thoughtTokens = $derived(totals.thoughtTokens ?? 0);
  const processedTokens = $derived(tokenCount(totals));
  const hasData = $derived(processedTokens > 0);
  const isUpdating = $derived($usage$.isStale);
  const cacheShare = $derived(share(cachedTokens, processedTokens));
  const detailsId = $derived(`workspace-token-usage-details-${workspaceId}`);
  const titleId = $derived(`workspace-token-usage-title-${workspaceId}`);

  function tokenCount(entry: TokenUsageTotals): number {
    return (
      entry.inputTokens +
      entry.outputTokens +
      entry.cacheReadTokens +
      entry.cacheCreationTokens +
      (entry.thoughtTokens ?? 0)
    );
  }

  function share(value: number, total: number): number {
    return total > 0 ? value / total : 0;
  }

  function shareLabel(value: number): string {
    return formatNumber(value, { style: 'percent', maximumFractionDigits: 1 });
  }

  /** Formatted cost, or null when the daemon reported none for the entry. */
  function costLabel(cost: TokenUsageCost | null | undefined): string | null {
    if (!cost) return null;
    const label = formatCurrency(cost.amount, cost.currency);
    return label === '' ? null : label;
  }

  const modelRows = $derived(
    Object.entries($usage$.byModel)
      .map(([model, modelTotals]) => ({
        id: model,
        label: formatModelLabel(model),
        title: model,
        tokens: tokenCount(modelTotals),
        cost: costLabel(modelTotals.cost),
      }))
      .filter((row) => row.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens),
  );

  const agentNameById = $derived(
    new Map($workspaceAgents$.map((agent) => [String(agent.id), agent.name])),
  );
  const agentRows = $derived(
    Object.entries($usage$.byAgentId)
      .map(([agentId, entry]) => ({
        id: agentId,
        label:
          agentNameById.get(agentId) ||
          m.workspace_tokenUsage_agentFallback_label({ id: agentId.substring(0, 8) }),
        title:
          agentNameById.get(agentId) ||
          m.workspace_tokenUsage_agentFallback_label({ id: agentId.substring(0, 8) }),
        tokens: tokenCount(entry),
        cost: costLabel(entry.cost),
      }))
      .filter((row) => row.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens),
  );

  const totalCost = $derived(costLabel(totals.cost));
  const hasCost = $derived(
    totalCost !== null ||
      modelRows.some((row) => row.cost !== null) ||
      agentRows.some((row) => row.cost !== null),
  );
  const modelTokenTotal = $derived(modelRows.reduce((sum, row) => sum + row.tokens, 0));
  const agentTokenTotal = $derived(agentRows.reduce((sum, row) => sum + row.tokens, 0));
  const compositionRows = $derived.by(() =>
    [
      {
        id: 'input',
        label: m.workspace_tokenUsage_in_label(),
        tokens: totals.inputTokens,
        colorClass: 'bg-cyan-500',
      },
      {
        id: 'output',
        label: m.workspace_tokenUsage_out_label(),
        tokens: totals.outputTokens,
        colorClass: 'bg-sky-300',
      },
      {
        id: 'cached',
        label: m.workspace_tokenUsage_cached_label(),
        tokens: cachedTokens,
        colorClass: 'bg-emerald-500',
      },
      {
        id: 'reasoning',
        label: m.workspace_tokenUsage_thinking_label(),
        tokens: thoughtTokens,
        colorClass: 'bg-violet-500',
      },
    ].map((row) => ({ ...row, share: share(row.tokens, processedTokens) })),
  );
</script>

{#if hasData}
  <div class="token-usage-shell w-full min-w-0 text-xs" data-testid="workspace-token-usage">
    <button
      type="button"
      class="group flex w-full min-w-0 items-center gap-2.5 rounded-md border border-border/70 bg-muted/20 px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none"
      data-testid="token-usage-disclosure"
      aria-label={expanded
        ? m.workspace_tokenUsage_collapse_ariaLabel()
        : m.workspace_tokenUsage_expand_ariaLabel()}
      aria-expanded={expanded}
      aria-controls={detailsId}
      onclick={() => (expanded = !expanded)}
    >
      <span
        class="flex h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-muted"
        aria-hidden="true"
      >
        {#each compositionRows as row (row.id)}
          {#if row.tokens > 0}
            <span class={row.colorClass} style:width={`${row.share * 100}%`}></span>
          {/if}
        {/each}
      </span>
      <span class="flex min-w-0 flex-1 flex-col">
        <span id={titleId} class="truncate font-medium text-foreground">
          {m.workspace_tokenUsage_title()}
        </span>
        <span class="truncate text-[10px] text-subtle">
          <span class="tabular-nums">{formatCompactNumber(processedTokens)}</span>
          {m.workspace_tokenUsage_processed_label()}
        </span>
      </span>
      <span
        class="flex shrink-0 flex-col items-end"
        title={m.workspace_tokenUsage_cacheEfficiency_label()}
      >
        <span class="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
          {shareLabel(cacheShare)}
        </span>
        <span class="text-[10px] text-subtle">{m.workspace_tokenUsage_cached_label()}</span>
      </span>
      <span class="flex w-2 shrink-0 justify-center" aria-live="polite">
        {#if isUpdating}
          <span
            class="size-1.5 rounded-full bg-blue-500 motion-safe:animate-pulse"
            title={m.workspace_tokenUsage_updating_ariaLabel()}
          >
            <span class="sr-only">{m.workspace_tokenUsage_updating_label()}</span>
          </span>
        {/if}
      </span>
      <Fa
        icon={faChevronDown}
        size="xs"
        class="shrink-0 text-subtle transition-transform duration-[var(--motion-fast)] {expanded
          ? ''
          : 'rotate-90'} motion-reduce:transition-none"
      />
    </button>

    {#if expanded}
      <section
        id={detailsId}
        class="mt-2 rounded-md border border-border/70 bg-card/40 px-3 py-3"
        aria-labelledby={titleId}
        data-testid="token-usage-details"
      >
        <section aria-labelledby={`${detailsId}-composition`}>
          <h4 id={`${detailsId}-composition`} class="mb-2 font-medium text-muted-foreground">
            {m.workspace_tokenUsage_composition_label()}
          </h4>
          <div
            class="mb-2.5 flex h-2 w-full overflow-hidden rounded-full bg-muted"
            aria-hidden="true"
          >
            {#each compositionRows as row (row.id)}
              {#if row.tokens > 0}
                <span class={row.colorClass} style:width={`${row.share * 100}%`}></span>
              {/if}
            {/each}
          </div>
          <div class="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 gap-y-1.5">
            {#each compositionRows as row (row.id)}
              <span class="flex min-w-0 items-center gap-2 text-muted-foreground">
                <span class="size-2 shrink-0 rounded-sm {row.colorClass}" aria-hidden="true"></span>
                <span class="truncate">{row.label}</span>
              </span>
              <span class="text-right font-medium tabular-nums text-foreground">
                {formatCompactNumber(row.tokens)}
              </span>
              <span class="w-10 text-right tabular-nums text-subtle">
                {shareLabel(row.share)}
              </span>
            {/each}
          </div>
        </section>

        <div class="breakdown-grid mt-4 grid grid-cols-1 gap-4 border-t border-border/50 pt-3">
          {#if agentRows.length > 0}
            <section aria-labelledby={`${detailsId}-agents`} data-testid="token-usage-by-agent">
              <h4 id={`${detailsId}-agents`} class="mb-2 font-medium text-muted-foreground">
                {m.workspace_tokenUsage_byAgent_label()}
              </h4>
              <ol class="flex flex-col gap-2">
                {#each agentRows as row (row.id)}
                  <li class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
                    <span class="truncate text-foreground" title={row.title}>{row.label}</span>
                    <span class="text-right font-medium tabular-nums text-foreground">
                      {formatCompactNumber(row.tokens)}
                    </span>
                    {#if hasCost}
                      <span class="text-[10px] text-subtle">
                        {m.workspace_tokenUsage_cost_label()}
                        {row.cost ?? m.workspace_tokenUsage_costEmpty_label()}
                      </span>
                    {:else}
                      <span></span>
                    {/if}
                    {#if agentRows.length > 1}
                      <span class="text-right text-[10px] tabular-nums text-subtle">
                        {shareLabel(share(row.tokens, agentTokenTotal))}
                      </span>
                      <span class="col-span-2 h-1 overflow-hidden rounded-full bg-muted">
                        <span
                          class="block h-full rounded-full bg-foreground/25"
                          style:width={`${share(row.tokens, agentTokenTotal) * 100}%`}
                        ></span>
                      </span>
                    {/if}
                  </li>
                {/each}
              </ol>
            </section>
          {/if}

          {#if modelRows.length > 0}
            <section aria-labelledby={`${detailsId}-models`} data-testid="token-usage-by-model">
              <h4 id={`${detailsId}-models`} class="mb-2 font-medium text-muted-foreground">
                {m.workspace_tokenUsage_byModel_label()}
              </h4>
              <ol class="flex flex-col gap-2">
                {#each modelRows as row (row.id)}
                  <li class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
                    <span class="truncate text-foreground" title={row.title}>{row.label}</span>
                    <span class="text-right font-medium tabular-nums text-foreground">
                      {formatCompactNumber(row.tokens)}
                    </span>
                    {#if hasCost}
                      <span class="text-[10px] text-subtle">
                        {m.workspace_tokenUsage_cost_label()}
                        {row.cost ?? m.workspace_tokenUsage_costEmpty_label()}
                      </span>
                    {:else}
                      <span></span>
                    {/if}
                    {#if modelRows.length > 1}
                      <span class="text-right text-[10px] tabular-nums text-subtle">
                        {shareLabel(share(row.tokens, modelTokenTotal))}
                      </span>
                      <span class="col-span-2 h-1 overflow-hidden rounded-full bg-muted">
                        <span
                          class="block h-full rounded-full bg-foreground/25"
                          style:width={`${share(row.tokens, modelTokenTotal) * 100}%`}
                        ></span>
                      </span>
                    {/if}
                  </li>
                {/each}
              </ol>
            </section>
          {/if}
        </div>

        {#if totalCost !== null}
          <div
            class="mt-3 flex justify-between gap-3 border-t border-border/50 pt-2"
            data-testid="token-usage-total-cost"
          >
            <span class="text-subtle">{m.workspace_tokenUsage_totalCost_label()}</span>
            <span class="font-medium tabular-nums text-foreground">{totalCost}</span>
          </div>
        {/if}
      </section>
    {/if}
  </div>
{/if}

<style>
  .token-usage-shell {
    container-type: inline-size;
  }

  @container (min-width: 420px) {
    .breakdown-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
