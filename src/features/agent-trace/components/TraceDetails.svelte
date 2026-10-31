<script lang="ts">
  /**
   * Details card for one trace span: status, timing, usage, input and output.
   */
  import Fa from 'svelte-fa';
  import {
    faMagnifyingGlassPlus,
    faTriangleExclamation,
    faXmark,
  } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { formatTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { TraceSpan } from '../trace-types';
  import { spanKindLabel, spanLabel, toolInputPreview } from '../utils/trace-labels';
  import { formatTraceCost, formatTraceDuration, formatTraceTokens } from '../utils/trace-scale';

  interface Props {
    span: TraceSpan;
    /** Working time, without idle time between bursts; `null` when unknown. */
    durationMs: number | null;
    onClose: () => void;
    /** Fits the time axis to this span; absent when it cannot zoom. */
    onZoom?: () => void;
  }

  let { span, durationMs, onClose, onZoom }: Props = $props();

  const label = $derived(spanLabel(span));
  const cost = $derived(formatTraceCost(span.usage));
  const input = $derived(span.kind === 'tool' ? toolInputPreview(span.toolInput) : span.input);
  const status = $derived(
    span.status === 'running'
      ? { text: m.agentTrace_status_running_label(), dot: 'bg-primary-ink' }
      : span.status === 'failed'
        ? { text: m.agentTrace_status_failed_label(), dot: 'bg-danger' }
        : { text: m.agentTrace_status_done_label(), dot: 'bg-muted-foreground' },
  );
  const metrics = $derived.by(() => {
    const rows: { label: string; value: string }[] = [];
    if (durationMs !== null) {
      rows.push(
        { label: m.agentTrace_stats_duration_label(), value: formatTraceDuration(durationMs) },
        { label: m.agentTrace_details_started_label(), value: formatTime(span.start) },
      );
    }
    if (cost) rows.push({ label: m.agentTrace_stats_cost_label(), value: cost });
    if (span.usage) {
      rows.push(
        {
          label: m.agentTrace_details_tokensIn_label(),
          value: formatTraceTokens(span.usage.tokensIn),
        },
        {
          label: m.agentTrace_details_tokensOut_label(),
          value: formatTraceTokens(span.usage.tokensOut),
        },
      );
    }
    if (span.kind === 'agent' && (span.turnCount ?? 0) > 1) {
      rows.push({ label: m.agentTrace_details_turns_label(), value: String(span.turnCount) });
    }
    if (span.kind !== 'tool' && (span.toolCount ?? 0) > 0) {
      rows.push({ label: m.agentTrace_stats_toolCalls_label(), value: String(span.toolCount) });
    }
    return rows;
  });
</script>

<div class="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-4 p-4" data-trace-details={span.id}>
  <div class="flex min-w-0 items-start gap-2.5">
    <span class="mt-0.5 flex size-5 shrink-0 items-center justify-center text-muted-foreground">
      {#if span.kind === 'agent'}
        <AgentAvatar agentId={span.agentId} variant="standard" />
      {:else if label.icon}
        <Fa icon={label.icon} size="sm" />
      {/if}
    </span>
    <div class="min-w-0 flex-1">
      <div class="line-clamp-2 break-words type-body font-medium text-foreground">{label.name}</div>
      <div class="flex min-w-0 items-center gap-1.5 type-caption text-muted-foreground">
        <span class="size-1.5 shrink-0 rounded-full {status.dot}" aria-hidden="true"></span>
        <span class="truncate"
          >{m.agentTrace_kind_withDetail_label({
            kind: status.text,
            detail: spanKindLabel(span, label),
          })}</span
        >
      </div>
    </div>
    <Button
      variant="ghost-light"
      size="icon-compact"
      class="-mt-1 -mr-1.5"
      aria-label={m.agentTrace_details_close_ariaLabel()}
      onclick={onClose}
    >
      <Fa icon={faXmark} />
    </Button>
  </div>

  <dl class="grid grid-cols-3 gap-x-3 gap-y-3">
    {#each metrics as metric (metric.label)}
      <div class="min-w-0">
        <dt class="truncate type-caption text-muted-foreground">{metric.label}</dt>
        <dd class="truncate type-caption font-medium text-foreground tabular-nums">
          {metric.value}
        </dd>
      </div>
    {/each}
  </dl>

  {#if span.error}
    <div
      class="flex gap-2 rounded-(--radius-medium) bg-danger-background px-3 py-2 type-caption text-danger"
      role="status"
    >
      <Fa icon={faTriangleExclamation} class="mt-0.5 shrink-0" size="sm" />
      <span class="line-clamp-4 break-words">{span.error}</span>
    </div>
  {/if}

  {#if input}
    <div class="min-w-0">
      <div class="type-caption text-muted-foreground">{m.agentTrace_details_input_label()}</div>
      <p class="line-clamp-4 break-words whitespace-pre-line type-caption text-foreground">
        {input}
      </p>
    </div>
  {/if}
  {#if span.output && !span.error}
    <div class="min-w-0">
      <div class="type-caption text-muted-foreground">{m.agentTrace_details_output_label()}</div>
      <p class="line-clamp-4 break-words whitespace-pre-line type-caption text-foreground">
        {span.output}
      </p>
    </div>
  {/if}

  {#if onZoom}
    <div class="flex">
      <Button variant="secondary" size="sm" onclick={onZoom} data-trace-zoom>
        {#snippet leadingIcon()}<Fa icon={faMagnifyingGlassPlus} size="xs" />{/snippet}
        {m.agentTrace_details_zoom_label()}
      </Button>
    </div>
  {/if}
</div>
