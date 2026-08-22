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
  const processedId = $derived(`workspace-token-usage-processed-${workspaceId}`);
  const cacheId = $derived(`workspace-token-usage-cache-${workspaceId}`);

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
        description: m.workspace_tokenUsage_in_description(),
        tokens: totals.inputTokens,
        colorClass: 'bg-cyan-500',
      },
      {
        id: 'output',
        label: m.workspace_tokenUsage_out_label(),
        description: m.workspace_tokenUsage_out_description(),
        tokens: totals.outputTokens,
        colorClass: 'bg-sky-300',
      },
      {
        id: 'cached',
        label: m.workspace_tokenUsage_cached_label(),
        description: m.workspace_tokenUsage_cached_description(),
        tokens: cachedTokens,
        colorClass: 'bg-success',
      },
      {
        id: 'reasoning',
        label: m.workspace_tokenUsage_thinking_label(),
        description: m.workspace_tokenUsage_thinking_description(),
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
      class="summary-control group grid h-11 w-full max-w-[34rem] min-w-0 grid-cols-[minmax(2.75rem,7rem)_auto_1px_auto_auto_auto] items-center gap-x-2 overflow-hidden rounded-md border border-border/70 bg-card/35 px-3 text-left text-foreground shadow-sm outline-none transition-colors hover:bg-muted/15 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none dark:bg-card/20 dark:hover:bg-muted/25"
      data-testid="token-usage-disclosure"
      aria-label={expanded
        ? m.workspace_tokenUsage_collapse_ariaLabel()
        : m.workspace_tokenUsage_expand_ariaLabel()}
      aria-expanded={expanded}
      aria-controls={detailsId}
      aria-describedby={`${processedId} ${cacheId}`}
      onclick={() => (expanded = !expanded)}
    >
      <span id={titleId} class="sr-only">{m.workspace_tokenUsage_title()}</span>
      <span class="flex h-2 min-w-0 overflow-hidden rounded-sm bg-muted" aria-hidden="true">
        {#each compositionRows as row (row.id)}
          {#if row.tokens > 0}
            <span class={row.colorClass} style:width={`${row.share * 100}%`}></span>
          {/if}
        {/each}
      </span>
      <span id={processedId} class="flex min-w-0 items-baseline gap-1 truncate">
        <span class="text-[13px] font-semibold tabular-nums text-foreground">
          {formatCompactNumber(processedTokens)}
        </span>
        <span class="sr-only">{m.workspace_tokenUsage_processed_label()}</span>
        <span
          class="summary-token-label text-[9px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
          aria-hidden="true"
        >
          {m.workspace_tokenUsage_tokens_label()}
        </span>
      </span>
      <span class="h-5 w-px bg-border/70" aria-hidden="true"></span>
      <span
        id={cacheId}
        class="flex shrink-0 items-baseline gap-1"
        title={m.workspace_tokenUsage_cacheEfficiency_label()}
      >
        <span class="text-[12px] font-semibold tabular-nums text-success">
          {shareLabel(cacheShare)}
        </span>
        <span
          class="summary-cache-label text-[9px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
          >{m.workspace_tokenUsage_cached_label()}</span
        >
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
        class="shrink-0 text-muted-foreground transition-transform duration-[var(--motion-fast)] {expanded
          ? ''
          : '-rotate-90'} motion-reduce:transition-none"
      />
    </button>

    {#if expanded}
      <section
        id={detailsId}
        class="mt-2 w-full overflow-hidden rounded-md border border-border/70 bg-card/30 shadow-sm dark:bg-card/15"
        aria-labelledby={titleId}
        data-testid="token-usage-details"
      >
        <section class="px-3 py-3" aria-labelledby={`${detailsId}-composition`}>
          <div class="flex items-baseline justify-between gap-3">
            <h4
              id={`${detailsId}-composition`}
              class="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
            >
              {m.workspace_tokenUsage_composition_label()}
            </h4>
            <span class="text-[9px] font-medium uppercase tracking-[0.08em] text-subtle">
              <span class="tabular-nums">{formatCompactNumber(processedTokens)}</span>
              {m.workspace_tokenUsage_processed_label()}
            </span>
          </div>
          <div class="mt-2 flex h-2 w-full overflow-hidden rounded-sm bg-muted" aria-hidden="true">
            {#each compositionRows as row (row.id)}
              {#if row.tokens > 0}
                <span class={row.colorClass} style:width={`${row.share * 100}%`}></span>
              {/if}
            {/each}
          </div>
          <div class="mt-2 divide-y divide-border/50 border-y border-border/60">
            {#each compositionRows as row (row.id)}
              <div class="composition-row min-w-0 py-2">
                <span class="composition-key size-2 rounded-sm {row.colorClass}" aria-hidden="true"
                ></span>
                <span class="composition-metric truncate text-[10px] font-medium text-foreground">
                  {row.label}
                </span>
                <span
                  class="composition-value text-right text-[11px] font-medium tabular-nums text-foreground"
                >
                  {formatCompactNumber(row.tokens)}
                </span>
                <span
                  class="composition-context text-right text-[9px] tabular-nums text-muted-foreground"
                >
                  {shareLabel(row.share)}
                </span>
                <span class="composition-description truncate text-[9px] text-subtle">
                  {row.description}
                </span>
              </div>
            {/each}
          </div>
        </section>

        <div class="breakdown-grid grid grid-cols-1 border-t border-border/70">
          {#if agentRows.length > 0}
            <section
              class="breakdown-section min-w-0 px-3 py-3"
              aria-labelledby={`${detailsId}-agents`}
              data-testid="token-usage-by-agent"
            >
              <h4
                id={`${detailsId}-agents`}
                class="mb-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
              >
                {m.workspace_tokenUsage_byAgent_label()}
              </h4>
              <ol class="divide-y divide-border/50 border-y border-border/60">
                {#each agentRows as row (row.id)}
                  <li class="min-w-0 py-0.5">
                    <span class="block h-1 overflow-hidden rounded-sm bg-muted" aria-hidden="true">
                      <span
                        class="block h-full bg-success/70"
                        style:width={`${share(row.tokens, agentTokenTotal) * 100}%`}
                      ></span>
                    </span>
                    <span
                      class="mt-1 grid min-w-0 grid-cols-[minmax(0,1fr)_4.25rem_3rem] items-center gap-x-1.5"
                    >
                      <span class="truncate text-[10px] text-foreground" title={row.title}
                        >{row.label}</span
                      >
                      <span class="text-right text-[10px] font-medium tabular-nums text-foreground">
                        {formatCompactNumber(row.tokens)}
                      </span>
                      <span class="text-right text-[9px] tabular-nums text-success">
                        {shareLabel(share(row.tokens, agentTokenTotal))}
                      </span>
                    </span>
                    {#if hasCost}
                      <span class="mt-1 block text-[9px] text-subtle">
                        {m.workspace_tokenUsage_cost_label()}
                        {row.cost ?? m.workspace_tokenUsage_costEmpty_label()}
                      </span>
                    {/if}
                  </li>
                {/each}
              </ol>
            </section>
          {/if}

          {#if modelRows.length > 0}
            <section
              class="breakdown-section min-w-0 px-3 py-3"
              aria-labelledby={`${detailsId}-models`}
              data-testid="token-usage-by-model"
            >
              <h4
                id={`${detailsId}-models`}
                class="mb-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
              >
                {m.workspace_tokenUsage_byModel_label()}
              </h4>
              <ol class="divide-y divide-border/50 border-y border-border/60">
                {#each modelRows as row (row.id)}
                  <li class="min-w-0 py-0.5">
                    <span class="block h-1 overflow-hidden rounded-sm bg-muted" aria-hidden="true">
                      <span
                        class="block h-full bg-success/70"
                        style:width={`${share(row.tokens, modelTokenTotal) * 100}%`}
                      ></span>
                    </span>
                    <span
                      class="mt-1 grid min-w-0 grid-cols-[minmax(0,1fr)_4.25rem_3rem] items-center gap-x-1.5"
                    >
                      <span class="truncate text-[10px] text-foreground" title={row.title}
                        >{row.label}</span
                      >
                      <span class="text-right text-[10px] font-medium tabular-nums text-foreground">
                        {formatCompactNumber(row.tokens)}
                      </span>
                      <span class="text-right text-[9px] tabular-nums text-success">
                        {shareLabel(share(row.tokens, modelTokenTotal))}
                      </span>
                    </span>
                    {#if hasCost}
                      <span class="mt-1 block text-[9px] text-subtle">
                        {m.workspace_tokenUsage_cost_label()}
                        {row.cost ?? m.workspace_tokenUsage_costEmpty_label()}
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
            class="flex justify-between gap-3 border-t border-border/70 px-3 py-2 text-[10px]"
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

  .composition-row {
    display: grid;
    grid-template-areas: 'key metric description value context';
    grid-template-columns: 0.5rem minmax(5.5rem, 0.9fr) minmax(6.5rem, 1fr) 4.5rem 3.5rem;
    align-items: center;
    column-gap: 0.5rem;
  }

  .composition-key {
    grid-area: key;
  }

  .composition-metric {
    grid-area: metric;
  }

  .composition-description {
    grid-area: description;
  }

  .composition-value {
    grid-area: value;
  }

  .composition-context {
    grid-area: context;
  }

  .breakdown-section + .breakdown-section {
    border-top: 1px solid hsl(var(--border));
  }

  @container (max-width: 419px) {
    .composition-row {
      grid-template-areas:
        'key metric value context'
        '. description description description';
      grid-template-columns: 0.5rem minmax(0, 1fr) 4rem 3rem;
      row-gap: 0.125rem;
    }
  }

  @container (max-width: 319px) {
    .summary-control {
      grid-template-columns: minmax(2.25rem, 1fr) auto 1px auto auto auto;
      column-gap: 0.375rem;
      padding-inline: 0.5rem;
    }

    .summary-token-label {
      display: none;
    }
  }

  @container (min-width: 420px) {
    .breakdown-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .breakdown-section + .breakdown-section {
      border-top: 0;
      border-left: 1px solid hsl(var(--border));
    }
  }
</style>
