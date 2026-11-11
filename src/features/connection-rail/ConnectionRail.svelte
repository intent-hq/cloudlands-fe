<script lang="ts">
  /**
   * ConnectionRail — Slack-style switcher down the window's left edge: one
   * tile per backend connection (then joined guest sessions) plus an add
   * button. Selecting a tile shows that backend in this window
   * (CONNECTIONS.OPEN with `switchSenderWindow`); in a browser tab, the tab
   * reloads on that backend. Hovering a tile shows its status; the active
   * tile opens the daemon status menu.
   */
  import { onDestroy, type Snippet } from 'svelte';
  import Fa from 'svelte-fa';
  import { faPlus, faUsers } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { cn } from '$lib/utils';
  import { Button } from '$lib/components/ui/button';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import DeviceIcon from '$lib/components/DeviceIcon.svelte';
  import Portal from '$lib/components/ui/Portal.svelte';
  import ConnectBackendModal from '$lib/components/layout/ConnectBackendModal.svelte';
  import DaemonStatusIndicator, {
    formatCpu,
    formatMemory,
  } from '$lib/components/layout/DaemonStatusIndicator.svelte';
  import { formatConnectionLabel, formatGuestSessionLabel } from '$lib/utils/connection-label';
  import {
    CONNECTION_ACCENT_CLASSES,
    resolveConnectionAccent,
  } from '$lib/utils/connection-accents';
  import type { ConnectionOpenStatus } from '$shared/types/connections';
  import {
    selectActiveProtocolMismatch,
    selectBackendConnections,
    selectCertWarningsByConnectionId,
    selectCurrentConnectionId,
  } from '$store/renderer/slices/connections/connections-selectors';
  import {
    connectionWorkflowCleared,
    connectionWorkflowRequested,
  } from '$store/renderer/slices/connections/connections-slice';
  import {
    selectGuestSessions,
    selectGuestSessionsConnectedIds,
    selectGuestSessionsOpenIds,
  } from '$store/renderer/slices/guest-sessions/guest-sessions-selectors';
  import {
    selectDaemonHealth,
    selectDaemonHealthStats,
  } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import { store as appStore } from '$store/renderer/store';

  const consumerId = $props.id();
  onDestroy(() => appStore.dispatch(connectionWorkflowCleared(consumerId)));

  const connections$ = selectBackendConnections();
  const currentConnectionId$ = selectCurrentConnectionId();
  const guestSessions$ = selectGuestSessions();
  const guestOpenIds$ = selectGuestSessionsOpenIds();
  const guestConnectedIds$ = selectGuestSessionsConnectedIds();
  const certWarningsById$ = selectCertWarningsByConnectionId();
  const activeProtocolMismatch$ = selectActiveProtocolMismatch();
  const health$ = selectDaemonHealth();
  const stats$ = selectDaemonHealthStats();

  let connectModalOpen = $state(false);

  type Tone = 'good' | 'warn' | 'bad' | 'idle';
  interface Status {
    tone: Tone;
    text: string;
  }
  const TONE_CLASSES: Record<Tone, string> = {
    good: 'bg-success',
    warn: 'bg-warning',
    bad: 'bg-danger',
    idle: 'bg-muted-foreground',
  };

  // The active connection reports live daemon health; others report the
  // pooled client's connection state.
  const currentStatus = $derived<Status>(
    $health$ === 'healthy'
      ? { tone: 'good', text: m.layout_daemonStatus_healthyState_label() }
      : $health$ === 'degraded'
        ? { tone: 'warn', text: m.layout_daemonStatus_degradedState_label() }
        : { tone: 'bad', text: m.layout_daemonStatus_notRunning_label() },
  );

  function connectionStatus(status: ConnectionOpenStatus | undefined): Status {
    if (status === 'connected') {
      return { tone: 'good', text: m.layout_connectionRail_status_connected() };
    }
    if (status === 'connecting') {
      return { tone: 'warn', text: m.layout_connectionRail_status_connecting() };
    }
    if (status === 'disconnected') {
      return { tone: 'bad', text: m.layout_connectionRail_status_disconnected() };
    }
    return { tone: 'idle', text: m.layout_connectionRail_status_notOpen() };
  }

  function guestStatus(id: string): Status {
    if (!$guestOpenIds$.includes(id)) return connectionStatus('not-open');
    return connectionStatus($guestConnectedIds$.includes(id) ? 'connected' : 'disconnected');
  }

  function switchTo(id: string) {
    if (id === $currentConnectionId$) return;
    appStore.dispatch(
      connectionWorkflowRequested(consumerId, {
        kind: 'open',
        id,
        recovery: 'settings',
        switchSenderWindow: true,
      }),
    );
  }
</script>

{#snippet statusCard(id: string, label: string, status: Status, isCurrent: boolean)}
  <div class="flex max-w-64 flex-col gap-1 text-left" data-testid="connection-rail-status">
    <span class="truncate font-medium text-foreground">{label}</span>
    <span class="flex items-center gap-1.5">
      <span class={cn('size-1.5 shrink-0 rounded-full', TONE_CLASSES[status.tone])}></span>
      {status.text}
    </span>
    {#if ($certWarningsById$[id]?.length ?? 0) > 0}
      <span class="text-warning-ink">{m.layout_daemonStatus_certWarnings_tooltip()}</span>
    {/if}
    {#if isCurrent && $activeProtocolMismatch$}
      <span class="text-warning-ink">{m.layout_daemonStatus_protocolMismatch_tooltip()}</span>
    {/if}
    {#if isCurrent && $health$ !== 'down' && $stats$}
      <span class="flex flex-wrap gap-x-2 text-subtle">
        {#if $stats$.cpuPercent !== undefined}
          <span>{m.layout_daemonStatus_cpu_label()} {formatCpu($stats$.cpuPercent)}</span>
        {/if}
        {#if $stats$.memoryBytes !== undefined}
          <span>{m.layout_daemonStatus_memory_label()} {formatMemory($stats$.memoryBytes)}</span>
        {/if}
        {#if $stats$.agents !== undefined}
          <span>
            {m.layout_daemonStatus_agentSlots_label()}
            {$stats$.agents}/{$stats$.maxAgents ?? '?'}
          </span>
        {/if}
      </span>
    {/if}
  </div>
{/snippet}

{#snippet tile(
  id: string,
  label: string,
  isCurrent: boolean,
  icon: Snippet,
  props: Record<string, unknown> = {},
)}
  <Button
    {...props}
    variant="ghost-light"
    size="icon-lg"
    iconOnly
    aria-label={label}
    active={isCurrent}
    wrapContent={false}
    aria-current={isCurrent ? 'page' : undefined}
    class={cn('rounded-lg', isCurrent && 'text-foreground')}
    data-testid="connection-rail-item"
    data-connection-id={id}
    onclick={isCurrent ? undefined : () => switchTo(id)}
  >
    {@render icon()}
  </Button>
{/snippet}

{#snippet railEntry(id: string, label: string, status: Status, icon: Snippet)}
  {@const isCurrent = id === $currentConnectionId$}
  {#snippet card()}
    {@render statusCard(id, label, isCurrent ? currentStatus : status, isCurrent)}
  {/snippet}
  <Tooltip side="right" content={card}>
    {#if isCurrent}
      <DaemonStatusIndicator side="right" align="start">
        {#snippet trigger({ props })}
          {@render tile(id, label, true, icon, props)}
        {/snippet}
      </DaemonStatusIndicator>
    {:else}
      {@render tile(id, label, false, icon)}
    {/if}
  </Tooltip>
{/snippet}

<nav
  class="mr-2 flex w-9 shrink-0 flex-col items-center gap-1.5"
  aria-label={m.layout_daemonStatus_connections_header()}
  data-testid="connection-rail"
>
  <div class="connection-rail-list flex min-h-0 flex-col items-center gap-1.5 overflow-y-auto">
    {#each $connections$ as conn (conn.id)}
      {@const accent = conn.isLocal ? null : resolveConnectionAccent(conn.accent)}
      {#snippet icon()}
        <DeviceIcon record={conn} size={18} />
        {#if accent !== null}
          <span
            class={cn(
              'absolute right-1 bottom-1 size-1.5 rounded-full',
              CONNECTION_ACCENT_CLASSES[accent],
            )}
            aria-hidden="true"
            data-connection-accent={accent}
          ></span>
        {/if}
      {/snippet}
      {@render railEntry(
        conn.id,
        conn.isLocal ? m.layout_daemonStatus_localConnection_label() : formatConnectionLabel(conn),
        connectionStatus(conn.status),
        icon,
      )}
    {/each}
    {#each $guestSessions$ as session (session.id)}
      {#snippet icon()}
        <Fa icon={faUsers} />
      {/snippet}
      {@render railEntry(
        session.id,
        formatGuestSessionLabel(session),
        guestStatus(session.id),
        icon,
      )}
    {/each}
  </div>
  <Button
    variant="ghost-light"
    size="icon-lg"
    iconOnly
    tooltip={m.layout_connectionRail_add_tooltip()}
    tooltipSide="right"
    class="rounded-lg"
    data-testid="connection-rail-add"
    onclick={() => (connectModalOpen = true)}
  >
    <Fa icon={faPlus} />
  </Button>
</nav>

{#if connectModalOpen}
  <Portal target="body" zIndex={100}>
    <ConnectBackendModal bind:open={connectModalOpen} switchSenderWindow />
  </Portal>
{/if}

<style>
  .connection-rail-list {
    scrollbar-width: none;
  }
</style>
