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
   * active state and a bar in the machine's accent colour.
   */
  import { faPlus } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import DeviceIcon from '$lib/components/DeviceIcon.svelte';
  import DaemonStatusIndicator from '$lib/components/layout/DaemonStatusIndicator.svelte';
  import ConnectBackendModal from '$lib/components/layout/ConnectBackendModal.svelte';
  import { Button } from '$lib/components/ui/button';
  import Header from '$lib/components/ui/Header.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import { cn } from '$lib/utils';
  import {
    CONNECTION_ACCENT_CLASSES,
    resolveConnectionAccent,
  } from '$lib/utils/connection-accents';
  import { formatConnectionLabel, formatLocalMachineLabel } from '$lib/utils/connection-label';
  import { m } from '$shared/paraglide/messages.js';
  import type { ConnectionRecord } from '$shared/types/connections';
  import { moveRailMachine } from '$shared/types/machine-rail';
  import {
    selectMachineRailCandidates,
    selectMachineRailVisible,
    selectIsRailMachineShown,
    selectMachineRailItems,
    selectRailMenuRequests,
  } from '$store/renderer/slices/machine-rail/machine-rail-selectors';
  import {
    addRailMachineRequested,
    openRailMachineMenuRequested,
    removeRailMachineRequested,
    reorderRailMachinesRequested,
    selectRailMachineRequested,
  } from '$store/renderer/slices/machine-rail/machine-rail-slice';
  import { store as appStore } from '$store/renderer/store';

  const visible$ = selectMachineRailVisible();
  const items$ = selectMachineRailItems();
  const candidates$ = selectMachineRailCandidates();

  const menuRequests$ = selectRailMenuRequests();

  // Names show only after the pointer rests on a button.
  const RAIL_TOOLTIP_DELAY_MS = 900;

  // Rail buttons show keyboard focus as the hover background, not the app-wide
  // focus outline (the Button paints its states on its surface element).
  const RAIL_BUTTON_FOCUS_CLASS =
    'focus-visible:outline-none [&:focus-visible>[data-slot=button-surface]]:bg-hover';

  // After a switch the pointer is still resting on the rail of the machine that
  // just appeared; its name would pop up unasked. Tooltips stay off from a click
  // or a switch until the pointer has left the rail.
  const shown$ = selectIsRailMachineShown();
  let tooltipsSuppressed = $state(false);
  let wasShown = true;
  $effect(() => {
    if ($shown$ && !wasShown) tooltipsSuppressed = true;
    wasShown = $shown$;
  });

  let menuOpen = $state(false);
  // This machine's status menu (health, machines): opened by a context click on
  // its rail item here, or on another machine's rail from that machine's renderer.
  let statusMenuOpen = $state(false);
  let seenMenuRequests = 0;
  $effect(() => {
    if ($menuRequests$ === seenMenuRequests) return;
    seenMenuRequests = $menuRequests$;
    statusMenuOpen = true;
  });

  function openStatusMenu(event: MouseEvent, id: string, own: boolean) {
    event.preventDefault();
    if (own) statusMenuOpen = true;
    else appStore.dispatch(openRailMachineMenuRequested(id));
  }
  let connectModalOpen = $state(false);

  const removable = $derived($items$.filter((item) => !item.home));

  // Drag a machine onto another to reorder the rail; Alt+Up / Alt+Down moves the
  // focused machine for keyboard users. Main owns the order: a drop only asks.
  let draggedId = $state<string | null>(null);
  let dropTarget = $state<{ id: string; position: 'before' | 'after' } | null>(null);

  function requestMove(id: string, targetId: string, position: 'before' | 'after') {
    const order = $items$.map((item) => item.id);
    const next = moveRailMachine(order, id, targetId, position);
    if (next.some((machineId, index) => machineId !== order[index])) {
      appStore.dispatch(reorderRailMachinesRequested(next));
    }
  }

  function handleDragStart(event: DragEvent, id: string) {
    draggedId = id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
    }
  }

  function handleDragOver(event: DragEvent, id: string) {
    if (!draggedId) return;
    event.preventDefault();
    if (draggedId === id) {
      dropTarget = null;
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    dropTarget = { id, position: event.clientY <= rect.top + rect.height / 2 ? 'before' : 'after' };
  }

  function handleDrop(event: DragEvent, id: string) {
    event.preventDefault();
    if (draggedId && dropTarget?.id === id) requestMove(draggedId, id, dropTarget.position);
    handleDragEnd();
  }

  function handleDragEnd() {
    draggedId = null;
    dropTarget = null;
  }

  function handleItemKeydown(event: KeyboardEvent, id: string) {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    const order = $items$.map((item) => item.id);
    const neighbour = order[order.indexOf(id) + (event.key === 'ArrowUp' ? -1 : 1)];
    if (!neighbour) return;
    event.preventDefault();
    requestMove(id, neighbour, event.key === 'ArrowUp' ? 'before' : 'after');
  }

  function machineName(record: ConnectionRecord | null, id: string): string {
    if (!record) return id;
    return record.isLocal ? formatLocalMachineLabel(record) : formatConnectionLabel(record);
  }

  function itemLabel(record: ConnectionRecord | null, id: string, offline: boolean): string {
    const name = machineName(record, id);
    return offline ? m.machineRail_item_offline_label({ name }) : name;
  }
</script>

{#if $visible$}
  <nav
    class="mr-2 flex w-10 shrink-0 flex-col items-center gap-1.5 pt-2.5"
    aria-label={m.machineRail_nav_ariaLabel()}
    data-testid="machine-rail"
    onpointerleave={() => (tooltipsSuppressed = false)}
  >
    <div class="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto">
      {#each $items$ as item (item.id)}
        {@const accent = item.record?.isLocal ? null : resolveConnectionAccent(item.record?.accent)}
        {@const label = itemLabel(item.record, item.id, item.offline)}
        <!-- svelte-ignore a11y_no_static_element_interactions (keyboard reordering is on the nested button) -->
        <div
          class={cn('relative flex', draggedId === item.id && 'opacity-50')}
          ondragover={(event) => handleDragOver(event, item.id)}
          ondrop={(event) => handleDrop(event, item.id)}
        >
          {#if dropTarget?.id === item.id}
            <span
              class={cn(
                'pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-primary',
                dropTarget.position === 'before' ? '-top-1' : '-bottom-1',
              )}
              aria-hidden="true"
            ></span>
          {/if}
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
            aria-label={label}
            aria-current={item.selected ? 'true' : undefined}
            tooltip={label}
            tooltipSide="right"
            tooltipDelayDuration={RAIL_TOOLTIP_DELAY_MS}
            tooltipDisabled={tooltipsSuppressed || draggedId !== null}
            data-testid="machine-rail-item"
            data-machine-id={item.id}
            data-offline={item.offline || undefined}
            onclick={() => {
              tooltipsSuppressed = true;
              appStore.dispatch(selectRailMachineRequested(item.id));
            }}
            oncontextmenu={(event: MouseEvent) => openStatusMenu(event, item.id, item.own)}
            draggable="true"
            ondragstart={(event: DragEvent) => handleDragStart(event, item.id)}
            ondragend={handleDragEnd}
            onkeydown={(event: KeyboardEvent) => handleItemKeydown(event, item.id)}
          >
            {#if item.record}
              <DeviceIcon
                record={item.record}
                size={18}
                class={cn('text-foreground', item.offline && 'opacity-40')}
              />
            {/if}
          </Button>
          {#if item.own}
            <!-- Zero-size anchor whose hidden trigger ends at the item's right edge, so the
                 menu opens right beside the item whatever the trigger's width. -->
            <span
              class="absolute top-0 right-0 flex size-0 justify-end overflow-hidden"
              aria-hidden={!statusMenuOpen}
            >
              <DaemonStatusIndicator railAnchor bind:open={statusMenuOpen}>
                {#snippet railActions()}
                  {#if !item.home}
                    <div class="mx-1 my-1 h-px bg-border"></div>
                    <div class="px-1 pb-1">
                      <Menu.Item
                        destructive
                        class="w-full cursor-pointer px-2 py-1.5 text-xs"
                        data-testid="machine-rail-remove-from-menu"
                        onSelect={() => {
                          statusMenuOpen = false;
                          appStore.dispatch(removeRailMachineRequested(item.id));
                        }}
                      >
                        {m.machineRail_remove_label()}
                      </Menu.Item>
                    </div>
                  {/if}
                {/snippet}
              </DaemonStatusIndicator>
            </span>
          {/if}
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
        <Menu.Item data-testid="machine-rail-add-new" onSelect={() => (connectModalOpen = true)}>
          {#snippet leading()}
            <Fa icon={faPlus} size="sm" />
          {/snippet}
          {m.settings_devices_add_label()}
        </Menu.Item>
        {#if removable.length > 0}
          <Menu.Separator />
          <Header class="px-2 pt-1.5 pb-0.5" size={6}>{m.machineRail_remove_header()}</Header>
          {#each removable as item (item.id)}
            <Menu.Item
              data-testid="machine-rail-remove-item"
              data-machine-id={item.id}
              onSelect={() => appStore.dispatch(removeRailMachineRequested(item.id))}
            >
              {#snippet leading()}
                {#if item.record}
                  <DeviceIcon record={item.record} size={16} class="text-foreground" />
                {/if}
              {/snippet}
              <span class="min-w-0 flex-1 truncate">{machineName(item.record, item.id)}</span>
            </Menu.Item>
          {/each}
        {/if}
      </Menu.Content>
    </Menu.Root>
  </nav>

  <ConnectBackendModal bind:open={connectModalOpen} />
{/if}
