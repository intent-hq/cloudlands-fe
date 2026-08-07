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

  /**
   * Display label for a remote connection (T14): prefer the captured hostname,
   * rendered as `hostname (host:port)` so the address stays visible for
   * reconnection, and fall back to the record's raw `label` (`host:port`) when
   * the hostname is unavailable/empty. The local entry is labeled elsewhere.
   */
  export function formatConnectionLabel(conn: {
    hostname?: string | null;
    host: string | null;
    port: number | null;
    label: string;
  }): string {
    const hostname = conn.hostname?.trim();
    if (hostname && conn.host && conn.port != null) {
      return `${hostname} (${conn.host}:${conn.port})`;
    }
    return conn.label;
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
  import Fa from 'svelte-fa';
  import { faPlus, faCheck, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import Header from '$lib/components/ui/Header.svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import BulkActionConfirmDialog from '$lib/components/modals/BulkActionConfirmDialog.svelte';
  import Portal from '$lib/components/ui/Portal.svelte';
  import ConnectBackendModal from './ConnectBackendModal.svelte';
  import CertMismatchModal from './CertMismatchModal.svelte';
  import ProtocolMismatchModal from './ProtocolMismatchModal.svelte';
  import {
    selectDaemonHealth,
    selectDaemonHealthStats,
    selectDaemonHealthLastUpdated,
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
    selectActiveConnectionId,
    selectConnectionCertMismatch,
    selectActiveProtocolMismatch,
    selectProtocolMismatchModal,
  } from '$store/renderer/slices/connections/connections-selectors';
  import {
    certMismatchCleared,
    protocolMismatchModalDismissed,
  } from '$store/renderer/slices/connections/connections-slice';
  import {
    switchConnection,
    forgetConnection,
  } from '$store/renderer/middlewares/connections-service';
  import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
  import { store as appStore } from '$store/renderer/store';
  import type { DaemonHealth } from '$store/renderer/slices/daemon-health/daemon-health-types';

  const health$ = selectDaemonHealth();
  const stats$ = selectDaemonHealthStats();
  const lastUpdated$ = selectDaemonHealthLastUpdated();
  const unslothStatus$ = selectUnslothStatus();
  const unslothStopping$ = selectUnslothStopping();
  const connections$ = selectConnections();
  const activeConnectionId$ = selectActiveConnectionId();
  const certMismatch$ = selectConnectionCertMismatch();
  const activeProtocolMismatch$ = selectActiveProtocolMismatch();
  const protocolMismatchModal$ = selectProtocolMismatchModal();

  let dropdownOpen = $state(false);
  let liveUptimeSeconds = $state<number | undefined>(undefined);
  let stopUnslothDialogOpen = $state(false);
  let connectModalOpen = $state(false);

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

  function openConnectModal() {
    dropdownOpen = false;
    connectModalOpen = true;
  }

  async function handleSwitchConnection(id: string) {
    dropdownOpen = false;
    try {
      await switchConnection(id);
    } catch {
      // The failure is surfaced via the slice's op-status/error; nothing more
      // to do here (the list/active refresh arrives via connections:changed).
    }
  }

  async function handleForgetConnection(id: string) {
    try {
      await forgetConnection(id);
    } catch {
      // Refresh + any error surface via the connections service; no-op here.
    }
  }

  // --- Cert-mismatch modal actions ---------------------------------------

  function dismissCertMismatch() {
    appStore.dispatch(certMismatchCleared());
  }

  async function switchBackToLocal() {
    dismissCertMismatch();
    try {
      await switchConnection(LOCAL_CONNECTION_ID);
    } catch {
      // no-op; op-status/error surface via the slice.
    }
  }

  async function forgetMismatchedConnection(id: string) {
    dismissCertMismatch();
    try {
      await forgetConnection(id);
    } catch {
      // no-op; refresh via connections:changed.
    }
  }

  // --- Protocol-mismatch modal actions (advisory, non-blocking) ----------

  /** "Continue anyway" — keep the connection; the menu warning persists. */
  function continueWithProtocolMismatch() {
    appStore.dispatch(protocolMismatchModalDismissed());
  }

  /** Switch back to the local sidecar from the advisory modal. */
  async function switchBackFromProtocolMismatch() {
    continueWithProtocolMismatch();
    try {
      await switchConnection(LOCAL_CONNECTION_ID);
    } catch {
      // no-op; op-status/error surface via the slice.
    }
  }
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
            <span
              class={cn(
                'font-medium',
                $health$ === 'healthy' ? 'text-green-500' : 'text-yellow-500',
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
                <span class="font-mono text-xs" aria-live="off"
                  >{formatUptime(liveUptimeSeconds)}</span
                >
              </div>
            {/if}

            <!-- CPU (only when the daemon reports it) -->
            {#if $stats$.cpuPercent !== undefined}
              <div class="flex justify-between text-xs">
                <span class="text-subtle">{m.layout_daemonStatus_cpu_label()}</span>
                <span class="font-mono text-xs" aria-live="off"
                  >{formatCpu($stats$.cpuPercent)}</span
                >
              </div>
            {/if}

            <!-- Memory (only when the daemon reports it) -->
            {#if $stats$.memoryBytes !== undefined}
              <div class="flex justify-between text-xs">
                <span class="text-subtle">{m.layout_daemonStatus_memory_label()}</span>
                <span class="font-mono text-xs" aria-live="off"
                  >{formatMemory($stats$.memoryBytes)}</span
                >
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

          <!-- Managed Unsloth server (only when one is running) -->
          {#if $unslothStatus$?.running}
            <div class="h-px bg-border my-1"></div>

            <Header class="pt-1 pb-0.5" size={6}
              >{m.layout_daemonStatus_unslothServer_header()}</Header
            >

            <!-- Model (HF repo id, shortened) -->
            {#if $unslothStatus$.repoId}
              <div class="flex justify-between text-xs">
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
              <div class="flex justify-between text-xs">
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
              <div class="flex justify-between text-xs">
                <span class="text-subtle">{m.layout_daemonStatus_port_label()}</span>
                <span class="font-mono text-xs">{$unslothStatus$.port}</span>
              </div>
            {/if}

            <!-- Uptime -->
            {#if $unslothStatus$.uptimeSecs !== undefined}
              <div class="flex justify-between text-xs">
                <span class="text-subtle">{m.layout_daemonStatus_uptime_label()}</span>
                <span class="font-mono text-xs" aria-live="off"
                  >{formatUptime($unslothStatus$.uptimeSecs)}</span
                >
              </div>
            {/if}

            <!-- CPU (process tree) -->
            {#if $unslothStatus$.cpuPercent !== undefined}
              <div class="flex justify-between text-xs">
                <span class="text-subtle">{m.layout_daemonStatus_cpu_label()}</span>
                <span class="font-mono text-xs" aria-live="off"
                  >{formatCpu($unslothStatus$.cpuPercent)}</span
                >
              </div>
            {/if}

            <!-- Memory (process tree) -->
            {#if $unslothStatus$.memoryBytes !== undefined}
              <div class="flex justify-between text-xs">
                <span class="text-subtle">{m.layout_daemonStatus_memory_label()}</span>
                <span class="font-mono text-xs" aria-live="off"
                  >{formatMemory($unslothStatus$.memoryBytes)}</span
                >
              </div>
            {/if}

            <!-- Attached agents (omitted when the agent manager is not attached) -->
            {#if $unslothStatus$.attachedAgentCount !== undefined}
              <div class="flex justify-between text-xs">
                <span class="text-subtle">{m.layout_daemonStatus_attachedAgents_label()}</span>
                <span class="font-mono text-xs">{$unslothStatus$.attachedAgentCount}</span>
              </div>
            {/if}

            <!-- Stop action -->
            <button
              class="w-full text-left text-xs text-red-500 hover:bg-muted/50 rounded px-1 py-1 mt-0.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
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

      <!-- Multi-backend connect: add action + connections list (Switch/Forget) -->
      <div class="h-px bg-border my-1"></div>
      <div class="px-1 pb-1">
        <button
          class="w-full text-left text-xs hover:bg-muted/50 rounded px-2 py-1.5 transition-colors cursor-pointer flex items-center gap-2"
          onclick={openConnectModal}
        >
          <span class="text-subtle"><Fa icon={faPlus} /></span>
          {m.layout_daemonStatus_connectToAnother_action()}
        </button>

        {#if $connections$.length > 0}
          <Header class="px-2 pt-1.5 pb-0.5" size={6}
            >{m.layout_daemonStatus_connections_header()}</Header
          >
          {#each $connections$ as conn (conn.id)}
            {@const isActive = conn.id === $activeConnectionId$}
            <!--
              Each connection is its own nested dropdown so Switch/Forget pop out
              as a side flyout (to the left, since this menu sits at the top-right
              of the title bar) instead of indenting inline. portal={false} keeps
              the flyout inside this menu's DOM subtree, so a click inside it does
              not register as "outside" the parent menu and close it.
            -->
            <DropdownMenu
              side="left"
              align="start"
              portal={false}
              class="block w-full"
              contentClass="min-w-28"
            >
              {#snippet trigger({ toggle, open }: { toggle: () => void; open: boolean })}
                <button
                  class="w-full text-left text-xs hover:bg-muted/50 rounded px-2 py-1.5 transition-colors cursor-pointer flex items-center justify-between gap-2"
                  aria-haspopup="menu"
                  aria-expanded={open}
                  onclick={toggle}
                >
                  <span class="truncate">
                    {conn.isLocal
                      ? m.layout_daemonStatus_localConnection_label()
                      : formatConnectionLabel(conn)}
                  </span>
                  <span class="flex items-center gap-1.5 shrink-0">
                    {#if $activeProtocolMismatch$?.id === conn.id}
                      <Tooltip side="left" contentClass="z-[10001]">
                        {#snippet content()}
                          <span>{m.layout_daemonStatus_protocolMismatch_tooltip()}</span>
                        {/snippet}
                        <span
                          class="text-yellow-600 dark:text-yellow-500"
                          aria-label={m.layout_daemonStatus_protocolMismatch_ariaLabel()}
                        >
                          <Fa icon={faTriangleExclamation} />
                        </span>
                      </Tooltip>
                    {/if}
                    {#if isActive}
                      <span
                        class="text-green-500"
                        aria-label={m.layout_daemonStatus_connectionActive_label()}
                      >
                        <Fa icon={faCheck} />
                      </span>
                    {/if}
                  </span>
                </button>
              {/snippet}

              {#snippet content({ close }: { close: () => void })}
                <button
                  class="w-full text-left text-xs hover:bg-muted/50 rounded px-2 py-1 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
                  disabled={isActive}
                  onclick={() => {
                    close();
                    handleSwitchConnection(conn.id);
                  }}
                >
                  {m.layout_daemonStatus_switch_action()}
                </button>
                {#if !conn.isLocal}
                  <button
                    class="w-full text-left text-xs text-red-500 hover:bg-muted/50 rounded px-2 py-1 transition-colors cursor-pointer"
                    onclick={() => {
                      close();
                      handleForgetConnection(conn.id);
                    }}
                  >
                    {m.layout_daemonStatus_forget_action()}
                  </button>
                {/if}
              {/snippet}
            </DropdownMenu>
          {/each}
        {/if}
      </div>
    </div>
  {/snippet}
</DropdownMenu>

<!--
  Portaled to the document body (same pattern as EditRegenerateConfirmDialog)
  so the fixed-position overlay escapes the title-bar region's containing
  block — rendered inline it gets clipped inside the title bar.
-->
{#if stopUnslothDialogOpen}
  <Portal target="body" zIndex={100}>
    <BulkActionConfirmDialog
      bind:open={stopUnslothDialogOpen}
      title={m.layout_daemonStatus_stopUnsloth_title()}
      description={stopUnslothDescription}
      confirmText={m.layout_daemonStatus_stopUnsloth_confirm_label()}
      variant="destructive"
      onConfirm={confirmStopUnsloth}
    />
  </Portal>
{/if}

<!-- Add-connection modal (portaled to body, same rationale as the stop dialog). -->
{#if connectModalOpen}
  <Portal target="body" zIndex={100}>
    <ConnectBackendModal bind:open={connectModalOpen} />
  </Portal>
{/if}

<!-- Cert-mismatch failure modal — driven by the connections:cert-mismatch push. -->
{#if $certMismatch$}
  <Portal target="body" zIndex={100}>
    <CertMismatchModal
      event={$certMismatch$}
      onSwitchBack={switchBackToLocal}
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
      onSwitchBack={switchBackFromProtocolMismatch}
      onContinue={continueWithProtocolMismatch}
    />
  </Portal>
{/if}
