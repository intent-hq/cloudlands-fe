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
  } from '$lib/components/ui/sidebar-context-menu/types';
  import { createMicroKeyAssignmentItems } from '$features/hardware-console/assignment/workspace-key-menu';
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
    items={createMicroKeyAssignmentItems(workspaceId, closeMenu)}
    onClickOutside={closeMenu}
  />
{/if}
