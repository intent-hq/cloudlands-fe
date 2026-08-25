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
  import { onMount, tick } from 'svelte';
  import Fa from 'svelte-fa';
  import { writable } from 'svelte/store';
  import { selectWorkspaceTokenUsage } from '$store/renderer/slices/token-usage/token-usage-selectors';
  import { fetchWorkspaceTokenUsage } from '$store/renderer/slices/token-usage/token-usage-slice';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { Button } from '$lib/components/ui/button';
  import { formatCompactNumber } from '$lib/utils/format-compact-number';
  import { formatCurrency, formatNumber } from '$lib/i18n/format';
  import { formatModelLabel } from '$features/token-usage/utils/format-model-label';
  import type {
    TokenUsageCost,
    TokenUsageCrossFilterRow,
    TokenUsageTotals,
  } from '$features/token-usage/token-usage-types';
  import { summarizeCrossFilterRows } from '$features/token-usage/utils/token-usage-utils';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    workspaceId: string;
  }

  type BreakdownKind = 'agent' | 'model';

  interface BreakdownRow {
    id: string;
    kind: BreakdownKind;
    kindLabel: string;
    label: string;
    title: string;
    tokens: number;
    totals: TokenUsageTotals;
    humanMessages: number;
    agentMessages: number;
  }

  interface ScopeTarget {
    kind: BreakdownKind;
    id: string;
  }

  let { workspaceId }: Props = $props();
  let expanded = $state(false);
  let disclosureElement: HTMLButtonElement | null = $state(null);
  let detailsElement: HTMLElement | undefined = $state();
  let overlayStyle = $state('position: fixed; visibility: hidden;');
  let hoveredTarget: ScopeTarget | null = $state(null);
  let focusedTarget: ScopeTarget | null = $state(null);
  let touchTarget: ScopeTarget | null = $state(null);
  let suppressTouchFocusPreview = false;

  const overlayWidth = 452;
  const overlayGap = 8;
  const viewportPadding = 8;

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
  const processedTokens = $derived(tokenCount(totals));
  const crossFilterAvailable = $derived($usage$.byAgentModel !== undefined);
  const crossFilterRows = $derived($usage$.byAgentModel ?? []);
  const crossFilterMessageCount = $derived(
    crossFilterRows.reduce((sum, row) => sum + row.humanMessages + row.agentMessages, 0),
  );
  const hasData = $derived(processedTokens > 0 || crossFilterMessageCount > 0);
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

  const legacyModelRows = $derived(
    Object.entries($usage$.byModel)
      .map(([model, modelTotals]): BreakdownRow => ({
        id: model,
        kind: 'model',
        kindLabel: m.workspace_tokenUsage_byModel_label(),
        label: formatModelLabel(model),
        title: model,
        tokens: tokenCount(modelTotals),
        totals: modelTotals,
        humanMessages: 0,
        agentMessages: 0,
      }))
      .filter((row) => row.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens),
  );

  const agentNameById = $derived(
    new Map($workspaceAgents$.map((agent) => [String(agent.id), agent.name])),
  );
  const legacyAgentRows = $derived(
    Object.entries($usage$.byAgentId)
      .map(([agentId, entry]): BreakdownRow => ({
        id: agentId,
        kind: 'agent',
        kindLabel: m.workspace_tokenUsage_byAgent_label(),
        label:
          agentNameById.get(agentId) ||
          m.workspace_tokenUsage_agentFallback_label({ id: agentId.substring(0, 8) }),
        title:
          agentNameById.get(agentId) ||
          m.workspace_tokenUsage_agentFallback_label({ id: agentId.substring(0, 8) }),
        tokens: tokenCount(entry),
        totals: entry,
        humanMessages: 0,
        agentMessages: 0,
      }))
      .filter((row) => row.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens),
  );

  function rowTarget(row: BreakdownRow): ScopeTarget {
    return { kind: row.kind, id: row.id };
  }

  function targetKey(target: ScopeTarget | null): string | null {
    if (!target) return null;
    return `${target.kind}:${target.id}`;
  }

  function rowKey(target: ScopeTarget | null): string | null {
    if (!target) return null;
    return `${target.kind}:${target.id}`;
  }

  function filterRowsForTarget(
    rows: TokenUsageCrossFilterRow[],
    target: ScopeTarget | null,
  ): TokenUsageCrossFilterRow[] {
    if (!target) return rows;
    return rows.filter((row) =>
      target.kind === 'agent' ? row.agentId === target.id : row.model === target.id,
    );
  }

  function matrixBreakdownRows(kind: BreakdownKind): BreakdownRow[] {
    const grouped = new Map<string, TokenUsageCrossFilterRow[]>();
    for (const cell of crossFilterRows) {
      const id = kind === 'agent' ? cell.agentId : cell.model;
      grouped.set(id, [...(grouped.get(id) ?? []), cell]);
    }
    return [...grouped.entries()]
      .map(([id, cells]): BreakdownRow => {
        const summary = summarizeCrossFilterRows(cells);
        const label =
          kind === 'agent'
            ? agentNameById.get(id) ||
              m.workspace_tokenUsage_agentFallback_label({ id: id.substring(0, 8) })
            : formatModelLabel(id);
        return {
          id,
          kind,
          kindLabel:
            kind === 'agent'
              ? m.workspace_tokenUsage_byAgent_label()
              : m.workspace_tokenUsage_byModel_label(),
          label,
          title: kind === 'agent' ? label : id,
          tokens: tokenCount(summary.totals),
          totals: summary.totals,
          humanMessages: summary.humanMessages,
          agentMessages: summary.agentMessages,
        };
      })
      .filter(
        (row) =>
          row.tokens > 0 ||
          row.humanMessages > 0 ||
          row.agentMessages > 0 ||
          row.totals.cost !== undefined,
      )
      .sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label));
  }

  const modelRows = $derived(crossFilterAvailable ? matrixBreakdownRows('model') : legacyModelRows);
  const agentRows = $derived(crossFilterAvailable ? matrixBreakdownRows('agent') : legacyAgentRows);
  const defaultTarget = $derived(
    crossFilterAvailable
      ? agentRows[0]
        ? rowTarget(agentRows[0])
        : modelRows[0]
          ? rowTarget(modelRows[0])
          : null
      : null,
  );
  const activeTarget: ScopeTarget | null = $derived(
    hoveredTarget ?? focusedTarget ?? touchTarget ?? defaultTarget,
  );
  const scopedCrossFilterRows = $derived(filterRowsForTarget(crossFilterRows, activeTarget));
  const crossFilterSummary = $derived(summarizeCrossFilterRows(scopedCrossFilterRows));
  const selectedAgentRow = $derived(
    (activeTarget?.kind === 'agent'
      ? agentRows.find((row) => row.id === activeTarget.id)
      : undefined) ?? agentRows[0],
  );
  const selectedModelRow = $derived(
    (activeTarget?.kind === 'model'
      ? modelRows.find((row) => row.id === activeTarget.id)
      : undefined) ?? modelRows[0],
  );
  const legacyPreviewRow = $derived(
    [...legacyAgentRows, ...legacyModelRows].find(
      (row) => rowKey(rowTarget(row)) === rowKey(activeTarget),
    ) ?? null,
  );
  const previewTotals = $derived(
    crossFilterAvailable ? crossFilterSummary.totals : (legacyPreviewRow?.totals ?? totals),
  );
  const previewProcessedTokens = $derived(tokenCount(previewTotals));
  const previewCost = $derived(costLabel(previewTotals.cost));
  const previewHumanMessages = $derived(
    crossFilterAvailable ? crossFilterSummary.humanMessages : null,
  );
  const previewAgentMessages = $derived(
    crossFilterAvailable ? crossFilterSummary.agentMessages : null,
  );
  const modelTokenTotal = $derived(modelRows.reduce((sum, row) => sum + row.tokens, 0));
  const agentTokenTotal = $derived(agentRows.reduce((sum, row) => sum + row.tokens, 0));

  function compositionFor(entry: TokenUsageTotals) {
    const entryProcessedTokens = tokenCount(entry);
    return [
      {
        id: 'cached' as const,
        label: m.workspace_tokenUsage_cached_label(),
        description: m.workspace_tokenUsage_cached_description(),
        tokens: entry.cacheReadTokens + entry.cacheCreationTokens,
        colorClass: 'bg-success token-cache-fill',
        contextClass: 'text-success token-cache-text',
      },
      {
        id: 'input' as const,
        label: m.workspace_tokenUsage_in_label(),
        description: m.workspace_tokenUsage_in_description(),
        tokens: entry.inputTokens,
        colorClass: 'bg-cyan-500',
        contextClass: 'text-cyan-600 dark:text-cyan-400',
      },
      {
        id: 'output' as const,
        label: m.workspace_tokenUsage_out_label(),
        description: m.workspace_tokenUsage_out_description(),
        tokens: entry.outputTokens,
        colorClass: 'bg-sky-300',
        contextClass: 'text-sky-600 dark:text-sky-300',
      },
      {
        id: 'reasoning' as const,
        label: m.workspace_tokenUsage_thinking_label(),
        description: m.workspace_tokenUsage_thinking_description(),
        tokens: entry.thoughtTokens ?? 0,
        colorClass: 'bg-violet-500',
        contextClass: 'text-violet-600 dark:text-violet-400',
      },
    ].map((row) => ({ ...row, share: share(row.tokens, entryProcessedTokens) }));
  }

  const workspaceCompositionRows = $derived(compositionFor(totals));
  const compositionRows = $derived(compositionFor(previewTotals));

  function scopeLabel(target: ScopeTarget | null): string {
    if (!target) return m.workspace_tokenUsage_workspace_label();
    const base =
      target.kind === 'agent'
        ? agentNameById.get(target.id) ||
          m.workspace_tokenUsage_agentFallback_label({ id: target.id.substring(0, 8) })
        : formatModelLabel(target.id);
    return base;
  }

  function scopeKindLabel(target: ScopeTarget | null): string {
    if (!target) return m.workspace_tokenUsage_workspace_label();
    return target.kind === 'agent'
      ? m.workspace_tokenUsage_byAgent_label()
      : m.workspace_tokenUsage_byModel_label();
  }

  function scopeTitle(target: ScopeTarget | null): string {
    if (target?.kind === 'model') return target.id;
    return scopeLabel(target);
  }

  function handleRowPointerEnter(row: BreakdownRow, event: PointerEvent) {
    if (event.pointerType === 'touch') return;
    hoveredTarget = rowTarget(row);
  }

  function handleRowPointerLeave(row: BreakdownRow) {
    if (rowKey(hoveredTarget) === rowKey(rowTarget(row))) hoveredTarget = null;
  }

  function handleRowPointerDown(row: BreakdownRow, event: PointerEvent) {
    suppressTouchFocusPreview = event.pointerType === 'touch';
    if (suppressTouchFocusPreview) {
      hoveredTarget = null;
      focusedTarget = null;
      event.preventDefault();
      const target = rowTarget(row);
      touchTarget = targetKey(touchTarget) === targetKey(target) ? null : target;
    }
  }

  function handleRowFocus(row: BreakdownRow) {
    if (!suppressTouchFocusPreview) focusedTarget = rowTarget(row);
  }

  function handleRowBlur(row: BreakdownRow, event: FocusEvent) {
    const next = event.relatedTarget;
    if (
      next instanceof Node &&
      (event.currentTarget as HTMLElement).closest('li')?.contains(next)
    ) {
      return;
    }
    if (rowKey(focusedTarget) === rowKey(rowTarget(row))) focusedTarget = null;
  }

  function updateOverlayPosition() {
    if (!expanded || !disclosureElement || !detailsElement) return;

    const anchor = disclosureElement.getBoundingClientRect();
    const padding = Math.min(viewportPadding, window.innerWidth / 2);
    const width = Math.min(overlayWidth, Math.max(0, window.innerWidth - padding * 2));
    const rightLimit = Math.max(padding, window.innerWidth - padding - width);
    const left = Math.max(padding, Math.min(anchor.left, rightLimit));
    const spaceBelow = Math.max(
      0,
      window.innerHeight - viewportPadding - anchor.bottom - overlayGap,
    );
    const spaceAbove = Math.max(0, anchor.top - viewportPadding - overlayGap);
    const opensAbove = detailsElement.scrollHeight > spaceBelow && spaceAbove > spaceBelow;
    const availableHeight = opensAbove ? spaceAbove : spaceBelow;
    const renderedHeight = Math.min(detailsElement.scrollHeight, availableHeight);
    const top = opensAbove
      ? Math.max(viewportPadding, anchor.top - overlayGap - renderedHeight)
      : anchor.bottom + overlayGap;

    overlayStyle = `position: fixed; visibility: visible; top: ${top}px; left: ${left}px; width: ${width}px; max-height: ${availableHeight}px;`;
  }

  function handleDocumentPointerDown(event: PointerEvent) {
    if (!expanded || !(event.target instanceof Node)) return;
    if (disclosureElement?.contains(event.target) || detailsElement?.contains(event.target)) {
      return;
    }
    expanded = false;
  }

  function handleDocumentKeydown(event: KeyboardEvent) {
    suppressTouchFocusPreview = false;
    touchTarget = null;
    if (!expanded || event.key !== 'Escape') return;
    event.preventDefault();
    expanded = false;
    disclosureElement?.focus();
  }

  onMount(() => {
    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    document.addEventListener('keydown', handleDocumentKeydown);
    window.addEventListener('resize', updateOverlayPosition);
    window.addEventListener('scroll', updateOverlayPosition, true);

    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
      document.removeEventListener('keydown', handleDocumentKeydown);
      window.removeEventListener('resize', updateOverlayPosition);
      window.removeEventListener('scroll', updateOverlayPosition, true);
    };
  });

  $effect(() => {
    if (!expanded) {
      overlayStyle = 'position: fixed; visibility: hidden;';
      hoveredTarget = null;
      focusedTarget = null;
      touchTarget = null;
      return;
    }

    agentRows.length;
    modelRows.length;
    previewCost;
    updateOverlayPosition();
    let cancelled = false;
    let frame = 0;
    void tick().then(() => {
      if (cancelled) return;
      frame = requestAnimationFrame(updateOverlayPosition);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  });
</script>

{#if hasData}
  <div class="token-usage-shell w-full min-w-0 text-xs" data-testid="workspace-token-usage">
    <Button
      bind:ref={disclosureElement}
      variant="plain"
      type="button"
      class="summary-control group grid h-10 w-full max-w-xs min-w-0 grid-cols-[minmax(2.75rem,3.25rem)_max-content_1px_max-content_auto_auto] items-center gap-x-1.5 overflow-hidden rounded-md border border-border bg-card/45 px-3 text-left text-foreground shadow-sm outline-none transition-colors hover:bg-muted/20 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none dark:hover:bg-muted/30"
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
        {#each workspaceCompositionRows as row (row.id)}
          {#if row.tokens > 0}
            <span
              class="summary-composition-segment {row.colorClass}"
              style:width={`${row.share * 100}%`}
            ></span>
          {/if}
        {/each}
      </span>
      <span id={processedId} class="flex min-w-0 items-baseline gap-1 whitespace-nowrap">
        <span class="text-sm font-semibold tabular-nums text-foreground">
          {formatCompactNumber(processedTokens)}
        </span>
        <span class="sr-only">{m.workspace_tokenUsage_processed_label()}</span>
        <span
          class="summary-token-label text-xs font-medium uppercase tracking-widest text-muted-foreground"
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
        <span class="token-cache-text text-sm font-semibold tabular-nums text-success">
          {shareLabel(cacheShare)}
        </span>
        <span
          class="summary-cache-label text-xs font-medium uppercase tracking-widest text-muted-foreground"
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
        class="shrink-0 text-muted-foreground transition-transform {expanded
          ? ''
          : '-rotate-90'} motion-reduce:transition-none"
      />
    </Button>

    {#if expanded}
      <section
        bind:this={detailsElement}
        id={detailsId}
        class="token-usage-details fixed overflow-x-hidden overflow-y-auto rounded-lg border border-border bg-card shadow-lg"
        style={overlayStyle}
        aria-labelledby={titleId}
        data-testid="token-usage-details"
      >
        {#if agentRows.length > 0 || modelRows.length > 0}
          <div class="breakdown-grid grid grid-cols-1">
            {#if agentRows.length > 0}
              <section
                class="breakdown-section min-w-0 px-4 py-4"
                aria-labelledby={`${detailsId}-agents`}
                data-testid="token-usage-by-agent"
              >
                <h4
                  id={`${detailsId}-agents`}
                  class="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
                >
                  {m.workspace_tokenUsage_byAgent_label()}
                </h4>
                {#if selectedAgentRow}
                  <div
                    class="navigator-selection mt-3 flex min-w-0 items-baseline justify-between gap-3"
                  >
                    <span
                      class="truncate text-sm font-medium text-foreground"
                      title={selectedAgentRow.title}>{selectedAgentRow.label}</span
                    >
                    <span
                      class="token-cache-text shrink-0 text-sm font-medium tabular-nums text-success"
                    >
                      {shareLabel(share(selectedAgentRow.tokens, agentTokenTotal))}
                    </span>
                  </div>
                {/if}
                <ol
                  class="breakdown-stack mt-2 flex h-8 w-full overflow-hidden rounded-md bg-muted/60"
                >
                  {#each agentRows as row (row.id)}
                    <li
                      class="breakdown-stack-item h-full"
                      style={`width: ${share(row.tokens, agentTokenTotal) * 100}%`}
                    >
                      <Button
                        variant="plain"
                        type="button"
                        class="breakdown-item-control h-full w-full min-w-0 rounded-none border-0 p-0 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
                        data-preview-active={rowKey(rowTarget(row)) ===
                        rowKey(rowTarget(selectedAgentRow))
                          ? 'true'
                          : undefined}
                        aria-current={rowKey(rowTarget(row)) === rowKey(rowTarget(selectedAgentRow))
                          ? 'true'
                          : undefined}
                        aria-label={m.workspace_tokenUsage_segment_ariaLabel({
                          scope: row.kindLabel,
                          category: row.label,
                          tokens: formatCompactNumber(row.tokens),
                          share: shareLabel(share(row.tokens, agentTokenTotal)),
                        })}
                        title={row.title}
                        onpointerenter={(event) => handleRowPointerEnter(row, event)}
                        onpointerleave={() => handleRowPointerLeave(row)}
                        onpointerdown={(event) => handleRowPointerDown(row, event)}
                        onfocus={() => handleRowFocus(row)}
                        onblur={(event) => handleRowBlur(row, event)}
                      ></Button>
                    </li>
                  {/each}
                </ol>
              </section>
            {/if}

            {#if modelRows.length > 0}
              <section
                class="breakdown-section min-w-0 px-4 py-4"
                aria-labelledby={`${detailsId}-models`}
                data-testid="token-usage-by-model"
              >
                <h4
                  id={`${detailsId}-models`}
                  class="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
                >
                  {m.workspace_tokenUsage_byModel_label()}
                </h4>
                {#if selectedModelRow}
                  <div
                    class="navigator-selection mt-3 flex min-w-0 items-baseline justify-between gap-3"
                  >
                    <span
                      class="truncate text-sm font-medium text-foreground"
                      title={selectedModelRow.title}>{selectedModelRow.label}</span
                    >
                    <span
                      class="token-cache-text shrink-0 text-sm font-medium tabular-nums text-success"
                    >
                      {shareLabel(share(selectedModelRow.tokens, modelTokenTotal))}
                    </span>
                  </div>
                {/if}
                <ol
                  class="breakdown-stack mt-2 flex h-8 w-full overflow-hidden rounded-md bg-muted/60"
                >
                  {#each modelRows as row (row.id)}
                    <li
                      class="breakdown-stack-item h-full"
                      style={`width: ${share(row.tokens, modelTokenTotal) * 100}%`}
                    >
                      <Button
                        variant="plain"
                        type="button"
                        class="breakdown-item-control h-full w-full min-w-0 rounded-none border-0 p-0 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
                        data-preview-active={rowKey(rowTarget(row)) ===
                        rowKey(rowTarget(selectedModelRow))
                          ? 'true'
                          : undefined}
                        aria-current={rowKey(rowTarget(row)) === rowKey(rowTarget(selectedModelRow))
                          ? 'true'
                          : undefined}
                        aria-label={m.workspace_tokenUsage_segment_ariaLabel({
                          scope: row.kindLabel,
                          category: row.label,
                          tokens: formatCompactNumber(row.tokens),
                          share: shareLabel(share(row.tokens, modelTokenTotal)),
                        })}
                        title={row.title}
                        onpointerenter={(event) => handleRowPointerEnter(row, event)}
                        onpointerleave={() => handleRowPointerLeave(row)}
                        onpointerdown={(event) => handleRowPointerDown(row, event)}
                        onfocus={() => handleRowFocus(row)}
                        onblur={(event) => handleRowBlur(row, event)}
                      ></Button>
                    </li>
                  {/each}
                </ol>
              </section>
            {/if}
          </div>
        {/if}

        <section
          class="border-t border-border px-4 py-4"
          aria-labelledby={`${detailsId}-composition`}
        >
          <div class="flex min-w-0 items-baseline justify-between gap-3">
            <h4 id={`${detailsId}-composition`} class="text-sm font-medium text-foreground">
              {m.workspace_tokenUsage_composition_label()}
            </h4>
            <span
              id={`${detailsId}-preview-status`}
              class="preview-status flex min-w-0 items-baseline justify-end gap-1.5 text-sm text-muted-foreground"
              aria-live="polite"
              aria-atomic="true"
            >
              <span class="shrink-0">{m.workspace_tokenUsage_activeScope_label()}</span>
              {#if activeTarget}
                <span class="shrink-0">{scopeKindLabel(activeTarget)}</span>
              {/if}
              <span class="preview-scope-label truncate" title={scopeTitle(activeTarget)}
                >{scopeLabel(activeTarget)}</span
              >
              <span class="shrink-0">
                <span class="tabular-nums">{formatCompactNumber(previewProcessedTokens)}</span>
                {m.workspace_tokenUsage_processed_label()}
              </span>
            </span>
          </div>
          {#if crossFilterAvailable}
            <dl
              class="message-counts mt-4 grid grid-cols-2 gap-x-6 text-sm"
              data-testid="token-usage-message-counts"
            >
              <div class="flex min-w-0 justify-between gap-2">
                <dt class="truncate text-muted-foreground">
                  {m.workspace_tokenUsage_humanMessages_label()}
                </dt>
                <dd class="font-medium tabular-nums text-foreground">{previewHumanMessages}</dd>
              </div>
              <div class="flex min-w-0 justify-between gap-2">
                <dt class="truncate text-muted-foreground">
                  {m.workspace_tokenUsage_agentMessages_label()}
                </dt>
                <dd class="font-medium tabular-nums text-foreground">{previewAgentMessages}</dd>
              </div>
            </dl>
          {/if}
          <div
            class="composition-strip mt-4 flex h-3 w-full overflow-hidden rounded-sm bg-muted"
            aria-hidden="true"
          >
            {#each compositionRows as row (row.id)}
              {#if row.tokens > 0}
                <span class={row.colorClass} style:width={`${row.share * 100}%`}></span>
              {/if}
            {/each}
          </div>
          <dl class="mt-2">
            {#each compositionRows as row (row.id)}
              <div class="composition-row min-w-0 py-3.5">
                <dt class="composition-metric min-w-0 text-sm font-medium text-foreground">
                  <span class="truncate">{row.label}</span>
                </dt>
                <dd class="composition-description truncate text-sm text-muted-foreground">
                  {row.description}
                </dd>
                <dd
                  class="composition-value text-right text-sm font-medium tabular-nums text-foreground"
                >
                  {formatCompactNumber(row.tokens)}
                </dd>
                <dd class="composition-context text-right text-sm tabular-nums {row.contextClass}">
                  {shareLabel(row.share)}
                </dd>
              </div>
            {/each}
          </dl>
        </section>

        {#if previewCost !== null}
          <div
            class="flex justify-between gap-3 px-4 pb-4 text-sm"
            data-testid="token-usage-total-cost"
          >
            <span class="text-muted-foreground">{m.workspace_tokenUsage_totalCost_label()}</span>
            <span class="font-medium tabular-nums text-foreground">{previewCost}</span>
          </div>
        {/if}
      </section>
    {/if}
  </div>
{/if}

<style>
  .token-usage-shell {
    container: token-summary / inline-size;
  }

  .token-usage-details {
    container: token-details / inline-size;
    z-index: 60;
  }

  .summary-composition-segment,
  .composition-strip > span {
    min-width: 2px;
  }

  .token-cache-fill {
    background-color: hsl(var(--success));
  }

  .token-cache-text {
    color: hsl(var(--success));
  }

  .composition-row {
    display: grid;
    grid-template-areas: 'metric description value context';
    grid-template-columns: minmax(4.75rem, 0.8fr) minmax(6.5rem, 1.2fr) 3.5rem 3rem;
    align-items: center;
    column-gap: 0.25rem;
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

  .breakdown-stack-item {
    min-width: 3px;
  }

  :global(.breakdown-item-control) {
    background: hsl(var(--muted-foreground) / 18%);
  }

  :global(.dark) :global(.breakdown-item-control) {
    background: hsl(var(--muted-foreground) / 24%);
  }

  :global(.breakdown-item-control[data-preview-active='true']) {
    background: hsl(var(--success));
  }

  .breakdown-stack-item + .breakdown-stack-item {
    box-shadow: inset 1px 0 hsl(var(--card) / 88%);
  }

  :global(.breakdown-item-control:focus-visible) {
    box-shadow: inset 0 0 0 2px hsl(var(--ring));
  }

  @media (hover: hover) {
    :global(.breakdown-item-control:not([data-preview-active='true']):hover) {
      background: hsl(var(--muted-foreground) / 28%);
    }
  }

  .preview-scope-label {
    max-width: 9rem;
  }

  @container token-details (max-width: 279px) {
    .composition-row {
      grid-template-areas:
        'metric value context'
        'description description description';
      grid-template-columns: minmax(0, 1fr) 3.25rem 2.75rem;
      row-gap: 0.125rem;
    }
  }

  @container token-summary (max-width: 319px) {
    .summary-control {
      grid-template-columns: minmax(2.25rem, 1fr) auto 1px auto auto auto;
      column-gap: 0.375rem;
      padding-inline: 0.5rem;
    }
  }

  @container token-summary (max-width: 295px) {
    .summary-token-label {
      display: none;
    }
  }

  @container token-details (max-width: 319px) {
    .breakdown-section {
      padding-inline: 0.5rem;
    }
  }

  @container token-details (min-width: 280px) {
    .breakdown-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      position: relative;
    }

    .breakdown-grid::after {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 50%;
      width: 1px;
      background: hsl(var(--border) / 55%);
      content: '';
      pointer-events: none;
    }

    .breakdown-section + .breakdown-section {
      border-top: 0;
    }
  }
</style>
