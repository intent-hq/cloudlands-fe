<script lang="ts">
  import { observeOverflow } from '$lib/actions/observe-overflow';

  let commandOverflow = $state<Record<number, boolean>>({});
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
  import { Badge } from '$lib/components/ui/badge';
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
  import { selectWorkspaceTitlesById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectProviderCatalogEntries } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import type {
    AgentMemoryRemoteOwner,
    AgentMemoryUsageAgentWirePayload,
  } from '$store/renderer/slices/daemon-health/daemon-health-types';
  import { formatMemory } from './DaemonStatusIndicator.svelte';

  interface Props {
    /** Called for every dismissal: Close button, Escape, X, backdrop. */
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const agentMemoryUsage$ = selectAgentMemoryUsage();
  const agentMemoryUsageError$ = selectAgentMemoryUsageError();
  const providerEntries$ = selectProviderCatalogEntries();
  const workspaceTitles$ = selectWorkspaceTitlesById();

  let open = $state(true);
  // Agent ids whose process list is expanded.
  let expandedAgentIds = $state<string[]>([]);

  function formatProcessCount(count: number): string {
    return count === 1
      ? m.layout_agentMemoryBreakdown_processes_one({ count: formatNumber(count) })
      : m.layout_agentMemoryBreakdown_processes_many({ count: formatNumber(count) });
  }

  // The owning backend's name, falling back to a short backend id.
  function ownerName(owner: AgentMemoryRemoteOwner): string {
    return owner.backendName.trim() || owner.backendId.slice(0, 8);
  }

  // Provider display names from the daemon catalog; unknown ids pass through.
  function providerName(providerId: string): string {
    return $providerEntries$.find((entry) => entry.id === providerId)?.shortName ?? providerId;
  }

  // An agent run for another backend is named by its launch on newer
  // daemons; older ones send no name and a backend workspace id that cannot
  // be resolved here, so fall back to provider and model, then a short id.
  function agentLabel(agent: AgentMemoryUsageAgentWirePayload): string {
    const name = agent.agentName?.trim();
    if (name) return name;
    if (agent.remoteOwner && agent.provider) return providerModel(agent);
    return m.layout_agentMemoryBreakdown_unnamedAgent_label({ id: agent.agentId.slice(0, 8) });
  }

  function providerModel(agent: AgentMemoryUsageAgentWirePayload): string {
    const provider = providerName(agent.provider ?? '');
    // i18n-ignore (separator between provider and model names)
    return agent.model ? `${provider} · ${agent.model}` : provider;
  }

  // "for <backend>", plus the backend's workspace title when the launch sent one.
  function ownerTag(agent: AgentMemoryUsageAgentWirePayload, owner: AgentMemoryRemoteOwner) {
    const tag = m.layout_agentMemoryBreakdown_remoteOwner_label({ backend: ownerName(owner) });
    const workspace = agent.workspaceTitle?.trim();
    return workspace ? `${tag} · ${workspace}` : tag; // i18n-ignore (separator)
  }

  // Local rows carry no title: resolve it from this client's workspaces.
  function localWorkspaceLabel(workspaceId: string): string {
    return $workspaceTitles$[workspaceId]?.trim() || workspaceId;
  }

  // Local rows: workspace (title, else id) and provider/model. Remote rows:
  // provider and model only when the label is the agent's name.
  function agentDetail(agent: AgentMemoryUsageAgentWirePayload): string {
    if (agent.remoteOwner) {
      return agent.agentName?.trim() && agent.provider ? providerModel(agent) : '';
    }
    const parts: string[] = [];
    if (agent.workspaceId) {
      parts.push(
        m.layout_agentMemoryBreakdown_workspace_label({
          workspace: localWorkspaceLabel(agent.workspaceId),
        }),
      );
    }
    if (agent.provider) {
      parts.push(agent.model ? `${agent.provider}/${agent.model}` : agent.provider);
    }
    return parts.join(' · '); // i18n-ignore (separator between already-localized parts)
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
    <div class="flex flex-wrap justify-between gap-x-4 gap-y-1 type-caption text-muted-foreground">
      <span class="shrink-0 whitespace-nowrap">
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
                    <span class="flex min-w-0 items-center gap-1.5">
                      <span class="truncate text-foreground">{agentLabel(agent)}</span>
                      {#if agent.remoteOwner}
                        <Badge variant="dot" size="compact" class="min-w-0 shrink">
                          <span class="min-w-0 truncate">{ownerTag(agent, agent.remoteOwner)}</span>
                        </Badge>
                      {/if}
                    </span>
                    {#if agentDetail(agent)}
                      <span class="truncate">{agentDetail(agent)}</span>
                    {/if}
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
                  agent: agentLabel(agent),
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
                      disabled={!commandOverflow[proc.pid]}
                      side="top"
                      class="min-w-0 flex-1"
                      contentClass="z-[10001] max-w-xl break-all"
                    >
                      {#snippet content()}
                        <span class="select-text font-mono">{proc.cmdline}</span>
                      {/snippet}
                      <span
                        class="block min-w-0 w-full truncate select-text font-mono"
                        use:observeOverflow={(overflow) => (commandOverflow[proc.pid] = overflow)}
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
