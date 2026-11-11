<script lang="ts">
  /**
   * ConnectionRail — Slack-style switcher down the window's left edge: one
   * tile per backend connection plus an add button. Selecting a tile rebinds
   * this window to that backend in place (CONNECTIONS.OPEN with
   * `switchSenderWindow`); in a browser tab, the tab reloads on that backend.
   */
  import { onDestroy } from 'svelte';
  import Fa from 'svelte-fa';
  import { faPlus } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { cn } from '$lib/utils';
  import { Button } from '$lib/components/ui/button';
  import DeviceIcon from '$lib/components/DeviceIcon.svelte';
  import Portal from '$lib/components/ui/Portal.svelte';
  import ConnectBackendModal from '$lib/components/layout/ConnectBackendModal.svelte';
  import { formatConnectionLabel } from '$lib/utils/connection-label';
  import {
    CONNECTION_ACCENT_CLASSES,
    resolveConnectionAccent,
  } from '$lib/utils/connection-accents';
  import {
    selectBackendConnections,
    selectCurrentConnectionId,
  } from '$store/renderer/slices/connections/connections-selectors';
  import {
    connectionWorkflowCleared,
    connectionWorkflowRequested,
  } from '$store/renderer/slices/connections/connections-slice';
  import { store as appStore } from '$store/renderer/store';

  const consumerId = $props.id();
  onDestroy(() => appStore.dispatch(connectionWorkflowCleared(consumerId)));

  const connections$ = selectBackendConnections();
  const currentConnectionId$ = selectCurrentConnectionId();

  let connectModalOpen = $state(false);

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

<nav
  class="mr-2 flex w-9 shrink-0 flex-col items-center gap-1.5"
  aria-label={m.layout_daemonStatus_connections_header()}
  data-testid="connection-rail"
>
  <div class="connection-rail-list flex min-h-0 flex-col items-center gap-1.5 overflow-y-auto">
    {#each $connections$ as conn (conn.id)}
      {@const isCurrent = conn.id === $currentConnectionId$}
      {@const accent = conn.isLocal ? null : resolveConnectionAccent(conn.accent)}
      {@const label = conn.isLocal
        ? m.layout_daemonStatus_localConnection_label()
        : formatConnectionLabel(conn)}
      <Button
        variant="ghost-light"
        size="icon-lg"
        iconOnly
        tooltip={label}
        tooltipSide="right"
        active={isCurrent}
        wrapContent={false}
        aria-current={isCurrent ? 'page' : undefined}
        class={cn('rounded-lg', isCurrent && 'text-foreground')}
        data-testid="connection-rail-item"
        data-connection-id={conn.id}
        onclick={() => switchTo(conn.id)}
      >
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
      </Button>
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
