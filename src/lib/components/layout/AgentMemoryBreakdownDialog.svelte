<script lang="ts">
  /**
   * Agent memory breakdown — one row per spawned agent adapter (wire order:
   * the daemon sorts by memory descending), each expandable to its process
   * list. Read-only: the single Close button is the form's submit.
   *
   * Mounted only while the breakdown is open; the parent owns the
   * `agentMemoryBreakdownOpened` / `agentMemoryBreakdownClosed` dispatches.
   */

  import { m } from '$shared/paraglide/messages.js';
  import { formatDateTime, formatNumber } from '$lib/i18n/format';
  import Fa from 'svelte-fa';
  import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import {
    Accordion,
    AccordionContent,
    AccordionHeader,
    AccordionItem,
    AccordionTrigger,
  } from '$lib/components/ui/accordion';
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { ListView } from '$lib/components/patterns/collection';
  import {
    selectAgentMemoryUsage,
    selectAgentMemoryUsageError,
  } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import { formatMemory } from './DaemonStatusIndicator.svelte';

  interface Props {
    /** Called for every dismissal: Close button, Escape, X, backdrop. */
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const agentMemoryUsage$ = selectAgentMemoryUsage();
  const agentMemoryUsageError$ = selectAgentMemoryUsageError();

  let open = $state(true);
  // Agent ids whose process list is expanded.
  let expandedAgentIds = $state<string[]>([]);

  function formatProcessCount(count: number): string {
    return count === 1
      ? m.layout_agentMemoryBreakdown_processes_one({ count: formatNumber(count) })
      : m.layout_agentMemoryBreakdown_processes_many({ count: formatNumber(count) });
  }
</script>

<FormDialog
  bind:open
  title={m.layout_agentMemoryBreakdown_title()}
  description={m.layout_agentMemoryBreakdown_description()}
  submitLabel={m.layout_agentMemoryBreakdown_close_label()}
  submitVariant="outline"
  showCancel={false}
  class="max-w-2xl"
  onSubmit={onClose}
  onCancel={onClose}
>
  {#if $agentMemoryUsage$}
    {@const usage = $agentMemoryUsage$}
    <!--
      A refresh failure after a successful sample keeps the last sample on
      screen but must not pass it off as fresh.
    -->
    {#if $agentMemoryUsageError$}
      <p class="flex items-center gap-1.5 type-caption text-warning-ink" role="status">
        <Fa icon={faTriangleExclamation} />
        {m.layout_agentMemoryBreakdown_refreshError_label()}
      </p>
    {/if}
    <div class="flex justify-between gap-2 type-caption text-muted-foreground">
      <span>
        {m.layout_agentMemoryBreakdown_total_label()}
        <span class="tabular-nums text-foreground"
          >{usage.totalBytes === null ? '—' : formatMemory(usage.totalBytes)}</span
        >
      </span>
      {#if usage.sampledAt}
        <span
          >{m.layout_agentMemoryBreakdown_sampledAt_label({
            time: formatDateTime(usage.sampledAt),
          })}</span
        >
      {/if}
    </div>
    {#if usage.agents.length === 0}
      <p class="type-body text-muted-foreground py-4 text-center">
        {m.layout_agentMemoryBreakdown_empty_label()}
      </p>
    {:else}
      <Accordion type="multiple" bind:value={expandedAgentIds} class="max-h-[60vh] overflow-y-auto">
        {#each usage.agents as agent (agent.agentId)}
          <AccordionItem value={agent.agentId} class="border-b border-border last:border-b-0">
            <AccordionHeader>
              <AccordionTrigger>
                <span class="flex items-center justify-between gap-3 min-w-0">
                  <span class="flex min-w-0 flex-col">
                    <span class="truncate text-foreground">{agent.agentName}</span>
                    <span class="truncate">
                      {m.layout_agentMemoryBreakdown_workspace_label({
                        workspace: agent.workspaceId,
                      })}
                      · {agent.provider}{agent.model ? `/${agent.model}` : ''}
                    </span>
                  </span>
                  <span class="flex shrink-0 flex-col items-end tabular-nums">
                    <span class="text-foreground">{formatMemory(agent.memoryBytes)}</span>
                    <span>{formatProcessCount(agent.processCount)}</span>
                  </span>
                </span>
              </AccordionTrigger>
            </AccordionHeader>
            <AccordionContent>
              <ListView
                items={agent.processes}
                getKey={(proc) => proc.pid}
                getText={(proc) => proc.name}
                virtualize={false}
                ariaLabel={m.layout_agentMemoryBreakdown_processList_ariaLabel({
                  agent: agent.agentName,
                })}
              >
                {#snippet row({ item: proc })}
                  <div class="flex items-baseline gap-2 min-w-0 px-1 py-0.5">
                    <span class="shrink-0 tabular-nums"
                      >{m.layout_agentMemoryBreakdown_pid_label({ pid: String(proc.pid) })}</span
                    >
                    <span class="shrink-0 text-foreground">{proc.name}</span>
                    <!--
                      The full command line stays in the DOM (CSS-truncated,
                      selectable) and is also exposed in full via tooltip.
                    -->
                    <Tooltip
                      side="top"
                      class="min-w-0 flex-1"
                      contentClass="z-[10001] max-w-xl break-all"
                    >
                      {#snippet content()}
                        <span class="select-text font-mono">{proc.cmdline}</span>
                      {/snippet}
                      <span class="block min-w-0 w-full truncate select-text font-mono"
                        >{proc.cmdline}</span
                      >
                    </Tooltip>
                    <span class="ml-auto shrink-0 tabular-nums text-foreground"
                      >{formatMemory(proc.memoryBytes)}</span
                    >
                  </div>
                {/snippet}
              </ListView>
            </AccordionContent>
          </AccordionItem>
        {/each}
      </Accordion>
    {/if}
  {:else if $agentMemoryUsageError$}
    <p class="type-body text-danger py-4 text-center">
      {m.layout_agentMemoryBreakdown_error_label()}
    </p>
  {:else}
    <p class="type-body text-muted-foreground py-4 text-center" aria-live="polite">
      {m.layout_agentMemoryBreakdown_loading_label()}
    </p>
  {/if}
</FormDialog>
