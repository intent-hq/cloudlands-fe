<script lang="ts">
  /**
   * MachineRail (Labs) — the strip at the window's left edge that lists the
   * machines this window stays connected to and switches between them.
   *
   * Every machine has its own renderer in the window and each renders this
   * rail from the same main-owned state, so the strip looks continuous while
   * the page beside it changes. Selecting, adding and removing are requests to
   * main; nothing is decided here.
   *
   * Items are the plain ghost icon button; the selected machine uses its
   * active state and a bar in the machine's accent colour; a machine that is
   * not connected is dimmed, and one whose daemon is degraded has a warning dot. A machine that is still starting after a click
   * spins in place until it is shown: once connected, or once its connection
   * fails, so its usual cannot-connect dialog shows. The add
   * button follows the last machine. Hosts joined as a guest come after the
   * user's own machines, below a separator.
   *
   * A context click opens the machine's menu where it is, without switching:
   * its status, removal from the rail and machine settings. The shown
   * machine's status comes from its own renderer, with full health details.
   *
   * The window's own renderer, under every other machine's, also paints the
   * shell backdrop with the shown machine's tint, so the tint cross-fades.
   */
  import { faPlus, faUsers } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import DeviceIcon from '$lib/components/DeviceIcon.svelte';
  import DaemonStatusIndicator from '$lib/components/layout/DaemonStatusIndicator.svelte';
  import ConnectBackendModal from '$lib/components/layout/ConnectBackendModal.svelte';
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import Header from '$lib/components/ui/Header.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import { cn } from '$lib/utils';
  import {
    CONNECTION_ACCENT_CLASSES,
    connectionShellTintColor,
    resolveConnectionAccent,
  } from '$lib/utils/connection-accents';
  import {
    formatConnectionLabel,
    formatGuestSessionLabel,
    formatLocalMachineLabel,
  } from '$lib/utils/connection-label';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import { m } from '$shared/paraglide/messages.js';
  import type { ConnectionRecord } from '$shared/types/connections';
  import type { GuestSessionRecord } from '$shared/types/guest-sessions';
  import {
    selectIsRailHomeRenderer,
    selectMachineRailCandidates,
    selectMachineRailEnabled,
    selectMachineRailGuestCandidates,
    selectMachineRailItems,
    selectRailSelectedRecord,
    type MachineRailItem,
    type MachineRailItemStatus,
  } from '$store/renderer/slices/machine-rail/machine-rail-selectors';
  import {
    addRailMachineRequested,
    removeRailMachineRequested,
    selectRailMachineRequested,
  } from '$store/renderer/slices/machine-rail/machine-rail-slice';
  import { selectShellTransparencyEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { store as appStore } from '$store/renderer/store';

  const enabled$ = selectMachineRailEnabled();
  const items$ = selectMachineRailItems();
  const candidates$ = selectMachineRailCandidates();
  const guestCandidates$ = selectMachineRailGuestCandidates();
  const isHomeRenderer$ = selectIsRailHomeRenderer();
  const selectedRecord$ = selectRailSelectedRecord();
  const shellTransparencyEnabled$ = selectShellTransparencyEnabled();

  const shellTint = $derived(
    connectionShellTintColor($selectedRecord$?.accent, $selectedRecord$?.isLocal ?? true),
  );

  // The backdrop must be a direct child of <body>: the window's own renderer
  // hides everything else there while another machine is on screen.
  function moveToBody(node: HTMLElement) {
    document.body.prepend(node);
    return { destroy: () => node.remove() };
  }

  // A machine's name shows after a short pause, then at once on the next item
  // (the tooltip provider skips the delay), so a pointer can slide down the rail.
  // The add button's tooltip waits for a deliberate pause.
  const MACHINE_TOOLTIP_DELAY_MS = 300;
  const RAIL_TOOLTIP_DELAY_MS = 900;

  // Rail buttons show keyboard focus as the hover background, not the app-wide
  // focus outline (the Button paints its states on its surface element).
  const RAIL_BUTTON_FOCUS_CLASS =
    'focus-visible:outline-none [&:focus-visible>[data-slot=button-surface]]:bg-hover';

  let menuOpen = $state(false);
  let connectModalOpen = $state(false);
  // The shown machine's status menu, rendered by DaemonStatusIndicator.
  let statusMenuOpen = $state(false);
  // Another machine's menu, anchored at its rail item.
  let itemMenu = $state<{ id: string; anchor: HTMLElement } | null>(null);
  let itemMenuOpen = $state(false);

  const ownItems = $derived($items$.filter((item) => !item.guest));
  const guestItems = $derived($items$.filter((item) => item.guest));
  const itemMenuItem = $derived($items$.find((item) => item.id === itemMenu?.id) ?? null);

  function openItemMenu(event: MouseEvent, item: MachineRailItem) {
    event.preventDefault();
    if (item.own) {
      statusMenuOpen = true;
      return;
    }
    itemMenu = { id: item.id, anchor: event.currentTarget as HTMLElement };
    itemMenuOpen = true;
  }

  function removeFromRail(id: string) {
    statusMenuOpen = false;
    itemMenuOpen = false;
    appStore.dispatch(removeRailMachineRequested(id));
  }

  function manageMachines(guest: boolean) {
    statusMenuOpen = false;
    itemMenuOpen = false;
    void navigateToSettings({ tab: guest ? 'collaboration' : 'devices' });
  }

  const STATUS_LABELS: Record<MachineRailItemStatus, () => string> = {
    connected: () => m.settings_devices_statusConnected_label(),
    connecting: () => m.settings_devices_statusConnecting_label(),
    disconnected: () => m.settings_devices_statusDisconnected_label(),
  };

  function machineName(record: ConnectionRecord | null, id: string): string {
    if (!record) return id;
    return record.isLocal ? formatLocalMachineLabel(record) : formatConnectionLabel(record);
  }

  function itemName(item: MachineRailItem): string {
    return item.guest ? formatGuestSessionLabel(item.guest) : machineName(item.record, item.id);
  }

  function itemLabel(item: MachineRailItem): string {
    const name = itemName(item);
    return item.offline ? m.machineRail_item_offline_label({ name }) : name;
  }
</script>

<!-- A machine's menu actions, shared by the shown machine's status menu and the others' menu. -->
{#snippet railMenuActions(item: MachineRailItem)}
  {#if !item.home}
    <Menu.Item
      class="w-full cursor-pointer text-xs px-2 py-1.5"
      data-testid="machine-rail-menu-remove"
      onSelect={() => removeFromRail(item.id)}
    >
      {m.machineRail_remove_header()}
    </Menu.Item>
  {/if}
  <Menu.Item
    class="w-full cursor-pointer text-xs px-2 py-1.5"
    data-testid="machine-rail-menu-manage"
    onSelect={() => manageMachines(!!item.guest)}
  >
    {item.guest
      ? m.layout_daemonStatus_manageGuestSessions_action()
      : m.layout_daemonStatus_manageDevices_action()}
  </Menu.Item>
{/snippet}

<!-- A guest host shows its device icon once its kind is known, people until then. -->
{#snippet guestIcon(guest: GuestSessionRecord, size: number, className: string)}
  {#if (guest.deviceIcon && guest.deviceIcon !== 'auto') || guest.detectedDeviceKind}
    <DeviceIcon record={guest} {size} class={className} />
  {:else}
    <Fa icon={faUsers} class={className} />
  {/if}
{/snippet}

{#snippet railItem(item: MachineRailItem)}
  {@const accent = item.record?.isLocal ? null : resolveConnectionAccent(item.record?.accent)}
  <div class="relative flex">
    {#if item.selected}
      <span
        class={cn(
          'absolute top-1/2 -left-1.5 h-4 w-0.5 -translate-y-1/2 rounded-full',
          accent === null ? 'bg-foreground' : CONNECTION_ACCENT_CLASSES[accent],
        )}
        aria-hidden="true"
        data-connection-accent={accent ?? undefined}
      ></span>
    {/if}
    <Button
      variant="ghost"
      size="icon"
      iconOnly
      class={RAIL_BUTTON_FOCUS_CLASS}
      active={item.selected}
      aria-label={itemLabel(item)}
      tooltip={itemLabel(item)}
      tooltipSide="right"
      tooltipDelayDuration={MACHINE_TOOLTIP_DELAY_MS}
      aria-current={item.selected ? 'true' : undefined}
      aria-busy={item.pending || undefined}
      aria-haspopup="menu"
      data-testid="machine-rail-item"
      data-machine-id={item.id}
      data-guest={item.guest ? true : undefined}
      data-offline={item.offline || undefined}
      data-pending={item.pending || undefined}
      onclick={() => appStore.dispatch(selectRailMachineRequested(item.id))}
      oncontextmenu={(event: MouseEvent) => openItemMenu(event, item)}
    >
      {#if item.pending}
        <IntentMarkLoader size={18} class="text-foreground" />
      {:else if item.guest}
        {@render guestIcon(item.guest, 18, cn('text-foreground', item.offline && 'opacity-40'))}
      {:else if item.record}
        <DeviceIcon
          record={item.record}
          size={18}
          class={cn('text-foreground', item.offline && 'opacity-40')}
        />
      {/if}
    </Button>
    {#if item.degraded && !item.pending}
      <span
        class="pointer-events-none absolute right-0.5 bottom-0.5 size-2 rounded-full bg-warning ring-2 ring-background"
        aria-hidden="true"
        data-testid="machine-rail-degraded-dot"
        data-machine-id={item.id}
      ></span>
    {/if}
    {#if item.own}
      <!-- Zero-size anchor whose hidden trigger ends at the item's right edge, so the
           menu opens right beside the item whatever the trigger's width. -->
      <span
        class="absolute top-0 right-0 flex size-0 justify-end overflow-hidden"
        aria-hidden={!statusMenuOpen}
      >
        <DaemonStatusIndicator railAnchor bind:open={statusMenuOpen}>
          {#snippet railActions()}
            {@render railMenuActions(item)}
          {/snippet}
        </DaemonStatusIndicator>
      </span>
    {/if}
  </div>
{/snippet}

{#if $enabled$}
  <nav
    class="mr-2 flex w-10 shrink-0 flex-col items-center gap-1.5 pt-1"
    aria-label={m.machineRail_nav_ariaLabel()}
    data-testid="machine-rail"
  >
    <div class="flex min-h-0 flex-col items-center gap-1.5 overflow-y-auto">
      {#each ownItems as item (item.id)}
        {@render railItem(item)}
      {/each}
      {#if ownItems.length > 0 && guestItems.length > 0}
        <div
          class="my-0.5 h-px w-5 shrink-0 bg-border"
          role="separator"
          data-testid="machine-rail-guest-separator"
        ></div>
      {/if}
      {#each guestItems as item (item.id)}
        {@render railItem(item)}
      {/each}
    </div>

    <Menu.Root bind:open={menuOpen}>
      <Menu.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            iconOnly
            class={RAIL_BUTTON_FOCUS_CLASS}
            aria-label={m.machineRail_add_label()}
            tooltip={m.machineRail_add_label()}
            tooltipSide="right"
            tooltipDelayDuration={RAIL_TOOLTIP_DELAY_MS}
            data-testid="machine-rail-add"
          >
            <Fa icon={faPlus} size="sm" />
          </Button>
        {/snippet}
      </Menu.Trigger>
      <Menu.Content side="right" align="end" aria-label={m.machineRail_add_label()}>
        {#if $candidates$.length > 0}
          <Header class="px-2 pt-1.5 pb-0.5" size={6}>{m.machineRail_add_header()}</Header>
          {#each $candidates$ as candidate (candidate.id)}
            <Menu.Item
              data-testid="machine-rail-add-item"
              data-machine-id={candidate.id}
              onSelect={() => appStore.dispatch(addRailMachineRequested(candidate.id))}
            >
              {#snippet leading()}
                <DeviceIcon record={candidate} size={16} class="text-foreground" />
              {/snippet}
              <span class="min-w-0 flex-1 truncate">{machineName(candidate, candidate.id)}</span>
            </Menu.Item>
          {/each}
          <Menu.Separator />
        {/if}
        {#if $guestCandidates$.length > 0}
          <Header class="px-2 pt-1.5 pb-0.5" size={6}
            >{m.layout_daemonStatus_guestSessions_header()}</Header
          >
          {#each $guestCandidates$ as candidate (candidate.id)}
            <Menu.Item
              data-testid="machine-rail-add-item"
              data-machine-id={candidate.id}
              onSelect={() => appStore.dispatch(addRailMachineRequested(candidate.id))}
            >
              {#snippet leading()}
                {@render guestIcon(candidate, 16, 'text-foreground')}
              {/snippet}
              <span class="min-w-0 flex-1 truncate">{formatGuestSessionLabel(candidate)}</span>
            </Menu.Item>
          {/each}
          <Menu.Separator />
        {/if}
        <Menu.Item data-testid="machine-rail-add-new" onSelect={() => (connectModalOpen = true)}>
          {#snippet leading()}
            <Fa icon={faPlus} size="sm" />
          {/snippet}
          {m.settings_devices_add_label()}
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>

    <Menu.Root bind:open={itemMenuOpen}>
      <Menu.Content
        side="right"
        align="start"
        customAnchor={itemMenu?.anchor ?? null}
        aria-label={itemMenuItem ? itemName(itemMenuItem) : undefined}
        data-testid="machine-rail-item-menu"
      >
        {#if itemMenuItem}
          <div class="px-2 py-1.5 text-xs" data-testid="machine-rail-menu-status">
            {m.layout_daemonStatus_statusSummary_label({
              status: STATUS_LABELS[itemMenuItem.status](),
            })}
          </div>
          <Menu.Separator />
          {@render railMenuActions(itemMenuItem)}
        {/if}
      </Menu.Content>
    </Menu.Root>
  </nav>

  <ConnectBackendModal bind:open={connectModalOpen} />

  {#if $isHomeRenderer$}
    <div
      use:moveToBody
      class="machine-rail-backdrop"
      data-shell-opaque={!$shellTransparencyEnabled$ || undefined}
      data-testid="machine-rail-backdrop"
      aria-hidden="true"
    >
      <span style:background-color={shellTint}></span>
    </div>
  {/if}
{/if}
