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
   * A machine other than the window's own can be dragged to another place in
   * its group (the others move aside to make room), or moved with Alt+Up/Down.
   *
   * A context click opens the machine's menu where it is, without switching:
   * its status, removal from the rail and machine settings. The shown
   * machine's status comes from its own renderer, with full health details.
   *
   * The window's own renderer, under every other machine's, also paints the
   * shell backdrop with the shown machine's tint, so the tint cross-fades.
   */
  import { faPlus, faUsers } from '@fortawesome/free-solid-svg-icons';
  import { flip } from 'svelte/animate';
  import Fa from 'svelte-fa';
  import DeviceIcon from '$lib/components/DeviceIcon.svelte';
  import DaemonStatusIndicator from '$lib/components/layout/DaemonStatusIndicator.svelte';
  import { machineSetupOpened } from '$features/machine-setup/machine-setup-slice';
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import Header from '$lib/components/ui/Header.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import { prefersReducedMotion, spring } from '$lib/motion';
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
    reorderRailMachinesRequested,
    selectRailMachineRequested,
  } from '$store/renderer/slices/machine-rail/machine-rail-slice';
  import { selectShellTransparencyEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { moveItem, railDropIndex, railShift } from './rail-reorder';

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
  // The shown machine's status menu, rendered by DaemonStatusIndicator.
  let statusMenuOpen = $state(false);
  // Another machine's menu, anchored at its rail item.
  let itemMenu = $state<{ id: string; anchor: HTMLElement } | null>(null);
  let itemMenuOpen = $state(false);

  type RailGroup = 'own' | 'guest';
  interface RailDrag {
    id: string;
    group: RailGroup;
    from: number;
    to: number;
    startY: number;
    dy: number;
    /** Slot centres of the group at drag start. */
    centers: number[];
    /** First slot a machine may move to: the window's own machine stays first. */
    min: number;
    active: boolean;
  }
  // Movement before a press becomes a drag, so a click stays a click.
  const DRAG_THRESHOLD_PX = 4;
  // How long a new order shows before main confirms it (or refuses it).
  const PENDING_ORDER_MS = 2000;
  let drag = $state<RailDrag | null>(null);
  let suppressClick = false;
  let pendingOrder = $state<string[] | null>(null);
  let pendingOrderTimer: ReturnType<typeof setTimeout> | undefined;

  const orderedItems = $derived.by(() => {
    if (!pendingOrder || pendingOrder.length !== $items$.length) return $items$;
    const byId = new Map($items$.map((item) => [item.id, item]));
    const ordered = pendingOrder.map((id) => byId.get(id));
    return ordered.every((item) => item !== undefined) ? (ordered as MachineRailItem[]) : $items$;
  });
  const ownItems = $derived(orderedItems.filter((item) => !item.guest));
  const guestItems = $derived(orderedItems.filter((item) => item.guest));

  // Main's reply (or push) carries the order to show from then on.
  $effect(() => {
    void $items$;
    pendingOrder = null;
  });

  function groupItems(group: RailGroup): MachineRailItem[] {
    return group === 'own' ? ownItems : guestItems;
  }

  function commitOrder(group: RailGroup, from: number, to: number) {
    const own = ownItems.map((item) => item.id);
    const guests = guestItems.map((item) => item.id);
    const moved =
      group === 'own'
        ? [...moveItem(own, from, to), ...guests]
        : [...own, ...moveItem(guests, from, to)];
    const homeId = $items$.find((item) => item.home)?.id;
    const order = homeId ? [homeId, ...moved.filter((id) => id !== homeId)] : moved;
    clearTimeout(pendingOrderTimer);
    pendingOrder = order;
    pendingOrderTimer = setTimeout(() => (pendingOrder = null), PENDING_ORDER_MS);
    appStore.dispatch(reorderRailMachinesRequested(order));
  }

  function startDrag(event: PointerEvent, item: MachineRailItem, group: RailGroup, index: number) {
    suppressClick = false;
    if (event.button !== 0 || item.home) return;
    const entry = event.currentTarget as HTMLElement;
    const slots = entry
      .closest('[data-rail-list]')
      ?.querySelectorAll<HTMLElement>(`[data-rail-group="${group}"]`);
    const centers = [...(slots ?? [])].map((slot) => {
      const rect = slot.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
    const list = groupItems(group);
    drag = {
      id: item.id,
      group,
      from: index,
      to: index,
      startY: event.clientY,
      dy: 0,
      centers,
      min: list[0]?.home ? 1 : 0,
      active: false,
    };
    entry.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent) {
    if (!drag) return;
    const dy = event.clientY - drag.startY;
    if (!drag.active && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    drag.active = true;
    drag.dy = dy;
    drag.to = railDropIndex(drag.centers, drag.from, dy, drag.min);
  }

  function endDrag(commit: boolean) {
    const ended = drag;
    drag = null;
    if (!ended?.active) return;
    // The press that ended a drag is not a click on the machine.
    suppressClick = true;
    if (commit && ended.to !== ended.from) commitOrder(ended.group, ended.from, ended.to);
  }

  /** Where a group entry sits during a drag: the dragged one follows the pointer. */
  function dragOffset(group: RailGroup, index: number): string | undefined {
    if (!drag?.active || drag.group !== group) return undefined;
    if (index === drag.from) return `translateY(${drag.dy}px)`;
    const step = drag.centers.length > 1 ? drag.centers[1] - drag.centers[0] : 0;
    const shift = railShift(index, drag.from, drag.to);
    return shift ? `translateY(${shift * step}px)` : undefined;
  }

  function moveWithKeys(
    event: KeyboardEvent,
    item: MachineRailItem,
    group: RailGroup,
    index: number,
  ) {
    if (!event.altKey || item.home) return;
    const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    const list = groupItems(group);
    const min = list[0]?.home ? 1 : 0;
    const to = Math.min(list.length - 1, Math.max(min, index + delta));
    if (to !== index) commitOrder(group, index, to);
  }

  function selectMachine(id: string) {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    appStore.dispatch(selectRailMachineRequested(id));
  }
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

{#snippet railEntry(item: MachineRailItem, group: RailGroup, index: number)}
  {@const dragged = drag?.active && drag.id === item.id}
  <div
    class={cn('relative flex', dragged && 'z-10 cursor-grabbing')}
    data-rail-group={group}
    style:transform={dragOffset(group, index)}
    style:transition={drag?.active && !dragged
      ? 'transform var(--spring-moderate) var(--spring-moderate-ease)'
      : undefined}
    onpointerdown={(event) => startDrag(event, item, group, index)}
    onpointermove={moveDrag}
    onpointerup={() => endDrag(true)}
    onpointercancel={() => endDrag(false)}
    onkeydown={(event) => moveWithKeys(event, item, group, index)}
  >
    {@render railItem(item)}
  </div>
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
      onclick={() => selectMachine(item.id)}
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
    <div class="flex min-h-0 flex-col items-center gap-1.5 overflow-y-auto" data-rail-list>
      {#each ownItems as item, index (item.id)}
        <div animate:flip={{ duration: prefersReducedMotion() ? 0 : spring.moderate.settleMs }}>
          {@render railEntry(item, 'own', index)}
        </div>
      {/each}
      {#if ownItems.length > 0 && guestItems.length > 0}
        <div
          class="my-0.5 h-px w-5 shrink-0 bg-border"
          role="separator"
          data-testid="machine-rail-guest-separator"
        ></div>
      {/if}
      {#each guestItems as item, index (item.id)}
        <div animate:flip={{ duration: prefersReducedMotion() ? 0 : spring.moderate.settleMs }}>
          {@render railEntry(item, 'guest', index)}
        </div>
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
        <Menu.Item
          data-testid="machine-rail-add-new"
          onSelect={() => appStore.dispatch(machineSetupOpened())}
        >
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
