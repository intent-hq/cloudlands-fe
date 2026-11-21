<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import { cn } from '$lib/utils';
  import { formatUptime } from '$lib/utils/daemon-status-format';
  import * as Menu from '$lib/components/ui/menu';
  import Header from '$lib/components/ui/Header.svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { selectUnslothStopping } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import type { UnslothServerWirePayload } from '$store/renderer/slices/daemon-health/daemon-health-types';
  import { formatCpu, formatMemory } from './DaemonStatusIndicator.svelte';

  let {
    status,
    serverCount = 1,
    stopsAll = false,
    menuAnchor,
    onStop,
  }: {
    status: UnslothServerWirePayload;
    /** Running servers; with more than one, each row names its model. */
    serverCount?: number;
    /** The daemon cannot stop one model, so stop ends every server. */
    stopsAll?: boolean;
    menuAnchor: HTMLElement | null;
    onStop: () => void;
  } = $props();

  const stopping$ = selectUnslothStopping();
  const multiple = $derived(serverCount > 1);

  // The repo name without the org prefix ("unsloth/Qwen3-4B-GGUF" → "Qwen3-4B-GGUF").
  const modelLabel = $derived(
    status.repoId ? (status.repoId.split('/').pop() ?? status.repoId) : '',
  );

  // "unsloth/Qwen3.5-9B-GGUF" → "Qwen3.5-9B"
  const shortModel = $derived(modelLabel.replace(/-GGUF$/i, ''));

  const header = $derived(
    multiple && shortModel
      ? m.layout_daemonStatus_unslothModel_label({ model: shortModel })
      : m.layout_daemonStatus_unslothServer_header(),
  );

  function formatPhase(phase: string): string {
    switch (phase) {
      case 'ready':
        return m.layout_daemonStatus_healthyState_label();
      case 'starting':
        return m.layout_daemonStatus_unslothPhaseStarting_label();
      case 'minting':
        return m.layout_daemonStatus_unslothPhaseMinting_label();
      case 'loading':
        return m.layout_daemonStatus_unslothPhaseLoading_label();
      default:
        return phase;
    }
  }

  const phaseLabel = $derived(status.phase ? formatPhase(status.phase) : null);

  const summaryLabel = $derived.by(() => {
    if (!phaseLabel) return header;
    if (multiple && shortModel) {
      return m.layout_daemonStatus_unslothModelSummary_label({
        model: shortModel,
        status: phaseLabel,
      });
    }
    return m.layout_daemonStatus_unslothSummary_label({ status: phaseLabel });
  });
</script>

<Menu.Sub>
  <div class="px-1">
    <Menu.SubTrigger class="w-full cursor-pointer text-xs px-2 py-1.5">
      {summaryLabel}
    </Menu.SubTrigger>
  </div>
  <!-- Aligns to the whole menu, like the daemon details panel. -->
  <Menu.SubContent
    side="left"
    align="start"
    alignOffset={0}
    customAnchor={menuAnchor}
    collisionPadding={8}
    class="min-w-56 w-max max-w-80 px-0"
  >
    <section aria-label={header} aria-live="off">
      <Header class="px-3 pt-1.5 pb-1" size={6}>{header}</Header>
      <div class="px-3 py-2 space-y-1.5">
        {#if status.repoId}
          <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
            <span class="text-subtle">{m.layout_daemonStatus_model_label()}</span>
            <Tooltip side="left" contentClass="z-[10001]">
              {#snippet content()}
                <span>{status.repoId}</span>
              {/snippet}
              <span class="text-xs truncate max-w-32">{modelLabel}</span>
            </Tooltip>
          </div>
        {/if}

        {#if phaseLabel}
          <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
            <span class="text-subtle">{m.layout_daemonStatus_phase_label()}</span>
            <span
              class={cn('text-xs', status.phase === 'ready' ? 'text-success' : 'text-warning-ink')}
            >
              {phaseLabel}
            </span>
          </div>
        {/if}

        {#if status.port !== undefined}
          <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
            <span class="text-subtle">{m.layout_daemonStatus_port_label()}</span>
            <span class="tabular-nums text-xs">{status.port}</span>
          </div>
        {/if}

        {#if status.uptimeSecs !== undefined}
          <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
            <span class="text-subtle">{m.layout_daemonStatus_uptime_label()}</span>
            <span class="tabular-nums text-xs" aria-live="off"
              >{formatUptime(status.uptimeSecs)}</span
            >
          </div>
        {/if}

        <!-- CPU and memory cover the server's whole process tree -->
        {#if status.cpuPercent !== undefined}
          <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
            <span class="text-subtle">{m.layout_daemonStatus_cpu_label()}</span>
            <span class="tabular-nums text-xs" aria-live="off">{formatCpu(status.cpuPercent)}</span>
          </div>
        {/if}

        {#if status.memoryBytes !== undefined}
          <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
            <span class="text-subtle">{m.layout_daemonStatus_memory_label()}</span>
            <span class="tabular-nums text-xs" aria-live="off"
              >{formatMemory(status.memoryBytes)}</span
            >
          </div>
        {/if}

        <!-- Omitted when the agent manager is not attached -->
        {#if status.attachedAgentCount !== undefined}
          <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
            <span class="text-subtle">{m.layout_daemonStatus_attachedAgents_label()}</span>
            <span class="tabular-nums text-xs">{status.attachedAgentCount}</span>
          </div>
        {/if}

        <Menu.Separator />
        <Menu.Item destructive disabled={$stopping$} onSelect={onStop}>
          {$stopping$
            ? m.layout_daemonStatus_stopUnsloth_stopping_label()
            : stopsAll
              ? m.layout_daemonStatus_stopUnsloth_stopAll_label()
              : m.layout_daemonStatus_stopUnsloth_action_label()}
        </Menu.Item>
      </div>
    </section>
  </Menu.SubContent>
</Menu.Sub>
