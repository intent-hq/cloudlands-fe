<script lang="ts">
  /**
   * Numbered micro-key slot badge: a small faint square showing the 1-based
   * slot number a workspace occupies (pinned or auto-filled). Clicking it
   * pops a small menu to pin the workspace to any of the 6 slots or to
   * unassign (which marks the slot sticky-unassigned so it never
   * auto-fills). Rendered only while a micro is connected — the parent
   * gates on `microConnectedReadable()`.
   */
  import MicroKeySlotSquare from '$lib/components/ui/toast/MicroKeySlotSquare.svelte';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
  import { store as appStore } from '$store/renderer/store';
  import {
    markKeySlotUnassigned,
    pinWorkspaceToKey,
  } from '$store/renderer/slices/hardware-console/hardware-console-slice';
  import {
    selectWorkspacePinnedKeySlot,
    selectWorkspaceResolvedKeySlot,
  } from '$store/renderer/slices/hardware-console/hardware-console-selectors';
  import { AGENT_KEY_COUNT } from '$features/hardware-console/assignment/key-assignment';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';

  interface Props {
    workspaceId: string;
    /** Resolved 0-based slot the workspace occupies. */
    slot: number;
  }

  let { workspaceId, slot }: Props = $props();

  let menu: { x: number; y: number } | null = $state(null);

  function handleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu = { x: rect.left, y: rect.bottom + 2 };
  }

  function closeMenu() {
    menu = null;
  }

  function getMenuItems(): SidebarMenuEntry[] {
    const pinnedSlot = selectWorkspacePinnedKeySlot.select(appStore.state, workspaceId);
    const resolvedSlot = selectWorkspaceResolvedKeySlot.select(appStore.state, workspaceId);
    const items: SidebarMenuEntry[] = [];
    for (let target = 0; target < AGENT_KEY_COUNT; target += 1) {
      items.push({
        id: `assign-micro-key-${target + 1}`,
        label: m.workspace_card_assignMicroKeyNumber_label({
          number: formatInteger(target + 1),
        }),
        checked: pinnedSlot === target,
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
     (identical visual to the toast surfaces); hover states ride the square. -->
<button
  type="button"
  class="micro-key-slot-badge shrink-0 cursor-pointer a11y-ignore"
  aria-label={m.workspace_microKeyBadge_ariaLabel({ number: formatInteger(slot + 1) })}
  title={m.workspace_microKeyBadge_tooltip({ number: formatInteger(slot + 1) })}
  onclick={handleClick}
>
  <MicroKeySlotSquare {slot} class="transition-colors hover:bg-muted hover:text-foreground" />
</button>

{#if menu}
  <SidebarContextMenu x={menu.x} y={menu.y} items={getMenuItems()} onClickOutside={closeMenu} />
{/if}
