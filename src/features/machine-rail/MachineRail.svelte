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
  import { tick } from 'svelte';
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
    selectIsRailMachineShown,
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
  const isShown$ = selectIsRailMachineShown();
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

  // Names are a fallback, not something to read on every pass of the pointer:
  // the first shows only after the pointer rests on a button. Once one is up,
  // moving to the next machine shows its name at once (the app's usual behaviour).
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
    /** Layout centres of the group's slots (transforms ignored). */
    centers: number[];
    /** First slot a machine may move to: the window's own machine stays first. */
    min: number;
    active: boolean;
    pointerId: number;
    entry: HTMLElement;
  }
  // Movement before a press becomes a drag, so a click stays a click.
  const DRAG_THRESHOLD_PX = 4;
  // How long a new order shows before main confirms it (or refuses it).
  const PENDING_ORDER_MS = 2000;
  let drag = $state<RailDrag | null>(null);
  // A dropped machine glides from where it was let go to its new slot.
  let settle = $state<{ id: string; offset: number; animate: boolean } | null>(null);
  // While a drop reorders the list, the settle glide replaces the reorder animation.
  let dropping = $state(false);
  let suppressClick = false;
  let pendingOrder = $state<string[] | null>(null);
  let pendingOrderTimer: ReturnType<typeof setTimeout> | undefined;
  let railList = $state<HTMLElement | null>(null);

  const orderedItems = $derived.by(() => {
    if (!pendingOrder || pendingOrder.length !== $items$.length) return $items$;
    const byId = new Map($items$.map((item) => [item.id, item]));
    const ordered = pendingOrder.map((id) => byId.get(id));
    return ordered.every((item) => item !== undefined) ? (ordered as MachineRailItem[]) : $items$;
  });
  const ownItems = $derived(orderedItems.filter((item) => !item.guest));
  // Everything but the window's own machine can leave the rail.
  const removableItems = $derived(orderedItems.filter((item) => !item.home));
  const guestItems = $derived(orderedItems.filter((item) => item.guest));

  // Main's reply carries the new order: the local one is no longer needed.
  $effect(() => {
    const order = $items$.map((item) => item.id).join('\n');
    if (pendingOrder && order === orderedItems.map((item) => item.id).join('\n')) {
      pendingOrder = null;
    }
  });

  function groupItems(group: RailGroup): MachineRailItem[] {
    return group === 'own' ? ownItems : guestItems;
  }

  function flipDuration(): number {
    return dropping || prefersReducedMotion() ? 0 : spring.moderate.settleMs;
  }

  /** Move machine `id` to slot `to` of its group, by id so a changed list stays right. */
  function commitOrder(group: RailGroup, id: string, to: number): boolean {
    const own = ownItems.map((item) => item.id);
    const guests = guestItems.map((item) => item.id);
    const list = group === 'own' ? own : guests;
    const from = list.indexOf(id);
    const target = Math.min(list.length - 1, to);
    if (from < 0 || from === target) return false;
    const moved =
      group === 'own'
        ? [...moveItem(own, from, target), ...guests]
        : [...own, ...moveItem(guests, from, target)];
    const homeId = $items$.find((item) => item.home)?.id;
    const order = homeId ? [homeId, ...moved.filter((machineId) => machineId !== homeId)] : moved;
    clearTimeout(pendingOrderTimer);
    pendingOrder = order;
    pendingOrderTimer = setTimeout(() => (pendingOrder = null), PENDING_ORDER_MS);
    appStore.dispatch(reorderRailMachinesRequested(order));
    return true;
  }

  function startDrag(event: PointerEvent, item: MachineRailItem, group: RailGroup, index: number) {
    suppressClick = false;
    drag = null;
    if (event.button !== 0 || item.home) return;
    const entry = event.currentTarget as HTMLElement;
    const slots = railList?.querySelectorAll<HTMLElement>(`[data-rail-group="${group}"]`);
    const centers = [...(slots ?? [])].map((slot) => slot.offsetTop + slot.offsetHeight / 2);
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
      pointerId: event.pointerId,
      entry,
    };
    // A release anywhere ends a press that has not become a drag (a drag is
    // captured, so its release reaches the entry).
    const pointerId = event.pointerId;
    window.addEventListener(
      'pointerup',
      (up) => {
        if (up.pointerId === pointerId && drag && !drag.active) drag = null;
      },
      { once: true, capture: true },
    );
  }

  function moveDrag(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    // A press released off the rail never reaches it: a move without the
    // button held ends that press instead of starting a drag.
    if (!(event.buttons & 1)) {
      endDrag(false);
      return;
    }
    const dy = event.clientY - drag.startY;
    if (!drag.active) {
      if (Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      // Capture only once it is a drag: a captured press would take the button's click.
      drag.active = true;
      drag.entry.setPointerCapture(event.pointerId);
    }
    drag.dy = dy;
    drag.to = railDropIndex(drag.centers, drag.from, dy, drag.min);
  }

  function endDrag(commit: boolean) {
    const ended = drag;
    drag = null;
    if (!ended?.active) return;
    // The press that ended a drag is not a click on the machine; clear the
    // mark once that click has had its turn.
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    // The dropped machine sits under the pointer: keep its name hidden until the pointer moves on.
    quietTooltips = ended.id;
    if (!commit || !commitOrder(ended.group, ended.id, ended.to)) return;
    if (prefersReducedMotion()) return;
    const offset = ended.centers[ended.from] + ended.dy - ended.centers[ended.to];
    dropping = true;
    settle = { id: ended.id, offset, animate: false };
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        dropping = false;
        if (settle?.id === ended.id) settle = { id: ended.id, offset: 0, animate: true };
        setTimeout(() => {
          if (settle?.id === ended.id) settle = null;
        }, spring.moderate.settleMs);
      }),
    );
  }

  /** Where a group entry sits: the dragged one follows the pointer, the others make room. */
  function entryOffset(item: MachineRailItem, group: RailGroup, index: number): string | undefined {
    if (settle?.id === item.id) return `translateY(${settle.offset}px)`;
    if (!drag?.active || drag.group !== group) return undefined;
    if (index === drag.from) return `translateY(${drag.dy}px)`;
    const step = drag.centers.length > 1 ? drag.centers[1] - drag.centers[0] : 0;
    const shift = railShift(index, drag.from, drag.to);
    return shift ? `translateY(${shift * step}px)` : undefined;
  }

  function entryTransition(item: MachineRailItem): string | undefined {
    const moving =
      (drag?.active && drag.id !== item.id) || (settle?.id === item.id && settle.animate);
    return moving ? 'transform var(--spring-moderate) var(--spring-moderate-ease)' : undefined;
  }

  async function moveWithKeys(
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
    if (to === index || !commitOrder(group, item.id, to)) return;
    // Moving a focused element in the DOM drops its focus: keep it on the machine.
    await tick();
    [...(railList?.querySelectorAll<HTMLElement>('[data-testid="machine-rail-item"]') ?? [])]
      .find((button) => button.dataset.machineId === item.id)
      ?.focus();
  }

  // Each machine's renderer has its own rail, and one that stops being shown
  // never sees the pointer leave. A machine's name stays hidden after a click
  // on it until the pointer or keyboard focus moves to another machine. Every
  // name stays hidden while this rail is not on screen and, once it shows
  // again, until the pointer has left the rail: after a switch the pointer is
  // still resting on the rail of the machine that just appeared, which reports
  // it as entering, so entering alone must not bring the names back.
  let quietTooltips = $state<'all' | string | null>(null);
  $effect(() => {
    if (!$isShown$) quietTooltips = 'all';
  });

  function tooltipQuiet(item: MachineRailItem): boolean {
    // No names while a machine is dragged: they would trail and cover the rail.
    if (drag?.active) return true;
    return quietTooltips === 'all' || quietTooltips === item.id;
  }

  /** The pointer or focus reached `item`: names return unless the whole rail is quiet. */
  function wakeTooltips(item: MachineRailItem) {
    if (quietTooltips !== null && quietTooltips !== 'all' && quietTooltips !== item.id) {
      quietTooltips = null;
    }
  }

  /** The pointer left the rail: the next visit is a deliberate one. */
  function wakeAllTooltips() {
    quietTooltips = null;
  }

  function selectMachine(id: string) {
    quietTooltips = id;
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
  <!-- svelte-ignore a11y_no_static_element_interactions (the machine's button inside is the control; this wrapper only tracks the drag) -->
  <div
    class={cn('relative flex', dragged && 'z-10 cursor-grabbing')}
    data-rail-group={group}
    style:transform={entryOffset(item, group, index)}
    style:transition={entryTransition(item)}
    onpointerenter={() => wakeTooltips(item)}
    onfocusin={() => wakeTooltips(item)}
    onpointerdown={(event) => startDrag(event, item, group, index)}
    onpointermove={moveDrag}
    onpointerup={() => endDrag(true)}
    onpointercancel={() => endDrag(false)}
    onlostpointercapture={() => endDrag(false)}
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
      tooltipDelayDuration={RAIL_TOOLTIP_DELAY_MS}
      tooltipDisabled={tooltipQuiet(item)}
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
    class="mr-2 flex w-10 shrink-0 flex-col items-center gap-1.5 pt-2.5"
    aria-label={m.machineRail_nav_ariaLabel()}
    data-testid="machine-rail"
    onpointerleave={wakeAllTooltips}
  >
    <div
      bind:this={railList}
      class="flex min-h-0 flex-col items-center gap-1.5 overflow-y-auto"
      data-rail-list
    >
      {#each ownItems as item, index (item.id)}
        <div animate:flip={{ duration: flipDuration() }}>
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
        <div animate:flip={{ duration: flipDuration() }}>
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
      <Menu.Content side="right" align="start" aria-label={m.machineRail_add_label()}>
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
        {#if removableItems.length > 0}
          <Menu.Separator />
          <Header class="px-2 pt-1.5 pb-0.5" size={6}>{m.machineRail_remove_header()}</Header>
          {#each removableItems as item (item.id)}
            <Menu.Item
              data-testid="machine-rail-remove-item"
              data-machine-id={item.id}
              onSelect={() => removeFromRail(item.id)}
            >
              {#snippet leading()}
                {#if item.guest}
                  {@render guestIcon(item.guest, 16, 'text-foreground')}
                {:else if item.record}
                  <DeviceIcon record={item.record} size={16} class="text-foreground" />
                {/if}
              {/snippet}
              <span class="min-w-0 flex-1 truncate">{itemName(item)}</span>
            </Menu.Item>
          {/each}
        {/if}
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
