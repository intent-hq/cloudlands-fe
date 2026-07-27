<script lang="ts" module>
  /**
   * Format raw sysinfo CPU percent (may exceed 100% on multi-core hosts)
   * with one decimal, e.g. `12.3%`.
   */
  export function formatCpu(percent: number): string {
    return `${percent.toFixed(1)}%`;
  }

  /**
   * Format a byte count as human-readable MB/GB, e.g. `512.0 MB` or `1.25 GB`.
   */
  export function formatMemory(bytes: number): string {
    const GB = 1024 ** 3;
    const MB = 1024 ** 2;
    if (bytes >= GB) {
      return `${(bytes / GB).toFixed(2)} GB`;
    }
    return `${(bytes / MB).toFixed(1)} MB`;
  }
</script>

<script lang="ts">
  /**
   * DaemonStatusIndicator - Colored status dot + dropdown menu for daemon health
   *
   * Shows green/yellow/red dot based on daemon health state.
   * Clicking opens a dropdown with detailed stats.
   */

  import { m } from '$shared/paraglide/messages.js';
  import { cn } from '$lib/utils';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import Header from '$lib/components/ui/Header.svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import {
    selectDaemonHealth,
    selectDaemonHealthStats,
    selectDaemonHealthLastUpdated,
  } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import { pollSystemStatus } from '$store/renderer/slices/daemon-health/daemon-health-slice';
  import { store as appStore } from '$store/renderer/store';
  import type { DaemonHealth } from '$store/renderer/slices/daemon-health/daemon-health-types';

  const health$ = selectDaemonHealth();
  const stats$ = selectDaemonHealthStats();
  const lastUpdated$ = selectDaemonHealthLastUpdated();

  let dropdownOpen = $state(false);
  let liveUptimeSeconds = $state<number | undefined>(undefined);

  // Color mapping for health states
  const healthColors: Record<DaemonHealth, string> = {
    healthy: 'bg-green-500',
    degraded: 'bg-yellow-500',
    down: 'bg-red-500',
  };

  const healthLabels: Record<DaemonHealth, () => string> = {
    healthy: () => m.layout_daemonStatus_healthy_label(),
    degraded: () => m.layout_daemonStatus_degraded_label(),
    down: () => m.layout_daemonStatus_down_label(),
  };

  // Format uptime from seconds to human-readable string
  function formatUptime(seconds: number | undefined): string {
    if (seconds === undefined) return m.layout_daemonStatus_unknown_label();

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  // Compute live uptime: base uptime + elapsed time since lastUpdated
  function computeLiveUptime(
    uptimeSeconds: number | undefined,
    lastUpdated: string | null
  ): number | undefined {
    if (uptimeSeconds === undefined) return undefined;
    if (!lastUpdated) return uptimeSeconds;

    const lastUpdateTime = new Date(lastUpdated).getTime();
    if (isNaN(lastUpdateTime)) {
      console.warn('Invalid lastUpdated timestamp:', lastUpdated);
      return uptimeSeconds; // Fallback to base uptime
    }

    const now = Date.now();
    const elapsedSeconds = Math.max(0, Math.floor((now - lastUpdateTime) / 1000));

    return uptimeSeconds + elapsedSeconds;
  }

  // Trigger stats refresh when menu opens. Intentionally not gated on health:
  // this is a single poll per open (not a repeating interval) and doubles as an
  // immediate recovery check when the daemon was down.
  $effect(() => {
    if (dropdownOpen) {
      appStore.dispatch(pollSystemStatus());
    }
  });

  // Tick live uptime and refresh stats every second while dropdown is open
  $effect(() => {
    if (dropdownOpen) {
      // Initialize live uptime
      liveUptimeSeconds = computeLiveUptime($stats$?.uptimeSeconds, $lastUpdated$);

      // Update every second. Skip the stats poll while the daemon is down —
      // the dropdown shows the "Not running" placeholder and each poll would
      // just fail; the 10s background interval still detects recovery.
      const interval = setInterval(() => {
        if ($health$ !== 'down') {
          appStore.dispatch(pollSystemStatus());
        }
        liveUptimeSeconds = computeLiveUptime($stats$?.uptimeSeconds, $lastUpdated$);
      }, 1000);

      return () => {
        clearInterval(interval);
        liveUptimeSeconds = undefined;
      };
    } else {
      liveUptimeSeconds = undefined;
    }
  });
</script>

<DropdownMenu align="end" side="bottom" bind:open={dropdownOpen} contentClass="px-0" portal={true}>
  {#snippet trigger({ toggle }: { toggle: () => void })}
    <Tooltip side="bottom">
      {#snippet content()}
        <span>{healthLabels[$health$]()}</span>
      {/snippet}
      <button
        onclick={toggle}
        class="flex items-center justify-center w-6 h-6 hover:bg-muted/50 rounded transition-colors cursor-pointer"
        aria-label={healthLabels[$health$]()}
      >
        <div class={cn('w-2 h-2 rounded-full', healthColors[$health$])}></div>
      </button>
    </Tooltip>
  {/snippet}

  {#snippet content()}
    <div class="w-56">
      <Header class="px-3 pt-1.5 pb-1" size={6}>{m.layout_daemonStatus_header()}</Header>

      {#if $health$ === 'down'}
        <!-- Down state: show placeholders -->
        <div class="px-3 py-2 space-y-1.5">
          <div class="flex justify-between text-xs">
            <span class="text-subtle">{m.layout_daemonStatus_status_label()}</span>
            <span class="text-red-500 font-medium">{m.layout_daemonStatus_notRunning_label()}</span>
          </div>
          <div class="h-px bg-border my-1"></div>
          <div class="text-xs text-subtle text-center py-2">
            {m.layout_daemonStatus_notConnected_description()}
          </div>
        </div>
      {:else}
        <!-- Healthy/Degraded state: show stats -->
        <div class="px-3 py-2 space-y-1.5">
          <div class="flex justify-between text-xs">
            <span class="text-subtle">{m.layout_daemonStatus_status_label()}</span>
            <span class={cn('font-medium', $health$ === 'healthy' ? 'text-green-500' : 'text-yellow-500')}>
              {$health$ === 'healthy'
                ? m.layout_daemonStatus_healthyState_label()
                : m.layout_daemonStatus_degradedState_label()}
            </span>
          </div>

          {#if $stats$}
            <div class="h-px bg-border my-1"></div>

            <!-- Agent slots -->
            <div class="flex justify-between text-xs">
              <span class="text-subtle">{m.layout_daemonStatus_agentSlots_label()}</span>
              <span class="font-mono">
                {$stats$.agents}/{$stats$.maxAgents ?? '?'}
              </span>
            </div>

            <!-- Connected clients -->
            <div class="flex justify-between text-xs">
              <span class="text-subtle">{m.layout_daemonStatus_wssClients_label()}</span>
              <span class="font-mono">{$stats$.clients}</span>
            </div>

            <!-- Transport -->
            <div class="flex justify-between text-xs">
              <span class="text-subtle">{m.layout_daemonStatus_transport_label()}</span>
              <span class="font-mono text-xs">
                {$stats$.listenMode}{$stats$.port ? `:${$stats$.port}` : ''}
              </span>
            </div>

            <!-- Version -->
            {#if $stats$.version}
              <div class="flex justify-between text-xs">
                <span class="text-subtle">{m.layout_daemonStatus_version_label()}</span>
                <span class="font-mono text-xs">{$stats$.version}</span>
              </div>
            {/if}

            <!-- Protocol version -->
            {#if $stats$.protocolVersion !== undefined}
              <div class="flex justify-between text-xs">
                <span class="text-subtle">{m.layout_daemonStatus_protocol_label()}</span>
                <span class="font-mono text-xs">{$stats$.protocolVersion}</span>
              </div>
            {/if}

            <!-- Uptime -->
            {#if liveUptimeSeconds !== undefined}
              <div class="flex justify-between text-xs">
                <span class="text-subtle">{m.layout_daemonStatus_uptime_label()}</span>
                <span class="font-mono text-xs" aria-live="off">{formatUptime(liveUptimeSeconds)}</span>
              </div>
            {/if}

            <!-- CPU (only when the daemon reports it) -->
            {#if $stats$.cpuPercent !== undefined}
              <div class="flex justify-between text-xs">
                <span class="text-subtle">{m.layout_daemonStatus_cpu_label()}</span>
                <span class="font-mono text-xs" aria-live="off">{formatCpu($stats$.cpuPercent)}</span>
              </div>
            {/if}

            <!-- Memory (only when the daemon reports it) -->
            {#if $stats$.memoryBytes !== undefined}
              <div class="flex justify-between text-xs">
                <span class="text-subtle">{m.layout_daemonStatus_memory_label()}</span>
                <span class="font-mono text-xs" aria-live="off">{formatMemory($stats$.memoryBytes)}</span>
              </div>
            {/if}

            <!-- Host OS/Arch -->
            <div class="flex justify-between text-xs">
              <span class="text-subtle">{m.layout_daemonStatus_host_label()}</span>
              <span class="font-mono text-xs">{$stats$.os}/{$stats$.arch}</span>
            </div>

            <!-- FE connection mode -->
            {#if $stats$.transport}
              <div class="flex justify-between text-xs">
                <span class="text-subtle">{m.layout_daemonStatus_connection_label()}</span>
                <span class="font-mono text-xs">
                  {#if $stats$.transport.mode === 'sidecar-uds'}
                    <!-- i18n-ignore (transport mode identifier, not translatable UI copy) -->
                    sidecar (UDS)
                  {:else if $stats$.transport.target}
                    <!-- i18n-ignore (transport mode identifier, not translatable UI copy) -->
                    external ({$stats$.transport.target})
                  {:else}
                    <!-- i18n-ignore (transport mode identifier, not translatable UI copy) -->
                    external (WebSocket)
                  {/if}
                </span>
              </div>
            {:else}
              <div class="flex justify-between text-xs">
                <span class="text-subtle">{m.layout_daemonStatus_connection_label()}</span>
                <!-- i18n-ignore (transport mode identifier) -->
                <span class="font-mono text-xs text-subtle">unknown</span>
              </div>
            {/if}

          {:else}
            <div class="h-px bg-border my-1"></div>
            <div class="text-xs text-subtle text-center py-2">
              {m.layout_daemonStatus_noStats_label()}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/snippet}
</DropdownMenu>
