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
  import {
    selectMachineRailCandidates,
    selectMachineRailEnabled,
    selectMachineRailItems,
    selectRailMenuRequests,
  } from '$store/renderer/slices/machine-rail/machine-rail-selectors';
  import {
    addRailMachineRequested,
    openRailMachineMenuRequested,
    removeRailMachineRequested,
    selectRailMachineRequested,
  } from '$store/renderer/slices/machine-rail/machine-rail-slice';
  import { store as appStore } from '$store/renderer/store';

  const enabled$ = selectMachineRailEnabled();
  const items$ = selectMachineRailItems();
  const candidates$ = selectMachineRailCandidates();

  const menuRequests$ = selectRailMenuRequests();

  // Machine buttons have no hover tooltip (the name is in their context menu and
  // accessible label); the add button's shows only after a deliberate pause.
  const RAIL_TOOLTIP_DELAY_MS = 900;

  // Rail buttons show keyboard focus as the hover background, not the app-wide
  // focus outline (the Button paints its states on its surface element).
  const RAIL_BUTTON_FOCUS_CLASS =
    'focus-visible:outline-none [&:focus-visible>[data-slot=button-surface]]:bg-hover';

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

  function machineName(record: ConnectionRecord | null, id: string): string {
    if (!record) return id;
    return record.isLocal ? formatLocalMachineLabel(record) : formatConnectionLabel(record);
  }

  function itemLabel(record: ConnectionRecord | null, id: string, offline: boolean): string {
    const name = machineName(record, id);
    return offline ? m.machineRail_item_offline_label({ name }) : name;
  }
</script>

{#if $enabled$}
  <nav
    class="mr-2 flex w-10 shrink-0 flex-col items-center gap-1.5 pt-1"
    aria-label={m.machineRail_nav_ariaLabel()}
    data-testid="machine-rail"
  >
    <div class="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto">
      {#each $items$ as item (item.id)}
        {@const accent = item.record?.isLocal ? null : resolveConnectionAccent(item.record?.accent)}
        {@const label = itemLabel(item.record, item.id, item.offline)}
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
            aria-label={label}
            aria-current={item.selected ? 'true' : undefined}
            data-testid="machine-rail-item"
            data-machine-id={item.id}
            data-offline={item.offline || undefined}
            onclick={() => appStore.dispatch(selectRailMachineRequested(item.id))}
            oncontextmenu={(event: MouseEvent) => openStatusMenu(event, item.id, item.own)}
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
              <DaemonStatusIndicator railAnchor bind:open={statusMenuOpen} />
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
