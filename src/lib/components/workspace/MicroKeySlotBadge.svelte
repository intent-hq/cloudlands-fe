<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  /**
   * Numbered micro-key slot badge: a small faint square showing the 1-based
   * slot number a workspace occupies (pinned or auto-filled). Clicking it
   * pops a small menu to pin the workspace to any of the 6 slots or to
   * unassign (which marks the slot sticky-unassigned so it never
   * auto-fills). Rendered only while a micro is connected — the parent
   * gates on `microConnectedReadable()`.
   */
  import MicroKeySlotSquare from '$features/hardware-console/components/MicroKeySlotSquare.svelte';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import {
    getSidebarContextPosition,
    type SidebarContextPosition,
    type SidebarMenuEntry,
  } from '$lib/components/ui/sidebar-context-menu/types';
  import { store as appStore } from '$store/renderer/store';
  import {
    markKeySlotUnassigned,
    pinWorkspaceToKey,
  } from '$store/renderer/slices/hardware-console/hardware-console-slice';
  import {
    selectWorkspacePinnedKeySlot,
    selectWorkspaceResolvedKeySlot,
    selectHardwareConsoleKeySlots,
  } from '$store/renderer/slices/hardware-console/hardware-console-selectors';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { AGENT_KEY_COUNT } from '$features/hardware-console/assignment/key-assignment';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { slotHoverClasses as slotHoverClassesFor } from '$features/hardware-console/components/micro-key-slot-colors';

  interface Props {
    workspaceId: string;
    /** Resolved 0-based slot the workspace occupies. */
    slot: number;
  }

  let { workspaceId, slot }: Props = $props();

  /** Hover deepens the square's pastel slot tint (matches its 0-based palette). */
  const slotHoverClasses = $derived(slotHoverClassesFor(slot));

  let menu: (SidebarContextPosition & { workspaceId: string }) | null = $state(null);

  $effect(() => {
    if (menu && menu.workspaceId !== workspaceId) menu = null;
  });

  function handleContextMenu(event: MouseEvent | KeyboardEvent) {
    const position = getSidebarContextPosition(event);
    if (position) menu = { ...position, workspaceId };
  }

  function handleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu = {
      x: rect.left,
      y: rect.bottom + 2,
      returnFocus: e.currentTarget as HTMLElement,
      workspaceId,
    };
  }

  function closeMenu() {
    menu = null;
  }

  function getMenuItems(): SidebarMenuEntry[] {
    const pinnedSlot = selectWorkspacePinnedKeySlot.select(appStore.state, workspaceId);
    const resolvedSlot = selectWorkspaceResolvedKeySlot.select(appStore.state, workspaceId);
    const occupiedSlots = selectHardwareConsoleKeySlots.select(appStore.state);
    const items: SidebarMenuEntry[] = [];
    for (let target = 0; target < AGENT_KEY_COUNT; target += 1) {
      const occupantId = occupiedSlots[target];
      const occupant =
        occupantId && occupantId !== workspaceId
          ? selectWorkspaceById.select(appStore.state, occupantId)
          : undefined;
      items.push({
        id: `assign-micro-key-${target + 1}`,
        label: occupant
          ? m.workspace_card_assignOccupiedMicroKey_label({
              number: formatInteger(target + 1),
              title: occupant.title,
            })
          : m.workspace_card_assignMicroKeyNumber_label({
              number: formatInteger(target + 1),
            }),
        checked: pinnedSlot === target,
        closeOnSelect: true,
        onClick: () => {
          appStore.dispatch(pinWorkspaceToKey(target, workspaceId));
          closeMenu();
        },
      });
    }
    if (resolvedSlot !== null) {
      items.push({ type: 'separator' });
      items.push({
        id: 'unassign-micro-key',
        label: m.workspace_card_unassignMicroKey_label(),
        onClick: () => {
          appStore.dispatch(markKeySlotUnassigned(resolvedSlot));
          closeMenu();
        },
      });
    }
    return items;
  }
</script>

<!-- The interactive click target composes the shared non-interactive square
     (identical visual to the toast surfaces); hover states ride the square.
     The size override collapses the default button box to the square itself so
     numbered rows keep the same height and dot/title offset as un-numbered rows. -->
<Button
  variant="ghost"
  size="icon"
  type="button"
  class="micro-key-slot-badge size-4 min-w-0 shrink-0 cursor-pointer rounded-[3px] p-0 a11y-ignore"
  aria-label={m.workspace_microKeyBadge_ariaLabel({ number: formatInteger(slot + 1) })}
  title={m.workspace_microKeyBadge_tooltip({ number: formatInteger(slot + 1) })}
  onclick={handleClick}
  oncontextmenu={handleContextMenu}
  onkeydown={handleContextMenu}
  aria-haspopup="menu"
  aria-expanded={menu !== null}
>
  <span class="contents">
    <MicroKeySlotSquare {slot} class="transition-colors {slotHoverClasses}" />
  </span>
</Button>

{#if menu}
  <SidebarContextMenu
    x={menu?.x ?? 0}
    y={menu?.y ?? 0}
    returnFocus={menu?.returnFocus}
    selection="single"
    ariaLabel={m.workspace_card_assignMicroKey_label()}
    items={getMenuItems()}
    onClickOutside={closeMenu}
  />
{/if}
