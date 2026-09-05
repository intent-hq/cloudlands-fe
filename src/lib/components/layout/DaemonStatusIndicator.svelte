<script lang="ts" module>
  import { formatNumber } from '$lib/i18n/format';

  /**
   * Format raw sysinfo CPU percent (may exceed 100% on multi-core hosts)
   * with one decimal, e.g. `12.3%`.
   */
  export function formatCpu(percent: number): string {
    return `${percent.toFixed(1)}%`;
  }

  /**
   * Format a byte count as human-readable MB/GB/TB, e.g. `512.0 MB`,
   * `1.25 GB` or `1.00 TB`.
   */
  export function formatMemory(bytes: number): string {
    const TB = 1024 ** 4;
    const GB = 1024 ** 3;
    const MB = 1024 ** 2;
    if (bytes >= TB) {
      return `${(bytes / TB).toFixed(2)} TB`;
    }
    if (bytes >= GB) {
      return `${(bytes / GB).toFixed(2)} GB`;
    }
    return `${(bytes / MB).toFixed(1)} MB`;
  }

  /**
   * Format a disk byte count with decimal (SI) units — TB = 1000^4 — so
   * values match what the OS (e.g. macOS Finder) reports for the same
   * volume. At most 3 significant figures, trailing zeros trimmed:
   * 2,000,000,000,000 B → `2 TB`; 1,070,000,000,000 B → `1.07 TB`;
   * 994,080,000,000 B → `994 GB`. Units are chosen with a half-step
   * threshold so rounding can never produce a 4-digit value — the whole
   * [999.5 GB, 1 TB) window renders `1 TB`, not `1000 GB` — and sub-MB
   * values clamp to `0 MB`. The numeric part is locale-formatted via
   * `$lib/i18n/format`.
   */
  export function formatDiskSize(bytes: number): string {
    const TB = 1000 ** 4;
    const GB = 1000 ** 3;
    const MB = 1000 ** 2;
    // i18n-ignore (SI unit suffixes are technical notation)
    const [value, unit] =
      bytes >= 999.5 * GB
        ? [bytes / TB, 'TB']
        : bytes >= 999.5 * MB
          ? [bytes / GB, 'GB']
          : [bytes / MB, 'MB'];
    // A nearly-full disk can report sub-MB free space, which would render
    // like "0.0005 MB" — floor the MB tier to two decimals so tiny values
    // clamp to "0 MB".
    const rounded =
      unit === 'MB'
        ? Math.round(Number(value.toPrecision(3)) * 100) / 100
        : Number(value.toPrecision(3));
    return `${formatNumber(rounded, { maximumSignificantDigits: 3, useGrouping: false })} ${unit}`;
  }

  /**
   * Strip a leading `v` from a version string. system.status may report a
   * v-prefixed version (the pin comparator accepts it), but the mismatch
   * messages prepend their own `v` — without normalization a valid `v0.9.1`
   * would render as `vv0.9.1`.
   */
  export function stripLeadingV(version: string): string {
    return version.replace(/^v/, '');
  }

  // Re-exported for existing importers; the implementation lives in the
  // dependency-light util so non-layout consumers (e.g. Settings → Devices)
  // can share it without importing this component.
  import { formatConnectionLabel } from '$lib/utils/connection-label';
  export { formatConnectionLabel };
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
  import { formatTransportLabel } from '$lib/utils/daemon-status-format';
  import Fa from 'svelte-fa';
  import { faPlus, faCheck, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import Header from '$lib/components/ui/Header.svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import BulkActionConfirmDialog from '$lib/components/modals/BulkActionConfirmDialog.svelte';
  import Portal from '$lib/components/ui/Portal.svelte';
  import CertMismatchModal from './CertMismatchModal.svelte';
  import ProtocolMismatchModal from './ProtocolMismatchModal.svelte';
  import {
    selectDaemonHealth,
    selectDaemonHealthStats,
    selectDaemonHealthLastUpdated,
    selectDaemonVersionComparison,
    selectUnslothStatus,
    selectUnslothStopping,
  } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import {
    pollSystemStatus,
    pollUnslothStatus,
    stopUnslothRequested,
  } from '$store/renderer/slices/daemon-health/daemon-health-slice';
  import {
    selectConnections,
    selectCurrentConnectionId,
    selectCurrentConnection,
    selectConnectionCertMismatch,
    selectCertWarningsByConnectionId,
    selectActiveProtocolMismatch,
    selectProtocolMismatchModal,
  } from '$store/renderer/slices/connections/connections-selectors';
  import {
    certMismatchCleared,
    protocolMismatchModalDismissed,
  } from '$store/renderer/slices/connections/connections-slice';
  import {
    openConnectionRequested,
    forgetConnectionRequested,
  } from '$store/renderer/slices/connections/connections-slice';
  import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
  import {
    CONNECTION_ACCENT_CLASSES,
    resolveConnectionAccent,
  } from '$lib/utils/connection-accents';
  import { store as appStore } from '$store/renderer/store';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import { toast } from '$lib/components/ui/toast';
  import type { DaemonHealth } from '$store/renderer/slices/daemon-health/daemon-health-types';

  const health$ = selectDaemonHealth();
  const stats$ = selectDaemonHealthStats();
  const lastUpdated$ = selectDaemonHealthLastUpdated();
  const versionComparison$ = selectDaemonVersionComparison();
  const unslothStatus$ = selectUnslothStatus();
  const unslothStopping$ = selectUnslothStopping();
  const connections$ = selectConnections();
  const currentConnectionId$ = selectCurrentConnectionId();
  const currentConnection$ = selectCurrentConnection();
  const certMismatch$ = selectConnectionCertMismatch();
  const certWarningsById$ = selectCertWarningsByConnectionId();
  const activeProtocolMismatch$ = selectActiveProtocolMismatch();
  const protocolMismatchModal$ = selectProtocolMismatchModal();

  let dropdownOpen = $state(false);
  let liveUptimeSeconds = $state<number | undefined>(undefined);
  let stopUnslothDialogOpen = $state(false);

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

  // Connected-daemon-vs-bundled-sidecar version mismatch: either direction
  // ('older'/'newer') counts; 'equal'/'unknown'/missing sides do not.
  const versionMismatch = $derived.by(() => {
    const cmp = $versionComparison$;
    return cmp && (cmp.comparison === 'older' || cmp.comparison === 'newer') ? cmp : null;
  });

  // Low workspaces-volume disk space (< 10% free, both fields present) is a
  // derived display-only warning — it never mutates the health state itself.
  const workspaceDiskLow = $derived.by(() => {
    const available = $stats$?.workspacesDiskAvailableBytes;
    const total = $stats$?.workspacesDiskTotalBytes;
    return available !== undefined && total !== undefined && total > 0 && available / total < 0.1;
  });

  // Formatted workspace-disk value: "free of total", or just the free part
  // when the daemon omits the total. Null hides the row entirely.
  const workspaceDiskValue = $derived.by(() => {
    const available = $stats$?.workspacesDiskAvailableBytes;
    if (available === undefined) return null;
    const total = $stats$?.workspacesDiskTotalBytes;
    return total !== undefined
      ? m.layout_daemonStatus_workspaceDiskFreeOfTotal_label({
          free: formatDiskSize(available),
          total: formatDiskSize(total),
        })
      : m.layout_daemonStatus_workspaceDiskFree_label({ free: formatDiskSize(available) });
  });

  // A version mismatch or low workspace disk turns an otherwise-healthy dot
  // yellow; degraded (already yellow) and down (red) are unchanged.
  const dotColorClass = $derived(
    $health$ === 'healthy' && (versionMismatch || workspaceDiskLow)
      ? 'bg-yellow-500'
      : healthColors[$health$],
  );

  const triggerLabel = $derived(
    $health$ === 'healthy' && versionMismatch
      ? m.layout_daemonStatus_healthyVersionMismatch_label()
      : healthLabels[$health$](),
  );

  const detailsStatusLabel = $derived(
    m.layout_daemonStatus_statusSummary_label({
      status:
        $health$ === 'healthy'
          ? m.layout_daemonStatus_healthyState_label()
          : $health$ === 'degraded'
            ? m.layout_daemonStatus_degradedState_label()
            : m.layout_daemonStatus_notRunning_label(),
    }),
  );

  const versionMismatchTooltip = $derived.by(() => {
    if (!versionMismatch) return null;
    // The i18n messages prepend "v" — strip any daemon-reported prefix so a
    // valid v-prefixed version never renders as "vv0.9.1".
    const params = {
      daemonVersion: stripLeadingV(versionMismatch.daemonVersion),
      pinnedVersion: stripLeadingV(versionMismatch.pinnedVersion),
    };
    return versionMismatch.comparison === 'older'
      ? m.layout_daemonStatus_versionBehind_tooltip(params)
      : m.layout_daemonStatus_versionAhead_tooltip(params);
  });

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
    lastUpdated: string | null,
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
      appStore.dispatch(pollUnslothStatus());
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
          appStore.dispatch(pollUnslothStatus());
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

  // Short model label for the unsloth row: the repo name without the org
  // prefix (e.g. "unsloth/Qwen3-4B-GGUF" → "Qwen3-4B-GGUF").
  const unslothModelLabel = $derived(
    $unslothStatus$?.repoId
      ? ($unslothStatus$.repoId.split('/').pop() ?? $unslothStatus$.repoId)
      : '',
  );

  // Compact machine name shown next to the status dot when this window's
  // connection is remote (name only, no host:port — same preference order as
  // formatConnectionLabel). Null when local/unknown → dot-only trigger.
  const currentRemoteName = $derived.by(() => {
    const conn = $currentConnection$;
    if (!conn || conn.isLocal) return null;
    return formatConnectionLabel(conn);
  });

  // Trigger accessible name: includes the visible remote name when shown so
  // the label-in-name relationship holds (WCAG 2.5.3).
  const triggerAriaLabel = $derived(
    currentRemoteName ? `${triggerLabel} — ${currentRemoteName}` : triggerLabel,
  );

  const stopUnslothDescription = $derived.by(() => {
    const count = $unslothStatus$?.attachedAgentCount ?? 0;
    const model = $unslothStatus$?.repoId ?? m.layout_daemonStatus_unslothFallbackModel_label();
    if (count > 0) {
      return count === 1
        ? m.layout_daemonStatus_stopUnslothAttached_one({ count, model })
        : m.layout_daemonStatus_stopUnslothAttached_many({ count, model });
    }
    return m.layout_daemonStatus_stopUnslothIdle_description({ model });
  });

  function confirmStopUnsloth() {
    appStore.dispatch(stopUnslothRequested());
  }

  // --- Multi-backend connect: menu actions -------------------------------

  function openDevicesSettings() {
    dropdownOpen = false;
    void navigateToSettings({ tab: 'devices' });
  }

  const hasSavedRemoteConnections = $derived($connections$.some((conn) => !conn.isLocal));

  function connectionDisplayLabel(id: string): string {
    const conn = $connections$.find((c) => c.id === id);
    if (!conn || conn.isLocal) return m.layout_daemonStatus_localConnection_label();
    return formatConnectionLabel(conn);
  }

  /**
   * Dispatch a connection open. A `secret-unavailable` resolution (the stored
   * access token cannot be read — keychain locked or entry gone) is a failure,
   * not a success (#3783): surface it and route to Devices settings, where the
   * token can be re-entered.
   */
  async function openConnectionOrRecover(id: string) {
    try {
      const action = openConnectionRequested(id);
      appStore.dispatch(action);
      const result = await action.promise;
      if (result.status === 'secret-unavailable') {
        toast.error(
          m.layout_daemonStatus_secretUnavailable_error({ label: connectionDisplayLabel(id) }),
        );
        void navigateToSettings({ tab: 'devices' });
      }
    } catch {
      // Other failures are surfaced via the slice's op-status/error; nothing
      // more to do here (the list/active refresh arrives via connections:changed).
    }
  }

  async function handleOpenConnection(id: string) {
    dropdownOpen = false;
    await openConnectionOrRecover(id);
  }

  // --- Cert-mismatch modal actions ---------------------------------------

  function dismissCertMismatch() {
    appStore.dispatch(certMismatchCleared());
  }

  async function openLocalFromCertMismatch() {
    dismissCertMismatch();
    await openConnectionOrRecover(LOCAL_CONNECTION_ID);
  }

  async function forgetMismatchedConnection(id: string) {
    dismissCertMismatch();
    try {
      const action = forgetConnectionRequested(id);
      appStore.dispatch(action);
      await action.promise;
    } catch {
      // no-op; refresh via connections:changed.
    }
  }

  // --- Protocol-mismatch modal actions (advisory, non-blocking) ----------

  /** "Continue anyway" — keep the connection; the menu warning persists. */
  function continueWithProtocolMismatch() {
    appStore.dispatch(protocolMismatchModalDismissed());
  }

  /** Open the local sidecar's window from the advisory modal. */
  async function openLocalFromProtocolMismatch() {
    continueWithProtocolMismatch();
    await openConnectionOrRecover(LOCAL_CONNECTION_ID);
  }
</script>

<DropdownMenu
  align="end"
  side="bottom"
  bind:open={dropdownOpen}
  contentClass="px-0"
  contentMaxHeight="var(--bits-dropdown-menu-content-available-height)"
  portal={true}
>
  {#snippet trigger({ props })}
    <button
      {...props}
      class={cn(
        'flex items-center justify-center h-6 hover:bg-muted/50 rounded transition-colors cursor-pointer',
        currentRemoteName ? 'gap-1.5 px-1.5' : 'w-6',
      )}
      aria-label={triggerAriaLabel}
    >
      {#if currentRemoteName}
        <span class="text-xs text-subtle truncate max-w-32">{currentRemoteName}</span>
      {/if}
      <div class={cn('w-2 h-2 rounded-full shrink-0', dotColorClass)}></div>
    </button>
  {/snippet}

  {#snippet content()}
    <!--
      Intrinsic width: grow to fit the widest stat row (no value wrapping)
      between the 224px floor and a 320px cap. At the cap the Connection
      row's min-w-0 truncate takes over instead of widening the menu.
    -->
    <div class="min-w-56 w-max max-w-80">
      <Menu.Sub>
        <Menu.SubTrigger class="w-full cursor-pointer text-xs px-3 py-1.5">
          {detailsStatusLabel}
        </Menu.SubTrigger>
        <Menu.SubContent side="left" align="start" class="min-w-56 w-max max-w-80 px-0">
          <Header class="px-3 pt-1.5 pb-1" size={6}>{m.layout_daemonStatus_header()}</Header>

          {#if $health$ === 'down'}
            <!-- Down state: show placeholders -->
            <div class="px-3 py-2 space-y-1.5">
              <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
                <span class="text-subtle">{m.layout_daemonStatus_status_label()}</span>
                <span class="text-danger font-medium"
                  >{m.layout_daemonStatus_notRunning_label()}</span
                >
              </div>
              <div class="h-px bg-border my-1"></div>
              <div class="text-xs text-subtle text-center py-2">
                {m.layout_daemonStatus_notConnected_description()}
              </div>
            </div>
          {:else}
            <!-- Healthy/Degraded state: show stats -->
            <div class="px-3 py-2 space-y-1.5">
              <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
                <span class="text-subtle">{m.layout_daemonStatus_status_label()}</span>
                <span
                  class={cn(
                    'font-medium',
                    $health$ === 'healthy' && !workspaceDiskLow
                      ? 'text-green-500'
                      : 'text-yellow-500',
                  )}
                >
                  {$health$ === 'healthy'
                    ? m.layout_daemonStatus_healthyState_label()
                    : m.layout_daemonStatus_degradedState_label()}
                </span>
              </div>

              {#if $stats$}
                <div class="h-px bg-border my-1"></div>

                <!-- Agent slots -->
                <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
                  <span class="text-subtle">{m.layout_daemonStatus_agentSlots_label()}</span>
                  <span class="font-mono">
                    {$stats$.agents}/{$stats$.maxAgents ?? '?'}
                  </span>
                </div>

                <!-- Connected clients -->
                <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
                  <span class="text-subtle">{m.layout_daemonStatus_wssClients_label()}</span>
                  <span class="font-mono">{$stats$.clients}</span>
                </div>

                <!-- Transport -->
                <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
                  <span class="text-subtle shrink-0">{m.layout_daemonStatus_transport_label()}</span
                  >
                  <span class="font-mono text-xs min-w-0 truncate">
                    {$stats$.listenMode}{$stats$.port ? `:${$stats$.port}` : ''}
                  </span>
                </div>

                <!-- Version -->
                {#if $stats$.version}
                  {#if versionMismatchTooltip}
                    <Tooltip side="left" contentClass="z-[10001]" class="w-full">
                      {#snippet content()}
                        <span>{versionMismatchTooltip}</span>
                      {/snippet}
                      <div class="flex justify-between gap-2 text-xs w-full whitespace-nowrap">
                        <span class="text-subtle shrink-0"
                          >{m.layout_daemonStatus_version_label()}</span
                        >
                        <span class="flex items-center gap-1.5 min-w-0">
                          <!--
                        Keyboard focus inside the menu is menu-managed (bits-ui
                        closes on Tab; arrow keys visit only menu items), so the
                        tooltip cannot open from keyboard focus here. Expose the
                        full explanation as the icon's accessible name instead
                        (role="img" so the span's aria-label is reliably mapped).
                      -->
                          <span
                            class="text-yellow-600 dark:text-yellow-500"
                            role="img"
                            aria-label={versionMismatchTooltip}
                          >
                            <Fa icon={faTriangleExclamation} />
                          </span>
                          <span class="font-mono text-xs min-w-0 truncate" title={$stats$.version}
                            >{$stats$.version}</span
                          >
                        </span>
                      </div>
                    </Tooltip>
                  {:else}
                    <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
                      <span class="text-subtle shrink-0"
                        >{m.layout_daemonStatus_version_label()}</span
                      >
                      <span class="font-mono text-xs min-w-0 truncate" title={$stats$.version}
                        >{$stats$.version}</span
                      >
                    </div>
                  {/if}
                {/if}

                <!-- Protocol version -->
                {#if $stats$.protocolVersion !== undefined}
                  <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
                    <span class="text-subtle">{m.layout_daemonStatus_protocol_label()}</span>
                    <span class="font-mono text-xs">{$stats$.protocolVersion}</span>
                  </div>
                {/if}

                <!-- Uptime -->
                {#if liveUptimeSeconds !== undefined}
                  <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
                    <span class="text-subtle">{m.layout_daemonStatus_uptime_label()}</span>
                    <span class="font-mono text-xs" aria-live="off"
                      >{formatUptime(liveUptimeSeconds)}</span
                    >
                  </div>
                {/if}

                <!-- CPU (only when the daemon reports it) -->
                {#if $stats$.cpuPercent !== undefined}
                  <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
                    <span class="text-subtle">{m.layout_daemonStatus_cpu_label()}</span>
                    <span class="font-mono text-xs" aria-live="off"
                      >{formatCpu($stats$.cpuPercent)}</span
                    >
                  </div>
                {/if}

                <!-- Memory (only when the daemon reports it) -->
                {#if $stats$.memoryBytes !== undefined}
                  <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
                    <span class="text-subtle">{m.layout_daemonStatus_memory_label()}</span>
                    <span class="font-mono text-xs" aria-live="off"
                      >{formatMemory($stats$.memoryBytes)}</span
                    >
                  </div>
                {/if}

                <!-- Workspace disk (only when the daemon reports it) -->
                {#if workspaceDiskValue !== null}
                  {#if workspaceDiskLow}
                    <Tooltip side="left" contentClass="z-[10001]" class="w-full">
                      {#snippet content()}
                        <span>{m.layout_daemonStatus_workspaceDiskLow_tooltip()}</span>
                      {/snippet}
                      <div class="flex justify-between gap-2 text-xs w-full whitespace-nowrap">
                        <span class="text-subtle"
                          >{m.layout_daemonStatus_workspaceDisk_label()}</span
                        >
                        <span class="flex items-center gap-1.5">
                          <!--
                        Same pattern as the version-mismatch icon above: menu
                        focus management prevents keyboard-triggered tooltips,
                        so expose the warning as the icon's accessible name.
                      -->
                          <span
                            class="text-warning"
                            role="img"
                            aria-label={m.layout_daemonStatus_workspaceDiskLow_tooltip()}
                          >
                            <Fa icon={faTriangleExclamation} />
                          </span>
                          <span class="font-mono text-xs" aria-live="off">{workspaceDiskValue}</span
                          >
                        </span>
                      </div>
                    </Tooltip>
                  {:else}
                    <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
                      <span class="text-subtle">{m.layout_daemonStatus_workspaceDisk_label()}</span>
                      <span class="font-mono text-xs" aria-live="off">{workspaceDiskValue}</span>
                    </div>
                  {/if}
                {/if}

                <!-- Host OS/Arch -->
                <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
                  <span class="text-subtle shrink-0">{m.layout_daemonStatus_host_label()}</span>
                  <span class="font-mono text-xs min-w-0 truncate">{$stats$.os}/{$stats$.arch}</span
                  >
                </div>

                <!-- FE connection mode -->
                {#if $stats$.transport}
                  {@const transportLabel = formatTransportLabel($stats$.transport)}
                  <div class="flex justify-between gap-2 text-xs">
                    <span class="text-subtle shrink-0"
                      >{m.layout_daemonStatus_connection_label()}</span
                    >
                    <span class="font-mono text-xs min-w-0 truncate" title={transportLabel}
                      >{transportLabel}</span
                    >
                  </div>
                {:else}
                  <div class="flex justify-between gap-2 text-xs">
                    <span class="text-subtle shrink-0"
                      >{m.layout_daemonStatus_connection_label()}</span
                    >
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

              <!-- Managed Unsloth server (only when one is running) -->
              {#if $unslothStatus$?.running}
                <div class="h-px bg-border my-1"></div>

                <Header class="pt-1 pb-0.5" size={6}
                  >{m.layout_daemonStatus_unslothServer_header()}</Header
                >

                <!-- Model (HF repo id, shortened) -->
                {#if $unslothStatus$.repoId}
                  <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
                    <span class="text-subtle">{m.layout_daemonStatus_model_label()}</span>
                    <Tooltip side="left" contentClass="z-[10001]">
                      {#snippet content()}
                        <span>{$unslothStatus$.repoId}</span>
                      {/snippet}
                      <span class="font-mono text-xs truncate max-w-32">{unslothModelLabel}</span>
                    </Tooltip>
                  </div>
                {/if}

                <!-- Phase -->
                {#if $unslothStatus$.phase}
                  <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
                    <span class="text-subtle">{m.layout_daemonStatus_phase_label()}</span>
                    <span
                      class={cn(
                        'font-mono text-xs',
                        $unslothStatus$.phase === 'ready' ? 'text-green-500' : 'text-yellow-500',
                      )}
                    >
                      {$unslothStatus$.phase}
                    </span>
                  </div>
                {/if}

                <!-- Port -->
                {#if $unslothStatus$.port !== undefined}
                  <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
                    <span class="text-subtle">{m.layout_daemonStatus_port_label()}</span>
                    <span class="font-mono text-xs">{$unslothStatus$.port}</span>
                  </div>
                {/if}

                <!-- Uptime -->
                {#if $unslothStatus$.uptimeSecs !== undefined}
                  <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
                    <span class="text-subtle">{m.layout_daemonStatus_uptime_label()}</span>
                    <span class="font-mono text-xs" aria-live="off"
                      >{formatUptime($unslothStatus$.uptimeSecs)}</span
                    >
                  </div>
                {/if}

                <!-- CPU (process tree) -->
                {#if $unslothStatus$.cpuPercent !== undefined}
                  <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
                    <span class="text-subtle">{m.layout_daemonStatus_cpu_label()}</span>
                    <span class="font-mono text-xs" aria-live="off"
                      >{formatCpu($unslothStatus$.cpuPercent)}</span
                    >
                  </div>
                {/if}

                <!-- Memory (process tree) -->
                {#if $unslothStatus$.memoryBytes !== undefined}
                  <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
                    <span class="text-subtle">{m.layout_daemonStatus_memory_label()}</span>
                    <span class="font-mono text-xs" aria-live="off"
                      >{formatMemory($unslothStatus$.memoryBytes)}</span
                    >
                  </div>
                {/if}

                <!-- Attached agents (omitted when the agent manager is not attached) -->
                {#if $unslothStatus$.attachedAgentCount !== undefined}
                  <div class="flex justify-between gap-2 text-xs whitespace-nowrap">
                    <span class="text-subtle">{m.layout_daemonStatus_attachedAgents_label()}</span>
                    <span class="font-mono text-xs">{$unslothStatus$.attachedAgentCount}</span>
                  </div>
                {/if}

                <!-- Stop action -->
                <button
                  class="w-full text-left text-xs text-danger hover:bg-muted/50 rounded px-1 py-1 mt-0.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
                  disabled={$unslothStopping$}
                  onclick={() => {
                    dropdownOpen = false;
                    stopUnslothDialogOpen = true;
                  }}
                >
                  {$unslothStopping$
                    ? m.layout_daemonStatus_stopUnsloth_stopping_label()
                    : m.layout_daemonStatus_stopUnsloth_action_label()}
                </button>
              {/if}
            </div>
          {/if}
        </Menu.SubContent>
      </Menu.Sub>

      <!-- Multi-backend devices list + final Devices CTA -->
      <div class="h-px bg-border my-1"></div>
      <div class="px-1 pb-1">
        {#if $connections$.length > 0}
          <Header class="px-2 pt-1.5 pb-0.5" size={6}
            >{m.layout_daemonStatus_devices_header()}</Header
          >
          {#each $connections$ as conn (conn.id)}
            {@const isCurrent = conn.id === $currentConnectionId$}
            {@const accent = resolveConnectionAccent(conn.accent)}
            <Menu.Item
              class="w-full cursor-pointer text-xs px-2 py-1.5"
              onSelect={() => handleOpenConnection(conn.id)}
            >
              {#if !conn.isLocal && accent !== null}
                <span
                  class={cn('size-2 shrink-0 rounded-full', CONNECTION_ACCENT_CLASSES[accent])}
                  aria-hidden="true"
                  data-connection-accent={accent}
                ></span>
              {/if}
              <span class="min-w-0 flex-1 truncate">
                {conn.isLocal
                  ? m.layout_daemonStatus_localConnection_label()
                  : formatConnectionLabel(conn)}
              </span>
              <span class="flex items-center gap-1.5 shrink-0">
                {#if ($certWarningsById$[conn.id]?.length ?? 0) > 0}
                  {@const certWarningHosts = $certWarningsById$[conn.id]
                    .map((w) => w.host)
                    .join(', ')}
                  <Tooltip side="left" contentClass="z-[10001]">
                    {#snippet content()}
                      <span>{m.layout_daemonStatus_certWarnings_tooltip()}: {certWarningHosts}</span
                      >
                    {/snippet}
                    <!--
                        Passive per-host cert warnings (#1746 follow-up) —
                        informative only, same aria-only pattern as the
                        protocol-mismatch icon below.
                      -->
                    <span
                      class="text-yellow-600 dark:text-yellow-500"
                      role="img"
                      aria-label={`${m.layout_daemonStatus_certWarnings_tooltip()}: ${certWarningHosts}`}
                      data-testid="daemon-status-cert-warnings-icon"
                    >
                      <Fa icon={faTriangleExclamation} />
                    </span>
                  </Tooltip>
                {/if}
                {#if $activeProtocolMismatch$?.id === conn.id}
                  <Tooltip side="left" contentClass="z-[10001]">
                    {#snippet content()}
                      <span>{m.layout_daemonStatus_protocolMismatch_tooltip()}</span>
                    {/snippet}
                    <!--
                        Same aria-only pattern as the Version-row warning icon:
                        the full explanation is the icon's accessible name, and
                        it flows into this menu item's name-from-contents
                        so arrow-key navigation announces it with the row.
                      -->
                    <span
                      class="text-yellow-600 dark:text-yellow-500"
                      role="img"
                      aria-label={m.layout_daemonStatus_protocolMismatch_tooltip()}
                    >
                      <Fa icon={faTriangleExclamation} />
                    </span>
                  </Tooltip>
                {/if}
                {#if isCurrent}
                  <!--
                      role="img" so the span's aria-label reliably maps to an
                      accessible name (same treatment as the warning icons).
                    -->
                  <span
                    class="text-green-500"
                    role="img"
                    aria-label={m.layout_daemonStatus_connectionActive_label()}
                  >
                    <Fa icon={faCheck} />
                  </span>
                {/if}
              </span>
            </Menu.Item>
          {/each}
        {/if}
        <button
          class="w-full text-left text-xs hover:bg-muted/50 rounded px-2 py-1.5 transition-colors cursor-pointer flex items-center gap-2"
          onclick={openDevicesSettings}
        >
          <span class="text-subtle"><Fa icon={faPlus} /></span>
          {hasSavedRemoteConnections
            ? m.layout_daemonStatus_manageDevices_action()
            : m.layout_daemonStatus_connectAnotherDevice_action()}
        </button>
      </div>
    </div>
  {/snippet}
</DropdownMenu>

<!-- BulkActionConfirmDialog owns its canonical body portal. -->
{#if stopUnslothDialogOpen}
  <BulkActionConfirmDialog
    bind:open={stopUnslothDialogOpen}
    title={m.layout_daemonStatus_stopUnsloth_title()}
    description={stopUnslothDescription}
    confirmText={m.layout_daemonStatus_stopUnsloth_confirm_label()}
    variant="destructive"
    onConfirm={confirmStopUnsloth}
  />
{/if}

<!-- Cert-mismatch failure modal — driven by the connections:cert-mismatch push. -->
{#if $certMismatch$}
  <Portal target="body" zIndex={100}>
    <CertMismatchModal
      event={$certMismatch$}
      onOpenLocal={openLocalFromCertMismatch}
      onForget={forgetMismatchedConnection}
      onDismiss={dismissCertMismatch}
    />
  </Portal>
{/if}

<!--
  Protocol-mismatch advisory modal — driven by connections:protocol-mismatch.
  Non-blocking: the connection is already live; a persistent menu warning
  remains after "continue anyway" dismisses this.
-->
{#if $protocolMismatchModal$}
  <Portal target="body" zIndex={100}>
    <ProtocolMismatchModal
      event={$protocolMismatchModal$}
      onOpenLocal={openLocalFromProtocolMismatch}
      onContinue={continueWithProtocolMismatch}
    />
  </Portal>
{/if}
