<script lang="ts">
  /**
   * HudBackendMenu — the HUD footer's INTENTD status zone as a drop-up
   * backend menu (Open-only mirror of the workspace-window daemon status
   * menu): an add-backend entry plus one row per saved backend that opens
   * (or focuses) that backend's workspace windows via CONNECTIONS.OPEN —
   * never changing what the HUD itself is bound to. The HUD's own backend
   * carries the same check/Active affordance as the reference menu.
   *
   * The trigger keeps the footer's original system-zone rendering (pulsing
   * dot + INTENTD + optional remote hostname + ONLINE/OFFLINE from
   * `selectHudSystem`), including its `hud-footer-system` /
   * `hud-footer-hostname` test ids.
   */
  import { m } from '$shared/paraglide/messages.js';
  import Fa from 'svelte-fa';
  import { faPlus, faCheck } from '@fortawesome/free-solid-svg-icons';
  import * as Menu from '$lib/components/ui/menu';
  import Header from '$lib/components/ui/Header.svelte';
  import Portal from '$lib/components/ui/Portal.svelte';
  import ConnectBackendModal from '$lib/components/layout/ConnectBackendModal.svelte';
  import { formatConnectionLabel } from '$lib/components/layout/DaemonStatusIndicator.svelte';
  import {
    selectConnections,
    selectCurrentConnectionId,
  } from '$store/renderer/slices/connections/connections-selectors';
  import { openConnectionRequested } from '$store/renderer/slices/connections/connections-slice';
  import { store as appStore } from '$store/renderer/store';
  import { selectHudSystem } from '$store/renderer/slices/hud/hud-selectors';

  const system$ = selectHudSystem();
  const connections$ = selectConnections();
  const currentConnectionId$ = selectCurrentConnectionId();

  const online = $derived($system$.online);
  const remoteHostname = $derived($system$.remoteHostname);

  let menuOpen = $state(false);
  let connectModalOpen = $state(false);
  // Inline failure line shown in the menu when an open resolves with
  // `secret-unavailable` (#3783). The HUD window has no Toaster and no
  // /settings route, so the menu itself carries the message; it clears on the
  // next open attempt.
  let openError = $state<string | null>(null);

  function openConnectModal() {
    menuOpen = false;
    connectModalOpen = true;
  }

  function connectionDisplayLabel(id: string): string {
    const conn = $connections$.find((c) => c.id === id);
    if (!conn || conn.isLocal) return m.layout_daemonStatus_localConnection_label();
    return formatConnectionLabel(conn);
  }

  async function handleOpenConnection(id: string) {
    menuOpen = false;
    openError = null;
    try {
      const action = openConnectionRequested(id);
      appStore.dispatch(action);
      const result = await action.promise;
      if (result.status === 'secret-unavailable') {
        openError = m.hud_backendMenu_secretUnavailable_error({
          label: connectionDisplayLabel(id),
        });
        menuOpen = true;
      }
    } catch {
      // Other failures are surfaced via the slice's op-status/error; nothing
      // more to do here (the list/active refresh arrives via connections:changed).
    }
  }
</script>

<div class="hud-backend-menu">
  <Menu.Root bind:open={menuOpen}>
    <Menu.Trigger class="hud-footer-system" data-testid="hud-footer-system">
      <span class="hud-footer-dot" class:hud-footer-dot-online={online}></span>
      <!-- i18n-ignore (brand/daemon name) -->
      <span class="hud-footer-system-key">INTENTD</span>
      {#if remoteHostname !== null}
        <!-- i18n-ignore (daemon-reported hostname is data, not copy) -->
        <span class="hud-footer-system-key" data-testid="hud-footer-hostname"
          >({remoteHostname})</span
        >
      {/if}
      {#if online}
        <span class="hud-footer-online">{m.hud_system_online_label()}</span>
      {:else}
        <span class="hud-footer-offline">{m.hud_system_offline_label()}</span>
      {/if}
    </Menu.Trigger>
    <Menu.Content
      side="top"
      align="start"
      collisionPadding={8}
      preventScroll={false}
      aria-label={m.ui_dropdownMenu_ariaLabel()}
    >
      <div class="min-w-52 w-max max-w-72 font-mono">
        <Menu.Item class="cursor-pointer text-xs" onSelect={openConnectModal}>
          <span class="text-subtle"><Fa icon={faPlus} /></span>
          {m.layout_daemonStatus_connectToAnother_action()}
        </Menu.Item>

        {#if $connections$.length > 0}
          <Header class="px-2 pt-1.5 pb-0.5" size={6}
            >{m.layout_daemonStatus_connections_header()}</Header
          >
          {#each $connections$ as conn (conn.id)}
            {@const isCurrent = conn.id === $currentConnectionId$}
            <!-- Open-only: selecting the row opens that backend's windows. -->
            <Menu.Item
              class="cursor-pointer text-xs"
              onSelect={() => handleOpenConnection(conn.id)}
            >
              <span class="min-w-0 flex-1 truncate">
                {conn.isLocal
                  ? m.layout_daemonStatus_localConnection_label()
                  : formatConnectionLabel(conn)}
              </span>
              {#if isCurrent}
                <!--
                  role="img" so the span's aria-label reliably maps to an
                  accessible name (same treatment as the reference menu).
                -->
                <span
                  class="text-green-500 shrink-0"
                  role="img"
                  aria-label={m.layout_daemonStatus_connectionActive_label()}
                >
                  <Fa icon={faCheck} />
                </span>
              {/if}
            </Menu.Item>
          {/each}
        {/if}
        {#if openError}
          <p
            class="px-2 pt-1.5 pb-1 text-xs text-danger"
            role="alert"
            data-testid="hud-backend-menu-open-error"
          >
            {openError}
          </p>
        {/if}
      </div>
    </Menu.Content>
  </Menu.Root>
</div>

<!-- Add-connection modal (portaled to body, same rationale as the reference menu). -->
{#if connectModalOpen}
  <Portal target="body" zIndex={100}>
    <ConnectBackendModal bind:open={connectModalOpen} />
  </Portal>
{/if}

<style>
  .hud-backend-menu {
    display: inline-block;
  }
  /* The system zone, restyled as a button: inherits the footer's JetBrains
     Mono font and keeps the original layout, with a hover/focus affordance
     for the menu trigger. :global because the button element is rendered by
     the Menu.Trigger primitive, not this component's template. */
  .hud-backend-menu :global(.hud-footer-system) {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    /* Cancel the left padding so the dot keeps the footer's original
       left-edge alignment despite the button's hover-affordance padding. */
    margin: 0 0 0 -8px;
    padding: 3px 8px;
    border: none;
    border-radius: 4px;
    background: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .hud-backend-menu :global(.hud-footer-system:hover) {
    background: hsl(var(--muted) / 0.5);
  }
  .hud-footer-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: hsl(var(--danger));
  }
  .hud-footer-dot-online {
    background: hsl(var(--primary));
    animation: hudpulse 2.2s ease-in-out infinite;
  }
  .hud-footer-system-key {
    color: hsl(var(--muted-foreground));
    letter-spacing: 0.12em;
  }
  .hud-footer-online {
    color: hsl(var(--primary));
  }
  .hud-footer-offline {
    color: hsl(var(--danger));
    animation: hudblink 1.6s step-end infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .hud-footer-dot-online,
    .hud-footer-offline {
      animation: none;
    }
  }
</style>
