<script lang="ts">
  /**
   * WorkspaceTokenUsage
   *
   * Compact token usage disclosure for the collapsed Agents launcher. Shows
   * only the processed total, with composition and ranked agent/model details
   * on demand. Provider-reported cost and reasoning tokens remain display-only
   * additions to the daemon-owned accounting. Renders nothing until token data
   * is available (no layout shift).
   */
  import { onMount, tick } from 'svelte';
  import { writable } from 'svelte/store';
  import { selectWorkspaceTokenUsage } from '$store/renderer/slices/token-usage/token-usage-selectors';
  import { fetchWorkspaceTokenUsage } from '$store/renderer/slices/token-usage/token-usage-slice';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { Button } from '$lib/components/ui/button';
  import AnimatedNumber from '$lib/components/ui/AnimatedNumber.svelte';
  import { portal } from '$lib/actions/portal';
  import {
    formatCompactNumber,
    formatCurrency,
    formatInteger,
    formatNumber,
  } from '$lib/i18n/format';
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

  $effect(() => {
    if (!disclosureElement || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateOverlayPosition);
    observer.observe(disclosureElement.closest('[data-sidebar-label-row]') ?? disclosureElement);
    return () => observer.disconnect();
  });

  const totals = $derived($usage$.totals);
  const processedTokens = $derived(tokenCount(totals));
  const crossFilterAvailable = $derived($usage$.byAgentModel !== undefined);
  const crossFilterRows = $derived($usage$.byAgentModel ?? []);
  const crossFilterMessageCount = $derived(
    crossFilterRows.reduce((sum, row) => sum + row.humanMessages + row.agentMessages, 0),
  );
  const hasData = $derived(processedTokens > 0 || crossFilterMessageCount > 0);
  const isUpdating = $derived($usage$.isStale);
  const detailsId = $derived(`workspace-token-usage-details-${workspaceId}`);
  const titleId = $derived(`workspace-token-usage-title-${workspaceId}`);
  const processedId = $derived(`workspace-token-usage-processed-${workspaceId}`);

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

  function segmentWidth(valueShare: number, segmentCount: number): string {
    const totalGapWidth = Math.max(0, segmentCount - 1);
    return `calc((100% - ${totalGapWidth}px) * ${valueShare})`;
  }

  function shareLabel(value: number): string {
    return formatNumber(value, { style: 'percent', maximumFractionDigits: 0 });
  }

  function compactWholeNumber(value: number): string {
    return formatCompactNumber(value, { maximumFractionDigits: 0 });
  }

  /** Formatted cost, or null when the daemon reported none for the entry. */
  function costLabel(cost: TokenUsageCost | null | undefined): string | null {
    if (!cost) return null;
    const label = formatCurrency(cost.amount, cost.currency, { fractionDigits: 0 });
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
  const modelSegmentRows = $derived(modelRows.filter((row) => row.tokens > 0));
  const agentSegmentRows = $derived(agentRows.filter((row) => row.tokens > 0));

  function firstNonzeroRow(rows: BreakdownRow[]): BreakdownRow | undefined {
    return rows.find((row) => row.tokens > 0);
  }

  const defaultTarget = $derived(
    crossFilterAvailable
      ? firstNonzeroRow(agentRows)
        ? rowTarget(firstNonzeroRow(agentRows)!)
        : firstNonzeroRow(modelRows)
          ? rowTarget(firstNonzeroRow(modelRows)!)
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
      : undefined) ?? firstNonzeroRow(agentRows),
  );
  const selectedModelRow = $derived(
    (activeTarget?.kind === 'model'
      ? modelRows.find((row) => row.id === activeTarget.id)
      : undefined) ?? firstNonzeroRow(modelRows),
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
        label: m.workspace_tokenUsage_cachedContext_label(),
        tokens: entry.cacheReadTokens + entry.cacheCreationTokens,
      },
      {
        id: 'input' as const,
        label: m.workspace_tokenUsage_inputContext_label(),
        tokens: entry.inputTokens,
      },
      {
        id: 'output' as const,
        label: m.workspace_tokenUsage_modelOutput_label(),
        tokens: entry.outputTokens,
      },
      {
        id: 'reasoning' as const,
        label: m.workspace_tokenUsage_reasoningTokens_label(),
        tokens: entry.thoughtTokens ?? 0,
      },
    ].map((row) => ({ ...row, share: share(row.tokens, entryProcessedTokens) }));
  }

  const compositionRows = $derived(compositionFor(previewTotals));
  const visibleCompositionRows = $derived(compositionRows.filter((row) => row.tokens > 0));
  const compositionSummary = $derived(
    visibleCompositionRows
      .map((row) =>
        m.workspace_tokenUsage_segment_ariaLabel({
          scope: m.workspace_tokenUsage_composition_label(),
          category: row.label,
          tokens: compactWholeNumber(row.tokens),
          share: shareLabel(row.share),
        }),
      )
      .join('; '),
  );

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

  function handleRowKeydown(row: BreakdownRow, rows: BreakdownRow[], event: KeyboardEvent) {
    const currentIndex = rows.findIndex(
      (candidate) => rowKey(rowTarget(candidate)) === rowKey(rowTarget(row)),
    );
    if (currentIndex < 0) return;

    let nextIndex: number | null = null;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + rows.length) % rows.length;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % rows.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = rows.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    suppressTouchFocusPreview = false;
    hoveredTarget = null;
    touchTarget = null;
    focusedTarget = rowTarget(rows[nextIndex]);
    const group = (event.currentTarget as HTMLElement).closest('[role="radiogroup"]');
    group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus();
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
    const borderHeight = detailsElement.offsetHeight - detailsElement.clientHeight;
    const renderedHeight = Math.min(detailsElement.scrollHeight + borderHeight, availableHeight);
    const top = opensAbove
      ? Math.max(viewportPadding, anchor.top - overlayGap - renderedHeight)
      : anchor.bottom + overlayGap;

    overlayStyle = `position: fixed; visibility: visible; top: ${top}px; left: ${left}px; width: ${width}px; max-height: ${availableHeight}px;`;
  }

  function closeOverlay({ restoreFocus = false } = {}) {
    expanded = false;
    if (restoreFocus && disclosureElement?.isConnected) disclosureElement.focus();
  }

  function handleDisclosurePointerDown(event: PointerEvent) {
    event.stopPropagation();
  }

  function handleDisclosureKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
  }

  function handleDisclosureClick(event: MouseEvent) {
    event.stopPropagation();
    expanded = !expanded;
  }

  function handleDocumentPointerDown(event: PointerEvent) {
    if (!expanded || !(event.target instanceof Node)) return;
    if (disclosureElement?.contains(event.target) || detailsElement?.contains(event.target)) {
      return;
    }
    closeOverlay();
  }

  function handleDocumentKeydown(event: KeyboardEvent) {
    suppressTouchFocusPreview = false;
    touchTarget = null;
    if (!expanded || event.key !== 'Escape') return;
    event.preventDefault();
    closeOverlay({ restoreFocus: true });
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
    if (!hasData && expanded) closeOverlay();
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
  <div
    class="token-usage-shell pointer-events-auto relative z-20 ml-auto shrink-0 text-xs"
    data-testid="workspace-token-usage"
  >
    <Button
      bind:ref={disclosureElement}
      variant="plain"
      type="button"
      class="summary-control inline-flex h-6 w-auto min-w-0 items-center rounded px-1.5 !text-xs font-normal tabular-nums text-muted-foreground outline-none transition-colors hover:bg-background/70 hover:text-foreground focus-visible:bg-background/80 focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      data-testid="token-usage-disclosure"
      aria-label={expanded
        ? m.workspace_tokenUsage_collapse_ariaLabel()
        : m.workspace_tokenUsage_expand_ariaLabel()}
      aria-expanded={expanded}
      aria-controls={detailsId}
      aria-describedby={processedId}
      onpointerdown={handleDisclosurePointerDown}
      onkeydown={handleDisclosureKeydown}
      onclick={handleDisclosureClick}
    >
      <span aria-hidden="true">{compactWholeNumber(processedTokens)}</span>
      <span id={processedId} class="sr-only" aria-live="polite">
        {compactWholeNumber(processedTokens)}
        {m.workspace_tokenUsage_tokensUsed_label()}
        {#if isUpdating}
          {m.workspace_tokenUsage_updating_label()}
        {/if}
      </span>
    </Button>
    <span id={titleId} class="sr-only">{m.workspace_tokenUsage_title()}</span>

    {#if expanded}
      <section
        use:portal={'body'}
        bind:this={detailsElement}
        id={detailsId}
        class="token-usage-details fixed overflow-x-hidden overflow-y-auto rounded-md border border-muted bg-card font-normal shadow-sm"
        style={overlayStyle}
        aria-labelledby={titleId}
        data-testid="token-usage-details"
      >
        {#if agentRows.length > 0 || modelRows.length > 0}
          <div class="breakdown-grid grid grid-cols-2 border-b border-border">
            {#if agentRows.length > 0}
              <section
                class="breakdown-section min-w-0 px-4 pb-4 pt-3"
                aria-labelledby={`${detailsId}-agents`}
                data-testid="token-usage-by-agent"
              >
                <h4 id={`${detailsId}-agents`} class="sr-only">
                  {m.workspace_tokenUsage_byAgent_label()}
                </h4>
                {#if selectedAgentRow && agentSegmentRows.length > 0}
                  <div class="navigator-row flex min-w-0 flex-col gap-1.5">
                    <div class="navigator-selection flex min-w-0 items-baseline gap-1.5">
                      <span
                        class="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
                        title={selectedAgentRow.title}>{selectedAgentRow.label}</span
                      >
                      <span
                        class="shrink-0 text-right text-xs font-normal tabular-nums text-muted-foreground"
                      >
                        <AnimatedNumber
                          value={share(selectedAgentRow.tokens, agentTokenTotal)}
                          format={shareLabel}
                          pulse={false}
                          class="block w-full text-right"
                        />
                      </span>
                    </div>
                    <ol
                      class="breakdown-stack flex h-2.5 w-full min-w-0 overflow-hidden bg-muted/60"
                      role="radiogroup"
                      aria-labelledby={`${detailsId}-agents`}
                    >
                      {#each agentSegmentRows as row (row.id)}
                        <li
                          class="breakdown-stack-item h-full"
                          role="presentation"
                          style={`width: ${segmentWidth(share(row.tokens, agentTokenTotal), agentSegmentRows.length)}`}
                        >
                          <button
                            type="button"
                            role="radio"
                            class="breakdown-item-control block h-full w-full min-w-0 appearance-none rounded-none border-0 p-0 outline-none transition-colors motion-reduce:transition-none"
                            data-preview-active={rowKey(rowTarget(row)) ===
                            rowKey(rowTarget(selectedAgentRow))
                              ? 'true'
                              : undefined}
                            aria-checked={rowKey(rowTarget(row)) ===
                            rowKey(rowTarget(selectedAgentRow))
                              ? 'true'
                              : 'false'}
                            tabindex={rowKey(rowTarget(row)) === rowKey(rowTarget(selectedAgentRow))
                              ? 0
                              : -1}
                            aria-label={m.workspace_tokenUsage_segment_ariaLabel({
                              scope: row.kindLabel,
                              category: row.label,
                              tokens: compactWholeNumber(row.tokens),
                              share: shareLabel(share(row.tokens, agentTokenTotal)),
                            })}
                            title={row.title}
                            onpointerenter={(event) => handleRowPointerEnter(row, event)}
                            onpointerleave={() => handleRowPointerLeave(row)}
                            onpointerdown={(event) => handleRowPointerDown(row, event)}
                            onfocus={() => handleRowFocus(row)}
                            onblur={(event) => handleRowBlur(row, event)}
                            onkeydown={(event) => handleRowKeydown(row, agentSegmentRows, event)}
                          ></button>
                        </li>
                      {/each}
                    </ol>
                  </div>
                {/if}
              </section>
            {/if}

            {#if modelRows.length > 0}
              <section
                class="breakdown-section min-w-0 px-4 pb-4 pt-3"
                aria-labelledby={`${detailsId}-models`}
                data-testid="token-usage-by-model"
              >
                <h4 id={`${detailsId}-models`} class="sr-only">
                  {m.workspace_tokenUsage_byModel_label()}
                </h4>
                {#if selectedModelRow && modelSegmentRows.length > 0}
                  <div class="navigator-row flex min-w-0 flex-col gap-1.5">
                    <div class="navigator-selection flex min-w-0 items-baseline gap-1.5">
                      <span
                        class="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
                        title={selectedModelRow.title}>{selectedModelRow.label}</span
                      >
                      <span
                        class="shrink-0 text-right text-xs font-normal tabular-nums text-muted-foreground"
                      >
                        <AnimatedNumber
                          value={share(selectedModelRow.tokens, modelTokenTotal)}
                          format={shareLabel}
                          pulse={false}
                          class="block w-full text-right"
                        />
                      </span>
                    </div>
                    <ol
                      class="breakdown-stack flex h-2.5 w-full min-w-0 overflow-hidden bg-muted/60"
                      role="radiogroup"
                      aria-labelledby={`${detailsId}-models`}
                    >
                      {#each modelSegmentRows as row (row.id)}
                        <li
                          class="breakdown-stack-item h-full"
                          role="presentation"
                          style={`width: ${segmentWidth(share(row.tokens, modelTokenTotal), modelSegmentRows.length)}`}
                        >
                          <button
                            type="button"
                            role="radio"
                            class="breakdown-item-control block h-full w-full min-w-0 appearance-none rounded-none border-0 p-0 outline-none transition-colors motion-reduce:transition-none"
                            data-preview-active={rowKey(rowTarget(row)) ===
                            rowKey(rowTarget(selectedModelRow))
                              ? 'true'
                              : undefined}
                            aria-checked={rowKey(rowTarget(row)) ===
                            rowKey(rowTarget(selectedModelRow))
                              ? 'true'
                              : 'false'}
                            tabindex={rowKey(rowTarget(row)) === rowKey(rowTarget(selectedModelRow))
                              ? 0
                              : -1}
                            aria-label={m.workspace_tokenUsage_segment_ariaLabel({
                              scope: row.kindLabel,
                              category: row.label,
                              tokens: compactWholeNumber(row.tokens),
                              share: shareLabel(share(row.tokens, modelTokenTotal)),
                            })}
                            title={row.title}
                            onpointerenter={(event) => handleRowPointerEnter(row, event)}
                            onpointerleave={() => handleRowPointerLeave(row)}
                            onpointerdown={(event) => handleRowPointerDown(row, event)}
                            onfocus={() => handleRowFocus(row)}
                            onblur={(event) => handleRowBlur(row, event)}
                            onkeydown={(event) => handleRowKeydown(row, modelSegmentRows, event)}
                          ></button>
                        </li>
                      {/each}
                    </ol>
                  </div>
                {/if}
              </section>
            {/if}
          </div>
        {/if}

        <section class="px-4 pb-3 pt-3" aria-labelledby={`${detailsId}-composition`}>
          <h4 id={`${detailsId}-composition`} class="sr-only">
            {m.workspace_tokenUsage_composition_label()}
          </h4>
          <span
            id={`${detailsId}-preview-status`}
            class="preview-status sr-only"
            aria-live="polite"
            aria-atomic="true"
          >
            <span>{m.workspace_tokenUsage_activeScope_label()}</span>
            {#if activeTarget}
              <span>{scopeKindLabel(activeTarget)}</span>
            {/if}
            <span title={scopeTitle(activeTarget)}>{scopeLabel(activeTarget)}</span>
            <span>
              <span>{compactWholeNumber(previewProcessedTokens)}</span>
              {m.workspace_tokenUsage_processed_label()}
            </span>
          </span>
          <div
            class="token-summary mb-2 flex min-w-0 items-center justify-between gap-3 text-xs font-normal tracking-normal text-muted-foreground"
          >
            <span>{m.workspace_tokenUsage_title()}</span>
            <span class="shrink-0 text-right text-sm font-normal tabular-nums text-foreground">
              <AnimatedNumber
                value={previewProcessedTokens}
                format={compactWholeNumber}
                pulse={false}
                class="block text-right"
              />
            </span>
          </div>
          {#if visibleCompositionRows.length > 0}
            <div
              class="composition-strip mb-3 flex h-2.5 w-full min-w-0 overflow-hidden"
              role="img"
              aria-label={compositionSummary}
            >
              {#each visibleCompositionRows as row (row.id)}
                <span
                  class="composition-strip-segment block h-full shrink-0"
                  data-metric={row.id}
                  style={`width: ${segmentWidth(row.share, visibleCompositionRows.length)}`}
                  aria-hidden="true"
                ></span>
              {/each}
            </div>
          {/if}
          <div
            class="composition-header min-w-0 border-b border-border pb-1 text-xs font-normal tracking-normal text-muted-foreground"
          >
            <span>{m.workspace_tokenUsage_metric_label()}</span>
            <span class="text-right">{m.workspace_tokenUsage_value_label()}</span>
            <span class="text-right">{m.workspace_tokenUsage_share_label()}</span>
          </div>
          <dl>
            {#each compositionRows as row (row.id)}
              <div class="composition-row token-composition-row min-w-0 py-1">
                <dt
                  class="composition-metric flex min-w-0 items-center gap-2 text-sm font-normal text-foreground"
                >
                  <span
                    class="composition-key size-1.5 shrink-0 rounded-full"
                    data-metric={row.id}
                    aria-hidden="true"
                  ></span>
                  <span class="min-w-0 truncate">{row.label}</span>
                </dt>
                <dd
                  class="composition-value text-right text-sm font-normal tabular-nums text-foreground"
                >
                  <AnimatedNumber
                    value={row.tokens}
                    format={compactWholeNumber}
                    pulse={false}
                    class="block w-full text-right"
                  />
                </dd>
                <dd
                  class="composition-context text-right text-xs font-normal tabular-nums text-muted-foreground"
                >
                  <AnimatedNumber
                    value={row.share}
                    format={shareLabel}
                    pulse={false}
                    class="block w-full text-right"
                  />
                </dd>
              </div>
              {#if row.id === 'input' && crossFilterAvailable}
                <div class="composition-row message-composition-row min-w-0 py-1">
                  <dt
                    class="composition-metric message-composition-metric flex min-w-0 text-sm font-normal text-foreground"
                  >
                    <span class="message-composition-label min-w-0 truncate">
                      {m.workspace_tokenUsage_humanMessages_label()}
                    </span>
                  </dt>
                  <dd
                    class="composition-value text-right text-sm font-normal tabular-nums text-foreground"
                  >
                    <AnimatedNumber
                      value={previewHumanMessages ?? 0}
                      format={formatInteger}
                      pulse={false}
                      class="block w-full text-right"
                    />
                  </dd>
                  <dd class="composition-context" aria-hidden="true"></dd>
                </div>
                <div class="composition-row message-composition-row min-w-0 py-1">
                  <dt
                    class="composition-metric message-composition-metric flex min-w-0 text-sm font-normal text-foreground"
                  >
                    <span class="message-composition-label min-w-0 truncate">
                      {m.workspace_tokenUsage_agentMessages_label()}
                    </span>
                  </dt>
                  <dd
                    class="composition-value text-right text-sm font-normal tabular-nums text-foreground"
                  >
                    <AnimatedNumber
                      value={previewAgentMessages ?? 0}
                      format={formatInteger}
                      pulse={false}
                      class="block w-full text-right"
                    />
                  </dd>
                  <dd class="composition-context" aria-hidden="true"></dd>
                </div>
              {/if}
            {/each}
          </dl>
        </section>

        {#if previewCost !== null}
          <div
            class="flex justify-between gap-3 border-t border-border px-4 py-3 text-sm"
            data-testid="token-usage-total-cost"
          >
            <span class="text-muted-foreground">{m.workspace_tokenUsage_totalCost_label()}</span>
            <span class="text-right font-normal tabular-nums text-foreground">{previewCost}</span>
          </div>
        {/if}
      </section>
    {/if}
  </div>
{/if}

<style>
  .token-usage-details {
    container: token-details / inline-size;
    z-index: var(--layer-popover);
  }

  .composition-row,
  .composition-header {
    display: grid;
    grid-template-areas: 'metric value context';
    grid-template-columns: minmax(0, 1fr) 3.5rem 3rem;
    align-items: center;
    column-gap: 0.5rem;
  }

  .navigator-selection {
    max-width: 100%;
  }

  .composition-metric {
    grid-area: metric;
  }

  .composition-value {
    grid-area: value;
  }

  .composition-context {
    grid-area: context;
  }

  .message-composition-metric {
    padding-inline-start: calc(0.375rem + 0.5rem + 1rem);
  }

  .breakdown-stack-item {
    min-width: 0;
  }

  .breakdown-stack {
    border-radius: 2px;
    gap: 1px;
    background: hsl(var(--border));
  }

  .composition-strip {
    border-radius: 2px;
    gap: 1px;
    background: hsl(var(--border));
  }

  .composition-strip-segment {
    flex: 0 0 auto;
  }

  .composition-strip-segment[data-metric='cached'],
  .composition-key[data-metric='cached'] {
    background: hsl(var(--success) / 82%);
  }

  .composition-strip-segment[data-metric='input'],
  .composition-key[data-metric='input'] {
    background: hsl(217 72% 53% / 84%);
  }

  .composition-strip-segment[data-metric='output'],
  .composition-key[data-metric='output'] {
    background: hsl(var(--info) / 82%);
  }

  .composition-strip-segment[data-metric='reasoning'],
  .composition-key[data-metric='reasoning'] {
    background: hsl(var(--warning) / 88%);
  }

  :global(.dark) .composition-strip-segment[data-metric='input'],
  :global(.dark) .composition-key[data-metric='input'] {
    background: hsl(213 88% 68% / 84%);
  }

  .breakdown-stack-item:first-child {
    border-radius: 2px 0 0 2px;
    overflow: hidden;
  }

  .breakdown-stack-item:last-child {
    border-radius: 0 2px 2px 0;
    overflow: hidden;
  }

  .breakdown-stack-item:only-child {
    border-radius: 2px;
  }

  :global(.breakdown-item-control) {
    background: hsl(var(--muted-foreground) / 14%);
  }

  :global(.dark) :global(.breakdown-item-control) {
    background: hsl(var(--muted-foreground) / 20%);
  }

  :global(.breakdown-item-control[data-preview-active='true']) {
    background: hsl(var(--foreground));
  }

  .breakdown-stack:focus-within {
    outline: 2px solid hsl(var(--foreground));
    outline-offset: 2px;
  }

  @media (hover: hover) {
    :global(.breakdown-item-control:not([data-preview-active='true']):hover) {
      background: hsl(var(--muted-foreground) / 28%);
    }
  }

  @container token-details (max-width: 319px) {
    .breakdown-section {
      padding-inline: 0.5rem;
    }
  }

  .breakdown-section + .breakdown-section {
    border-left: 1px solid hsl(var(--border));
  }

  .composition-row + .composition-row {
    border-top: 1px solid hsl(var(--border));
  }
</style>
